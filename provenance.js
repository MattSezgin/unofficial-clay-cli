const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function toolVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return `${pkg.name || 'clay-cli'}@${pkg.version || 'unknown'}`;
  } catch {
    return 'clay-cli@unknown';
  }
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function resolveToolPath(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.join(ROOT, file);
}

function sha256File(file) {
  const full = resolveToolPath(file);
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
}

function fileRef(file) {
  const full = resolveToolPath(file);
  if (!full) return null;
  return {
    path: path.relative(ROOT, full),
    sha256: sha256File(full),
  };
}

function bundleHash(items = []) {
  return sha256Text(JSON.stringify(items.map(item => ({
    path: item.path || null,
    sha256: item.sha256 || null,
    commandId: item.commandId || null,
    exactCommand: item.exactCommand || item.command || null,
  }))));
}

function buildCommandProvenance(opts = {}) {
  const sourceArtifacts = (opts.sourceFiles || []).map(fileRef).filter(Boolean);
  return {
    kind: 'clay-command',
    capturedAt: opts.capturedAt || new Date().toISOString(),
    commandId: opts.commandId || null,
    exactCommand: opts.exactCommand || null,
    exitCode: Number(opts.exitCode ?? 0),
    stdoutPath: opts.stdoutPath || null,
    stderrPath: opts.stderrPath || null,
    toolVersion: opts.toolVersion || toolVersion(),
    workspaceId: opts.workspaceId || null,
    folderId: opts.folderId || null,
    workbookId: opts.workbookId || null,
    tableId: opts.tableId || null,
    viewId: opts.viewId || null,
    sourceArtifacts,
    sourceArtifactSha256: opts.sourceArtifactSha256 || bundleHash(sourceArtifacts),
  };
}

function buildEvidenceBundleProvenance(opts = {}) {
  const sourceArtifacts = (opts.sourceFiles || []).map(fileRef).filter(Boolean);
  const sourceCommands = (opts.sourceCommands || []).map(command => ({
    commandId: command.commandId || command.id || null,
    exactCommand: command.exactCommand || command.command || null,
    exitCode: command.exitCode == null ? null : Number(command.exitCode),
    provenanceKind: command.provenanceKind || command.kind || null,
  }));
  return {
    kind: 'clay-evidence-bundle',
    capturedAt: opts.capturedAt || new Date().toISOString(),
    toolVersion: opts.toolVersion || toolVersion(),
    workspaceId: opts.workspaceId || null,
    folderId: opts.folderId || null,
    workbookId: opts.workbookId || null,
    tableId: opts.tableId || null,
    viewId: opts.viewId || null,
    sourceArtifacts,
    sourceCommands,
    sourceArtifactSha256: opts.sourceArtifactSha256 || bundleHash([...sourceArtifacts, ...sourceCommands]),
  };
}

function hasClayCommandProvenance(artifact, commandRe) {
  const provenance = artifact?.provenance || {};
  return provenance.kind === 'clay-command'
    && typeof provenance.capturedAt === 'string'
    && typeof provenance.exactCommand === 'string'
    && commandRe.test(provenance.exactCommand)
    && Number(provenance.exitCode) === 0
    && typeof provenance.toolVersion === 'string';
}

function hasEvidenceBundleProvenance(artifact) {
  const provenance = artifact?.provenance || {};
  const sourceCommands = Array.isArray(provenance.sourceCommands) ? provenance.sourceCommands : [];
  return provenance.kind === 'clay-evidence-bundle'
    && typeof provenance.capturedAt === 'string'
    && /^[a-f0-9]{64}$/.test(provenance.sourceArtifactSha256 || '')
    && sourceCommands.some(command => (
      command.provenanceKind === 'clay-command'
      && typeof command.exactCommand === 'string'
      && Number(command.exitCode) === 0
    ));
}

module.exports = {
  buildCommandProvenance,
  buildEvidenceBundleProvenance,
  bundleHash,
  fileRef,
  hasClayCommandProvenance,
  hasEvidenceBundleProvenance,
  sha256File,
  sha256Text,
  toolVersion,
};
