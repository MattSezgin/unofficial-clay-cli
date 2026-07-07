#!/usr/bin/env node
/**
 * validate-community.js - validates every community contribution against its schema.
 * Dependency-free on purpose: a security gate should not have a supply chain.
 *
 * Checks:
 *   - every community/templates/<slug>/template.yaml validates against template.schema.json
 *   - slug folder name === template id
 *   - every community/contributors/<handle>/profile.yaml validates against profile.schema.json
 *   - handle folder name === profile github field
 *   - template author is 'anonymous' or has a profile folder
 *   - action steps reference real action keys from integration-library/registry.yaml
 *
 * Exit 0 = all valid. Exit 1 = problems printed with fix hints.
 */
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATES_DIR = path.join(ROOT, 'community', 'templates');
const CONTRIBUTORS_DIR = path.join(ROOT, 'community', 'contributors');

// --- minimal JSON Schema subset validator (type/required/properties/additionalProperties/
// patternProperties/items/enum/pattern/min-max/length/properties counts) ---
function validate(value, schema, at, errors) {
  if (schema.type) {
    const t = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const want = schema.type === 'integer' ? 'number' : schema.type;
    if (t !== want) { errors.push(`${at}: expected ${schema.type}, got ${t}`); return; }
    if (schema.type === 'integer' && !Number.isInteger(value)) { errors.push(`${at}: expected integer`); return; }
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: too short (min ${schema.minLength})`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: too long (max ${schema.maxLength})`);
    if (schema.pattern && !(new RegExp(schema.pattern, 'u')).test(value)) errors.push(`${at}: does not match required format (${schema.pattern})`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: max ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => validate(item, schema.items, `${at}[${i}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) errors.push(`${at}: max ${schema.maxProperties} keys`);
    for (const req of schema.required || []) {
      if (!(req in value)) errors.push(`${at}: missing required field '${req}'`);
    }
    for (const key of keys) {
      const propSchema = (schema.properties || {})[key];
      if (propSchema) { validate(value[key], propSchema, `${at}.${key}`, errors); continue; }
      let matched = false;
      for (const [pattern, patternSchema] of Object.entries(schema.patternProperties || {})) {
        if (new RegExp(pattern, 'u').test(key)) { validate(value[key], patternSchema, `${at}.${key}`, errors); matched = true; break; }
      }
      if (!matched && schema.additionalProperties === false) {
        errors.push(`${at}: unknown field '${key}' - only schema-listed fields are allowed (this is how we keep secrets structurally impossible)`);
      }
    }
  }
}

function loadYaml(file) { return YAML.parse(fs.readFileSync(file, 'utf8')); }
function listDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('_')).map(e => e.name);
}

function main() {
  const problems = [];
  const templateSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'community', 'schemas', 'template.schema.json'), 'utf8'));
  const profileSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'community', 'schemas', 'profile.schema.json'), 'utf8'));

  let registryKeys = new Set();
  const registryFile = path.join(ROOT, 'integration-library', 'registry.yaml');
  if (fs.existsSync(registryFile)) registryKeys = new Set(Object.keys(loadYaml(registryFile).integrations || {}));

  const handles = new Set(listDirs(CONTRIBUTORS_DIR));
  for (const handle of handles) {
    const profileFile = path.join(CONTRIBUTORS_DIR, handle, 'profile.yaml');
    if (!fs.existsSync(profileFile)) { problems.push(`contributors/${handle}: missing profile.yaml`); continue; }
    let profile;
    try { profile = loadYaml(profileFile); } catch (e) { problems.push(`contributors/${handle}/profile.yaml: invalid YAML - ${e.message}`); continue; }
    const errors = [];
    validate(profile, profileSchema, 'profile', errors);
    if (profile && profile.github && profile.github.toLowerCase() !== handle.toLowerCase()) {
      errors.push(`profile.github ('${profile.github}') must match the folder name ('${handle}')`);
    }
    problems.push(...errors.map(e => `contributors/${handle}: ${e}`));
  }

  for (const slug of listDirs(TEMPLATES_DIR)) {
    const templateFile = path.join(TEMPLATES_DIR, slug, 'template.yaml');
    if (!fs.existsSync(templateFile)) { problems.push(`templates/${slug}: missing template.yaml`); continue; }
    let template;
    try { template = loadYaml(templateFile); } catch (e) { problems.push(`templates/${slug}/template.yaml: invalid YAML - ${e.message}`); continue; }
    const errors = [];
    validate(template, templateSchema, 'template', errors);
    if (template && template.id && template.id !== slug) errors.push(`template.id ('${template.id}') must match the folder name ('${slug}')`);
    if (template && template.author && template.author !== 'anonymous' && !handles.has(template.author)) {
      errors.push(`author '${template.author}' has no community/contributors/${template.author}/profile.yaml - add one (the share wizard offers this) or use 'anonymous'`);
    }
    for (const [i, step] of (Array.isArray(template && template.steps) ? template.steps : []).entries()) {
      if (step && step.kind === 'action' && step.action_key && registryKeys.size && !registryKeys.has(step.action_key)) {
        errors.push(`steps[${i}].action_key '${step.action_key}' is not in integration-library/registry.yaml - check the key or add kind: http-placeholder`);
      }
      if (step && step.kind === 'action' && !step.action_key) errors.push(`steps[${i}]: kind 'action' requires action_key`);
    }
    problems.push(...errors.map(e => `templates/${slug}: ${e}`));
  }

  if (problems.length) {
    console.error(`[FAIL] ${problems.length} community validation problem(s):\n`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[OK] community valid: ${listDirs(TEMPLATES_DIR).length} template(s), ${handles.size} contributor profile(s).`);
}

main();
