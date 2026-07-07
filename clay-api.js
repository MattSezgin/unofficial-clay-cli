/**
 * Clay API Client
 * Interact with Clay's internal v3 API — list tables, push rows, run enrichments, check credits.
 * Auth is cookie-based (claysession), auto-refreshed from .env credentials.
 *
 * Usage as module:
 *   const { ClayAPI } = require('./clay-api.js');
 *   const clay = new ClayAPI();
 *   const workspaces = await clay.getWorkspaces();
 *
 * Usage as CLI:
 *   node clay-api.js <command> [args]
 *   node clay-api.js help
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_HOST = 'api.clay.com';
// The session file deliberately lives ONE DIRECTORY ABOVE the repo: a credential
// that sits outside the working tree can never be committed, even if .gitignore
// rules break.
const SESSION_FILE = path.join(__dirname, '..', '.clay-session');
// .env is read from the repo root first (the documented setup), falling back to
// one directory above for setups that keep all credentials outside the tree.
const ENV_FILE = [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')].find(p => fs.existsSync(p)) || path.join(__dirname, '.env');
const SESSION_MAX_AGE_MS = 23 * 60 * 60 * 1000; // 23 hours

class ClayAPI {
  constructor() {
    this._session = null;
  }

  // ---------------------------------------------------------------------------
  // ENV + Session helpers
  // ---------------------------------------------------------------------------

  _loadEnv() {
    if (!fs.existsSync(ENV_FILE)) {
      throw new Error('.env file not found — create it with CLAY_EMAIL and CLAY_PASSWORD');
    }
    const lines = fs.readFileSync(ENV_FILE, 'utf-8').split('\n');
    const env = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    if (!env.CLAY_EMAIL || !env.CLAY_PASSWORD) {
      throw new Error('.env must contain CLAY_EMAIL and CLAY_PASSWORD');
    }
    return env;
  }

  _loadSession() {
    if (!fs.existsSync(SESSION_FILE)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      if (!data.cookie || !data.savedAt) return null;
      const age = Date.now() - new Date(data.savedAt).getTime();
      if (age > SESSION_MAX_AGE_MS) return null;
      return data.cookie;
    } catch {
      return null;
    }
  }

  _saveSession(cookie) {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ cookie, savedAt: new Date().toISOString() }, null, 2));
  }

  _clearSession() {
    this._session = null;
    // Never delete the only session copy: a single stray 401 (e.g. an
    // unauthenticated request before _ensureSession) would destroy auth for
    // everything. Park it as .invalid so it stays recoverable.
    if (fs.existsSync(SESSION_FILE)) fs.renameSync(SESSION_FILE, SESSION_FILE + '.invalid');
  }

  async _ensureSession() {
    if (this._session) return;
    const cached = this._loadSession();
    if (cached) {
      this._session = cached;
      return;
    }
    // Try login if .env exists, otherwise guide user to provide cookie
    if (fs.existsSync(ENV_FILE)) {
      await this.login();
    } else {
      throw new Error(
        'No valid session and no .env file.\n' +
        'Option 1: Create .env (repo root) with CLAY_EMAIL and CLAY_PASSWORD\n' +
        'Option 2: Grab the claysession cookie from browser DevTools (Application tab) and save it to the session file.\n' +
        `  The session file lives OUTSIDE the repo so it can never be committed: ${SESSION_FILE}\n` +
        '  echo \'{"cookie":"YOUR_COOKIE","savedAt":"' + new Date().toISOString() + '"}\' > ' + SESSION_FILE
      );
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP transport
  // ---------------------------------------------------------------------------

  /**
   * @param {string} method
   * @param {string} urlPath
   * @param {object} opts
   * @param {object} [opts.body] - JSON body
   * @param {object} [opts.formJsonBody] - Sent as application/x-www-form-urlencoded where the key is the JSON string
   * @param {object} [opts.query] - Query string params
   * @param {boolean} [opts.noAuth] - Skip auth header
   */
  _request(method, urlPath, opts = {}) {
    return new Promise((resolve, reject) => {
      let queryString = '';
      if (opts.query) {
        const parts = [];
        for (const [k, v] of Object.entries(opts.query)) {
          parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
        }
        queryString = '?' + parts.join('&');
      }

      const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Origin': 'https://app.clay.com',
        'Referer': 'https://app.clay.com/'
      };

      if (!opts.noAuth && this._session) {
        headers['Cookie'] = `claysession=${this._session}`;
      }

      let bodyData = null;

      if (opts.formJsonBody) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        const jsonStr = JSON.stringify(opts.formJsonBody);
        bodyData = encodeURIComponent(jsonStr) + '=';
      } else if (opts.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        bodyData = JSON.stringify(opts.body);
      }

      if (bodyData) {
        headers['Content-Length'] = Buffer.byteLength(bodyData);
      }

      const reqOpts = {
        hostname: BASE_HOST,
        port: 443,
        path: urlPath + queryString,
        method,
        headers
      };

      const req = https.request(reqOpts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();

          // Extract set-cookie for login
          const setCookie = res.headers['set-cookie'];

          let parsed;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = { _raw: raw };
          }

          if (res.statusCode === 401) {
            this._clearSession();
            reject(new Error('Unauthorized — session expired or invalid'));
            return;
          }

          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 500)}`));
            return;
          }

          resolve({ data: parsed, headers: res.headers, setCookie, statusCode: res.statusCode });
        });
      });

      req.on('error', reject);
      if (bodyData) req.write(bodyData);
      req.end();
    });
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  async login() {
    const env = this._loadEnv();
    const { data, setCookie } = await this._request('POST', '/v3/auth/login', {
      body: { email: env.CLAY_EMAIL, password: env.CLAY_PASSWORD, source: null },
      noAuth: true
    });

    if (!setCookie) {
      throw new Error('Login failed — no Set-Cookie header returned');
    }

    let sessionToken = null;
    for (const c of setCookie) {
      const match = c.match(/claysession=([^;]+)/);
      if (match) {
        sessionToken = decodeURIComponent(match[1]);
        break;
      }
    }

    if (!sessionToken) {
      throw new Error('Login failed — claysession cookie not found in response');
    }

    this._session = sessionToken;
    this._saveSession(sessionToken);
    return data;
  }

  // ---------------------------------------------------------------------------
  // User / Workspace APIs
  // ---------------------------------------------------------------------------

  async getMe() {
    await this._ensureSession();
    const { data } = await this._request('GET', '/v3/me');
    return data;
  }

  async getWorkspaces() {
    await this._ensureSession();
    const { data } = await this._request('GET', '/v3/my-workspaces');
    return data;
  }

  async getWorkspaceDetails(wsId) {
    await this._ensureSession();
    const { data } = await this._request('GET', `/v3/workspaces/${wsId}`);
    return data;
  }

  async getResources(wsId, ownerIds = []) {
    await this._ensureSession();
    const body = { parentResource: null, filters: {} };
    if (ownerIds.length > 0) {
      body.filters.ownerIds = ownerIds;
    }
    const { data } = await this._request('POST', `/v3/workspaces/${wsId}/resources_v2/`, { body });
    return data;
  }

  async getPermissions(wsId) {
    await this._ensureSession();
    const { data } = await this._request('GET', `/v3/workspaces/${wsId}/permissions`);
    return data;
  }

  async getUsers(wsId) {
    await this._ensureSession();
    const { data } = await this._request('GET', `/v3/workspaces/${wsId}/users`);
    return data;
  }

  async getSignals(wsId) {
    await this._ensureSession();
    const { data } = await this._request('GET', `/v3/workspaces/${wsId}/signals`);
    return data;
  }

  async getWorkbooks(wsId) {
    await this._ensureSession();
    const { data } = await this._request('GET', `/v3/workspaces/${wsId}/workbooks`);
    return data;
  }

  async createFolder(wsId, name) {
    await this._ensureSession();
    const { data } = await this._request('POST', `/v3/workspaces/${wsId}/folders`, {
      body: { name }
    });
    return data;
  }

  async createTable(wsId, workbookId, name, type = 'company') {
    await this._ensureSession();
    const { data } = await this._request('POST', '/v3/tables', {
      body: { name, workbookId, workspaceId: Number(wsId), type }
    });
    return data;
  }

  async createWorkbook(wsId, name, parentFolderId = null) {
    await this._ensureSession();
    const body = { name, workspaceId: Number(wsId), settings: { isAutoRun: true } };
    if (parentFolderId) body.parentFolderId = parentFolderId;
    const { data } = await this._request('POST', '/v3/workbooks', { body });
    return data;
  }

  async deleteWorkbook(workbookId) {
    await this._ensureSession();
    const { data } = await this._request('DELETE', `/v3/workbooks/${workbookId}`);
    return data;
  }

  async deleteResources(wsId, opts = {}) {
    await this._ensureSession();
    const { data } = await this._request('DELETE', `/v3/workspaces/${wsId}/resources/`, {
      body: {
        tableIds: opts.tableIds || [],
        workbookIds: opts.workbookIds || [],
        folderIds: opts.folderIds || [],
        isPermanentDelete: opts.isPermanentDelete || false
      }
    });
    return data;
  }

  // ---------------------------------------------------------------------------
  // Table / Record APIs
  // ---------------------------------------------------------------------------

  async getRowCount(tableId) {
    await this._ensureSession();
    const { data } = await this._request('GET', `/v3/tables/${tableId}/count`);
    return data;
  }

  async getRecordIds(tableId, viewId) {
    await this._ensureSession();
    const { data } = await this._request('GET', `/v3/tables/${tableId}/views/${viewId}/records/ids`);
    return data;
  }

  async getTableInfo(tableId) {
    await this._ensureSession();
    const { data } = await this._request('GET', `/v3/tables/${tableId}`);
    return data;
  }

  async getRows(tableId, viewId, limit, offset) {
    await this._ensureSession();
    const query = {};
    if (limit !== undefined) query.limit = String(limit);
    if (offset !== undefined) query.offset = String(offset);
    const { data } = await this._request('GET', `/v3/tables/${tableId}/views/${viewId}/records`, { query });
    return data;
  }

  async addRows(tableId, records) {
    await this._ensureSession();
    // Auto-generate row IDs if not provided
    const rows = records.map((cells) => ({
      id: crypto.randomBytes(12).toString('hex'),
      cells: typeof cells === 'object' ? cells : {}
    }));
    const { data } = await this._request('POST', `/v3/tables/${tableId}/records`, {
      body: { records: rows }
    });
    return data;
  }

  async deleteRows(tableId, viewId) {
    await this._ensureSession();
    const { data } = await this._request('DELETE', `/v3/tables/${tableId}/records`, {
      formJsonBody: {
        deleteAll: true,
        viewId,
        omitDeletingRecordIds: [],
        recordIds: [],
        viewFiltersHash: ''
      }
    });
    return data;
  }

  async getRecord(tableId, recordId) {
    await this._ensureSession();
    const { data } = await this._request('GET', `/v3/tables/${tableId}/records/${recordId}`);
    return data;
  }

  async updateRecord(tableId, recordId, cells) {
    await this._ensureSession();
    const { data } = await this._request('PATCH', `/v3/tables/${tableId}/records/${recordId}`, {
      body: { cells }
    });
    return data;
  }

  async updateRecords(tableId, records) {
    await this._ensureSession();
    const { data } = await this._request('PATCH', `/v3/tables/${tableId}/records`, {
      body: { records }
    });
    return data;
  }

  async runEnrichment(tableId, fieldIds, viewId, numRecords) {
    await this._ensureSession();
    const runRecords = { viewIdTopRecords: { viewId } };
    if (numRecords !== undefined && numRecords !== null) {
      runRecords.viewIdTopRecords.numRecords = Number(numRecords);
    }
    // NOTE: /run now requires a JSON body; the old formJsonBody (form-urlencoded) encoding
    // is rejected with "fieldIds - Required, runRecords - Required". See docs gotcha #17.
    const { data } = await this._request('PATCH', `/v3/tables/${tableId}/run`, {
      body: {
        fieldIds: Array.isArray(fieldIds) ? fieldIds : [fieldIds],
        runRecords,
        callerName: 'API'
      }
    });
    return data;
  }

  // ---------------------------------------------------------------------------
  // Field / View APIs
  // ---------------------------------------------------------------------------

  async createField(tableId, name, type = 'text') {
    await this._ensureSession();
    const { data } = await this._request('POST', `/v3/tables/${tableId}/fields`, {
      body: { name, type, typeSettings: { dataTypeSettings: { type } } }
    });
    return data;
  }

  async updateField(tableId, fieldId, updates) {
    await this._ensureSession();
    const { data } = await this._request('PATCH', `/v3/tables/${tableId}/fields/${fieldId}`, {
      body: updates
    });
    return data;
  }

  async deleteField(tableId, fieldId) {
    await this._ensureSession();
    const { data } = await this._request('DELETE', `/v3/tables/${tableId}/fields/${fieldId}`);
    return data;
  }

  async createView(tableId, name) {
    await this._ensureSession();
    const { data } = await this._request('POST', `/v3/tables/${tableId}/views`, {
      body: { name }
    });
    return data;
  }

  async getViewDetails(tableId, viewId) {
    await this._ensureSession();
    const { data } = await this._request('GET', `/v3/tables/${tableId}/views/${viewId}`);
    return data;
  }

  async deleteView(tableId, viewId) {
    await this._ensureSession();
    const { data } = await this._request('DELETE', `/v3/tables/${tableId}/views/${viewId}`);
    return data;
  }

  // ---------------------------------------------------------------------------
  // Source APIs
  // ---------------------------------------------------------------------------

  async getSources(tableId) {
    await this._ensureSession();
    const { data } = await this._request('GET', '/v3/sources', {
      query: { tableId }
    });
    return data;
  }

  async addWebhook(tableId, wsId, name = 'Webhook') {
    await this._ensureSession();
    const { data } = await this._request('PATCH', `/v3/tables/${tableId}`, {
      body: {
        tableSettings: {},
        fieldGroupMap: {},
        sourceSettings: {
          addSource: {
            name: 'Webhook',
            source: {
              name,
              workspaceId: String(wsId),
              type: 'webhook',
              typeSettings: {
                urlSlugText: 'Pull in data from a Webhook',
                iconType: 'Webhook',
                name: 'Webhook',
                description: 'Send any data to Clay',
                stages: []
              }
            }
          }
        }
      }
    });
    return data;
  }

  async deleteSource(sourceId, deleteRecords = false) {
    await this._ensureSession();
    const { data } = await this._request('DELETE', `/v3/sources/${sourceId}`, {
      body: { deleteRecords }
    });
    return data;
  }

  // ---------------------------------------------------------------------------
  // Credit / Integration APIs
  // ---------------------------------------------------------------------------

  async getCredits(wsId, startTime, endTime) {
    await this._ensureSession();
    const now = new Date();
    const start = startTime || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = endTime || now.toISOString();
    const { data } = await this._request('GET', `/v3/credit-reporting/${wsId}/creditReportType/workspace`, {
      query: {
        'timeRange[startTime]': start,
        'timeRange[endTime]': end
      }
    });
    return data;
  }

  async getCreditsByIntegration(wsId, startTime, endTime) {
    await this._ensureSession();
    const now = new Date();
    const start = startTime || new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const end = endTime || now.toISOString();
    const { data } = await this._request('GET', `/v3/credit-reporting/${wsId}/creditReportType/integration`, {
      query: {
        'timeRange[startTime]': start,
        'timeRange[endTime]': end
      }
    });
    return data;
  }

  async getIntegrations(wsId) {
    await this._ensureSession();
    const { data } = await this._request('GET', `/v3/workspaces/${wsId}/app-accounts`);
    return data;
  }
}

// =============================================================================
// CLI
// =============================================================================

function printHelp() {
  const help = `Clay API CLI — interact with Clay's v3 API

Usage: node clay-api.js <command> [args]

Commands:
  me                                       Current user profile
  login                                    Force fresh login
  workspaces                               List all workspaces
  workspace <wsId>                         Workspace details (billing, credits)
  tables <wsId> [ownerIds...]              List tables/workbooks (optionally filter by owner IDs)
  workbooks <wsId>                         List all workbooks
  signals <wsId>                           List signal automations
  table-info <tableId>                     Table metadata (fields, views, enrichments)
  table-count <tableId>                    Count rows in a table
  table-records <tableId> <viewId>         Fetch record IDs
  rows <tableId> <viewId> [limit] [offset] Read row data (resolves field names)
  record <tableId> <recordId>              Read a single record
  update-record <tableId> <recordId> <fieldId> <value>
                                           Edit a cell value
  update-records <tableId>                 Bulk edit cells (reads JSON from stdin)
  add-rows <tableId>                       Add rows (reads JSON array from stdin)
  delete-rows <tableId> <viewId> --confirm Delete all rows in a view (destructive)
  run-enrichment <tableId> <fieldId> <viewId> [n]
                                           Run enrichment on N rows (omit n = all)
  create-field <tableId> <name> [type]     Add a column (default type: text)
  delete-field <tableId> <fieldId>         Remove a column
  rename-field <tableId> <fieldId> <name>  Rename a column
  create-view <tableId> <name>             Add a view
  view-details <tableId> <viewId>          View column config and filters
  delete-view <tableId> <viewId>           Remove a view
  create-table <wsId> <workbookId> <name> [type]
                                           Create a table in a workbook (type: company|people|spreadsheet|jobs)
  sources <tableId>                        List data sources
  add-webhook <tableId> <wsId> [name]      Add webhook source
  delete-source <sourceId>                 Delete a source
  credits <wsId> [startTime] [endTime]     Credit usage (default: last 30 days)
  credits-by-integration <wsId> [startTime] [endTime]
                                           Credit usage by integration
  integrations <wsId>                      List connected integrations
  permissions <wsId>                       List workspace users
  create-folder <wsId> <name>              Create a folder
  create-workbook <wsId> <name> [--folder=<folderId>]
                                           Create a workbook (optionally in a folder)
  delete-workbook <workbookId>             Delete a workbook (soft delete)
  delete-resources <wsId> --workbooks=id1,id2 [--tables=id1] [--folders=id1] [--permanent]
                                           Delete resources (soft delete by default)
  help                                     Show this help

Safety:
  Write commands always preview first (dry-run) unless --confirm is passed.
  --dry-run                                Explicitly preview (no execution)
  --confirm                                Execute the write operation for real

All output is JSON to stdout. Errors/safety notices go to stderr.
Auth is automatic — session cached in .clay-session (23h TTL).`;

  console.log(help);
}

function jsonOut(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function errOut(msg) {
  process.stderr.write(JSON.stringify({ error: msg }) + '\n');
  process.exit(1);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(chunks.join('')));
      } catch (e) {
        reject(new Error('Invalid JSON on stdin'));
      }
    });
    process.stdin.on('error', reject);
    // Timeout after 5s if no data
    setTimeout(() => {
      if (chunks.length === 0) reject(new Error('No data on stdin (pipe JSON array)'));
    }, 5000);
  });
}

// Write commands that require --dry-run or --confirm
const WRITE_COMMANDS = new Set([
  'add-rows', 'delete-rows', 'run-enrichment', 'add-webhook', 'delete-source',
  'create-table', 'create-folder', 'create-workbook', 'delete-workbook', 'delete-resources',
  'update-record', 'update-records', 'create-field', 'delete-field', 'rename-field',
  'create-view', 'delete-view'
]);

async function main() {
  const rawArgs = process.argv.slice(2);
  const hasConfirm = rawArgs.includes('--confirm');
  const args = rawArgs.filter(a => a !== '--dry-run' && a !== '--confirm');
  const command = args[0];

  // Safety: write commands without --confirm always force dry-run
  let dryRun = rawArgs.includes('--dry-run');
  if (WRITE_COMMANDS.has(command) && !hasConfirm) {
    dryRun = true;
    if (!rawArgs.includes('--dry-run')) {
      process.stderr.write(JSON.stringify({
        safety: 'Write command detected — showing preview only.',
        hint: 'Re-run with --confirm to execute for real.'
      }, null, 2) + '\n');
    }
  }

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const clay = new ClayAPI();

  try {
    switch (command) {
      case 'me': {
        jsonOut(await clay.getMe());
        break;
      }

      case 'login': {
        const result = await clay.login();
        jsonOut({ success: true, ...result });
        break;
      }

      case 'workspaces': {
        jsonOut(await clay.getWorkspaces());
        break;
      }

      case 'workspace': {
        if (!args[1]) errOut('Usage: workspace <wsId>');
        const ws = await clay.getWorkspaceDetails(args[1]);
        const w = ws.workspace || ws;
        jsonOut({
          id: w.id, name: w.name,
          billing: w.billingPlanType, credits: w.credits,
          centsPerCredit: w.centsPerCredit,
          currentPeriodEnd: w.currentPeriodEnd,
          featureFlags: w.featureFlags
        });
        break;
      }

      case 'tables': {
        if (!args[1]) errOut('Usage: tables <wsId> [ownerIds...]');
        const ownerIds = args.slice(2);
        jsonOut(await clay.getResources(args[1], ownerIds));
        break;
      }

      case 'workbooks': {
        if (!args[1]) errOut('Usage: workbooks <wsId>');
        const wbs = await clay.getWorkbooks(args[1]);
        jsonOut((wbs || []).map(w => ({ id: w.id, name: w.name })));
        break;
      }

      case 'signals': {
        if (!args[1]) errOut('Usage: signals <wsId>');
        jsonOut(await clay.getSignals(args[1]));
        break;
      }

      case 'table-count': {
        if (!args[1]) errOut('Usage: table-count <tableId>');
        jsonOut(await clay.getRowCount(args[1]));
        break;
      }

      case 'table-records': {
        if (!args[1] || !args[2]) errOut('Usage: table-records <tableId> <viewId>');
        jsonOut(await clay.getRecordIds(args[1], args[2]));
        break;
      }

      case 'table-info': {
        if (!args[1]) errOut('Usage: table-info <tableId>');
        const info = await clay.getTableInfo(args[1]);
        // Summarize: fields, views, field groups
        const table = info.table || info;
        const summary = {
          id: table.id,
          name: table.name,
          workspaceId: table.workspaceId,
          views: (table.views || []).map(v => ({ id: v.id, name: v.name })),
          fields: (table.fields || []).map(f => ({ id: f.id, name: f.name, type: f.type })),
          fieldGroups: Object.entries(table.fieldGroupMap || {}).map(([id, g]) => ({ id, name: g.name, type: g.type }))
        };
        jsonOut(summary);
        break;
      }

      case 'rows': {
        if (!args[1] || !args[2]) errOut('Usage: rows <tableId> <viewId> [limit] [offset]');
        const rowData = await clay.getRows(args[1], args[2], args[3] ? Number(args[3]) : undefined, args[4] ? Number(args[4]) : undefined);
        // Resolve field IDs to names if possible
        try {
          const tableInfo = await clay.getTableInfo(args[1]);
          const fieldMap = {};
          for (const f of (tableInfo.table || tableInfo).fields || []) {
            fieldMap[f.id] = f.name;
          }
          const readable = (rowData.results || []).map(row => {
            const obj = { _rowId: row.id };
            for (const [fid, cell] of Object.entries(row.cells || {})) {
              const name = fieldMap[fid] || fid;
              obj[name] = cell.value !== undefined ? cell.value : cell;
            }
            return obj;
          });
          jsonOut(readable);
        } catch {
          jsonOut(rowData);
        }
        break;
      }

      case 'record': {
        if (!args[1] || !args[2]) errOut('Usage: record <tableId> <recordId>');
        const rec = await clay.getRecord(args[1], args[2]);
        // Resolve field names
        try {
          const ti = await clay.getTableInfo(args[1]);
          const fm = {};
          for (const f of ((ti.table || ti).fields || [])) fm[f.id] = f.name;
          const obj = { _rowId: (rec.record || rec).id };
          for (const [fid, cell] of Object.entries((rec.record || rec).cells || {})) {
            obj[fm[fid] || fid] = cell.value !== undefined ? cell.value : cell;
          }
          jsonOut(obj);
        } catch { jsonOut(rec); }
        break;
      }

      case 'update-record': {
        if (!args[1] || !args[2] || !args[3] || !args[4]) errOut('Usage: update-record <tableId> <recordId> <fieldId> <value>');
        const cellValue = args.slice(4).join(' ');
        if (dryRun) { jsonOut({ dryRun: true, action: 'update-record', tableId: args[1], recordId: args[2], fieldId: args[3], value: cellValue }); break; }
        jsonOut(await clay.updateRecord(args[1], args[2], { [args[3]]: { value: cellValue } }));
        break;
      }

      case 'update-records': {
        if (!args[1]) errOut('Usage: echo \'[{"id":"r_xxx","cells":{"f_xxx":{"value":"..."}}}]\' | update-records <tableId>');
        const updates = await readStdin();
        if (!Array.isArray(updates)) errOut('stdin must be a JSON array of {id, cells} objects');
        if (dryRun) { jsonOut({ dryRun: true, action: 'update-records', tableId: args[1], count: updates.length, preview: updates.slice(0, 3) }); break; }
        jsonOut(await clay.updateRecords(args[1], updates));
        break;
      }

      case 'add-rows': {
        if (!args[1]) errOut('Usage: echo \'[{"col":"val"}]\' | add-rows <tableId>');
        const records = await readStdin();
        if (!Array.isArray(records)) errOut('stdin must be a JSON array of row objects');
        if (dryRun) { jsonOut({ dryRun: true, action: 'add-rows', tableId: args[1], rowCount: records.length, preview: records.slice(0, 3) }); break; }
        jsonOut(await clay.addRows(args[1], records));
        break;
      }

      case 'delete-rows': {
        if (!args[1] || !args[2]) errOut('Usage: delete-rows <tableId> <viewId> --confirm');
        if (dryRun) { jsonOut({ dryRun: true, action: 'delete-rows', tableId: args[1], viewId: args[2], warning: 'Would delete ALL rows in this view' }); break; }
        jsonOut(await clay.deleteRows(args[1], args[2]));
        break;
      }

      case 'run-enrichment': {
        if (!args[1] || !args[2] || !args[3]) errOut('Usage: run-enrichment <tableId> <fieldId> <viewId> [n]');
        const n = args[4] ? Number(args[4]) : undefined;
        if (dryRun) { jsonOut({ dryRun: true, action: 'run-enrichment', tableId: args[1], fieldIds: args[2], viewId: args[3], numRecords: n || 'all', warning: 'This will consume credits' }); break; }
        jsonOut(await clay.runEnrichment(args[1], args[2], args[3], n));
        break;
      }

      case 'create-field': {
        if (!args[1] || !args[2]) errOut('Usage: create-field <tableId> <name> [type]');
        const fieldType = args[3] || 'text';
        if (dryRun) { jsonOut({ dryRun: true, action: 'create-field', tableId: args[1], name: args[2], type: fieldType }); break; }
        jsonOut(await clay.createField(args[1], args[2], fieldType));
        break;
      }

      case 'delete-field': {
        if (!args[1] || !args[2]) errOut('Usage: delete-field <tableId> <fieldId>');
        if (dryRun) { jsonOut({ dryRun: true, action: 'delete-field', tableId: args[1], fieldId: args[2] }); break; }
        jsonOut(await clay.deleteField(args[1], args[2]));
        break;
      }

      case 'rename-field': {
        if (!args[1] || !args[2] || !args[3]) errOut('Usage: rename-field <tableId> <fieldId> <name>');
        if (dryRun) { jsonOut({ dryRun: true, action: 'rename-field', tableId: args[1], fieldId: args[2], name: args.slice(3).join(' ') }); break; }
        jsonOut(await clay.updateField(args[1], args[2], { name: args.slice(3).join(' ') }));
        break;
      }

      case 'create-view': {
        if (!args[1] || !args[2]) errOut('Usage: create-view <tableId> <name>');
        if (dryRun) { jsonOut({ dryRun: true, action: 'create-view', tableId: args[1], name: args.slice(2).join(' ') }); break; }
        jsonOut(await clay.createView(args[1], args.slice(2).join(' ')));
        break;
      }

      case 'view-details': {
        if (!args[1] || !args[2]) errOut('Usage: view-details <tableId> <viewId>');
        jsonOut(await clay.getViewDetails(args[1], args[2]));
        break;
      }

      case 'delete-view': {
        if (!args[1] || !args[2]) errOut('Usage: delete-view <tableId> <viewId>');
        if (dryRun) { jsonOut({ dryRun: true, action: 'delete-view', tableId: args[1], viewId: args[2] }); break; }
        jsonOut(await clay.deleteView(args[1], args[2]));
        break;
      }

      case 'sources': {
        if (!args[1]) errOut('Usage: sources <tableId>');
        jsonOut(await clay.getSources(args[1]));
        break;
      }

      case 'add-webhook': {
        if (!args[1] || !args[2]) errOut('Usage: add-webhook <tableId> <wsId> [name]');
        if (dryRun) { jsonOut({ dryRun: true, action: 'add-webhook', tableId: args[1], wsId: args[2], name: args[3] || 'Webhook' }); break; }
        jsonOut(await clay.addWebhook(args[1], args[2], args[3] || 'Webhook'));
        break;
      }

      case 'delete-source': {
        if (!args[1]) errOut('Usage: delete-source <sourceId>');
        if (dryRun) { jsonOut({ dryRun: true, action: 'delete-source', sourceId: args[1] }); break; }
        jsonOut(await clay.deleteSource(args[1]));
        break;
      }

      case 'credits': {
        if (!args[1]) errOut('Usage: credits <wsId> [startTime] [endTime]');
        jsonOut(await clay.getCredits(args[1], args[2], args[3]));
        break;
      }

      case 'credits-by-integration': {
        if (!args[1]) errOut('Usage: credits-by-integration <wsId> [startTime] [endTime]');
        jsonOut(await clay.getCreditsByIntegration(args[1], args[2], args[3]));
        break;
      }

      case 'integrations': {
        if (!args[1]) errOut('Usage: integrations <wsId>');
        jsonOut(await clay.getIntegrations(args[1]));
        break;
      }

      case 'permissions': {
        if (!args[1]) errOut('Usage: permissions <wsId>');
        jsonOut(await clay.getPermissions(args[1]));
        break;
      }

      case 'create-table': {
        if (!args[1] || !args[2] || !args[3]) errOut('Usage: create-table <wsId> <workbookId> <name> [type]\n  type: company (default), people, spreadsheet, jobs');
        const tableType = args[4] || 'company';
        if (dryRun) { jsonOut({ dryRun: true, action: 'create-table', wsId: args[1], workbookId: args[2], name: args[3], type: tableType }); break; }
        jsonOut(await clay.createTable(args[1], args[2], args[3], tableType));
        break;
      }

      case 'create-folder': {
        if (!args[1] || !args[2]) errOut('Usage: create-folder <wsId> <name>');
        if (dryRun) { jsonOut({ dryRun: true, action: 'create-folder', wsId: args[1], name: args.slice(2).join(' ') }); break; }
        jsonOut(await clay.createFolder(args[1], args.slice(2).join(' ')));
        break;
      }

      case 'create-workbook': {
        if (!args[1] || !args[2]) errOut('Usage: create-workbook <wsId> <name> [--folder=<folderId>]');
        let parentFolderId = null;
        const nameArgs = [];
        for (const a of args.slice(2)) {
          if (a.startsWith('--folder=')) parentFolderId = a.slice(9);
          else nameArgs.push(a);
        }
        const wbName = nameArgs.join(' ');
        if (dryRun) { jsonOut({ dryRun: true, action: 'create-workbook', wsId: args[1], name: wbName, parentFolderId }); break; }
        jsonOut(await clay.createWorkbook(args[1], wbName, parentFolderId));
        break;
      }

      case 'delete-workbook': {
        if (!args[1]) errOut('Usage: delete-workbook <workbookId>');
        if (dryRun) { jsonOut({ dryRun: true, action: 'delete-workbook', workbookId: args[1] }); break; }
        jsonOut(await clay.deleteWorkbook(args[1]));
        break;
      }

      case 'delete-resources': {
        if (!args[1]) errOut('Usage: delete-resources <wsId> --workbooks=id1,id2 [--tables=id1] [--folders=id1] [--permanent]');
        const opts = { workbookIds: [], tableIds: [], folderIds: [], isPermanentDelete: false };
        for (const a of args.slice(2)) {
          if (a.startsWith('--workbooks=')) opts.workbookIds = a.slice(12).split(',');
          else if (a.startsWith('--tables=')) opts.tableIds = a.slice(9).split(',');
          else if (a.startsWith('--folders=')) opts.folderIds = a.slice(10).split(',');
          else if (a === '--permanent') opts.isPermanentDelete = true;
        }
        if (dryRun) { jsonOut({ dryRun: true, action: 'delete-resources', wsId: args[1], ...opts }); break; }
        jsonOut(await clay.deleteResources(args[1], opts));
        break;
      }

      default:
        errOut(`Unknown command: ${command}. Run with "help" to see available commands.`);
    }
  } catch (err) {
    errOut(err.message);
  }
}

// Export for use as module
module.exports = { ClayAPI };

// CLI entry point
if (require.main === module) {
  main();
}
