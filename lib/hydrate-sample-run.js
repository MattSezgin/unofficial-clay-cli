#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

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

function readStructured(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (/\.ya?ml$/i.test(file)) return YAML.parse(text);
  return JSON.parse(text);
}

function writeStructured(data, file) {
  const text = /\.json$/i.test(file) ? JSON.stringify(data, null, 2) + '\n' : YAML.stringify(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return { wrote: file, bytes: Buffer.byteLength(text) };
}

function extractApplyIds(applyResult = {}) {
  const tableId = applyResult.tableId
    || (applyResult.operations || []).find(op => op.op === 'create_table')?.id
    || null;
  const viewId = applyResult.viewId
    || (applyResult.operations || []).find(op => op.op === 'create_view')?.id
    || null;
  return { tableId, viewId };
}

function hydrateCommand(command, replacements) {
  if (!command || typeof command !== 'object') return command;
  let nextCommand = String(command.command || '');
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (value) nextCommand = nextCommand.replaceAll(`<${placeholder}>`, value);
  }
  return {
    ...command,
    command: nextCommand,
  };
}

function hydratePrompt(prompt, replacements) {
  if (!prompt || typeof prompt !== 'object') return prompt;
  let command = String(prompt.command || '');
  let text = String(prompt.prompt || '');
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (!value) continue;
    command = command.replaceAll(`<${placeholder}>`, value);
    text = text.replaceAll(`<${placeholder}>`, value);
  }
  return {
    ...prompt,
    command,
    prompt: text,
  };
}

function hydratePacket(packet, flags = {}) {
  if (packet.mode !== 'offline-sample-run-packet') {
    throw new Error('hydrate requires an offline-sample-run-packet artifact');
  }

  const applyResult = flags['apply-result'] ? readStructured(flags['apply-result']) : {};
  const extracted = extractApplyIds(applyResult);
  const tableId = flags.table || extracted.tableId;
  const viewId = flags.view || extracted.viewId;
  if (!tableId) throw new Error('sample table id required via --table or --apply-result');
  if (!viewId) throw new Error('sample view id required via --view or --apply-result');

  const completedIds = new Set(String(flags.completed || 'apply_sample_spec').split(',').map(item => item.trim()).filter(Boolean));
  const replacements = {
    'sample-table': tableId,
    'sample-view': viewId,
  };

  const completedLiveCommands = (packet.liveCommands || [])
    .filter(command => completedIds.has(command.id))
    .map(command => hydrateCommand(command, replacements));
  const remainingLiveCommands = (packet.liveCommands || [])
    .filter(command => !completedIds.has(command.id))
    .map(command => hydrateCommand(command, replacements));

  return {
    ...packet,
    artifactVersion: 1,
    mode: 'offline-sample-run-packet',
    hydratedAt: new Date().toISOString(),
    hydration: {
      source: flags['apply-result'] || null,
      tableId,
      viewId,
      completedLiveCommandIds: [...completedIds],
      valuePolicy: 'Hydrated packets may include live table/view IDs. Write only to ignored runs/ artifacts.',
    },
    liveCommands: remainingLiveCommands,
    completedLiveCommands,
    readbackCommands: (packet.readbackCommands || []).map(command => hydrateCommand(command, replacements)),
    confirmationPrompts: (packet.confirmationPrompts || [])
      .filter(prompt => !completedIds.has(prompt.commandId))
      .map(prompt => hydratePrompt(prompt, replacements)),
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const file = flags._[0];
  if (!file || flags.help) {
    console.log('Usage: node lib/hydrate-sample-run.js <sample-run.json|yaml> [--apply-result apply.json] [--table TABLE_ID --view VIEW_ID] [--completed apply_sample_spec] [--out hydrated.json]');
    return;
  }

  const packet = readStructured(file);
  const hydrated = hydratePacket(packet, flags);
  if (flags.out) {
    console.log(JSON.stringify(writeStructured(hydrated, flags.out), null, 2));
    return;
  }
  process.stdout.write(JSON.stringify(hydrated, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = {
  extractApplyIds,
  hydrateCommand,
  hydratePacket,
  hydratePrompt,
  parseArgs,
  readStructured,
  writeStructured,
};
