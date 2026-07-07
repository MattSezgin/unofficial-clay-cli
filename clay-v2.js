#!/usr/bin/env node
/**
 * Clay CLI v2 prototype — full-fidelity operator primitives.
 *
 * Safety defaults:
 * - read commands redact by default
 * - mutating / credit-consuming commands require --confirm
 * - --workspace/--folder guard for writes should point at your sandbox folder during discovery
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const YAML = require('yaml');
const { ClayAPI } = require('./clay-api.js');
const { buildCommandProvenance } = require('./lib/provenance');
const { listIntegrations, getIntegration, validateSpecAgainstIntegrationRegistry, integrationPromotionReport, integrationPromotionMarkdown } = require('./lib/integration-library');
const { buildProofPacketFromManifest } = require('./lib/proof-harness');
const { readAndNormalizeActionsCatalog } = require('./lib/catalog-normalizer');
const { compareCatalogs, readCatalog } = require('./lib/catalog-delta');

const SENSITIVE_KEY_RE = /(cookie|authorization|bearer|token|api[_-]?key|apikey|secret|password|passwd|credential|private[_-]?key|session|webhook|slack|google[_-]?sheet|auth(?:Account)?Id|auth[_-]?id|appAccountId|apiToken|intercomHash|profilePicture|oauth|client[_-]?secret|campaign(?:Id|[_-]?id)|lead(?:Id|[_-]?id))/i;
const SENSITIVE_VALUE_RE = /(Bearer\s+[A-Za-z0-9._\-]+|sk-[A-Za-z0-9._\-]+|eyJ[A-Za-z0-9._\-]+|xox[baprs]-[A-Za-z0-9._\-]+|https:\/\/hooks\.slack\.com\/\S+|https:\/\/api\.clay\.com\/v3\/sources\/webhook\S+|https?:\/\/[^\s"'<>]*(?:webhook|token|signature|secret|api[_-]?key|client_secret)=[^\s"'<>]+|(?:api(?:[_-]?key)?|apikey|token|secret|password|client_secret|access_token|refresh_token|code)=['"]?[A-Za-z0-9._%+\-]{8,})/i;
const MUTATING = new Set(['create-workbook','create-table','update-table-settings','create-view','update-view','delete-view','create-field','create-action','update-field','create-output-field','add-rows','update-record','delete-record','view-field','create-field-group','delete-field','create-webhook-source','source-preview','source-import','run-top']);
const CREDIT = new Set(['run-top']);
const SPEC_MUTATING = new Set(['apply-spec']);
const OFFLINE = new Set(['redact', 'score', 'validate-spec', 'integration-list', 'integration-show', 'integration-validate-spec', 'integration-promotion-report', 'normalize-actions-catalog', 'catalog-delta']);
// Write scopes are environment-driven. This build ships with NO default workspace
// or folder - configure yours before any live command:
//   CLAY_WORKSPACE_ID   your workspace id (the number in the Clay app URL)
//   CLAY_FOLDER_ID      optional but recommended: restrict writes to one sandbox folder
//   CLAY_WRITE_SCOPES   optional: JSON array [{"name","workspaceId","folderId"}] for multiple scopes
const DEFAULT_WORKSPACE = process.env.CLAY_WORKSPACE_ID || '';
const DEFAULT_FOLDER = process.env.CLAY_FOLDER_ID || '';
function loadWriteScopes() {
  if (process.env.CLAY_WRITE_SCOPES) {
    let parsed;
    try { parsed = JSON.parse(process.env.CLAY_WRITE_SCOPES); } catch (err) {
      throw new Error(`CLAY_WRITE_SCOPES is not valid JSON: ${err.message}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some(s => !s || !s.name || !s.workspaceId)) {
      throw new Error('CLAY_WRITE_SCOPES must be a non-empty JSON array of {name, workspaceId, folderId}');
    }
    return parsed.map(s => ({ name: String(s.name), workspaceId: String(s.workspaceId), folderId: s.folderId ? String(s.folderId) : '' }));
  }
  if (DEFAULT_WORKSPACE) return [{ name: 'default', workspaceId: DEFAULT_WORKSPACE, folderId: DEFAULT_FOLDER }];
  return [];
}
const ALLOWED_WRITE_SCOPES = loadWriteScopes();
const DEV_MODE_SCOPE = ALLOWED_WRITE_SCOPES.length ? {
  ...ALLOWED_WRITE_SCOPES[0],
  maxRowsBeforeReadback: 10,
  exactCommandConfirmationRequired: false,
  autoConfirmAllowed: true,
} : null;
const NO_SCOPE_HINT = 'no write scope configured - set CLAY_WORKSPACE_ID (+ optional CLAY_FOLDER_ID), or CLAY_WRITE_SCOPES for multiple scopes';
function resolveWorkspace(explicit) {
  const id = explicit ? String(explicit) : DEFAULT_WORKSPACE;
  if (!id) throw new Error('no workspace configured - pass --workspace <id> or set CLAY_WORKSPACE_ID');
  return id;
}
function resolveFolder(explicit) {
  const id = explicit ? String(explicit) : DEFAULT_FOLDER;
  if (!id) throw new Error('no folder configured - pass --folder <id> or set CLAY_FOLDER_ID');
  return id;
}

function stableRedaction(value) {
  const source = value && typeof value === 'object' ? JSON.stringify(value) : String(value);
  const digest = crypto.createHash('sha256').update(source).digest('hex').slice(0, 12);
  return `<redacted:${digest}>`;
}

function createRedactionReport() {
  return {
    redactedLocationCount: 0,
    redactedByReason: {},
    redactedLocations: [],
    valuePolicy: 'Counts and JSON paths only; raw values are never included in this report.',
  };
}

function noteRedaction(report, pathExpression, reason) {
  if (!report) return;
  report.redactedLocationCount += 1;
  report.redactedByReason[reason] = (report.redactedByReason[reason] || 0) + 1;
  report.redactedLocations.push({ path: pathExpression, reason });
}

function redact(value, parentKey = '', report = null, pathExpression = '$') {
  if (Array.isArray(value)) return value.map((v, i) => redact(v, parentKey, report, `${pathExpression}[${i}]`));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const childPath = `${pathExpression}.${k.replace(/[^A-Za-z0-9_$]/g, '_')}`;
      if (SENSITIVE_KEY_RE.test(k)) {
        noteRedaction(report, childPath, 'sensitive_key');
        out[k] = stableRedaction(v);
      } else {
        out[k] = redact(v, k, report, childPath);
      }
    }
    return out;
  }
  if (typeof value === 'string') {
    if (SENSITIVE_KEY_RE.test(parentKey)) {
      noteRedaction(report, pathExpression, 'sensitive_parent_key');
      return stableRedaction(value);
    }
    return value.replace(new RegExp(SENSITIVE_VALUE_RE.source, SENSITIVE_VALUE_RE.flags.includes('g') ? SENSITIVE_VALUE_RE.flags : `${SENSITIVE_VALUE_RE.flags}g`), m => {
      noteRedaction(report, pathExpression, 'sensitive_value');
      return stableRedaction(m);
    });
  }
  return value;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) args[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[a.slice(2)] = argv[++i];
      else args[a.slice(2)] = true;
    } else args._.push(a);
  }
  return args;
}

function out(data, opts = {}) {
  const report = opts.raw ? null : createRedactionReport();
  const redacted = opts.raw ? data : redact(data, '', report);
  const text = JSON.stringify(redacted, null, 2) + '\n';
  if (opts.report && report) {
    fs.mkdirSync(path.dirname(opts.report), { recursive: true });
    fs.writeFileSync(opts.report, JSON.stringify(report, null, 2) + '\n');
  }
  if (opts.out) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, text);
    console.log(JSON.stringify({ wrote: opts.out, bytes: Buffer.byteLength(text), redacted: !opts.raw, redactionReport: opts.report || null }, null, 2));
  } else process.stdout.write(text);
}

function shellQuote(value) {
  const s = String(value);
  if (/^[A-Za-z0-9_./:=@%-]+$/.test(s)) return s;
  return JSON.stringify(s);
}

function exactCliCommand() {
  return ['node', 'clay-v2.js', ...process.argv.slice(2)].map(shellQuote).join(' ');
}

function withCommandProvenance(data, opts = {}) {
  return {
    ...data,
    provenance: buildCommandProvenance({
      commandId: opts.commandId,
      exactCommand: exactCliCommand(),
      exitCode: 0,
      stdoutPath: opts.stdoutPath || null,
      sourceFiles: opts.sourceFiles || [],
      workspaceId: opts.workspaceId,
      folderId: opts.folderId,
      workbookId: opts.workbookId,
      tableId: opts.tableId,
      viewId: opts.viewId,
    }),
  };
}

function devModeState() {
  return {
    mode: 'dev',
    scope: DEV_MODE_SCOPE,
    operatorLoop: [
      'live_readback',
      'one_exact_confirmed_live_action',
      'immediate_live_readback',
      'write_stop_state'
    ],
    warning: 'Dev mode is limited to your configured sandbox scope (first entry of your write scopes). Within that scope, it may proceed through small live Clay actions without separate chat approval; outside that scope normal confirmations apply.'
  };
}

function enforceNoAutoConfirm(flags) {
  const requested = flags['auto-confirm'] || flags['confirm-all'] || flags['yes-to-all'];
  if (!requested) return;
  if (flags['dev-mode']) return;
  console.error(JSON.stringify({
    safety: 'auto_confirm_not_supported_outside_dev_mode',
    reason: 'Auto-confirm is only allowed in --dev-mode scoped to your configured sandbox.',
    devMode: devModeState()
  }, null, 2));
  process.exit(2);
}

function enforceDevModeScope(flags) {
  if (!flags['dev-mode']) return;
  if (!DEV_MODE_SCOPE) throw new Error(`--dev-mode requires a configured write scope; ${NO_SCOPE_HINT}`);
  if (flags.workspace && String(flags.workspace) !== DEV_MODE_SCOPE.workspaceId) {
    throw new Error(`--dev-mode is scoped to workspace ${DEV_MODE_SCOPE.workspaceId}`);
  }
  if (flags.folder && DEV_MODE_SCOPE.folderId && String(flags.folder) !== DEV_MODE_SCOPE.folderId) {
    throw new Error(`--dev-mode is scoped to sandbox folder ${DEV_MODE_SCOPE.folderId}`);
  }
}

function mustConfirm(command, flags) {
  enforceNoAutoConfirm(flags);
  if (flags['dry-run']) return;
  const devModeAutoApproved = Boolean(flags['dev-mode']);
  if ((MUTATING.has(command) || SPEC_MUTATING.has(command) || CREDIT.has(command)) && !flags.confirm && !devModeAutoApproved) {
    console.error(JSON.stringify({
      safety: 'mutating_or_credit_consuming_command_requires_confirm',
      command,
      exactCommand: exactCliCommand(),
      hint: 'Re-run with --confirm after exact chat approval. Use --dry-run for preview where supported.',
      ...(flags['dev-mode'] ? { devMode: devModeState() } : {})
    }, null, 2));
    process.exit(2);
  }
}

async function readStdinJson() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return null;
  return JSON.parse(text);
}

async function getTableManifest(clay, tableId, viewId, opts = {}) {
  const query = {};
  if (viewId) {
    query.extraDataViewId = viewId;
    query.includeExtraData = 'true';
  }
  const { data } = await clay._request('GET', `/v3/tables/${tableId}`, Object.keys(query).length ? { query } : {});
  const table = data.table || data;
  const manifest = { table, extraData: data.extraData || null };

  if (opts.includeRows && viewId) {
    const idsResp = await clay._request('GET', `/v3/tables/${tableId}/views/${viewId}/records/ids`);
    const ids = idsResp.data.results || idsResp.data.recordIds || idsResp.data.ids || (Array.isArray(idsResp.data) ? idsResp.data : []);
    const recordIds = ids.slice(0, Number(opts.includeRows));
    const actionFieldIds = (table.fields || []).filter(f => f.type === 'action').map(f => f.id);
    if (recordIds.length) {
      const { data: bulk } = await clay._request('POST', `/v3/tables/${tableId}/bulk-fetch-records`, {
        body: { recordIds, includeExternalContentFieldIds: actionFieldIds }
      });
      manifest.records = bulk.results || bulk;
    } else manifest.records = [];
  }
  return manifest;
}

function normalizeFieldForScore(f) {
  const drop = new Set(['createdAt','updatedAt','creator','workspaceId','tableId','cellCount','supportedFilterOperators','abilities','actionDefinition']);
  const rec = (v) => {
    if (Array.isArray(v)) return v.map(rec);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, val] of Object.entries(v)) if (!drop.has(k)) o[k] = rec(val);
      return o;
    }
    return v;
  };
  return rec(f);
}

function readSpec(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (/\.ya?ml$/i.test(file)) return YAML.parse(text);
  return JSON.parse(text);
}

function cellValue(record, fieldId) {
  const cell = record?.cells?.[fieldId];
  if (cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'value')) return cell.value;
  return cell;
}

function findFieldByNames(fields, names) {
  const wanted = names.map(n => n.toLowerCase());
  return fields.find(f => wanted.includes(String(f.name || '').toLowerCase()));
}

function buildPeopleSourceSpecFromCompanyManifest(manifest, opts = {}) {
  const table = manifest.table || manifest;
  const fields = table.fields || [];
  const records = manifest.records || [];
  const sourceField = opts.companyTableFieldId
    ? fields.find(f => f.id === opts.companyTableFieldId)
    : fields.find(f => f.type === 'source');
  if (!sourceField) throw new Error('could not find company source field; pass --company-table-field FIELD');
  const domainField = opts.domainField
    ? fields.find(f => f.id === opts.domainField || f.name === opts.domainField)
    : findFieldByNames(fields, ['Resolved Domain', 'Domain', 'Company Domain']);
  if (!domainField) throw new Error('could not find domain field; pass --domain-field FIELD_OR_NAME');
  const domains = [...new Set(records.map(r => cellValue(r, domainField.id)).filter(v => typeof v === 'string' && v.includes('.') && !v.includes('://')))].slice(0, Number(opts.limit || 10));
  if (!domains.length) throw new Error(`no domains found in field ${domainField.name} (${domainField.id})`);
  const recordIds = records.map(r => r.id || r.recordId).filter(Boolean).slice(0, domains.length);
  if (recordIds.length !== domains.length) throw new Error(`record/domain count mismatch: ${recordIds.length} record IDs vs ${domains.length} domains`);
  return {
    workspaceId: resolveWorkspace(opts.workspaceId),
    source: {
      type: 'people',
      limit: Number(opts.limit || 10),
      filters: {
        about_keywords: [],
        certification_keywords: [],
        company_annual_revenues: [],
        company_description_keywords: [],
        company_description_keywords_exclude: [],
        company_identifier: domains,
        company_record_id: recordIds,
        company_table_id: table.id,
        company_table_view_id: opts.viewId,
        company_table_field_id: sourceField.id,
        company_sizes: [],
        company_industries_include: [],
        company_industries_exclude: [],
        connection_count: null,
        current_role_max_months_since_start_date: null,
        current_role_min_months_since_start_date: 1,
        exclude_entities_bitmap: null,
        exclude_entity_bitmap: null,
        exclude_entities_configuration: [],
        exclude_people_identifiers_mixed: [],
        experience_count: null,
        follower_count: 10,
        headline_keywords: [],
        include_company_filter_bitmap: null,
        include_company_filter_identifier_count: domains.length,
        include_past_experiences: false,
        job_description_keywords: [],
        job_functions: [],
        job_title_mode: 'smart',
        job_title_exact_keyword_match: null,
        job_title_exact_match: null,
        job_title_exclude_keywords: [],
        job_title_keywords: opts.jobTitleKeywords || ['Founder', 'CEO', 'Head of Growth', 'VP Marketing', 'Head of Marketing'],
        job_title_seniority_floor_level: null,
        job_title_seniority_levels: [],
        job_title_seniority_levels_v2: opts.seniorityLevels || ['founder', 'c-suite', 'vp', 'head'],
        job_title_seniority_match_mode: 'exact',
        languages: [],
        location_cities_exclude: [],
        location_cities_include: [],
        location_countries_exclude: [],
        location_countries_include: [],
        location_regions_exclude: [],
        location_regions_include: [],
        location_states_exclude: [],
        location_states_include: [],
        locations: [],
        locations_exclude: [],
        max_connection_count: null,
        max_experience_count: null,
        max_follower_count: 20000,
        name: '',
        names: [],
        previous_entities_bitmap: null,
        profile_keywords: [],
        role_range_end_month: null,
        role_range_start_month: null,
        school_names: [],
        search_raw_location: false,
        start_from_method: 'query',
      },
      extract: [
        { name: 'Full Name', type: 'text', path: 'name' },
        { name: 'Job Title', type: 'text', path: 'latest_experience_title' },
        { name: 'LinkedIn Profile', type: 'text', path: 'url' },
        { name: 'Current Company', type: 'text', path: 'latest_experience_company_name' },
      ],
    },
    generatedFrom: {
      companyTableId: table.id,
      companyViewId: opts.viewId,
      companySourceFieldId: sourceField.id,
      domainFieldId: domainField.id,
      domainFieldName: domainField.name,
      companyCount: domains.length,
    },
  };
}

function resolveEnvPlaceholders(value, env = process.env) {
  if (Array.isArray(value)) return value.map(item => resolveEnvPlaceholders(item, env));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, resolveEnvPlaceholders(val, env)]));
  }
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (match, name, fallback) => {
    if (env[name] !== undefined && env[name] !== '') return env[name];
    if (fallback !== undefined) return fallback;
    return match;
  });
}

function findUnresolvedPlaceholders(value, at = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findUnresolvedPlaceholders(item, `${at}[${index}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, val] of Object.entries(value)) findUnresolvedPlaceholders(val, `${at}.${key}`, found);
    return found;
  }
  if (typeof value === 'string' && /\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/.test(value)) found.push({ path: at, value });
  return found;
}

function assertAllowedWorkspace(workspaceId) {
  if (!ALLOWED_WRITE_SCOPES.length) throw new Error(NO_SCOPE_HINT);
  const id = resolveWorkspace(workspaceId);
  if (!ALLOWED_WRITE_SCOPES.some(scope => scope.workspaceId === id)) {
    throw new Error(`writes are restricted to your approved workspaces: ${ALLOWED_WRITE_SCOPES.map(scope => scope.workspaceId).join(', ')} (extend via CLAY_WRITE_SCOPES)`);
  }
}

function assertAllowedFolder(folderId) {
  if (!ALLOWED_WRITE_SCOPES.length) throw new Error(NO_SCOPE_HINT);
  const scopedFolders = ALLOWED_WRITE_SCOPES.map(scope => scope.folderId).filter(Boolean);
  if (folderId && scopedFolders.length && !scopedFolders.includes(String(folderId))) {
    throw new Error(`writes are restricted to your approved folders: ${scopedFolders.join(', ')} (extend via CLAY_WRITE_SCOPES)`);
  }
}

function assertAllowedScope(workspaceId, folderId) {
  if (!ALLOWED_WRITE_SCOPES.length) throw new Error(NO_SCOPE_HINT);
  const ws = resolveWorkspace(workspaceId);
  const scope = ALLOWED_WRITE_SCOPES.find(s => s.workspaceId === ws && (!s.folderId || s.folderId === String(folderId)));
  if (!scope) {
    throw new Error(`workspace/folder pair is not an approved write scope: ${ws}/${folderId} (extend via CLAY_WRITE_SCOPES)`);
  }
  return scope;
}

function writeSpec(spec, file) {
  const text = /\.json$/i.test(file) ? JSON.stringify(spec, null, 2) + '\n' : YAML.stringify(spec);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { wrote: file, bytes: Buffer.byteLength(text) };
}

function specFromManifest(manifest, viewId) {
  const table = manifest.table;
  const view = viewId && (table.views || []).find(v => v.id === viewId) || null;
  const fields = table.fields || [];
  const byParent = new Map();
  for (const f of fields) {
    const parent = f.extractedField?.fieldIdExtractedFrom;
    if (parent) {
      byParent.set(parent, [...(byParent.get(parent) || []), f]);
    }
  }
  const parentIds = new Set([...byParent.values()].flat().map(f => f.id));
  const specFields = [];
  for (const f of fields) {
    if (['f_created_at', 'f_updated_at'].includes(f.id)) continue;
    if (parentIds.has(f.id)) continue;
    const vf = view?.fields?.[f.id] || {};
    const base = { name: f.name, id: f.id, type: f.type };
    if (vf.isVisible === false) base.visible = false;
    if (vf.width) base.width = vf.width;
    if (f.type === 'formula') {
      base.formula = f.typeSettings?.formulaText;
      base.dataType = f.typeSettings?.dataTypeSettings?.type || f.typeSettings?.formulaType || 'text';
      if (f.typeSettings?.mappedResultPath) base.mappedResultPath = f.typeSettings.mappedResultPath;
    } else if (f.type === 'action') {
      base.actionKey = f.typeSettings?.actionKey;
      base.actionPackageId = f.typeSettings?.actionPackageId;
      base.actionVersion = f.typeSettings?.actionVersion;
      base.dataType = f.typeSettings?.dataTypeSettings?.type || 'json';
      if (f.typeSettings?.authAccountId) base.authAccountId = f.typeSettings.authAccountId;
      if (f.typeSettings?.conditionalRunFormulaText) base.runCondition = f.typeSettings.conditionalRunFormulaText;
      if (f.typeSettings?.runAsButton !== undefined) base.runAsButton = f.typeSettings.runAsButton;
      base.inputs = Object.fromEntries((f.typeSettings?.inputsBinding || []).filter(b => b.formulaText !== undefined).map(b => [b.name, b.formulaText]));
      const parsedSchema = parseAnswerSchemaFields(f);
      if (Object.keys(parsedSchema.fields || {}).length) {
        base.outputs = Object.entries(parsedSchema.fields).map(([name, cfg]) => ({ name, type: cfg.type === 'string' ? 'text' : cfg.type, path: name }));
      }
      const outputs = byParent.get(f.id) || [];
      if (outputs.length) {
        base.extractOutputs = true;
        base.extractedOutputs = outputs.map(o => ({ name: o.name, id: o.id, type: o.typeSettings?.dataTypeSettings?.type || o.typeSettings?.formulaType || 'text', path: o.typeSettings?.mappedResultPath || (o.extractedField?.extractedKeyPath || '').replace(/^\?\./, '').split('.').filter(Boolean) }));
        if (!base.outputs) base.outputs = base.extractedOutputs.map(o => ({ name: o.name, type: o.type, path: Array.isArray(o.path) ? o.path.join('.') : o.path }));
      }
    } else {
      base.dataType = f.typeSettings?.dataTypeSettings?.type || f.type;
      if (f.typeSettings?.dataTypeSettings?.options) base.options = f.typeSettings.dataTypeSettings.options;
    }
    specFields.push(base);
  }
  return {
    claySpecVersion: 1,
    workspaceId: table.workspaceId || resolveWorkspace(),
    workbookId: table.workbookId,
    table: { id: table.id, name: table.name, type: table.type || 'spreadsheet' },
    view: view ? { id: view.id, name: view.name } : (viewId ? { id: viewId } : undefined),
    fields: specFields
  };
}

function useAiModelCompatibilityIssue(inputs = {}) {
  const unquote = value => String(value || '').trim().replace(/^['"]|['"]$/g, '');
  const useCase = unquote(inputs.useCase || '');
  const model = unquote(inputs.model || '');
  if (/^clay-/i.test(model) && useCase && useCase !== 'claygent') {
    return {
      severity: 'error',
      type: 'use_ai_model_usecase_incompatible',
      message: `Clay-native model ${model} must use useCase "claygent"; useCase "${useCase}" fails at runtime with "Model does not support Use AI".`,
      model,
      useCase,
    };
  }
  return null;
}

function validateSpecObject(spec) {
  const issues = [];
  if (!spec || typeof spec !== 'object') issues.push({ severity: 'error', type: 'invalid_spec', message: 'spec must be an object' });
  const isSourceSpec = !!(spec.source || spec.type === 'companies' || spec.type === 'people');
  if (isSourceSpec) {
    const source = spec.source || spec;
    if (!['companies', 'people'].includes(source.type)) issues.push({ severity: 'error', type: 'invalid_source_type', message: 'source.type must be companies or people' });
    if (!source.filters || typeof source.filters !== 'object') issues.push({ severity: 'error', type: 'missing_source_filters', message: 'source.filters object required' });
    return { valid: !issues.some(i => i.severity === 'error'), issueCount: issues.length, issues };
  }
  if (!spec.table?.id && !spec.table?.name) issues.push({ severity: 'error', type: 'missing_table', message: 'table.id or table.name required' });
  if (!Array.isArray(spec.fields) && !Array.isArray(spec.sources)) issues.push({ severity: 'error', type: 'missing_fields', message: 'fields or sources must be an array' });
  for (const s of spec.sources || []) {
    if (!['companies', 'people'].includes(s.type)) issues.push({ severity: 'error', type: 'invalid_source_type', sourceName: s.name, message: 'source.type must be companies or people' });
    if (s.type === 'people' && s.import) issues.push({ severity: 'warning', type: 'people_source_import_not_verified', sourceName: s.name, message: 'people preview verified; import endpoint not yet verified.' });
  }
  const names = new Set();
  for (const f of spec.fields || []) {
    if (!f.name) issues.push({ severity: 'error', type: 'field_missing_name', field: f });
    if (names.has(f.name)) issues.push({ severity: 'error', type: 'duplicate_field_name', fieldName: f.name });
    names.add(f.name);
    if (f.type === 'action' || f.actionKey) {
      if (!f.actionKey) issues.push({ severity: 'error', type: 'action_missing_actionKey', fieldName: f.name });
      if (f.actionKey === 'use-ai') {
        if (!f.inputs?.prompt) issues.push({ severity: 'error', type: 'use_ai_missing_prompt', fieldName: f.name });
        const compatibility = useAiModelCompatibilityIssue(f.inputs || {});
        if (compatibility) issues.push({ ...compatibility, fieldName: f.name });
        const modelText = String(f.inputs?.model || '');
        const usesClayNativeModel = /"clay-/.test(modelText) || /^clay-/.test(modelText);
        if (!f.authAccountId && !usesClayNativeModel) issues.push({ severity: 'error', type: 'use_ai_missing_authAccountId', fieldName: f.name });
        if (String(f.authAccountId || '').startsWith('<redacted:')) issues.push({ severity: 'error', type: 'redacted_authAccountId_not_applyable', fieldName: f.name });
        if (!Array.isArray(f.outputs) || !f.outputs.length) issues.push({ severity: 'error', type: 'use_ai_missing_outputs', fieldName: f.name, message: 'Must model Clay UI Define outputs -> Fields.' });
      }
      if (f.actionKey === 'http-api-v2' && !f.inputs?.url) {
        issues.push({ severity: 'error', type: 'http_api_missing_internal_url_input', fieldName: f.name, message: 'Clay UI label Endpoint maps to internal input name url.' });
      }
    }
    if (f.outputs) for (const o of f.outputs) if (!o.name || !o.path) issues.push({ severity: 'error', type: 'output_missing_name_or_path', fieldName: f.name, output: o });
  }
  return { valid: !issues.some(i => i.severity === 'error'), issueCount: issues.length, issues };
}

function specFieldSig(f) {
  return JSON.stringify({ name: f.name, type: f.type, actionKey: f.actionKey, inputs: f.inputs, outputs: f.outputs, runCondition: f.runCondition, runAsButton: f.runAsButton, formula: f.formula, dataType: f.dataType, options: f.options, visible: f.visible, width: f.width });
}

function diffSpecToLive(spec, liveSpec) {
  const liveByName = new Map((liveSpec.fields || []).map(f => [f.name, f]));
  const desiredByName = new Map((spec.fields || []).map(f => [f.name, f]));
  const changes = [];
  for (const f of spec.fields || []) {
    const live = liveByName.get(f.name);
    if (!live) changes.push({ op: 'create_field', field: f.name, desired: f });
    else if (specFieldSig(f) !== specFieldSig({ ...live, id: undefined })) changes.push({ op: 'update_field', field: f.name, live, desired: f });
  }
  for (const f of liveSpec.fields || []) if (!desiredByName.has(f.name)) changes.push({ op: 'extra_live_field', field: f.name, live: f, message: 'Not deleted unless spec delete policy is added.' });
  return { changeCount: changes.length, changes };
}

async function createOutputField(clay, tableId, parentId, output) {
  const requestedType = output.type || output.dataType || 'text';
  // Clay formulaType is stricter than dataType; URL/email extracted fields are created as text formulas.
  const formulaType = ['url', 'email'].includes(String(requestedType).toLowerCase()) ? 'text' : requestedType;
  const dataType = formulaType;
  const pathParts = Array.isArray(output.path) ? output.path : String(output.path || output.name).split('.').filter(Boolean);
  const formulaPath = pathParts.map(p => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p) ? `.${p}` : `?.[${JSON.stringify(p)}]`).join('');
  const formulaText = `{{${parentId}}}${formulaPath}`;
  const { data } = await clay._request('POST', `/v3/tables/${tableId}/fields`, { body: { name: output.name, type: 'formula', typeSettings: { dataTypeSettings: { type: dataType }, formulaType, formulaText, mappedResultPath: pathParts }, inputFieldIds: [parentId] } });
  return data.field || data;
}

function resolveFieldRefs(text, fieldIdByName) {
  if (typeof text !== 'string') return text;
  return text.replace(/\{\{([^}]+)\}\}/g, (m, inner) => {
    const key = inner.trim();
    if (/^f_/.test(key)) return m;
    return fieldIdByName.get(key) ? `{{${fieldIdByName.get(key)}}}` : m;
  });
}

function extractFieldIdsFromFormulaText(text) {
  if (typeof text !== 'string') return [];
  return [...new Set([...text.matchAll(/\{\{\s*(f_[A-Za-z0-9]+)\s*\}\}/g)].map(match => match[1]))];
}

function inputFieldIdsFromBindings(bindings = [], extraFormulaTexts = []) {
  const ids = [];
  for (const binding of bindings) {
    if (binding?.formulaText) ids.push(...extractFieldIdsFromFormulaText(binding.formulaText));
    if (binding?.formulaMap) for (const value of Object.values(binding.formulaMap)) ids.push(...extractFieldIdsFromFormulaText(value));
  }
  for (const text of extraFormulaTexts) ids.push(...extractFieldIdsFromFormulaText(text));
  return [...new Set(ids)];
}

function expectedInputFieldIdsForActionSpec(f, inputBindings, runCondition) {
  const explicit = Array.isArray(f.inputFieldIds) && f.inputFieldIds.length ? f.inputFieldIds : null;
  return explicit || inputFieldIdsFromBindings(inputBindings, runCondition ? [runCondition] : []);
}

function dependencyReadbackForField(field, expectedInputFieldIds = []) {
  const actual = Array.isArray(field?.inputFieldIds) ? field.inputFieldIds : [];
  const missing = expectedInputFieldIds.filter(id => !actual.includes(id));
  const extra = actual.filter(id => !expectedInputFieldIds.includes(id));
  return {
    fieldId: field?.id || null,
    fieldName: field?.name || null,
    expectedInputFieldIds: [...expectedInputFieldIds].sort(),
    actualInputFieldIds: [...actual].sort(),
    missing,
    extra,
    ok: missing.length === 0,
  };
}

function clayOutputType(t) {
  const x = String(t || 'text').toLowerCase();
  if (['text', 'string', 'url', 'email'].includes(x)) return 'string';
  if (['number', 'currency'].includes(x)) return 'number';
  if (['boolean', 'checkbox'].includes(x)) return 'boolean';
  if (['object', 'json'].includes(x)) return 'object';
  if (['array', 'list'].includes(x)) return 'array';
  return 'string';
}

function parseOutputsSpec(value) {
  return String(value || '').split(',').filter(Boolean).map(spec => {
    const [outName, outType = 'text', outPath = outName] = spec.split(':');
    return { name: outName, type: outType, path: outPath };
  });
}

function answerSchemaBinding(outputs, format = 'json-schema') {
  if (!Array.isArray(outputs) || !outputs.length) return null;
  if (format === 'fields') {
    const fields = {};
    for (const o of outputs) fields[o.path || o.name] = { type: clayOutputType(o.type || o.dataType) };
    return { name: 'answerSchemaType', formulaMap: { type: '"json"', fields: JSON.stringify(fields), jsonType: '"Fields"' }, optional: true };
  }
  const schema = outputJsonSchema(outputs);
  return { name: 'answerSchemaType', formulaMap: { type: '"json"', jsonType: '"JSONSchema"', jsonSchema: JSON.stringify(JSON.stringify(schema, null, 2)) }, optional: true };
}

function outputJsonSchema(outputs = []) {
  const properties = {};
  const required = [];
  for (const output of outputs) {
    const key = output.path || output.name;
    properties[key] = { type: clayOutputType(output.type || output.dataType) };
    required.push(key);
  }
  return { type: 'object', properties, required };
}

function parseAnswerSchemaFields(field = {}) {
  const schemaBinding = (field.typeSettings?.inputsBinding || []).find(binding => binding.name === 'answerSchemaType');
  if (!schemaBinding?.formulaMap) return { fields: {}, rawBinding: schemaBinding || null, parseError: null };
  try {
    if (schemaBinding.formulaMap.fields) {
      return { fields: JSON.parse(schemaBinding.formulaMap.fields), rawBinding: schemaBinding, parseError: null };
    }
    if (schemaBinding.formulaMap.jsonSchema) {
      const rawSchema = JSON.parse(schemaBinding.formulaMap.jsonSchema);
      const schema = typeof rawSchema === 'string' ? JSON.parse(rawSchema) : rawSchema;
      return { fields: schema.properties || {}, rawBinding: schemaBinding, parseError: null };
    }
    return { fields: {}, rawBinding: schemaBinding, parseError: null };
  } catch (error) {
    return { fields: {}, rawBinding: schemaBinding, parseError: error.message };
  }
}

function expectedOutputMap(outputs = []) {
  const expected = {};
  for (const output of outputs) expected[output.path || output.name] = { type: clayOutputType(output.type || output.dataType) };
  return expected;
}

function verifyFieldOutputSchema(table, fieldRef, outputs = []) {
  const field = (table.fields || []).find(candidate => candidate.id === fieldRef || candidate.name === fieldRef);
  if (!field) {
    return {
      valid: false,
      table: { id: table.id || null, name: table.name || null },
      field: { ref: fieldRef, found: false },
      expected: expectedOutputMap(outputs),
      actual: {},
      missing: outputs.map(output => output.path || output.name),
      extra: [],
      typeMismatches: [],
      hasDefaultResponseOnly: false,
      issues: [{ type: 'field_not_found', severity: 'error', message: `Field not found: ${fieldRef}` }],
    };
  }

  const expected = expectedOutputMap(outputs);
  const parsed = parseAnswerSchemaFields(field);
  const actual = parsed.fields || {};
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  const missing = expectedKeys.filter(key => !Object.prototype.hasOwnProperty.call(actual, key));
  const extra = actualKeys.filter(key => !Object.prototype.hasOwnProperty.call(expected, key));
  const typeMismatches = expectedKeys
    .filter(key => actual[key] && actual[key].type !== expected[key].type)
    .map(key => ({ field: key, expected: expected[key].type, actual: actual[key].type }));
  const hasDefaultResponseOnly = actualKeys.length === 1 && actualKeys[0] === 'response';
  const issues = [];

  if (field.type !== 'action' || field.typeSettings?.actionKey !== 'use-ai') {
    issues.push({ type: 'not_use_ai_action', severity: 'warning', actionKey: field.typeSettings?.actionKey || null, message: 'Field is not a Use AI action field.' });
  }
  if (!parsed.rawBinding) {
    issues.push({ type: 'schema_missing', severity: 'error', message: 'Field has no answerSchemaType binding; Clay UI will not show the expected JSON Schema outputs.' });
  }
  if (parsed.parseError) {
    issues.push({ type: 'schema_parse_error', severity: 'error', message: parsed.parseError });
  }
  if (hasDefaultResponseOnly) {
    issues.push({ type: 'default_response_only', severity: 'error', message: 'Field output schema only contains the default response key.' });
  }
  for (const key of missing) issues.push({ type: 'missing_output', severity: 'error', field: key });
  for (const mismatch of typeMismatches) issues.push({ type: 'output_type_mismatch', severity: 'error', ...mismatch });
  for (const key of extra) issues.push({ type: 'extra_output', severity: 'warning', field: key });

  return {
    valid: issues.filter(issue => issue.severity === 'error').length === 0,
    table: { id: table.id || null, name: table.name || null },
    field: {
      id: field.id,
      name: field.name,
      type: field.type,
      actionKey: field.typeSettings?.actionKey || null,
    },
    expected,
    actual,
    missing,
    extra,
    typeMismatches,
    hasDefaultResponseOnly,
    issues,
  };
}

function mergeAnswerSchemaBinding(inputBindings = [], outputs = []) {
  const schema = answerSchemaBinding(outputs);
  if (!schema) return inputBindings;
  return [
    ...inputBindings.filter(binding => binding.name !== 'answerSchemaType'),
    schema,
  ];
}

function actionSchemaSummaries(fields = []) {
  return fields
    .filter(field => field.type === 'action' || field.actionKey)
    .map(field => {
      const outputs = Array.isArray(field.outputs) ? field.outputs : [];
      const schema = answerSchemaBinding(outputs);
      return {
        field: field.name || null,
        actionKey: field.actionKey || null,
        outputCount: outputs.length,
        outputFields: outputs.map(output => output.path || output.name).filter(Boolean),
        outputFormat: outputs.length ? 'JSON Schema' : 'none',
        outputJsonSchema: outputs.length ? outputJsonSchema(outputs) : null,
        answerSchemaBinding: schema,
      };
    });
}

async function createFieldFromSpec(clay, tableId, f, fieldIdByName = new Map()) {
  let body;
  if (f.type === 'formula') {
    body = { name: f.name, type: 'formula', typeSettings: { dataTypeSettings: { type: f.dataType || 'text' }, formulaType: f.dataType || 'text', formulaText: resolveFieldRefs(f.formula, fieldIdByName) } };
  } else if (f.type === 'action' || f.actionKey) {
    const inputBindings = Object.entries(f.inputs || {}).map(([name, formulaText]) => ({ name, formulaText: resolveFieldRefs(formulaText, fieldIdByName) }));
    if (f.actionKey === 'use-ai') {
      const schema = answerSchemaBinding(f.outputs);
      if (schema && !inputBindings.some(b => b.name === 'answerSchemaType')) inputBindings.push(schema);
    }
    const typeSettings = { dataTypeSettings: { type: f.dataType || 'json' }, actionKey: f.actionKey, actionPackageId: f.actionPackageId, actionVersion: f.actionVersion || 1, inputsBinding: inputBindings };
    const runCondition = f.runCondition ? resolveFieldRefs(f.runCondition, fieldIdByName) : null;
    if (runCondition) typeSettings.conditionalRunFormulaText = runCondition;
    if (f.runAsButton !== undefined) typeSettings.runAsButton = !!f.runAsButton;
    if (f.authAccountId) typeSettings.authAccountId = f.authAccountId;
    body = { name: f.name, type: 'action', typeSettings, inputFieldIds: expectedInputFieldIdsForActionSpec(f, inputBindings, runCondition) };
  } else {
    body = { name: f.name, type: f.type || f.dataType || 'text', typeSettings: { dataTypeSettings: { type: f.dataType || f.type || 'text', ...(f.options ? { options: f.options } : {}) } } };
  }
  const { data } = await clay._request('POST', `/v3/tables/${tableId}/fields`, { body });
  const created = data.field || data;
  const outputs = [];
  if (f.extractOutputs) for (const o of f.outputs || []) outputs.push(await createOutputField(clay, tableId, created.id, o));
  return { created, outputs };
}

function tableTemplateFromManifest(manifest, viewId, opts = {}) {
  const spec = specFromManifest(manifest, viewId);
  const includeRows = Number(opts.includeRows || 0);
  if (includeRows > 0 && Array.isArray(manifest.records)) {
    const fields = manifest.table?.fields || [];
    const fieldsById = new Map(fields.map(field => [field.id, field]));
    spec.rows = manifest.records.slice(0, includeRows).map(record => {
      const row = {};
      for (const [fieldId, cell] of Object.entries(record.cells || {})) {
        const field = fieldsById.get(fieldId);
        if (!field || ['action', 'formula', 'source'].includes(field.type)) continue;
        row[field.name] = cell && typeof cell === 'object' && Object.prototype.hasOwnProperty.call(cell, 'value') ? cell.value : cell;
      }
      return row;
    });
  }
  return spec;
}

async function fullWorkbookExport(clay, workbookId, opts = {}) {
  const workspaceId = resolveWorkspace(opts.workspaceId);
  const includeRows = Number(opts.includeRows || 0);
  const { data } = await clay._request('GET', `/v3/workbooks/${workbookId}/tables`);
  const shallowTables = Array.isArray(data) ? data : (data.tables || []);
  const tables = [];
  const templates = [];
  for (const shallow of shallowTables) {
    const viewId = shallow.firstViewId || shallow.views?.[0]?.id;
    const manifest = await getTableManifest(clay, shallow.id, viewId, { includeRows });
    let sources = [];
    try {
      const sourceResp = await clay._request('GET', '/v3/sources', { query: { tableId: shallow.id } });
      sources = sourceResp.data || [];
    } catch (error) {
      sources = [{ exportError: error.message }];
    }
    const actionDefinitions = (manifest.table?.fields || [])
      .filter(field => field.type === 'action')
      .map(field => ({ fieldId: field.id, fieldName: field.name, actionDefinition: field.actionDefinition || null, typeSettings: field.typeSettings || {} }));
    tables.push({
      id: shallow.id,
      name: manifest.table?.name || shallow.name,
      firstViewId: viewId || null,
      manifest,
      sources,
      actionDefinitions,
    });
    templates.push(tableTemplateFromManifest(manifest, viewId, { includeRows }));
  }
  return withCommandProvenance({
    kind: 'clay-full-workbook-export',
    exportVersion: 1,
    workspaceId,
    workbookId,
    tableCount: tables.length,
    includeRows,
    security: {
      redactedByDefault: true,
      redactionNotes: [
        'authAccountId, tokens, cookies, webhook URLs, API keys, private keys, and provider credentials are stable-redacted unless --raw is explicitly used.',
        'Templates preserve formula/prompt/schema shape while redacting sensitive IDs and values.'
      ],
    },
    tables,
    templates,
  }, { commandId: 'clay-full-workbook-export', workspaceId, workbookId });
}


function slugifyName(value) {
  return String(value || 'unnamed').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unnamed';
}

function writeJsonFile(file, data, opts = {}) {
  const payload = opts.raw ? data : redact(data);
  const text = JSON.stringify(payload, null, 2) + '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { wrote: file, bytes: Buffer.byteLength(text) };
}

function actionInventoryFromWorkbookExport(exported, sourcePath = null) {
  const actions = [];
  for (const table of exported.tables || []) {
    const fields = table.manifest?.table?.fields || [];
    const byParent = new Map();
    for (const field of fields) {
      const parent = field.extractedField?.fieldIdExtractedFrom;
      if (parent) byParent.set(parent, [...(byParent.get(parent) || []), field]);
    }
    for (const field of fields.filter(f => f.type === 'action')) {
      const ts = field.typeSettings || {};
      const inputsBinding = ts.inputsBinding || [];
      const inputs = {};
      if (Array.isArray(inputsBinding)) {
        for (const binding of inputsBinding) inputs[binding.name] = binding.formulaText || binding.formulaMap || null;
      }
      const extractedOutputs = (byParent.get(field.id) || []).map(output => ({
        id: output.id,
        name: output.name,
        formulaText: output.typeSettings?.formulaText || null,
        mappedResultPath: output.typeSettings?.mappedResultPath || null,
        extractedField: output.extractedField || null,
      }));
      actions.push({
        workspaceId: exported.workspaceId,
        workbookId: exported.workbookId,
        source_export: sourcePath,
        table: { id: table.id, name: table.name },
        field: { id: field.id, name: field.name },
        actionKey: ts.actionKey || null,
        actionPackageId: ts.actionPackageId || null,
        actionVersion: ts.actionVersion || null,
        authAccountIdPresent: Boolean(ts.authAccountId),
        runAsButton: Boolean(ts.runAsButton),
        runCondition: ts.conditionalRunFormulaText || null,
        inputBindingNames: Object.keys(inputs),
        inputs,
        answerSchemaType: inputs.answerSchemaType || null,
        promptPreview: typeof inputs.prompt === 'string' ? inputs.prompt.slice(0, 500) : null,
        promptHash: typeof inputs.prompt === 'string' ? crypto.createHash('sha256').update(inputs.prompt).digest('hex') : null,
        extractedOutputs,
      });
    }
  }
  return actions;
}

function summarizeIntegrationGaps(actions, registry) {
  const integrations = registry.integrations || {};
  const byKey = new Map();
  for (const action of actions.filter(a => a.actionKey)) byKey.set(action.actionKey, [...(byKey.get(action.actionKey) || []), action]);
  const unknown = [];
  const updates = [];
  for (const [actionKey, items] of byKey.entries()) {
    const existing = integrations[actionKey];
    const packageIds = [...new Set(items.map(i => i.actionPackageId).filter(Boolean))].sort();
    const versions = [...new Set(items.map(i => i.actionVersion).filter(v => v != null))].sort();
    const inputs = [...new Set(items.flatMap(i => i.inputBindingNames || []))].sort();
    const outputs = [...new Set(items.flatMap(i => (i.extractedOutputs || []).map(o => o.name).filter(Boolean)))].sort();
    const observedIn = items.map(i => ({ workbookId: i.workbookId, table: i.table?.name, field: i.field?.name }));
    const summary = { actionKey, actionPackageIds: packageIds, actionVersions: versions, requiredInputsObserved: inputs, extractedOutputsObserved: outputs, authRequiredObserved: items.some(i => i.authAccountIdPresent), runConditionObserved: items.some(i => i.runCondition), observedIn };
    if (!existing) unknown.push(summary);
    else {
      const missingPackageIds = packageIds.filter(id => !(existing.actionPackageIds || []).includes(id));
      const missingInputs = inputs.filter(name => !(existing.requiredInputsObserved || []).includes(name));
      const missingOutputs = outputs.filter(name => !(existing.extractedOutputsObserved || []).includes(name));
      if (missingPackageIds.length || missingInputs.length || missingOutputs.length || (summary.authRequiredObserved && !existing.authRequiredObserved) || (summary.runConditionObserved && !existing.runConditionObserved)) {
        updates.push({ actionKey, missingPackageIds, missingInputs, missingOutputs, authRequiredObserved: summary.authRequiredObserved, runConditionObserved: summary.runConditionObserved, observedIn });
      }
    }
  }
  return { unknownActionCount: unknown.length, updateActionCount: updates.length, unknown, updates };
}

function mergeActionsIntoRegistry(registry, actions, sourceLabel = 'workspace-onboarding') {
  const next = JSON.parse(JSON.stringify(registry));
  next.integrations = next.integrations || {};
  const gaps = summarizeIntegrationGaps(actions, next);
  for (const item of gaps.unknown) {
    next.integrations[item.actionKey] = { ...item, status: `discovered_from_${sourceLabel}`, promotionStatus: 'discovered' };
  }
  for (const update of gaps.updates) {
    const existing = next.integrations[update.actionKey];
    if (!existing.promotionStatus) existing.promotionStatus = 'discovered';
    existing.actionPackageIds = [...new Set([...(existing.actionPackageIds || []), ...update.missingPackageIds])].sort();
    existing.requiredInputsObserved = [...new Set([...(existing.requiredInputsObserved || []), ...update.missingInputs])].sort();
    existing.extractedOutputsObserved = [...new Set([...(existing.extractedOutputsObserved || []), ...update.missingOutputs])].sort();
    existing.authRequiredObserved = Boolean(existing.authRequiredObserved || update.authRequiredObserved);
    existing.runConditionObserved = Boolean(existing.runConditionObserved || update.runConditionObserved);
    existing.observedIn = [...(existing.observedIn || []), ...update.observedIn];
  }
  return { registry: next, gaps };
}

function integrationDocForSummary(summary) {
  const observed = (summary.observedIn || []).map(o => `- \`${o.workbookId}\` / \`${o.table}\` / \`${o.field}\``).join('\n') || '- Not recorded';
  const inputs = (summary.requiredInputsObserved || []).map(i => `- \`${i}\``).join('\n') || '- None observed';
  const outputs = (summary.extractedOutputsObserved || []).map(o => `- \`${o}\``).join('\n') || '- None observed yet; inspect parent fullValue before assuming output paths.';
  return `# Clay Integration: ${summary.actionKey}\n\n## Status\n\nPromotion status: \`discovered\`. This was discovered by \`onboard-workspace\`; it needs human review plus <=10-row sandbox proof before being marked \`reviewed\` or \`battle-tested\`.\n\n## Real Source Evidence\n\n${observed}\n\n## Action Identity\n\n- \`actionKey\`: \`${summary.actionKey}\`\n- \`actionPackageId\`: \`${(summary.actionPackageIds || [])[0] || ''}\`\n- \`actionVersion\`: \`${(summary.actionVersions || [])[0] || 1}\`\n- Auth observed: \`${Boolean(summary.authRequiredObserved)}\`\n- Run condition observed: \`${Boolean(summary.runConditionObserved)}\`\n\n## Observed Input Bindings\n\n${inputs}\n\n## Observed Extracted Outputs\n\n${outputs}\n\n## Promotion Checklist\n\n1. Confirm required vs optional inputs.\n2. Capture auth account type and env/profile mapping.\n3. Create or refine \`integration-library/templates/${summary.actionKey}.yaml\`.\n4. Run <=10 rows in your sandbox folder.\n5. Verify parent action fullValue, extracted values, status semantics, and value-level QA.\n`;
}

function integrationTemplateForSummary(summary) {
  const packageId = (summary.actionPackageIds || [])[0] || '';
  const version = (summary.actionVersions || [])[0] || 1;
  const field = {
    name: summary.actionKey,
    type: 'action',
    actionKey: summary.actionKey,
    actionPackageId: packageId,
    actionVersion: version,
    dataType: 'json',
    strictIntegrationCoverage: true,
    inputs: Object.fromEntries((summary.requiredInputsObserved || []).map(name => [name, `\${${String(name).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}}`])),
    outputs: (summary.extractedOutputsObserved || []).map(name => ({ name, type: 'text', path: String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') })),
  };
  if (summary.authRequiredObserved) field.authEnv = `CLAY_${summary.actionKey.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_AUTH_ACCOUNT_ID`;
  if (summary.runConditionObserved) field.runCondition = '!!{{Required Input}}';
  return { integrationTemplateVersion: 1, actionKey: summary.actionKey, promotionStatus: 'discovered', status: 'discovered_by_onboard_workspace', field };
}

function updateIntegrationLibraryFromActions(actions, outDir) {
  const registryPath = path.join(__dirname, 'integration-library', 'registry.yaml');
  const registry = YAML.parse(fs.readFileSync(registryPath, 'utf8'));
  const { registry: merged, gaps } = mergeActionsIntoRegistry(registry, actions, 'workspace_onboarding');
  writeSpec(merged, registryPath);
  const docsDir = path.join(__dirname, 'docs', 'integrations');
  const templatesDir = path.join(__dirname, 'integration-library', 'templates');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(templatesDir, { recursive: true });
  for (const summary of gaps.unknown) {
    const docPath = path.join(docsDir, `${summary.actionKey}.md`);
    const templatePath = path.join(templatesDir, `${summary.actionKey}.yaml`);
    if (!fs.existsSync(docPath)) fs.writeFileSync(docPath, integrationDocForSummary(summary));
    if (!fs.existsSync(templatePath)) writeSpec(integrationTemplateForSummary(summary), templatePath);
  }
  if (outDir) writeJsonFile(path.join(outDir, 'library-update-result.json'), { updated: true, registryPath, unknownAdded: gaps.unknown.map(g => g.actionKey), existingUpdated: gaps.updates.map(g => g.actionKey) }, { raw: true });
  return gaps;
}

async function onboardWorkspace(clay, opts = {}) {
  const workspaceId = resolveWorkspace(opts.workspaceId);
  const includeRows = Number(opts.includeRows || 5);
  const outDir = opts.outDir || path.join('runs', new Date().toISOString().slice(0,10), 'workspace-onboarding', workspaceId);
  const selected = opts.workbooks ? new Set(String(opts.workbooks).split(',').map(s => s.trim()).filter(Boolean)) : null;
  const limit = opts.limit ? Number(opts.limit) : null;
  const { data } = await clay._request('GET', `/v3/workspaces/${workspaceId}/workbooks`);
  const allWorkbooks = Array.isArray(data) ? data : (data.workbooks || data.results || []);
  let workbooks = selected ? allWorkbooks.filter(w => selected.has(w.id || w.workbookId)) : allWorkbooks;
  if (limit) workbooks = workbooks.slice(0, limit);
  fs.mkdirSync(outDir, { recursive: true });
  const exports = [];
  const allActions = [];
  for (const workbook of workbooks) {
    const workbookId = workbook.id || workbook.workbookId;
    if (!workbookId) continue;
    const slug = `${slugifyName(workbook.name || workbook.title || workbookId)}-${workbookId}`;
    const exportPath = path.join(outDir, `${slug}-full-export.json`);
    const templatePath = path.join(outDir, `${slug}-template.yaml`);
    let exported;
    try {
      exported = await fullWorkbookExport(clay, workbookId, { workspaceId, includeRows });
      writeJsonFile(exportPath, exported);
      writeSpec({ clayWorkbookTemplateVersion: 1, workspaceId, workbookId, tables: exported.templates }, templatePath);
      const actions = actionInventoryFromWorkbookExport(exported, exportPath);
      allActions.push(...actions);
      exports.push({ workbookId, name: workbook.name || workbook.title || null, status: 'exported', tableCount: exported.tableCount, actionCount: actions.length, exportPath, templatePath });
    } catch (error) {
      exports.push({ workbookId, name: workbook.name || workbook.title || null, status: 'error', error: error.message });
    }
  }
  const inventory = { count: allActions.length, actions: allActions };
  const inventoryPath = path.join(outDir, 'action-inventory.json');
  writeJsonFile(inventoryPath, inventory);
  const registry = YAML.parse(fs.readFileSync(path.join(__dirname, 'integration-library', 'registry.yaml'), 'utf8'));
  const gaps = summarizeIntegrationGaps(allActions, registry);
  const gapPath = path.join(outDir, 'integration-gap-report.json');
  writeJsonFile(gapPath, gaps, { raw: true });
  let libraryUpdate = null;
  if (opts.updateLibrary) libraryUpdate = updateIntegrationLibraryFromActions(allActions, outDir);
  const report = {
    kind: 'clay-workspace-onboarding',
    workspaceId,
    includeRows,
    workbookCount: workbooks.length,
    exportedCount: exports.filter(e => e.status === 'exported').length,
    errorCount: exports.filter(e => e.status === 'error').length,
    actionCount: allActions.length,
    unknownActionCount: gaps.unknownActionCount,
    updateActionCount: gaps.updateActionCount,
    paths: { outDir, inventoryPath, gapPath },
    exports,
    gaps,
    libraryUpdate,
  };
  writeJsonFile(path.join(outDir, 'onboarding-report.json'), report, { raw: true });
  return report;
}

function workbookFixtureFromTables(workspaceId, workbookId, tables, rowCounts = {}) {
  const actionSummary = field => {
    const typeSettings = field.typeSettings || {};
    const dataTypeSettings = typeSettings.dataTypeSettings || {};
    const inputsBinding = typeSettings.inputsBinding || typeSettings.inputs || [];
    const serialized = JSON.stringify(typeSettings);
    return {
      id: field.id,
      name: field.name,
      type: field.type,
      actionKey: typeSettings.actionKey || null,
      actionPackageId: typeSettings.actionPackageId || null,
      actionVersion: typeSettings.actionVersion || null,
      dataType: dataTypeSettings.type || null,
      inputBindingNames: Array.isArray(inputsBinding) ? inputsBinding.map(input => input.name).filter(Boolean) : [],
      hasPrompt: /prompt|system|message|instructions/i.test(serialized),
      hasJsonSchema: /answerSchemaType|json|schema|properties/i.test(serialized),
      hasRunCondition: Boolean(typeSettings.conditionalRunFormulaText || typeSettings.conditionalRunFormulaPrompt),
      conditionalRunFormulaText: typeSettings.conditionalRunFormulaText || null,
      typeSettings,
    };
  };

  return withCommandProvenance({
    kind: 'clay-workbook-parity-fixture',
    workspaceId,
    workbookId,
    tableCount: tables.length,
    tables: tables.map(table => {
      const fields = table.fields || [];
      const actionFields = fields.filter(field => field.type === 'action');
      const formulaFields = fields.filter(field => field.type === 'formula');
      const sourceFields = fields.filter(field => field.type === 'source');
      return {
        id: table.id,
        name: table.name,
        type: table.type,
        workbookId: table.workbookId,
        firstViewId: table.firstViewId,
        fieldCount: fields.length,
        recordCount: rowCounts[table.id] ?? table.recordCount ?? table.rowCount ?? table.count ?? 0,
        viewCount: (table.views || []).length,
        sourceFieldCount: sourceFields.length,
        actionFieldCount: actionFields.length,
        formulaFieldCount: formulaFields.length,
        actionFields: actionFields.map(actionSummary),
        formulaFields: formulaFields.map(field => ({
          id: field.id,
          name: field.name,
          typeSettings: field.typeSettings || {},
        })),
        sourceFields: sourceFields.map(field => ({
          id: field.id,
          name: field.name,
          typeSettings: field.typeSettings || {},
        })),
        views: (table.views || []).map(view => ({
          id: view.id,
          name: view.name,
          type: view.type,
          fieldConfigCount: Object.keys(view.fields || {}).length,
          filter: view.filter || null,
          sort: view.sort || null,
          limit: view.limit || null,
        })),
      };
    }),
  }, { commandId: 'clay-workbook-fixture', workspaceId, workbookId });
}

function scoreManifest(a, b) {
  const af = (a.table?.fields || a.fields || []).map(normalizeFieldForScore);
  const bf = (b.table?.fields || b.fields || []).map(normalizeFieldForScore);
  const bySig = arr => new Map(arr.map(f => [`${f.name}::${f.type}`, f]));
  const bm = bySig(bf);
  const mismatches = [];
  for (const f of af) {
    const key = `${f.name}::${f.type}`;
    const g = bm.get(key);
    if (!g) { mismatches.push({ type: 'missing_field', key }); continue; }
    const fs = JSON.stringify(f); const gs = JSON.stringify(g);
    if (fs !== gs) mismatches.push({ type: 'field_config_mismatch', key });
  }
  return {
    score: af.length ? Number(((af.length - mismatches.length) / af.length).toFixed(6)) : 0,
    sourceFieldCount: af.length,
    targetFieldCount: bf.length,
    mismatches,
    status: mismatches.length ? 'config_mismatch' : 'perfect_config_parity'
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const cmd = flags._[0];
  if (!cmd || cmd === 'help') {
    console.log(`Clay v2 prototype\n\nCommands:\n  dev-mode [--json]                         Show scoped live-operator dev mode rules\n  manifest <tableId> --view <viewId> [--include-rows N] [--out file] [--raw]\n  workbook-fixture <workbookId> [--workspace <id>] [--out file] [--raw]\n  workbook-export <workbookId> [--workspace <id>] [--include-rows N] [--out file] [--template-out file] [--raw]\n  onboard-workspace [--workspace <id>] [--workbooks id1,id2] [--limit N] [--include-rows 5] [--out-dir dir] [--update-library]\n  integration-list [--out file]\n  integration-show <actionKey> [--out file]\n  integration-validate-spec <spec.yaml|json> [--out file]
  integration-promotion-report [--format json|markdown] [--out file]\n  proof-readback <tableId> --view VIEW --field FIELD [--include-rows 10] [--expected-enums-json '{"path":["VALUE"]}'] [--from-manifest manifest.json] [--out file]\n  redact <input> [--out file] [--report report.json]\n  score <source.json> <target.json>\n  action-def <tableId> <fieldId> [--out file]
  search-actions <query> [--workspace <id>] [--types action,source_action,...]
  actions-catalog [--workspace <id>] [--query text] [--report redaction-report.json]
  normalize-actions-catalog <raw-actions-catalog.json> [--out normalized.json] [--expected-definitions 1282] [--expected-unique-keys 1244]
  catalog-delta <stored-catalog.json> <new-catalog.json> [--out report.json]
  app-accounts [--workspace <id>] [--type appAccountTypeId]
  model-pricing [--workspace <id>]\n  create-workbook --name NAME [--workspace <id>] [--folder <id>] --confirm\n  create-table --workbook ID --name NAME [--workspace <id>] [--type spreadsheet] --confirm\n  update-table-settings <tableId> [--auto-run true|false] --confirm\n  sources <tableId> [--out file]\n  create-webhook-source <tableId> --name NAME [--workspace <id>] [--allow-duplicate-webhook] [--dev-mode|--confirm]\n  create-view <tableId> --name NAME --confirm
  update-view <tableId> --view VIEW [--name NAME] [--limit N] --confirm
  delete-view <tableId> --view VIEW --confirm\n  create-field <tableId> --name NAME --type text|url|number|formula|http-api|use-ai [--outputs name:type:path,...] [--dry-run] [options] --confirm\n  create-action <tableId> --name NAME --action-key KEY --package-id ID [--version 1] --inputs-json '{"input":"formulaText"}' [--field-map-json '{"Field":"f_id"}'] [--auth-account ID] [--dry-run] --confirm\n  update-field <tableId> --field FIELD [--name NAME] [--description TEXT] [--outputs name:type:path,...] [--dry-run] --confirm\n  verify-field-output-schema <tableId> --field FIELD --outputs name:type:path,... [--from-manifest manifest.json] [--out file]\n  add-rows <tableId> --confirm < rows.json\n  update-record <tableId> --record RECORD_ID --cells '{"Field Name":"value"}' [--allow-select-write] --confirm\n  delete-record <tableId> --record RECORD_ID --confirm\n  run-top <tableId> --field FIELD --view VIEW --n 10 --confirm\n  run-status <tableId> [--workspace <id>]\n  run-watch <tableId> --field FIELD [--timeout 300]\n  view-field <tableId> --view VIEW --field FIELD [--visible true|false] [--width 200] --confirm\n  delete-field <tableId> --field FIELD --confirm\n  create-field-group <tableId> --name NAME --fields f1,f2 --confirm\n  create-output-field <tableId> --parent FIELD --name response --path response [--data-type text] --confirm\n  verify-table <tableId> [--view VIEW] [--include-rows 10]\n  build-people-source-from-companies <companyTableId> --view VIEW --out people-source.yaml [--domain-field "Resolved Domain"] [--company-table-field FIELD] [--limit 10]\n  export-spec <tableId> --view VIEW [--out table.yaml]\n  validate-spec <spec.yaml|json>\n  diff-spec <spec.yaml|json> [--table TABLE_ID --view VIEW]\n  apply-spec <spec.yaml|json> [--field-map-json '{"Field":"f_id"}'] [--dry-run] --confirm [--out apply-result.json]\n  source-preview <source.yaml|json> [--workspace <id>] [--dev-mode|--confirm] [--out preview.json]\n  source-import <source.yaml|json> --destination-table TABLE [--dev-mode|--confirm] [--out import-result.json]\n\nDev mode:\n  Add --dev-mode to live commands to enforce your configured sandbox scope.\n  In --dev-mode, small live actions may proceed without separate chat approval; outside that scope normal confirmation applies.\n`);
    return;
  }
  if (cmd === 'dev-mode') return out(devModeState(), { raw: true });
  enforceDevModeScope(flags);
  mustConfirm(cmd, flags);
  const offlineCommand = OFFLINE.has(cmd) || (['apply-spec', 'create-field', 'update-field', 'create-action'].includes(cmd) && flags['dry-run']) || (cmd === 'verify-field-output-schema' && flags['from-manifest']) || (cmd === 'proof-readback' && flags['from-manifest']);
  let clay = null;
  if (!offlineCommand) {
    clay = new ClayAPI();
    await clay._ensureSession();
  }

  if (cmd === 'manifest') {
    const tableId = flags._[1]; if (!tableId) throw new Error('usage: manifest <tableId> --view <viewId>');
    const manifest = await getTableManifest(clay, tableId, flags.view, { includeRows: flags['include-rows'] });
    return out(manifest, { out: flags.out, raw: flags.raw });
  }

  if (cmd === 'workbook-fixture') {
    const workbookId = flags._[1]; if (!workbookId) throw new Error('usage: workbook-fixture <workbookId> [--workspace <id>] [--out file] [--raw]');
    const workspaceId = resolveWorkspace(flags.workspace);
    const { data } = await clay._request('GET', `/v3/workbooks/${workbookId}/tables`);
    const tables = data || [];
    const rowCounts = {};
    for (const table of tables) {
      const viewId = table.firstViewId || table.views?.[0]?.id;
      if (!viewId) continue;
      try {
        const ids = await clay._request('GET', `/v3/tables/${table.id}/views/${viewId}/records/ids`);
        rowCounts[table.id] = (ids.data?.results || ids.data || []).length;
      } catch {
        rowCounts[table.id] = table.recordCount ?? table.rowCount ?? table.count ?? 0;
      }
    }
    return out(workbookFixtureFromTables(workspaceId, workbookId, tables, rowCounts), { out: flags.out, raw: flags.raw });
  }

  if (cmd === 'workbook-export') {
    const workbookId = flags._[1]; if (!workbookId) throw new Error('usage: workbook-export <workbookId> [--workspace <id>] [--include-rows N] [--out file] [--template-out file] [--raw]');
    const workspaceId = resolveWorkspace(flags.workspace);
    const exported = await fullWorkbookExport(clay, workbookId, { workspaceId, includeRows: flags['include-rows'] || 0 });
    if (flags['template-out']) {
      writeSpec({ clayWorkbookTemplateVersion: 1, workspaceId, workbookId, tables: exported.templates }, flags['template-out']);
    }
    return out(exported, { out: flags.out, raw: flags.raw });
  }

  if (cmd === 'onboard-workspace') {
    const report = await onboardWorkspace(clay, {
      workspaceId: resolveWorkspace(flags.workspace),
      workbooks: flags.workbooks,
      limit: flags.limit,
      includeRows: flags['include-rows'] || 5,
      outDir: flags['out-dir'],
      updateLibrary: !!flags['update-library'],
    });
    return out(report, { out: flags.out, raw: true });
  }

  if (cmd === 'integration-list') {
    return out({ count: listIntegrations().length, integrations: listIntegrations().map(item => ({ actionKey: item.actionKey || item.key, status: item.status, promotionStatus: item.promotionStatus, authRequiredObserved: !!item.authRequiredObserved, runConditionObserved: !!item.runConditionObserved, observedCount: (item.observedIn || []).length })) }, { out: flags.out, raw: true });
  }

  if (cmd === 'integration-promotion-report') {
    const report = integrationPromotionReport();
    if (flags.format === 'markdown' || flags.markdown) {
      const markdown = integrationPromotionMarkdown(report);
      if (flags.out) fs.writeFileSync(flags.out, markdown);
      else process.stdout.write(markdown);
      return;
    }
    return out(report, { out: flags.out, raw: true });
  }

  if (cmd === 'integration-show') {
    const actionKey = flags._[1]; if (!actionKey) throw new Error('usage: integration-show <actionKey> [--out file]');
    return out(getIntegration(actionKey), { out: flags.out, raw: true });
  }

  if (cmd === 'integration-validate-spec') {
    const file = flags._[1]; if (!file) throw new Error('usage: integration-validate-spec <spec.yaml|json> [--out file]');
    return out(validateSpecAgainstIntegrationRegistry(readSpec(file)), { out: flags.out, raw: true });
  }

  if (cmd === 'proof-readback') {
    const tableId = flags._[1];
    if (!tableId && !flags['from-manifest']) throw new Error('usage: proof-readback <tableId> --view VIEW --field FIELD [--include-rows 10] [--from-manifest manifest.json] [--out file]');
    if (!flags.field) throw new Error('proof-readback requires --field FIELD');
    const includeRows = Number(flags['include-rows'] || 10);
    if (includeRows > 10) throw new Error('proof-readback strict proof row cap is 10; use a separate scale gate for larger runs');
    const manifest = flags['from-manifest'] ? readSpec(flags['from-manifest']) : await getTableManifest(clay, tableId, flags.view, { includeRows });
    const result = buildProofPacketFromManifest(manifest, {
      fieldId: flags.field,
      fieldName: flags.field,
      viewId: flags.view,
      rowLimit: includeRows,
      tableId,
      expectedEnums: flags['expected-enums-json'] ? JSON.parse(flags['expected-enums-json']) : {},
      artifacts: flags['from-manifest'] ? [flags['from-manifest']] : [],
    });
    return out(result, { out: flags.out, raw: true });
  }

  if (cmd === 'redact') {
    const input = flags._[1]; if (!input) throw new Error('usage: redact <input> [--out file] [--report report.json]');
    return out(JSON.parse(fs.readFileSync(input, 'utf8')), { out: flags.out, report: flags.report });
  }

  if (cmd === 'normalize-actions-catalog') {
    const input = flags._[1];
    if (!input) throw new Error('usage: normalize-actions-catalog <raw-actions-catalog.json> [--out normalized.json]');
    const normalized = readAndNormalizeActionsCatalog(input, { generatedAt: flags['generated-at'] || null });
    const expectedDefinitions = flags['expected-definitions'] ? Number(flags['expected-definitions']) : null;
    const expectedUniqueKeys = flags['expected-unique-keys'] ? Number(flags['expected-unique-keys']) : null;
    if (expectedDefinitions !== null && normalized.counts.definitions !== expectedDefinitions) {
      throw new Error(`expected ${expectedDefinitions} definitions, got ${normalized.counts.definitions}`);
    }
    if (expectedUniqueKeys !== null && normalized.counts.uniqueKeys !== expectedUniqueKeys) {
      throw new Error(`expected ${expectedUniqueKeys} unique keys, got ${normalized.counts.uniqueKeys}`);
    }
    return out(normalized, { out: flags.out, raw: flags.raw });
  }

  if (cmd === 'score') {
    const [src, tgt] = [flags._[1], flags._[2]]; if (!src || !tgt) throw new Error('usage: score <source.json> <target.json>');
    return out(scoreManifest(JSON.parse(fs.readFileSync(src,'utf8')), JSON.parse(fs.readFileSync(tgt,'utf8'))), { raw: true });
  }

  if (cmd === 'action-def') {
    const [tableId, fieldId] = [flags._[1], flags._[2]]; if (!tableId || !fieldId) throw new Error('usage: action-def <tableId> <fieldId>');
    const info = await clay.getTableInfo(tableId); const table = info.table || info;
    const f = (table.fields || []).find(x => x.id === fieldId); if (!f) throw new Error('field not found');
    return out({ table: { id: table.id, name: table.name }, field: f, actionDefinition: f.actionDefinition }, { out: flags.out, raw: flags.raw });
  }

  if (cmd === 'search-actions') {
    const query = flags._[1]; if (!query) throw new Error('usage: search-actions <query> [--workspace <id>]');
    const types = flags.types ? String(flags.types).split(',') : ['waterfall','template','action','internal_action','export_action','signal_action','client_driven_source_action','source_action','webhook_subscription_source','function','waterfall_template','parent_waterfall_template'];
    const { data } = await clay._request('POST', `/v3/enrichment-search/${resolveWorkspace(flags.workspace)}/query-v2`, { body: { userQuery: query, types } });
    return out(data, { raw: flags.raw });
  }

  if (cmd === 'actions-catalog') {
    const { data } = await clay._request('GET', '/v3/actions', { query: { workspaceId: resolveWorkspace(flags.workspace) } });
    let actions = data.actions || data;
    if (flags.query) actions = actions.filter(a => JSON.stringify(a).toLowerCase().includes(String(flags.query).toLowerCase()));
    return out({ count: actions.length, actions }, { raw: flags.raw, report: flags.report });
  }

  if (cmd === 'catalog-delta') {
    const [storedFile, newFile] = [flags._[1], flags._[2]];
    if (!storedFile || !newFile) throw new Error('usage: catalog-delta <stored-catalog.json> <new-catalog.json> [--out report.json]');
    return out(compareCatalogs(readCatalog(storedFile), readCatalog(newFile)), { out: flags.out, raw: true });
  }

  if (cmd === 'app-accounts') {
    const { data } = await clay._request('GET', `/v3/workspaces/${resolveWorkspace(flags.workspace)}/app-accounts`);
    const accounts = flags.type ? data.filter(a => a.appAccountTypeId === flags.type) : data;
    return out({ count: accounts.length, accounts }, { out: flags.out, raw: flags.raw });
  }

  if (cmd === 'model-pricing') {
    const { data } = await clay._request('GET', `/v3/model-pricing/${resolveWorkspace(flags.workspace)}/base-costs`);
    return out(data, { out: flags.out, raw: flags.raw });
  }

  if (cmd === 'create-workbook') {
    const workspaceId = resolveWorkspace(flags.workspace);
    const parentFolderId = resolveFolder(flags.folder);
    const name = flags.name; if (!name) throw new Error('--name required');
    assertAllowedScope(workspaceId, parentFolderId);
    const { data } = await clay._request('POST', '/v3/workbooks', { body: { name, workspaceId: Number(workspaceId), parentFolderId, settings: { isAutoRun: false } } });
    return out(data, { out: flags.out });
  }

  if (cmd === 'create-table') {
    const workspaceId = resolveWorkspace(flags.workspace);
    const workbookId = flags.workbook; const name = flags.name; if (!workbookId || !name) throw new Error('--workbook and --name required');
    assertAllowedWorkspace(workspaceId);
    const { data } = await clay._request('POST', '/v3/tables', { body: { name, workbookId, workspaceId: Number(workspaceId), type: flags.type || 'spreadsheet', template: flags.template || 'no_views' } });
    return out(data);
  }

  if (cmd === 'sources') {
    const tableId = flags._[1]; if (!tableId) throw new Error('usage: sources <tableId> [--out file]');
    const { data } = await clay._request('GET', '/v3/sources', { query: { tableId } });
    return out(data, { out: flags.out });
  }

  if (cmd === 'create-webhook-source') {
    const tableId = flags._[1]; if (!tableId || !flags.name) throw new Error('usage: create-webhook-source <tableId> --name NAME [--workspace <id>] [--allow-duplicate-webhook] [--dev-mode|--confirm]');
    const workspaceId = resolveWorkspace(flags.workspace);
    assertAllowedWorkspace(workspaceId);
    const existing = await clay._request('GET', '/v3/sources', { query: { tableId } });
    const webhookSources = (existing.data || []).filter(source => source.type === 'webhook' && !source.deletedAt);
    if (webhookSources.length && !flags['allow-duplicate-webhook']) {
      throw new Error(`table already has ${webhookSources.length} webhook source(s); pass --allow-duplicate-webhook for an intentional duplicate probe`);
    }
    const { data } = await clay._request('PATCH', `/v3/tables/${tableId}`, {
      body: {
        tableSettings: {},
        fieldGroupMap: {},
        sourceSettings: {
          addSource: {
            name: 'Webhook',
            source: {
              name: flags.name,
              workspaceId,
              type: 'webhook',
              typeSettings: {
                urlSlugText: 'Pull in data from a Webhook',
                iconType: 'Webhook',
                name: 'Webhook',
                description: 'Send any data to Clay',
                stages: [],
              },
            },
          },
        },
      },
    });
    return out(withCommandProvenance({ created: true, tableId, result: data }, {
      commandId: 'create_webhook_source',
      workspaceId,
      tableId,
      stdoutPath: flags.out || null,
    }), { out: flags.out });
  }

  if (cmd === 'create-view') {
    const tableId = flags._[1]; if (!tableId || !flags.name) throw new Error('usage: create-view <tableId> --name NAME --confirm');
    const { data } = await clay._request('POST', `/v3/tables/${tableId}/views`, { body: { name: flags.name, type: flags.type || 'grid' } });
    return out(data);
  }

  if (cmd === 'update-view') {
    const tableId = flags._[1]; if (!tableId || !flags.view) throw new Error('usage: update-view <tableId> --view VIEW [--name NAME] [--limit N] --confirm');
    const body = {};
    if (flags.name) body.name = flags.name;
    if (flags.limit !== undefined) body.limit = flags.limit === 'null' ? null : Number(flags.limit);
    if (!Object.keys(body).length) throw new Error('nothing to update');
    const { data } = await clay._request('PATCH', `/v3/tables/${tableId}/views/${flags.view}`, { body });
    return out(data);
  }

  if (cmd === 'delete-view') {
    const tableId = flags._[1]; if (!tableId || !flags.view) throw new Error('usage: delete-view <tableId> --view VIEW --confirm');
    const { data } = await clay._request('DELETE', `/v3/tables/${tableId}/views/${flags.view}`);
    return out({ deleted: true, tableId, viewId: flags.view, result: data });
  }

  if (cmd === 'update-table-settings') {
    const tableId = flags._[1]; if (!tableId) throw new Error('usage: update-table-settings <tableId> [--auto-run true|false] --confirm');
    const tableSettings = {};
    if (flags['auto-run'] !== undefined) tableSettings.AUTO_RUN_ON = String(flags['auto-run']) === 'true';
    if (flags['auto-run-mode']) tableSettings.AUTO_RUN_MODE = flags['auto-run-mode'];
    if (!Object.keys(tableSettings).length) throw new Error('no settings supplied');
    const { data } = await clay._request('PATCH', `/v3/tables/${tableId}`, { body: { tableSettings } });
    return out(data);
  }

  if (cmd === 'create-field') {
    const tableId = flags._[1]; const type = flags.type || 'text'; const name = flags.name; if (!tableId || !name) throw new Error('usage: create-field <tableId> --name NAME --type TYPE');
    let body;
    if (type === 'formula') {
      if (!flags.formula) throw new Error('--formula required');
      body = { name, type: 'formula', typeSettings: { dataTypeSettings: { type: flags['data-type'] || 'text' }, formulaType: flags['formula-type'] || flags['data-type'] || 'text', formulaText: flags.formula } };
    } else if (type === 'http-api') {
      if (!flags.url) throw new Error('--url formulaText required (internal input name is url)');
      const bindings = [ { name: 'method', formulaText: JSON.stringify(flags.method || 'GET') }, { name: 'url', formulaText: flags.url } ];
      if (flags['query-string']) bindings.push({ name: 'queryString', formulaText: flags['query-string'] });
      if (flags.body) bindings.push({ name: 'body', formulaText: flags.body });
      const typeSettings = { dataTypeSettings: { type: 'json' }, actionKey: 'http-api-v2', actionPackageId: '4299091f-3cd3-4d68-b198-0143575f471d', actionVersion: 1, inputsBinding: bindings };
      if (flags['run-condition']) typeSettings.conditionalRunFormulaText = flags['run-condition'];
      body = { name, type: 'action', typeSettings, inputFieldIds: flags.inputs ? flags.inputs.split(',') : inputFieldIdsFromBindings(bindings, flags['run-condition'] ? [flags['run-condition']] : []) };
    } else if (type === 'use-ai') {
      if (!flags.prompt) throw new Error('--prompt formulaText required');
      if (!flags.outputs && !flags['allow-parent-only']) throw new Error('Use AI needs --outputs name:type:path,... to match Clay UI Define outputs -> Fields, or explicit --allow-parent-only');
      // GOTCHA: use-ai fields SILENTLY do not run without an AI auth account
      // (red dot in UI, run-status stays empty []). Warn loudly.
      if (!flags['auth-account']) console.error('WARNING: no --auth-account on this use-ai field. It will likely NOT run (silent: empty run-status, red dot in UI). Find the workspace AI account via the app-accounts command and pass --auth-account <id>.');
      const compatibility = useAiModelCompatibilityIssue({ useCase: JSON.stringify(flags.useCase || 'use-ai'), model: JSON.stringify(flags.model || 'gpt-4o-mini') });
      if (compatibility) throw new Error(`${compatibility.type}: ${compatibility.message}`);
      const bindings = [
        { name: 'useCase', formulaText: JSON.stringify(flags.useCase || 'use-ai') },
        { name: 'prompt', formulaText: flags.prompt },
        { name: 'model', formulaText: JSON.stringify(flags.model || 'gpt-4o-mini') },
    ];
    if (flags.temperature) bindings.push({ name: 'temperature', formulaText: JSON.stringify(flags.temperature) });
    if (flags.outputs) {
        const outs = parseOutputsSpec(flags.outputs);
        bindings.splice(0, bindings.length, ...mergeAnswerSchemaBinding(bindings, outs));
      }
      const typeSettings = { dataTypeSettings: { type: 'json' }, actionKey: 'use-ai', actionPackageId: '67ba01e9-1898-4e7d-afe7-7ebe24819a57', actionVersion: 1, inputsBinding: bindings };
      if (flags['run-condition']) typeSettings.conditionalRunFormulaText = flags['run-condition'];
      if (flags['auth-account']) typeSettings.authAccountId = flags['auth-account'];
      body = { name, type: 'action', typeSettings, inputFieldIds: flags.inputs ? flags.inputs.split(',') : inputFieldIdsFromBindings(bindings, flags['run-condition'] ? [flags['run-condition']] : []) };
    } else {
      body = { name, type, typeSettings: { dataTypeSettings: { type } } };
    }
    if (flags.view && flags['after-field']) body.viewSettings = { [flags.view]: { afterFieldId: flags['after-field'] } };
    if (flags.view) body.activeViewId = flags.view;
    if (flags['dry-run']) {
      const outputs = flags.outputs ? parseOutputsSpec(flags.outputs) : [];
      return out({
        created: false,
        dryRun: true,
        tableId,
        fieldName: name,
        fieldType: type,
        request: {
          method: 'POST',
          path: `/v3/tables/${tableId}/fields`,
          body,
        },
        ...(type === 'use-ai' && outputs.length ? {
          outputFormat: 'JSON Schema',
          outputJsonSchema: outputJsonSchema(outputs),
          answerSchemaBinding: answerSchemaBinding(outputs),
        } : {}),
      }, { out: flags.out, raw: true });
    }
    const { data } = await clay._request('POST', `/v3/tables/${tableId}/fields`, { body });
    const created = data.field || data;
    const result = { created };
    if (type === 'use-ai' && flags.outputs && flags['extract-outputs']) {
      result.outputs = [];
      for (const spec of parseOutputsSpec(flags.outputs)) {
        const { name: outName, type: outType = 'text', path: outPath = outName } = spec;
        const child = await createOutputField(clay, tableId, created.id, { name: outName, type: outType, path: outPath });
        result.outputs.push(child);
      }
    }
    return out(result, { out: flags.out });
  }

  if (cmd === 'create-action') {
    const tableId = flags._[1]; if (!tableId || !flags.name || !flags['action-key'] || !flags['package-id']) throw new Error('usage: create-action <tableId> --name NAME --action-key KEY --package-id ID [--inputs-json JSON] --confirm');
    const inputs = flags['inputs-json'] ? JSON.parse(flags['inputs-json']) : {};
    let fieldIdByName;
    if (flags['dry-run'] && flags['field-map-json']) {
      fieldIdByName = new Map(Object.entries(JSON.parse(flags['field-map-json'])));
    } else {
      const infoForRefs = await clay.getTableInfo(tableId);
      const tableForRefs = infoForRefs.table || infoForRefs;
      fieldIdByName = new Map((tableForRefs.fields || []).map(field => [field.name, field.id]));
    }
    const inputBindings = Object.entries(inputs).map(([name, formulaText]) => ({ name, formulaText: resolveFieldRefs(formulaText, fieldIdByName) }));
    const runCondition = flags['run-condition'] ? resolveFieldRefs(flags['run-condition'], fieldIdByName) : null;
    const typeSettings = { dataTypeSettings: { type: flags['data-type'] || 'json' }, actionKey: flags['action-key'], actionPackageId: flags['package-id'], actionVersion: Number(flags.version || 1), inputsBinding: inputBindings };
    if (flags['auth-account']) typeSettings.authAccountId = flags['auth-account'];
    if (runCondition) typeSettings.conditionalRunFormulaText = runCondition;
    const expectedInputFieldIds = flags.inputs ? flags.inputs.split(',') : inputFieldIdsFromBindings(inputBindings, runCondition ? [runCondition] : []);
    const body = { name: flags.name, type: 'action', typeSettings, inputFieldIds: expectedInputFieldIds };
    if (flags.view && flags['after-field']) body.viewSettings = { [flags.view]: { afterFieldId: flags['after-field'] } };
    if (flags.view) body.activeViewId = flags.view;
    if (flags['dry-run']) return out({ dryRun: true, tableId, expectedInputFieldIds, request: { method: 'POST', path: `/v3/tables/${tableId}/fields`, body } }, { out: flags.out, raw: true });
    const { data } = await clay._request('POST', `/v3/tables/${tableId}/fields`, { body });
    const created = data.field || data;
    const infoAfter = await clay.getTableInfo(tableId);
    const tableAfter = infoAfter.table || infoAfter;
    const readbackField = (tableAfter.fields || []).find(field => field.id === created.id || field.name === flags.name) || created;
    return out({ ...data, dependencyReadback: dependencyReadbackForField(readbackField, expectedInputFieldIds) }, { raw: true });
  }

  if (cmd === 'update-field') {
    const tableId = flags._[1]; if (!tableId || !flags.field) throw new Error('usage: update-field <tableId> --field FIELD [--name NAME] [--description TEXT] [--outputs name:type:path,...] --confirm');
    const body = {};
    if (flags.name) body.name = flags.name;
    if (flags.description !== undefined) body.description = flags.description;
    if (flags['dry-run']) {
      if (!flags.outputs) throw new Error('update-field --dry-run currently requires --outputs');
      const outputs = parseOutputsSpec(flags.outputs);
      return out({
        updated: false,
        dryRun: true,
        tableId,
        field: flags.field,
        outputFormat: 'JSON Schema',
        outputJsonSchema: outputJsonSchema(outputs),
        answerSchemaBinding: answerSchemaBinding(outputs),
      }, { out: flags.out, raw: true });
    }
    if (flags.outputs) {
      const info = await clay.getTableInfo(tableId);
      const table = info.table || info;
      const field = (table.fields || []).find(f => f.id === flags.field || f.name === flags.field);
      if (!field) throw new Error('field not found for output schema update');
      if (field.type !== 'action' || field.typeSettings?.actionKey !== 'use-ai') throw new Error('--outputs update currently supports use-ai action fields only');
      const outputs = parseOutputsSpec(flags.outputs);
      body.typeSettings = {
        ...field.typeSettings,
        inputsBinding: mergeAnswerSchemaBinding(field.typeSettings?.inputsBinding || [], outputs),
      };
    }
    if (!Object.keys(body).length) throw new Error('nothing to update');
    const { data } = await clay._request('PATCH', `/v3/tables/${tableId}/fields/${flags.field}`, { body });
    return out(data, { out: flags.out });
  }

  if (cmd === 'verify-field-output-schema') {
    const tableId = flags._[1];
    if (!tableId || !flags.field || !flags.outputs) {
      throw new Error('usage: verify-field-output-schema <tableId> --field FIELD --outputs name:type:path,... [--from-manifest manifest.json]');
    }
    let table;
    if (flags['from-manifest']) {
      const manifest = JSON.parse(fs.readFileSync(flags['from-manifest'], 'utf8'));
      table = manifest.table || manifest;
      if (!table || typeof table !== 'object') throw new Error('--from-manifest must contain a table object');
    } else {
      const info = await clay.getTableInfo(tableId);
      table = info.table || info;
    }
    const result = verifyFieldOutputSchema(table, flags.field, parseOutputsSpec(flags.outputs));
    return out({
      ...result,
      source: flags['from-manifest'] ? { kind: 'manifest_file', path: flags['from-manifest'] } : { kind: 'live_clay_readback', tableId },
    }, { out: flags.out, raw: true });
  }

  if (cmd === 'add-rows') {
    const tableId = flags._[1]; if (!tableId) throw new Error('usage: add-rows <tableId> < rows.json');
    const rows = await readStdinJson(); if (!Array.isArray(rows)) throw new Error('stdin must be JSON array');
    const records = rows.map(cells => ({ id: crypto.randomBytes(12).toString('hex'), cells }));
    const { data } = await clay._request('POST', `/v3/tables/${tableId}/records`, { body: { records } });
    return out(data);
  }

  if (cmd === 'update-record') {
    const tableId = flags._[1]; if (!tableId || !flags.record || !flags.cells) throw new Error('usage: update-record <tableId> --record RECORD_ID --cells JSON --confirm');
    const info = await clay.getTableInfo(tableId); const table = info.table || info;
    const fields = table.fields || [];
    const fieldIdByName = new Map(fields.map(f => [f.name, f.id]));
    const fieldById = new Map(fields.map(f => [f.id, f]));
    const inputCells = JSON.parse(flags.cells);
    const cells = Object.fromEntries(Object.entries(inputCells).map(([k, v]) => [fieldIdByName.get(k) || k, v]));
    const selectWrites = Object.keys(cells).map(id => fieldById.get(id)).filter(f => f?.type === 'select');
    if (selectWrites.length && !flags['allow-select-write']) {
      throw new Error(`select cell writes are not supported by the verified records API path yet: ${selectWrites.map(f => `${f.name} (${f.id})`).join(', ')}. Use --allow-select-write only for live probes, then verify readback manually.`);
    }
    const { data } = await clay._request('PATCH', `/v3/tables/${tableId}/records/${flags.record}`, { body: { cells } });
    return out({ updated: true, tableId, recordId: flags.record, result: data });
  }

  if (cmd === 'delete-record') {
    const tableId = flags._[1]; if (!tableId || !flags.record) throw new Error('usage: delete-record <tableId> --record RECORD_ID --confirm');
    const { data } = await clay._request('DELETE', `/v3/tables/${tableId}/records/${flags.record}`);
    return out({ deleted: true, tableId, recordId: flags.record, result: data });
  }

  if (cmd === 'run-top') {
    const tableId = flags._[1]; if (!tableId || !flags.field || !flags.view) throw new Error('usage: run-top <tableId> --field FIELD --view VIEW --n 10');
    const n = Number(flags.n || 10);
    if (n > 10 && !flags['allow-more-than-10']) throw new Error('refusing to run more than 10 without --allow-more-than-10');
    const { data } = await clay._request('PATCH', `/v3/tables/${tableId}/run`, { body: { fieldIds: [flags.field], runRecords: { viewIdTopRecords: { viewId: flags.view, numRecords: n } }, callerName: 'clay-v2' } });
    return out(data);
  }

  if (cmd === 'run-status') {
    const tableId = flags._[1]; if (!tableId) throw new Error('usage: run-status <tableId>');
    const { data } = await clay._request('GET', `/v3/workspaces/${resolveWorkspace(flags.workspace)}/tables/${tableId}/fields/runstatus`);
    return out(data);
  }

  if (cmd === 'run-watch') {
    const tableId = flags._[1]; if (!tableId || !flags.field) throw new Error('usage: run-watch <tableId> --field FIELD [--timeout 300]');
    const timeoutMs = Number(flags.timeout || 300) * 1000;
    const start = Date.now();
    let last = null;
    while (Date.now() - start < timeoutMs) {
      const { data } = await clay._request('GET', `/v3/workspaces/${resolveWorkspace(flags.workspace)}/tables/${tableId}/fields/runstatus`);
      last = data.statusCountsByField?.[flags.field] || [];
      const active = last.some(s => ['QUEUED','RUNNING','AWAITING_CALLBACK','RETRY'].includes(s.status));
      if (last.length && !active) return out({ done: true, fieldId: flags.field, statuses: last, elapsedSeconds: Math.round((Date.now() - start) / 1000) });
      await new Promise(r => setTimeout(r, Number(flags.interval || 5) * 1000));
    }
    return out({ done: false, fieldId: flags.field, statuses: last, elapsedSeconds: Math.round((Date.now() - start) / 1000) });
  }

  if (cmd === 'view-field') {
    const tableId = flags._[1]; if (!tableId || !flags.view || !flags.field) throw new Error('usage: view-field <tableId> --view VIEW --field FIELD [--visible true|false] [--width 200]');
    const body = {};
    if (flags.visible !== undefined) body.isVisible = String(flags.visible) === 'true';
    if (flags.width !== undefined) body.width = Number(flags.width);
    if (!Object.keys(body).length) throw new Error('nothing to update');
    const { data } = await clay._request('PATCH', `/v3/tables/${tableId}/views/${flags.view}/fields/${flags.field}`, { body });
    return out(data);
  }

  if (cmd === 'delete-field') {
    const tableId = flags._[1]; if (!tableId || !flags.field) throw new Error('usage: delete-field <tableId> --field FIELD --confirm');
    const { data } = await clay._request('DELETE', `/v3/tables/${tableId}/fields/${flags.field}`);
    return out({ deleted: true, tableId, fieldId: flags.field, result: data });
  }

  if (cmd === 'build-people-source-from-companies') {
    const tableId = flags._[1];
    if (!tableId || !flags.view || !flags.out) throw new Error('usage: build-people-source-from-companies <companyTableId> --view VIEW --out people-source.yaml [--domain-field "Resolved Domain"] [--company-table-field FIELD] [--limit 10]');
    const workspaceId = resolveWorkspace(flags.workspace);
    assertAllowedWorkspace(workspaceId);
    const limit = Number(flags.limit || 10);
    if (flags['dev-mode'] && limit > DEV_MODE_SCOPE.maxRowsBeforeReadback) throw new Error(`--dev-mode max limit is ${DEV_MODE_SCOPE.maxRowsBeforeReadback}`);
    const manifest = await getTableManifest(clay, tableId, flags.view, { includeRows: limit });
    const spec = buildPeopleSourceSpecFromCompanyManifest(manifest, {
      workspaceId,
      viewId: flags.view,
      limit,
      domainField: flags['domain-field'],
      companyTableFieldId: flags['company-table-field'],
    });
    fs.mkdirSync(path.dirname(flags.out), { recursive: true });
    fs.writeFileSync(flags.out, YAML.stringify(spec));
    return out({
      wrote: flags.out,
      generatedFrom: spec.generatedFrom,
      domains: spec.source.filters.company_identifier,
      recordCount: spec.source.filters.company_record_id.length,
      previewCommand: `node clay-v2.js source-preview ${flags.out} --workspace ${shellQuote(workspaceId)}${flags['dev-mode'] ? ' --dev-mode' : ''} --out ${flags.out.replace(/\.ya?ml$/i, '-preview.json')}`,
    }, { raw: true });
  }

  if (cmd === 'export-spec') {
    const tableId = flags._[1]; if (!tableId || !flags.view) throw new Error('usage: export-spec <tableId> --view VIEW [--out table.yaml]');
    const manifest = await getTableManifest(clay, tableId, flags.view, { includeRows: 0 });
    const spec = specFromManifest(manifest, flags.view);
    const exportSpec = flags.raw ? spec : redact(spec);
    if (flags.out) return out(writeSpec(exportSpec, flags.out), { raw: true });
    return process.stdout.write(YAML.stringify(exportSpec));
  }

  if (cmd === 'validate-spec') {
    const file = flags._[1]; if (!file) throw new Error('usage: validate-spec <spec.yaml|json>');
    const spec = readSpec(file);
    return out({ ...validateSpecObject(spec), integrationValidation: validateSpecAgainstIntegrationRegistry(spec) }, { raw: true });
  }

  if (cmd === 'diff-spec') {
    const file = flags._[1]; if (!file) throw new Error('usage: diff-spec <spec.yaml|json> [--table TABLE_ID --view VIEW]');
    const spec = readSpec(file);
    const tableId = flags.table || spec.table?.id; if (!tableId) throw new Error('live table id required via --table or spec.table.id');
    const viewId = flags.view || spec.view?.id;
    const liveManifest = await getTableManifest(clay, tableId, viewId, { includeRows: 0 });
    const liveSpec = specFromManifest(liveManifest, viewId);
    return out(diffSpecToLive(spec, liveSpec), { raw: true });
  }

  if (cmd === 'source-preview') {
    const file = flags._[1]; if (!file) throw new Error('usage: source-preview <source.yaml|json>');
    const spec = readSpec(file);
    const workspaceId = resolveWorkspace(flags.workspace || spec.workspaceId);
    assertAllowedWorkspace(workspaceId);
    const source = spec.source || spec;
    if (!['companies', 'people'].includes(source.type)) throw new Error('source-preview supports type: companies|people');
    const inputs = { ...(source.filters || {}) };
    // The preview endpoint only accepts limit 1-50 (errors with ERROR_INVALID_INPUT otherwise).
    // result_count:true returns the FULL available total regardless of limit, so clamp here -
    // this lets a single spec be reused for both source-preview and source-import (which wants a high limit).
    inputs.limit = Math.min(Math.max(Number(inputs.limit ?? source.limit ?? 50) || 50, 1), 50);
    inputs.result_count = true;
    const defaultEnrichmentType = source.type === 'people' ? 'find-lists-of-people-with-mixrank-source-preview' : 'find-lists-of-companies-with-mixrank-source-preview';
    const { data } = await clay._request('POST', '/v3/actions/run-cpj-preview-enrichment', { body: { workspaceId: String(workspaceId), enrichmentType: source.enrichmentType || defaultEnrichmentType, options: { returnTaskId: true, returnActionMetadata: true }, inputs } });
    return out(withCommandProvenance(data, {
      commandId: 'source_preview',
      sourceFiles: [file],
      stdoutPath: flags.out || null,
      workspaceId,
    }), { out: flags.out });
  }

  if (cmd === 'source-import') {
    const file = flags._[1]; if (!file || !flags['destination-table']) throw new Error('usage: source-import <source.yaml|json> --destination-table TABLE --confirm');
    const spec = readSpec(file);
    const workspaceId = String(resolveWorkspace(flags.workspace || spec.workspaceId));
    assertAllowedWorkspace(workspaceId);
    const source = spec.source || spec;
    if (!['companies', 'people'].includes(source.type)) throw new Error('source-import supports companies|people');
    const inputs = { ...(source.filters || {}) };
    if (inputs.limit == null) inputs.limit = source.limit || 1;
    const sourceState = { sourceType: source.type, sourceConfig: { type: 'search', entityType: source.type, mode: 'filters', filters: inputs, additionalRequirements: [], originalQuery: '', createdAt: Date.now()/1000, lastModifiedAt: Date.now()/1000 } };
    const conv = await clay._request('POST', `/v3/${workspaceId}/ai-generation/chat-conversation`, { body: { conversationType: 'ai_onboarding', initialSourceState: sourceState } });
    const conversationId = conv.data.id || conv.data.conversationId;
    const previewInputs = { ...inputs, result_count: true };
    const previewType = source.type === 'people' ? 'find-lists-of-people-with-mixrank-source-preview' : 'find-lists-of-companies-with-mixrank-source-preview';
    const preview = await clay._request('POST', '/v3/actions/run-cpj-preview-enrichment', { body: { workspaceId, enrichmentType: previewType, options: { returnTaskId: true, returnActionMetadata: true }, inputs: previewInputs } });
    const previewActionTaskId = preview.data.taskId;
    if (!conversationId || !previewActionTaskId) throw new Error('missing conversationId or preview taskId');
    await clay._request('POST', `/v3/${workspaceId}/ai-generation/chat-conversation/${conversationId}/confirm-ai-onboarding-output`, { body: {} });
    const basicFields = source.basicFields || (source.type === 'people' ? [
      { name: 'First Name', dataType: 'text', formulaText: '{{source}}.first_name' },
      { name: 'Last Name', dataType: 'text', formulaText: '{{source}}.last_name' },
      { name: 'Full Name', dataType: 'text', formulaText: '{{source}}.name' },
      { name: 'Job Title', dataType: 'text', formulaText: '{{source}}.matched_experience.job_title || {{source}}.latest_experience_title' },
      { name: 'Location', dataType: 'text', formulaText: '{{source}}.location_name' },
      { name: 'Company Domain', dataType: 'url', formulaText: '{{source}}.domain' },
      { name: 'LinkedIn Profile', dataType: 'url', formulaText: '{{source}}.url', isDedupeField: true }
    ] : [
      { name: 'Name', dataType: 'text', formulaText: '{{source}}.name' },
      { name: 'Description', dataType: 'text', formulaText: '{{source}}.description' },
      { name: 'Primary Industry', dataType: 'text', formulaText: '{{source}}.industry' },
      { name: 'Size', dataType: 'text', formulaText: '{{source}}.size' },
      { name: 'Type', dataType: 'text', formulaText: '{{source}}.type' },
      { name: 'Location', dataType: 'text', formulaText: '{{source}}.location' },
      { name: 'Country', dataType: 'text', formulaText: '{{source}}.country' },
      { name: 'Domain', dataType: 'url', formulaText: '{{source}}.domain' },
      { name: 'LinkedIn URL', dataType: 'url', formulaText: '{{source}}.linkedin_url', isDedupeField: true }
    ]);
    const isPeople = source.type === 'people';
    const importBody = { workspaceId, workbookName: source.workbookName || (isPeople ? 'People Search' : 'Companies Search'), workbookId: source.workbookId || null, conversationId, assignedFieldId: source.assignedFieldId || (isPeople ? 'f_people_search' : 'f_companies_search'), cpjConfig: { type: source.type, typeSettings: { name: source.name || (isPeople ? 'Find people' : 'Find companies'), iconType: isPeople ? 'PersonWithMagnifyingGlass' : 'BuildingWithMagnifyingGlass', actionKey: isPeople ? 'find-lists-of-people-with-mixrank-source' : 'find-lists-of-companies-with-mixrank-source', actionPackageId: 'e251a70e-46d7-4f3a-b3ef-a211ad3d8bd2', previewTextPath: 'name', defaultPreviewText: isPeople ? 'Clay Profile' : 'Profile', recordsPath: isPeople ? 'people' : 'companies', idPath: isPeople ? 'profile_id' : 'linkedin_company_id', scheduleConfig: { runSettings: 'once' }, ...(isPeople ? { dedupeOnUniqueIds: true } : {}), hasEvaluatedInputs: false, inputs, previewActionKey: previewType }, clientSettings: { tableType: isPeople ? 'people' : 'company' }, basicFields, previewActionTaskId, destinationTableId: flags['destination-table'] } };
    const imported = await clay._request('POST', '/v3/sources/create-cpj-table', { body: importBody });
    const createdExtracts = [];
    if (Array.isArray(source.extract) && source.extract.length) {
      const info = await clay.getTableInfo(flags['destination-table']);
      const table = info.table || info;
      const sourceField = (table.fields || []).find(f => f.type === 'source' && (f.typeSettings?.sourceIds || []).includes(imported.data.sourceId));
      if (!sourceField) throw new Error('source imported but source field not found for extraction');
      for (const e of source.extract) createdExtracts.push(await createOutputField(clay, flags['destination-table'], sourceField.id, e));
    }
    return out(withCommandProvenance({
      imported: true,
      conversationId,
      previewActionTaskId,
      destinationTableId: flags['destination-table'],
      sourceId: imported.data.sourceId,
      extractedFields: createdExtracts.map(f => ({ id: f.id, name: f.name })),
      result: imported.data,
    }, {
      commandId: 'source_import',
      sourceFiles: [file],
      stdoutPath: flags.out || null,
      workspaceId,
      tableId: flags['destination-table'],
    }), { out: flags.out });
  }

  if (cmd === 'apply-spec') {
    const file = flags._[1]; if (!file) throw new Error('usage: apply-spec <spec.yaml|json> --confirm');
    const rawSpec = readSpec(file);
    if (flags.workspace) rawSpec.workspaceId = flags.workspace;
    if (flags.workbook) rawSpec.workbookId = flags.workbook;
    if (flags.folder) rawSpec.folderId = flags.folder;
    const spec = resolveEnvPlaceholders(rawSpec);
    const unresolved = findUnresolvedPlaceholders(spec);
    if (unresolved.length) throw new Error(`unresolved spec placeholders before apply: ${unresolved.map(item => item.path).join(', ')}`);
    const validation = validateSpecObject(spec);
    if (!validation.valid) return out({ applied: false, validation }, { raw: true });
    if (flags['dry-run']) {
      const workspaceId = resolveWorkspace(spec.workspaceId);
      assertAllowedWorkspace(workspaceId);
      assertAllowedFolder(spec.folderId || flags.folder);
      const dryRunFieldIdByName = new Map(Object.entries(flags['field-map-json'] ? JSON.parse(flags['field-map-json']) : {}));
      const dependencyPlans = (spec.fields || []).filter(field => field.type === 'action' || field.actionKey).map(field => {
        const inputBindings = Object.entries(field.inputs || {}).map(([name, formulaText]) => ({ name, formulaText: resolveFieldRefs(formulaText, dryRunFieldIdByName) }));
        const runCondition = field.runCondition ? resolveFieldRefs(field.runCondition, dryRunFieldIdByName) : null;
        return { field: field.name, actionKey: field.actionKey || null, inputBindings, runCondition, expectedInputFieldIds: expectedInputFieldIdsForActionSpec(field, inputBindings, runCondition) };
      });
      return out({
        applied: false,
        dryRun: true,
        sourceSpec: path.relative(__dirname, path.isAbsolute(file) ? file : path.join(__dirname, file)),
        workspaceId: String(workspaceId),
        folderId: spec.folderId || null,
        workbookId: spec.workbookId || null,
        tableId: spec.table?.id || null,
        tableName: spec.table?.name || null,
        viewId: flags.view || spec.view?.id || null,
        viewName: spec.view?.name || null,
        wouldCreateTable: !spec.table?.id,
        wouldCreateView: !flags.view && !spec.view?.id && !!spec.view?.name,
        fieldCount: (spec.fields || []).length,
        rowCount: (spec.rows || []).length,
        actionSchemas: actionSchemaSummaries(spec.fields || []),
        dependencyPlans,
        plannedOperations: [
          ...(!spec.table?.id ? [{ op: 'create_table', table: spec.table?.name || null, workbookId: spec.workbookId || null }] : []),
          ...(!flags.view && !spec.view?.id && spec.view?.name ? [{ op: 'create_view', view: spec.view.name }] : []),
          ...(spec.fields || []).map(field => ({ op: 'ensure_field', field: field.name, type: field.type || field.dataType || 'text' })),
          ...((spec.rows || []).length ? [{ op: 'add_rows_if_new_table_or_apply_rows', count: spec.rows.length }] : []),
        ],
      }, { out: flags.out, raw: true });
    }
    let tableId = spec.table?.id;
    let createdTable = false;
    const operations = [];
    if (!tableId) {
      if (!spec.workbookId || !spec.table?.name) throw new Error('creating a table from spec requires workbookId and table.name');
      const workspaceId = resolveWorkspace(spec.workspaceId);
      assertAllowedWorkspace(workspaceId);
      assertAllowedFolder(spec.folderId || flags.folder);
      const created = await clay._request('POST', '/v3/tables', { body: { name: spec.table.name, workbookId: spec.workbookId, workspaceId: Number(workspaceId), type: spec.table.type || 'spreadsheet', template: 'no_views' } });
      tableId = (created.data.table || created.data).id;
      createdTable = true;
      operations.push({ op: 'create_table', table: spec.table.name, id: tableId });
    }
    let viewId = flags.view || spec.view?.id;
    if (!viewId && (createdTable || spec.view?.name)) {
      const createdView = await clay._request('POST', `/v3/tables/${tableId}/views`, { body: { name: spec.view?.name || 'Default View', type: spec.view?.type || 'grid' } });
      viewId = createdView.data.id;
      operations.push({ op: 'create_view', view: spec.view?.name || 'Default View', id: viewId });
    }
    const liveManifest = await getTableManifest(clay, tableId, viewId, { includeRows: 0 });
    const liveSpec = specFromManifest(liveManifest, viewId);
    const liveByName = new Map((liveSpec.fields || []).map(f => [f.name, f]));
    const fieldIdByName = new Map((liveSpec.fields || []).filter(f => f.id).map(f => [f.name, f.id]));
    const createdByName = new Map();
    const expectedDependencyByName = new Map();
    for (const f of spec.fields || []) {
      const live = liveByName.get(f.name);
      if (!live) {
        if (f.type === 'action' || f.actionKey) {
          const inputBindings = Object.entries(f.inputs || {}).map(([name, formulaText]) => ({ name, formulaText: resolveFieldRefs(formulaText, fieldIdByName) }));
          const runCondition = f.runCondition ? resolveFieldRefs(f.runCondition, fieldIdByName) : null;
          expectedDependencyByName.set(f.name, expectedInputFieldIdsForActionSpec(f, inputBindings, runCondition));
        }
        const res = await createFieldFromSpec(clay, tableId, f, fieldIdByName);
        createdByName.set(f.name, res.created);
        fieldIdByName.set(f.name, res.created.id);
        operations.push({ op: 'create_field', field: f.name, id: res.created.id, outputs: (res.outputs || []).map(o => ({ name: o.name, id: o.id })) });
      } else {
        let desiredTs;
        let desiredInputFieldIds = null;
        if (f.type === 'formula') desiredTs = { dataTypeSettings: { type: f.dataType || 'text' }, formulaType: f.dataType || 'text', formulaText: resolveFieldRefs(f.formula, fieldIdByName) };
        else if (f.type === 'action' || f.actionKey) {
          const bs = Object.entries(f.inputs || {}).map(([name, formulaText]) => ({ name, formulaText: resolveFieldRefs(formulaText, fieldIdByName) }));
          const schema = f.actionKey === 'use-ai' ? answerSchemaBinding(f.outputs) : null;
          if (schema && !bs.some(b => b.name === 'answerSchemaType')) bs.push(schema);
          const runCondition = f.runCondition ? resolveFieldRefs(f.runCondition, fieldIdByName) : null;
          desiredInputFieldIds = expectedInputFieldIdsForActionSpec(f, bs, runCondition);
          expectedDependencyByName.set(f.name, desiredInputFieldIds);
          desiredTs = { dataTypeSettings: { type: f.dataType || 'json' }, actionKey: f.actionKey, actionPackageId: f.actionPackageId, actionVersion: f.actionVersion || 1, inputsBinding: bs, ...(f.authAccountId ? { authAccountId: f.authAccountId } : {}), ...(runCondition ? { conditionalRunFormulaText: runCondition } : {}), ...(f.runAsButton !== undefined ? { runAsButton: !!f.runAsButton } : {}) };
        } else desiredTs = { dataTypeSettings: { type: f.dataType || f.type || 'text', ...(f.options ? { options: f.options } : {}) } };
        const needsPatch = specFieldSig(f) !== specFieldSig(live);
        if (needsPatch && !flags['create-only']) {
          const patchBody = { name: f.name, typeSettings: desiredTs, ...(desiredInputFieldIds ? { inputFieldIds: desiredInputFieldIds } : {}) };
          const patched = await clay._request('PATCH', `/v3/tables/${tableId}/fields/${live.id}`, { body: patchBody });
          operations.push({ op: 'patch_field', field: f.name, id: (patched.data.field || patched.data).id, ...(desiredInputFieldIds ? { expectedInputFieldIds: desiredInputFieldIds } : {}) });
        }
        const liveOutputs = new Set((live.outputs || []).map(o => o.name));
        for (const o of f.outputs || []) if (!liveOutputs.has(o.name)) {
          const child = await createOutputField(clay, tableId, live.id, o);
          operations.push({ op: 'create_output_field', parent: f.name, field: o.name, id: child.id });
        }
      }
    }
    const infoAfterFields = await clay.getTableInfo(tableId); const tableAfterFields = infoAfterFields.table || infoAfterFields;
    for (const f of tableAfterFields.fields || []) if (f.name && f.id) fieldIdByName.set(f.name, f.id);
    const dependencyReadbacks = [];
    const fieldsAfterByName = new Map((tableAfterFields.fields || []).map(field => [field.name, field]));
    for (const [fieldName, expectedInputFieldIds] of expectedDependencyByName.entries()) {
      const readbackField = fieldsAfterByName.get(fieldName);
      const readback = dependencyReadbackForField(readbackField, expectedInputFieldIds);
      dependencyReadbacks.push(readback);
      operations.push({ op: 'dependency_readback', field: fieldName, ...readback });
    }
    if (Array.isArray(spec.rows) && spec.rows.length && (createdTable || flags['apply-rows'])) {
      const records = spec.rows.map(row => ({ id: crypto.randomBytes(12).toString('hex'), cells: Object.fromEntries(Object.entries(row).map(([name, value]) => [fieldIdByName.get(name) || name, value]).filter(([fieldId]) => fieldId)) }));
      await clay._request('POST', `/v3/tables/${tableId}/records`, { body: { records } });
      operations.push({ op: 'add_rows', count: records.length });
    }
    if (viewId) {
      const table = tableAfterFields;
      const liveFieldsByName = new Map((table.fields || []).map(f => [f.name, f]));
      for (const f of spec.fields || []) {
        if (f.visible === undefined && f.width === undefined) continue;
        const live = liveFieldsByName.get(f.name) || createdByName.get(f.name);
        if (!live?.id) continue;
        const body = {}; if (f.visible !== undefined) body.isVisible = !!f.visible; if (f.width !== undefined) body.width = Number(f.width);
        await clay._request('PATCH', `/v3/tables/${tableId}/views/${viewId}/fields/${live.id}`, { body });
        operations.push({ op: 'patch_view_field', field: f.name, id: live.id, body });
      }
    }
    const verify = await (async () => {
      const post = await getTableManifest(clay, tableId, viewId, { includeRows: 10 });
      return validateSpecObject(specFromManifest(post, viewId));
    })();
    return out(withCommandProvenance({
      applied: true,
      tableId,
      viewId,
      operations,
      postApplySpecValidation: verify,
      dependencyReadbacks,
    }, {
      commandId: 'apply_sample_spec',
      sourceFiles: [file],
      stdoutPath: flags.out || null,
      workspaceId: resolveWorkspace(spec.workspaceId),
      folderId: spec.folderId || null,
      workbookId: spec.workbookId || null,
      tableId,
      viewId,
    }), { out: flags.out, raw: true });
  }

  if (cmd === 'create-field-group') {
    const tableId = flags._[1]; if (!tableId || !flags.name || !flags.fields) throw new Error('usage: create-field-group <tableId> --name NAME --fields f1,f2');
    const { data } = await clay._request('POST', `/v3/tables/${tableId}/fields/group`, { body: { name: flags.name, fieldIds: flags.fields.split(',') } });
    return out(data);
  }

  if (cmd === 'create-output-field') {
    const tableId = flags._[1]; if (!tableId || !flags.parent || !flags.name || !flags.path) throw new Error('usage: create-output-field <tableId> --parent FIELD --name response --path response');
    const dataType = flags['data-type'] || 'text';
    const pathParts = String(flags.path).split('.').filter(Boolean);
    const formulaPath = pathParts.map(p => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p) ? `.${p}` : `?.[${JSON.stringify(p)}]`).join('');
    const formulaText = `{{${flags.parent}}}${formulaPath}`;
    const { data } = await clay._request('POST', `/v3/tables/${tableId}/fields`, { body: { name: flags.name, type: 'formula', typeSettings: { dataTypeSettings: { type: dataType }, formulaType: dataType, formulaText, mappedResultPath: pathParts }, inputFieldIds: [flags.parent] } });
    return out(data);
  }

  if (cmd === 'verify-table') {
    const tableId = flags._[1]; if (!tableId) throw new Error('usage: verify-table <tableId> [--view VIEW]');
    const manifest = await getTableManifest(clay, tableId, flags.view, { includeRows: flags['include-rows'] || 10 });
    const table = manifest.table;
    const fields = table.fields || [];
    const childrenByParent = new Map();
    for (const f of fields) {
      const parent = f.extractedField?.fieldIdExtractedFrom;
      if (parent) {
        if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
        childrenByParent.get(parent).push({ id: f.id, name: f.name, path: f.typeSettings?.mappedResultPath || f.extractedField?.extractedKeyPath });
      }
    }
    const issues = [];
    for (const f of fields) {
      if (f.settingsError?.length) issues.push({ severity: 'error', fieldId: f.id, fieldName: f.name, type: 'settings_error', details: f.settingsError });
      if (f.type === 'action') {
        const actionKey = f.typeSettings?.actionKey;
        const children = childrenByParent.get(f.id) || [];
        const schemaBinding = (f.typeSettings?.inputsBinding || []).find(b => b.name === 'answerSchemaType' && b.formulaMap?.fields);
        const hasUiOutputs = !!schemaBinding || children.length > 0;
        if (['use-ai', 'http-api-v2'].includes(actionKey) && !hasUiOutputs) {
          issues.push({ severity: 'warning', fieldId: f.id, fieldName: f.name, type: 'action_without_outputs', actionKey, message: 'Action has neither UI output schema nor extracted output fields.' });
        }
        if (actionKey === 'use-ai' && !f.typeSettings?.authAccountId) {
          const model = (f.typeSettings?.inputsBinding || []).find(b => b.name === 'model')?.formulaText || '';
          if (!/"clay-/.test(model) && !/^clay-/.test(model)) issues.push({ severity: 'error', fieldId: f.id, fieldName: f.name, type: 'missing_auth_account', actionKey });
        }
      }
    }
    const records = manifest.records || [];
    const fieldByIdOrName = new Map(fields.flatMap(f => [[f.id, f], [f.name, f]]));
    const requiredValueFields = String(flags['require-values'] || '').split(',').map(s => s.trim()).filter(Boolean).map(ref => fieldByIdOrName.get(ref) || { id: ref, name: ref, missingField: true });
    for (const f of requiredValueFields) {
      if (f.missingField) issues.push({ severity: 'error', fieldId: f.id, fieldName: f.name, type: 'required_value_field_not_found' });
    }
    const nonEmptyCellValue = cell => {
      if (!cell) return null;
      const value = cell.value ?? cell.text ?? cell.externalContent?.fullValue ?? null;
      if (value == null) return null;
      if (typeof value === 'string' && !value.trim()) return null;
      return value;
    };
    const statusCounts = {};
    for (const r of records) {
      for (const f of requiredValueFields.filter(f => !f.missingField)) {
        const cell = (r.cells || r.values || {})[f.id];
        if (nonEmptyCellValue(cell) == null) {
          issues.push({ severity: 'error', fieldId: f.id, fieldName: f.name, type: 'required_value_blank', sampleRecordId: r.id, message: 'Field is required for downstream actions but readback value is blank.' });
        }
      }
      const cells = r.cells || r.values || {};
      for (const [fieldId, cell] of Object.entries(cells)) {
        const status = cell?.metadata?.status || cell?.externalContent?.status;
        if (!status) continue;
        statusCounts[fieldId] ||= {};
        statusCounts[fieldId][status] = (statusCounts[fieldId][status] || 0) + 1;
        if (status !== 'SUCCESS' && status !== 'ERROR_RUN_CONDITION_NOT_MET') {
          const f = fields.find(x => x.id === fieldId);
          const isError = String(status).startsWith('ERROR') || ['FAILED', 'CANCELLED'].includes(status);
          issues.push({ severity: isError ? 'error' : 'warning', fieldId, fieldName: f?.name, type: 'cell_non_success_status', status, sampleRecordId: r.id, message: cell?.externalContent?.message || cell?.metadata?.errorMessagePreview || cell?.value });
        }
      }
    }
    const summary = {
      table: { id: table.id, name: table.name },
      checkedRows: records.length,
      issueCount: issues.length,
      errorCount: issues.filter(i => i.severity === 'error').length,
      warningCount: issues.filter(i => i.severity === 'warning').length,
      actionOutputs: fields.filter(f => f.type === 'action').map(f => { const schemaBinding = (f.typeSettings?.inputsBinding || []).find(b => b.name === 'answerSchemaType' && b.formulaMap?.fields); let uiOutputs = []; if (schemaBinding) { try { uiOutputs = Object.entries(JSON.parse(schemaBinding.formulaMap.fields)).map(([name, cfg]) => ({ name, type: cfg.type, source: 'answerSchemaType' })); } catch {} } return { id: f.id, name: f.name, actionKey: f.typeSettings?.actionKey, uiOutputs, extractedOutputs: childrenByParent.get(f.id) || [] }; }),
      statusCounts,
      issues
    };
    return out(summary);
  }

  throw new Error(`unknown command ${cmd}`);
}

main().catch(e => { console.error(JSON.stringify({ error: e.message }, null, 2)); process.exit(1); });
