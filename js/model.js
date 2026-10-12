export const KINDS = {
  start: { w: 120, h: 50, label: 'Start', text: 'Start' },
  end: { w: 120, h: 50, label: 'Slut', text: 'Slut' },
  process: { w: 160, h: 56, label: 'Process', text: 'x = 0' },
  decision: { w: 170, h: 90, label: 'Villkor', text: 'x < 10' },
  io: { w: 160, h: 56, label: 'In/Ut', text: 'print x' },
  box: { w: 160, h: 60, label: 'Enhet', text: 'Enhet' },
};

export const PALETTES = {
  flowchart: ['start', 'process', 'decision', 'io', 'end'],
  algorithm: ['start', 'process', 'decision', 'io', 'end'],
  org: ['box'],
};

export const YES = ['ja', 'yes', 'true', 'sant', 'j', 'y'];
export const NO = ['nej', 'no', 'false', 'falskt', 'n'];

let counter = 0;
export const uid = (p) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function newDoc(type) {
  return { type, nodes: [], edges: [] };
}

export function makeNode(kind, x, y, text) {
  const k = KINDS[kind];
  return { id: uid('n'), kind, x, y, w: k.w, h: k.h, text: text ?? k.text };
}

export function sampleDoc(type) {
  const doc = newDoc(type);
  const add = (kind, text) => { const n = makeNode(kind, 0, 0, text); doc.nodes.push(n); return n; };
  const link = (a, b, label = '') => doc.edges.push({ id: uid('e'), from: a.id, to: b.id, label });
  if (type === 'org') {
    const ceo = add('box', 'VD');
    const kids = ['Ekonomi', 'Utveckling', 'Försäljning'].map((t) => add('box', t));
    kids.forEach((k) => link(ceo, k));
    ['Backend', 'Frontend'].forEach((t) => link(kids[1], add('box', t)));
  } else {
    const s = add('start', 'Start');
    const inp = add('io', 'input n');
    const init = add('process', 'sum = 0; i = 1');
    const cond = add('decision', 'i <= n');
    const body = add('process', 'sum = sum + i; i = i + 1');
    const out = add('io', 'print sum');
    const e = add('end', 'Slut');
    link(s, inp); link(inp, init); link(init, cond);
    link(cond, body, 'Ja'); link(body, cond); link(cond, out, 'Nej'); link(out, e);
  }
  autoLayout(doc);
  return doc;
}

// Skiktad layout uppifrån och ned (BFS), används för organisationsträd och importerade diagram.
export function autoLayout(doc, gapX = 220, gapY = 130) {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const out = new Map(doc.nodes.map((n) => [n.id, []]));
  const hasIn = new Set();
  for (const e of doc.edges) {
    if (out.has(e.from) && byId.has(e.to)) { out.get(e.from).push(e.to); hasIn.add(e.to); }
  }
  const roots = doc.nodes.filter((n) => !hasIn.has(n.id));
  if (!roots.length && doc.nodes.length) roots.push(doc.nodes[0]);
  const depth = new Map();
  const order = [];
  const queue = [];
  const visit = (id, d) => { depth.set(id, d); order.push(id); queue.push(id); };
  for (const r of roots) if (!depth.has(r.id)) {
    visit(r.id, 0);
    while (queue.length) {
      const id = queue.shift();
      for (const t of out.get(id)) if (!depth.has(t)) visit(t, depth.get(id) + 1);
    }
  }
  for (const n of doc.nodes) if (!depth.has(n.id)) { depth.set(n.id, 0); order.push(n.id); }
  const rows = [];
  for (const id of order) (rows[depth.get(id)] ??= []).push(id);
  const widest = Math.max(1, ...rows.map((r) => r?.length ?? 0));
  const cx = 60 + (widest * gapX) / 2;
  rows.forEach((row, d) => {
    if (!row) return;
    row.forEach((id, i) => {
      const n = byId.get(id);
      n.x = cx + (i - (row.length - 1) / 2) * gapX;
      n.y = 70 + d * gapY;
    });
  });
}
