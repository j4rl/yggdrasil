import { KINDS, PALETTES, newDoc, makeNode, sampleDoc, autoLayout, uid } from './model.js';
import { Simulator, validate } from './sim.js';
import { toMermaid, fromMermaid } from './mermaid.js';

const NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const svg = $('canvas');
const STORE = 'yggdrasil.doc';

let doc = load() ?? sampleDoc('algorithm');
let sel = null; // { type: 'node' | 'edge', id }
let connecting = false;
let connectFrom = null;
let sim = null;
let timer = null;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE)); } catch { return null; }
}
const save = () => localStorage.setItem(STORE, JSON.stringify(doc));
const byId = (id) => doc.nodes.find((n) => n.id === id);

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
}

function wrap(text, max) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      if (line && (line + ' ' + w).length > max) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
    }
    lines.push(line);
  }
  return lines;
}

function shapePoints(n) {
  const { x, y, w, h } = n;
  if (n.kind === 'decision') return `${x},${y - h / 2} ${x + w / 2},${y} ${x},${y + h / 2} ${x - w / 2},${y}`;
  const s = 14;
  return `${x - w / 2 + s},${y - h / 2} ${x + w / 2 + s},${y - h / 2} ${x + w / 2 - s},${y + h / 2} ${x - w / 2 - s},${y + h / 2}`;
}

// Skärningspunkt mellan linjen centrum->mot och nodens kant.
function clip(n, tx, ty) {
  const dx = tx - n.x, dy = ty - n.y;
  if (!dx && !dy) return { x: n.x, y: n.y };
  const hw = n.w / 2, hh = n.h / 2;
  const t = n.kind === 'decision' ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh) : Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: n.x + dx * t, y: n.y + dy * t };
}

function edgeGeometry(e) {
  const a = byId(e.from), b = byId(e.to);
  if (!a || !b) return null;
  if (b.y <= a.y && a !== b) {
    const sx = a.x + a.w / 2, ex = b.x + b.w / 2;
    const mx = Math.max(sx, ex) + 70;
    return { d: `M${sx},${a.y} C${mx},${a.y} ${mx},${b.y} ${ex},${b.y}`, lx: (sx + ex) / 2 * 0.25 + mx * 0.75, ly: (a.y + b.y) / 2 };
  }
  const p = clip(a, b.x, b.y), r = clip(b, a.x, a.y);
  return { d: `M${p.x},${p.y} L${r.x},${r.y}`, lx: (p.x + r.x) / 2, ly: (p.y + r.y) / 2 - 8 };
}

function render() {
  svg.replaceChildren();
  const defs = el('defs', {}, svg);
  const mk = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#333' }, mk);

  for (const e of doc.edges) {
    const g = edgeGeometry(e);
    if (!g) continue;
    const grp = el('g', { class: `edge${sel?.id === e.id ? ' selected' : ''}`, 'data-edge': e.id }, svg);
    el('path', { d: g.d, class: 'hit' }, grp);
    const line = el('path', { d: g.d, class: 'line' }, grp);
    if (doc.type !== 'org') line.setAttribute('marker-end', 'url(#arrow)');
    if (e.label) el('text', { x: g.lx, y: g.ly }, grp).textContent = e.label;
  }

  for (const n of doc.nodes) {
    const cls = ['node', n.kind];
    if (sel?.id === n.id) cls.push('selected');
    if (connectFrom === n.id) cls.push('selected');
    if (sim?.visited.has(n.id)) cls.push('visited');
    if (sim && !sim.done && sim.current === n.id) cls.push('active');
    if (sim?.done && sim.error && sim.current === n.id) cls.push('active');
    const g = el('g', { class: cls.join(' '), 'data-node': n.id }, svg);
    if (n.kind === 'decision' || n.kind === 'io') el('polygon', { points: shapePoints(n), class: 'shape' }, g);
    else el('rect', { x: n.x - n.w / 2, y: n.y - n.h / 2, width: n.w, height: n.h, rx: n.kind === 'box' ? 6 : n.h / 2 * (n.kind === 'process' ? 0 : 1), class: 'shape' }, g);
    const lines = wrap(n.text, Math.floor(n.w / 8) - (n.kind === 'decision' ? 6 : 0));
    const t = el('text', {}, g);
    lines.forEach((l, i) => {
      const ts = el('tspan', { x: n.x, y: n.y + (i - (lines.length - 1) / 2) * 16 }, t);
      ts.textContent = l;
    });
  }
  renderSide();
  save();
}

function renderSide() {
  const probs = doc.type === 'algorithm' ? validate(doc) : [];
  const ul = $('problems');
  ul.replaceChildren();
  if (doc.type !== 'algorithm') ul.append(Object.assign(document.createElement('li'), { className: 'ok', textContent: 'Semantisk kontroll gäller algoritmflödesschema.' }));
  else if (!probs.length) ul.append(Object.assign(document.createElement('li'), { className: 'ok', textContent: 'Inga problem hittades.' }));
  else probs.forEach((p) => ul.append(Object.assign(document.createElement('li'), { textContent: p })));
  $('simPanel').style.display = doc.type === 'algorithm' ? '' : 'none';

  const vt = $('vars');
  vt.replaceChildren();
  for (const [k, v] of Object.entries(sim?.vars ?? {})) {
    const tr = vt.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = JSON.stringify(v);
  }
  $('simStatus').textContent = !sim ? '' : sim.error ? `Fel: ${sim.error}` : sim.done ? `Klar (${sim.steps} steg)` : `Steg ${sim.steps}`;
  $('btnConnect').classList.toggle('on', connecting);
}

function buildPalette() {
  const p = $('palette');
  p.replaceChildren();
  for (const kind of PALETTES[doc.type]) {
    const b = document.createElement('button');
    b.textContent = `+ ${KINDS[kind].label}`;
    b.onclick = () => addNode(kind);
    p.append(b);
  }
}

function addNode(kind) {
  const wrapEl = $('canvasWrap');
  const n = makeNode(kind, wrapEl.scrollLeft + 300 + Math.random() * 80, wrapEl.scrollTop + 120 + Math.random() * 80);
  doc.nodes.push(n);
  if (doc.type === 'org' && sel?.type === 'node') doc.edges.push({ id: uid('e'), from: sel.id, to: n.id, label: '' });
  sel = { type: 'node', id: n.id };
  stopSim(true);
  render();
}

function connect(a, b) {
  if (a === b || doc.edges.some((e) => e.from === a && e.to === b)) return;
  const from = byId(a);
  let label = '';
  if (doc.type === 'algorithm' && from.kind === 'decision') {
    const used = doc.edges.filter((e) => e.from === a).map((e) => e.label);
    label = used.includes('Ja') ? 'Nej' : 'Ja';
  }
  doc.edges.push({ id: uid('e'), from: a, to: b, label });
  stopSim(true);
}

function deleteSelected() {
  if (!sel) return;
  if (sel.type === 'node') {
    doc.nodes = doc.nodes.filter((n) => n.id !== sel.id);
    doc.edges = doc.edges.filter((e) => e.from !== sel.id && e.to !== sel.id);
  } else doc.edges = doc.edges.filter((e) => e.id !== sel.id);
  sel = null;
  stopSim(true);
  render();
}

function point(ev) {
  const r = svg.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}

svg.addEventListener('pointerdown', (ev) => {
  const nodeEl = ev.target.closest('[data-node]');
  const edgeEl = ev.target.closest('[data-edge]');
  if (nodeEl) {
    const n = byId(nodeEl.dataset.node);
    if (connecting || ev.shiftKey) {
      const from = connectFrom ?? (ev.shiftKey && sel?.type === 'node' ? sel.id : null);
      if (from) { connect(from, n.id); connectFrom = null; } else connectFrom = n.id;
      sel = { type: 'node', id: n.id };
      render();
      return;
    }
    sel = { type: 'node', id: n.id };
    const start = point(ev);
    const ox = n.x - start.x, oy = n.y - start.y;
    const move = (e) => {
      const p = point(e);
      n.x = Math.round((p.x + ox) / 10) * 10;
      n.y = Math.round((p.y + oy) / 10) * 10;
      render();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    render();
  } else if (edgeEl) {
    sel = { type: 'edge', id: edgeEl.dataset.edge };
    render();
  } else {
    sel = null;
    connectFrom = null;
    render();
  }
});

svg.addEventListener('dblclick', (ev) => {
  const nodeEl = ev.target.closest('[data-node]');
  const edgeEl = ev.target.closest('[data-edge]');
  if (nodeEl) {
    const n = byId(nodeEl.dataset.node);
    const t = prompt('Text:', n.text);
    if (t !== null) { n.text = t; stopSim(true); render(); }
  } else if (edgeEl) {
    const e = doc.edges.find((x) => x.id === edgeEl.dataset.edge);
    const t = prompt('Pilens text:', e.label);
    if (t !== null) { e.label = t; stopSim(true); render(); }
  }
});

document.addEventListener('keydown', (ev) => {
  if (['TEXTAREA', 'INPUT', 'SELECT'].includes(ev.target.tagName)) return;
  if (ev.key === 'Delete' || ev.key === 'Backspace') deleteSelected();
  if (ev.key === 'Escape') { connecting = false; connectFrom = null; render(); }
});

// Simulering
function stopSim(reset) {
  clearInterval(timer);
  timer = null;
  if (reset) { sim = null; $('output').textContent = ''; }
}

function ensureSim() {
  if (sim) return;
  $('output').textContent = '';
  sim = new Simulator(doc, {
    input: (name) => prompt(`Ange värde för ${name}:`),
    print: (s) => { $('output').textContent += `${s}\n`; },
  });
}

function stepSim() {
  ensureSim();
  sim.step();
  if (sim.done) { clearInterval(timer); timer = null; }
  render();
}

$('simStep').onclick = () => { clearInterval(timer); timer = null; stepSim(); };
$('simRun').onclick = () => {
  if (sim?.done) stopSim(true);
  ensureSim();
  clearInterval(timer);
  timer = setInterval(stepSim, Number($('simSpeed').value));
};
$('simPause').onclick = () => { clearInterval(timer); timer = null; };
$('simReset').onclick = () => { stopSim(true); render(); };
$('simSpeed').oninput = () => {
  if (timer) { clearInterval(timer); timer = setInterval(stepSim, Number($('simSpeed').value)); }
};

// Verktygsfält
function setDoc(d) {
  stopSim(true);
  doc = d;
  sel = null;
  connectFrom = null;
  $('docType').value = doc.type;
  buildPalette();
  render();
  $('mermaid').value = toMermaid(doc);
}

$('docType').onchange = (e) => {
  const type = e.target.value;
  if (doc.nodes.length && !confirm('Byta diagramtyp skapar ett nytt exempel. Fortsätta?')) { e.target.value = doc.type; return; }
  setDoc(sampleDoc(type));
};
$('btnNew').onclick = () => { if (!doc.nodes.length || confirm('Rensa diagrammet?')) setDoc(newDoc(doc.type)); };
$('btnSample').onclick = () => setDoc(sampleDoc(doc.type));
$('btnConnect').onclick = () => { connecting = !connecting; connectFrom = null; render(); };
$('btnDelete').onclick = deleteSelected;
$('btnLayout').onclick = () => { autoLayout(doc); render(); };
$('btnSave').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  a.download = 'yggdrasil.json';
  a.click();
  URL.revokeObjectURL(a.href);
};
$('btnLoad').onclick = () => $('fileLoad').click();
$('fileLoad').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.nodes) || !Array.isArray(d.edges) || !PALETTES[d.type]) throw new Error('Ogiltigt dokument');
    setDoc(d);
  } catch (err) { alert(err.message); }
  e.target.value = '';
};
$('mmExport').onclick = () => { $('mermaid').value = toMermaid(doc); };
$('mmImport').onclick = () => {
  try { setDoc(fromMermaid($('mermaid').value, doc.type)); } catch (err) { alert(err.message); }
};

setDoc(doc);
