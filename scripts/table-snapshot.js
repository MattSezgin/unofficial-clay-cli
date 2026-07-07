#!/usr/bin/env node
/**
 * table-snapshot.js - render a Clay table's current state as a single clean
 * HTML page: schema overview, field types, and a small sample of rows.
 *
 *   node scripts/table-snapshot.js <tableId> [--view <viewId>] [--rows 5]
 *                                  [--redacted] [--out snapshot.html] [--open]
 *
 * Great for reviewing a build, sharing state with a teammate, or letting an
 * AI agent show you what it did. With --open it launches in Lavish
 * (npx lavish-axi) if available, else your default browser.
 *
 * PRIVACY: without --redacted the page contains YOUR row data - treat it like
 * the table itself (the file lands in git-ignored runs/). --redacted replaces
 * every cell value with a stable hash so structure reviews stay shareable.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ClayAPI } = require(path.join(__dirname, '..', 'clay-api.js'));

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[a.slice(2)] = argv[++i];
      else args[a.slice(2)] = true;
    } else args._.push(a);
  }
  return args;
}

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const redact = v => `#${crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 8)}`;

function cellText(value, redacted) {
  if (value == null || value === '') return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (redacted) return redact(s);
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}

function render({ table, fields, rows, redacted, tableId }) {
  const kindCounts = {};
  for (const f of fields) kindCounts[f.type || 'unknown'] = (kindCounts[f.type || 'unknown'] || 0) + 1;
  const kindBadges = Object.entries(kindCounts).map(([k, n]) => `<span class="badge">${esc(k)} × ${n}</span>`).join(' ');
  const headCells = fields.map(f => `<th>${esc(f.name)}<div class="ft">${esc(f.type || '')}</div></th>`).join('');
  const bodyRows = rows.map(r => `<tr>${fields.map(f => `<td>${esc(cellText(r[f.name] ?? r[f.id], redacted))}</td>`).join('')}</tr>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(table.name || 'Clay table')} - snapshot</title>
<style>
  body{font-family:-apple-system,Segoe UI,sans-serif;margin:0;background:#f6f7f9;color:#1b1e24;line-height:1.5}
  .wrap{max-width:1200px;margin:0 auto;padding:32px 20px}
  h1{font-size:22px;margin:0 0 4px} .sub{color:#69707c;font-size:13px;margin-bottom:16px}
  .badge{display:inline-block;background:#e8ecf2;border-radius:12px;padding:2px 10px;font-size:12px;margin:0 4px 4px 0}
  .warn{background:#fdf3e3;border-left:4px solid #b45309;border-radius:6px;padding:10px 14px;font-size:13px;margin:14px 0}
  .tablebox{overflow-x:auto;background:#fff;border:1px solid #e2e5ea;border-radius:10px;margin-top:16px}
  table{border-collapse:collapse;font-size:12.5px;min-width:100%}
  th{white-space:nowrap;text-align:left;padding:8px 10px;border-bottom:2px solid #e2e5ea;background:#fafbfc;font-size:12px}
  th .ft{font-weight:400;color:#8a93a1;font-size:10.5px}
  td{padding:7px 10px;border-bottom:1px solid #eef0f3;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style></head><body><div class="wrap">
<h1>${esc(table.name || 'Clay table')}</h1>
<div class="sub">table <code>${esc(tableId)}</code> · ${fields.length} fields · showing ${rows.length} row(s) · generated ${new Date().toISOString()}</div>
<div>${kindBadges}</div>
${redacted
    ? '<div class="warn">Redacted snapshot - every value is a stable hash. Structure is reviewable, data is not recoverable.</div>'
    : '<div class="warn">This page contains real row data from your table. Keep it local (it lives in git-ignored runs/) - use --redacted for a shareable version.</div>'}
<div class="tablebox"><table><thead><tr>${headCells}</tr></thead><tbody>
${bodyRows}
</tbody></table></div>
</div></body></html>`;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const tableId = flags._[0];
  if (!tableId) {
    console.error('usage: node scripts/table-snapshot.js <tableId> [--view <viewId>] [--rows 5] [--redacted] [--out file.html] [--open]');
    process.exit(1);
  }
  const limit = Math.min(parseInt(flags.rows || '5', 10) || 5, 10);
  const redacted = !!flags.redacted;

  const clay = new ClayAPI();
  const info = await clay.getTableInfo(tableId);
  const table = info.table || info;
  const fields = (table.fields || info.fields || []).slice(0, 60);
  if (!fields.length) throw new Error('no fields returned - check the table id and your session');

  const viewId = flags.view || (table.views && table.views[0] && (table.views[0].id || table.views[0].viewId));
  let rows = [];
  if (viewId) {
    const rowData = await clay.getRows(tableId, viewId, limit, 0);
    const records = rowData.records || rowData.rows || rowData.data || [];
    rows = records.slice(0, limit).map(r => r.cells || r.values || r);
  } else {
    console.error('[warn] no view found - rendering schema only');
  }

  const html = render({ table, fields, rows, redacted, tableId });
  const outFile = path.resolve(flags.out || path.join(__dirname, '..', 'runs', 'snapshots', `${tableId}-${redacted ? 'redacted' : 'local'}.html`));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html);
  console.log(`[OK] snapshot written: ${outFile}`);

  if (flags.open) {
    const lavish = spawnSync('npx', ['-y', 'lavish-axi', outFile], { stdio: 'inherit', timeout: 30000 });
    if (lavish.status !== 0) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      spawnSync(opener, [outFile], { stdio: 'ignore', shell: process.platform === 'win32' });
      console.log('[info] opened in your browser (install lavish-axi for the annotate-and-review flow)');
    }
  }
}

main().catch(err => { console.error(`[FAIL] ${err.message}`); process.exit(1); });
