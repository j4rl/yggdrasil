import { makeNode, newDoc, uid, autoLayout } from './model.js';

const SHAPES = [
  ['([', '])', 'stadium'],
  ['[[', ']]', 'process'],
  ['[/', '/]', 'io'],
  ['((', '))', 'process'],
  ['[', ']', 'process'],
  ['{', '}', 'decision'],
  ['(', ')', 'process'],
];

const q = (t) => `"${t.replace(/"/g, '#quot;').replace(/\n/g, '<br/>')}"`;
const unq = (t) => t.trim().replace(/^"(.*)"$/s, '$1').replace(/#quot;/g, '"').replace(/<br\s*\/?>/gi, '\n');

export function toMermaid(doc) {
  const ids = new Map(doc.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const lines = ['flowchart TD'];
  for (const n of doc.nodes) {
    const id = ids.get(n.id);
    const t = q(n.text);
    const shape = { start: `([${t}])`, end: `([${t}])`, decision: `{${t}}`, io: `[/${t}/]` }[n.kind] ?? `[${t}]`;
    lines.push(`  ${id}${shape}`);
  }
  for (const e of doc.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    lines.push(`  ${ids.get(e.from)} -->${e.label ? `|${q(e.label)}|` : ''} ${ids.get(e.to)}`);
  }
  return lines.join('\n');
}

function parseNode(s, pos) {
  const m = /^\s*(\w+)/.exec(s.slice(pos));
  if (!m) throw new Error(`Förväntade nod vid "${s.slice(pos, pos + 15)}"`);
  let p = pos + m[0].length;
  const rest = s.slice(p);
  for (const [open, close, kind] of SHAPES) {
    if (!rest.startsWith(open)) continue;
    const end = rest.indexOf(close, open.length);
    if (end < 0) throw new Error(`Saknar ${close}`);
    return { id: m[1], kind, text: unq(rest.slice(open.length, end)), pos: p + end + close.length };
  }
  return { id: m[1], pos: p };
}

export function fromMermaid(src, type) {
  const doc = newDoc(type);
  const map = new Map();
  const getNode = (r) => {
    let n = map.get(r.id);
    if (!n) {
      n = makeNode('process', 0, 0, r.text ?? r.id);
      n.shape = r.kind;
      map.set(r.id, n);
      doc.nodes.push(n);
    } else if (r.text !== undefined) { n.text = r.text; n.shape = r.kind; }
    return n;
  };
  const lines = src.split('\n').map((l) => l.replace(/%%.*$/, '').trim()).filter(Boolean);
  if (!/^(flowchart|graph)\b/i.test(lines[0] || '')) throw new Error('Förväntade "flowchart TD" på första raden');
  for (const line of lines.slice(1)) {
    for (const stmt of line.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.trim()).filter(Boolean)) {
      let r = parseNode(stmt, 0);
      let prev = getNode(r);
      let pos = r.pos;
      while (pos < stmt.length) {
        const rest = stmt.slice(pos);
        const a = /^\s*(?:-->|==>|---|-\.->)(?:\|([^|]*)\|)?/.exec(rest) || /^\s*--\s*([^->]+?)\s*-->/.exec(rest);
        if (!a) { if (!rest.trim()) break; throw new Error(`Okänd syntax: "${rest.trim().slice(0, 20)}"`); }
        r = parseNode(stmt, pos + a[0].length);
        const next = getNode(r);
        doc.edges.push({ id: uid('e'), from: prev.id, to: next.id, label: a[1] ? unq(a[1]) : '' });
        prev = next;
        pos = r.pos;
      }
    }
  }
  const hasIn = new Set(doc.edges.map((e) => e.to));
  for (const n of doc.nodes) {
    if (type === 'org') n.kind = 'box';
    else if (n.shape === 'stadium') n.kind = hasIn.has(n.id) ? 'end' : 'start';
    else if (n.shape) n.kind = n.shape;
    delete n.shape;
    const k = { start: [120, 50], end: [120, 50], decision: [170, 90], io: [160, 56], box: [160, 60] }[n.kind];
    if (k) [n.w, n.h] = k;
  }
  autoLayout(doc);
  return doc;
}
