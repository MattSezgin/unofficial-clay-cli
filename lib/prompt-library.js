#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { parseArgs, readStructured, writeStructured } = require('./plan-playbook');

const ROOT = path.join(__dirname, '..');
const PROMPT_DIR = path.join(ROOT, 'prompts');

function listPromptFiles() {
  if (!fs.existsSync(PROMPT_DIR)) return [];
  return fs.readdirSync(PROMPT_DIR)
    .filter(file => file.endsWith('.yaml') || file.endsWith('.json'))
    .sort()
    .map(file => path.join(PROMPT_DIR, file));
}

function loadPrompt(file) {
  return readStructured(file);
}

function loadPrompts() {
  return listPromptFiles().map(file => ({ file: path.relative(ROOT, file), prompt: loadPrompt(file) }));
}

function findPrompt(selector, prompts = loadPrompts()) {
  if (!selector) return null;
  return prompts.find(({ file, prompt }) => (
    prompt.id === selector
    || prompt.playbookId === selector
    || path.basename(file, path.extname(file)) === selector
  )) || null;
}

function promptSummary(entry) {
  const prompt = entry.prompt;
  return {
    id: prompt.id,
    playbookId: prompt.playbookId,
    name: prompt.name,
    mode: prompt.mode,
    file: entry.file,
    requiredInputs: prompt.inputFields?.required || [],
    optionalInputs: prompt.inputFields?.optional || [],
    outputFields: Object.keys(prompt.outputSchema || {}),
    guardrailCount: (prompt.guardrails || []).length,
    qaCheckCount: (prompt.qaChecks || []).length,
  };
}

function buildPromptPacket(selector, opts = {}) {
  const prompts = loadPrompts();
  const entry = findPrompt(selector, prompts);
  if (!entry) {
    throw new Error(`Prompt not found for "${selector}". Available: ${prompts.map(item => item.prompt.id).join(', ') || 'none'}`);
  }
  const prompt = entry.prompt;
  return {
    artifactVersion: 1,
    mode: 'offline-prompt-contract',
    generatedAt: new Date().toISOString(),
    prompt: promptSummary(entry),
    systemPrompt: prompt.systemPrompt,
    taskPrompt: prompt.taskPrompt,
    guardrails: prompt.guardrails || [],
    outputSchema: prompt.outputSchema || {},
    qaChecks: prompt.qaChecks || [],
    runtimeNotes: [
      'Map inputFields to Clay columns at runtime.',
      'Do not commit row values, client-specific prompt text, webhook URLs, app account IDs, or session material.',
      'Run only sample rows first, then read back and quality-check before scale.',
    ],
    valuePolicy: prompt.valuePolicy || 'Runtime values omitted from committed artifacts.',
    valuesIncluded: false,
  };
}

function buildPromptIndex() {
  const prompts = loadPrompts();
  return {
    artifactVersion: 1,
    mode: 'offline-prompt-library-index',
    generatedAt: new Date().toISOString(),
    count: prompts.length,
    prompts: prompts.map(promptSummary),
    valuePolicy: 'Index contains prompt metadata only; no row values or private IDs.',
  };
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log('Usage: node lib/prompt-library.js [--list] [--playbook PLAYBOOK_ID] [--out file] [--json]');
    return;
  }

  const artifact = flags.playbook || flags.prompt
    ? buildPromptPacket(flags.playbook || flags.prompt)
    : buildPromptIndex();

  if (flags.out) {
    console.log(JSON.stringify(writeStructured(artifact, path.resolve(flags.out)), null, 2));
    return;
  }
  if (flags.json) process.stdout.write(JSON.stringify(artifact, null, 2) + '\n');
  else process.stdout.write(YAML.stringify(artifact));
}

if (require.main === module) main();

module.exports = {
  buildPromptIndex,
  buildPromptPacket,
  findPrompt,
  listPromptFiles,
  loadPrompts,
  promptSummary,
};
