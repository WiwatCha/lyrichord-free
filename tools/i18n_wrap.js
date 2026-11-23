// Build step: wrap every Thai UI string in the app script with T(...) so the UI can switch Thai <-> English.
// Source files stay plain Thai. Usage: node tools/i18n_wrap.js keys.json < script.js > wrapped.js
const fs = require('fs');
const acorn = require('./vendor/acorn.js'), walk = require('./vendor/walk.js');
const src = fs.readFileSync(0, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
const TH = /[฀-๿]/;
// a run starts and ends with Thai (or a closing bracket) and may contain spaces, digits, Latin words and punctuation in between
const RUN = /[฀-๿](?:[฀-๿\s,.:;!?()"'“”\-–—\/·…%+*0-9A-Za-z#]*[฀-๿)])?/g;
// constants translated where they are used (T(KIND[x]) etc.), and demo lyrics that must stay Thai
const SKIPVARS = new Set(['SOL', 'LV_NAME', 'LV_HINT', 'QLABEL', 'KIND', 'L', 'TOUR', 'CREDITS']);
const edits = [], keys = new Set();
function skip(anc) {
  const node = anc[anc.length - 1], parent = anc[anc.length - 2];
  if (parent && parent.type === 'Property' && parent.key === node && !parent.computed) return true;
  if (parent && parent.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)) return true;
  for (const a of anc) {
    if (a.type === 'VariableDeclarator' && a.id && SKIPVARS.has(a.id.name)) return true;
    if (a.type === 'CallExpression' && a.callee.type === 'Identifier' && a.callee.name === 'T') return true;
  }
  return false;
}
walk.fullAncestor(ast, (node, _st, anc) => {
  if (node.type === 'Literal' && typeof node.value === 'string' && !node.regex && TH.test(node.value)) {
    if (skip(anc)) return;
    const v = node.value, parts = []; let last = 0;
    for (const m of v.matchAll(RUN)) {
      if (m.index > last) parts.push(JSON.stringify(v.slice(last, m.index)));
      parts.push(`T(${JSON.stringify(m[0])})`); keys.add(m[0]); last = m.index + m[0].length;
    }
    if (last < v.length) parts.push(JSON.stringify(v.slice(last)));
    edits.push({ start: node.start, end: node.end, text: parts.length === 1 ? parts[0] : `(${parts.join(' + ')})` });
  } else if (node.type === 'TemplateElement' && TH.test(node.value.raw)) {
    if (skip(anc)) return;
    const text = node.value.raw.replace(RUN, m => { keys.add(m); return '${T(' + JSON.stringify(m) + ')}'; });
    edits.push({ start: node.start, end: node.end, text });
  }
});
edits.sort((a, b) => b.start - a.start);
let out = src;
for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
fs.writeFileSync(process.argv[2], JSON.stringify([...keys].sort(), null, 0));
process.stdout.write(out);
