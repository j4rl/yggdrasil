export const KINDS = {
  start: { w: 120, h: 50, label: 'Start', text: 'Start' },
  end: { w: 120, h: 50, label: 'Slut', text: 'Slut' },
  process: { w: 160, h: 56, label: 'Process', text: 'x = 0' },
  decision: { w: 170, h: 90, label: 'Villkor', text: 'x < 10' },
  io: { w: 160, h: 56, label: 'In/Ut', text: 'print x' },
  topic: { w: 170, h: 70, label: 'Ämne', text: 'Nytt ämne' },
  concept: { w: 160, h: 60, label: 'Begrepp', text: 'Nytt begrepp' },
  state: { w: 160, h: 60, label: 'Tillstånd', text: 'Nytt tillstånd' },
  table: { w: 260, h: 180, label: 'Tabell', text: 'ny_tabell' },
  class: { w: 220, h: 150, label: 'Klass', text: 'NyKlass' },
  box: { w: 160, h: 60, label: 'Enhet', text: 'Enhet' },
};

export const PALETTES = {
  flowchart: ['start', 'process', 'decision', 'io', 'end'],
  algorithm: ['start', 'process', 'decision', 'io', 'end'],
  org: ['box'],
  uml: ['class'],
  database: ['table'],
  mindmap: ['topic'],
  concept: ['concept'],
  state: ['start', 'state', 'decision', 'end'],
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
  return { id: uid('n'), kind, x, y, w: k.w, h: k.h, text: text ?? k.text, ...(kind === 'table' ? { columns: 'id INTEGER PK' } : {}) };
}

export function sampleDoc(type) {
  const doc = newDoc(type);
  const add = (kind, text) => { const n = makeNode(kind, 0, 0, text); doc.nodes.push(n); return n; };
  const link = (a, b, label = '') => doc.edges.push({ id: uid('e'), from: a.id, to: b.id, label });
  if (type === 'database') {
    const customers = add('table', 'customers');
    customers.columns = 'id INTEGER PK\nname VARCHAR(100) NOT NULL\nemail VARCHAR(255) UNIQUE';
    const orders = add('table', 'orders');
    orders.columns = 'id INTEGER PK\ncustomer_id INTEGER NOT NULL\ntotal DECIMAL(10,2) NOT NULL DEFAULT 0';
    link(orders, customers);
    Object.assign(doc.edges[0], { fromColumn: 'customer_id', toColumn: 'id', onDelete: 'RESTRICT' });
  } else if (type === 'uml') {
    const person = add('class', 'Person');
    person.attributes = 'name: str\nage: int';
    person.methods = 'greet(): str';
    const student = add('class', 'Student');
    student.attributes = 'school: str';
    student.methods = 'study(subject: str): void';
    link(student, person, 'ärver');
    doc.edges[0].relation = 'inheritance';
  } else if (type === 'org') {
    const ceo = add('box', 'VD');
    const kids = ['Ekonomi', 'Utveckling', 'Försäljning'].map((t) => add('box', t));
    kids.forEach((k) => link(ceo, k));
    ['Backend', 'Frontend'].forEach((t) => link(kids[1], add('box', t)));
  } else if (type === 'mindmap' || type === 'concept') {
    const kind = type === 'mindmap' ? 'topic' : 'concept';
    const root = add(kind, type === 'mindmap' ? 'Projektidé' : 'Ekosystem');
    const labels = type === 'mindmap' ? ['Mål', 'Resurser', 'Aktiviteter'] : ['Växter', 'Djur', 'Miljö'];
    labels.forEach((text) => link(root, add(kind, text), type === 'concept' ? 'omfattar' : ''));
  } else if (type === 'state') {
    const start = add('start', 'Start');
    const idle = add('state', 'Väntar');
    const active = add('state', 'Aktiv');
    const end = add('end', 'Avslutad');
    link(start, idle); link(idle, active, 'Starta'); link(active, idle, 'Pausa'); link(active, end, 'Avsluta');
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
  if (doc.type === 'database') { gapX = Math.max(gapX, ...doc.nodes.map(n => n.w + 60)); gapY = Math.max(gapY, ...doc.nodes.map(n => n.h + 70)); }
  if (doc.type === 'mindmap') return layoutMindmap(doc);
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

function layoutMindmap(doc) {
  const incoming = new Set(doc.edges.map(e => e.to));
  const visited = new Set();
  const roots = [...doc.nodes.filter(n => !incoming.has(n.id)), ...doc.nodes];
  let component = 0;
  for (const root of roots) {
    if (visited.has(root.id)) continue;
    const cx = 650 + component++ * 1100, cy = 600;
    root.x = cx; root.y = cy; visited.add(root.id);
    const queue = [{ node: root, angle: 0, spread: Math.PI * 2, depth: 0 }];
    while (queue.length) {
      const {node, angle, spread, depth} = queue.shift();
      const children = doc.edges.filter(e => e.from === node.id).map(e => doc.nodes.find(n => n.id === e.to)).filter(n => n && !visited.has(n.id));
      children.forEach((child, i) => {
        if (visited.has(child.id)) return;
        visited.add(child.id);
        const a = depth === 0 ? i * Math.PI * 2 / children.length : angle + ((i + .5) / children.length - .5) * spread;
        child.x = Math.round(node.x + Math.cos(a) * 280);
        child.y = Math.round(node.y + Math.sin(a) * 180);
        queue.push({ node: child, angle: a, spread: Math.min(Math.PI, spread / Math.max(1, children.length)), depth: depth + 1 });
      });
    }
  }
}
