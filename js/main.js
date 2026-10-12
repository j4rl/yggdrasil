import { KINDS, PALETTES, newDoc, makeNode, sampleDoc, autoLayout, uid } from './model.js';
import { Simulator, validate } from './sim.js';
import { toMermaid, fromMermaid } from './mermaid.js';
import { generateCode } from './codegen.js';

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
  if (nodeShape(n) === 'diamond') return `${x},${y - h / 2} ${x + w / 2},${y} ${x},${y + h / 2} ${x - w / 2},${y}`;
  const s = 14;
  return `${x - w / 2 + s},${y - h / 2} ${x + w / 2 + s},${y - h / 2} ${x + w / 2 - s},${y + h / 2} ${x - w / 2 - s},${y + h / 2}`;
}

// Skärningspunkt mellan linjen centrum->mot och nodens kant.
function clip(n, tx, ty) {
  const dx = tx - n.x, dy = ty - n.y;
  if (!dx && !dy) return { x: n.x, y: n.y };
  const hw = n.w / 2, hh = n.h / 2;
  const t = nodeShape(n) === 'ellipse' ? 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2) : nodeShape(n) === 'diamond' ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh) : Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
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
    if (!['org', 'mindmap', 'concept'].includes(doc.type)) line.setAttribute('marker-end', 'url(#arrow)');
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
    const style = appearance(n), shape = nodeShape(n);
    let outline;
    if (shape === 'diamond' || shape === 'io') outline = el('polygon', { points: shapePoints(n), class: 'shape' }, g);
    else if (shape === 'ellipse') outline = el('ellipse', { cx: n.x, cy: n.y, rx: n.w / 2, ry: n.h / 2, class: 'shape' }, g);
    else outline = el('rect', { x: n.x - n.w / 2, y: n.y - n.h / 2, width: n.w, height: n.h, rx: shape === 'rounded' ? style.radius : 0, class: 'shape' }, g);
    Object.assign(outline.style, { fill: style.fill, stroke: style.stroke, strokeWidth: style.border });
    if (sim?.visited.has(n.id)) outline.style.stroke = '#22aa77';
    if (sim?.current === n.id) { outline.style.stroke = '#ff6600'; outline.style.fill = '#ffe0b3'; }
    const classDetails = n.kind === 'class' ? [n.attributes, n.methods].filter(Boolean).join('\n') : '';
    const lines = wrap(n.text + (classDetails ? `\n────────\n${classDetails}` : '') + (n.details && doc.type !== 'algorithm' ? `\n${n.details}` : ''), Math.max(3, Math.floor(n.w / (style.font * .6)) - (shape === 'diamond' ? 6 : 2)));
    const t = el('text', {}, g);
    const background = outline.style.fill;
    const hex = background.startsWith('#') ? background.slice(1) : null;
    const rgb = hex?.length === 6 ? [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) : background.match(/\d+/g)?.slice(0, 3).map(Number);
    const luminance = rgb?.map(c => { const s = c / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });
    const fallbackColor = luminance && .2126 * luminance[0] + .7152 * luminance[1] + .0722 * luminance[2] > .179 ? '#000000' : '#ffffff';
    t.style.setProperty('--bubble-background', background);
    t.style.setProperty('--bubble-text-fallback', fallbackColor);
    t.style.fontSize = `${style.font}px`;
    lines.forEach((l, i) => {
      const ts = el('tspan', { x: n.x, y: n.y + (i - (lines.length - 1) / 2) * (style.font * 1.25) }, t);
      ts.textContent = l;
    });
  }
  renderSide();
  syncAppearance();
  save();
}

function renderSide() {
  const probs = doc.type === 'algorithm' ? validate(doc) : [];
  const ul = $('problems');
  ul.replaceChildren();
  if (doc.type !== 'algorithm') ul.append(Object.assign(document.createElement('li'), { className: 'ok', textContent: 'Semantisk kontroll gäller algoritmflödesschema.' }));
  else if (!probs.length) ul.append(Object.assign(document.createElement('li'), { className: 'ok', textContent: 'Inga problem hittades.' }));
  else probs.forEach((p) => ul.append(Object.assign(document.createElement('li'), { textContent: p })));
  $('codePanel').hidden = !['algorithm', 'uml'].includes(doc.type);
  if ($('generatedCode').value) { $('generatedCode').value = ''; $('downloadCode').disabled = true; $('codeStatus').textContent = 'Diagrammet har ändrats. Generera koden igen.'; }
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
  if (['org', 'mindmap'].includes(doc.type) && sel?.type === 'node') doc.edges.push({ id: uid('e'), from: sel.id, to: n.id, label: '' });
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
    svg.querySelectorAll('.selected').forEach((g) => g.classList.remove('selected'));
    nodeEl.classList.add('selected');
    syncAppearance();
    const start = point(ev);
    const ox = n.x - start.x, oy = n.y - start.y;
    const move = (e) => {
      const p = point(e);
      if (Math.hypot(p.x - start.x, p.y - start.y) < 4) return;
      n.x = Math.round((p.x + ox) / 10) * 10;
      n.y = Math.round((p.y + oy) / 10) * 10;
      render();
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up, { once: true });
  } else if (edgeEl) {
    sel = { type: 'edge', id: edgeEl.dataset.edge };
    svg.querySelectorAll('.selected').forEach((g) => g.classList.remove('selected'));
    edgeEl.classList.add('selected');
    syncAppearance();
  } else {
    sel = null;
    connectFrom = null;
    render();
  }
});

let editing = null;
function nodeShape(n) {
  return n.style?.shape && n.style.shape !== 'auto' ? n.style.shape : ({ decision: 'diamond', io: 'io', topic: 'ellipse', start: 'rounded', end: 'rounded', box: 'rounded', concept: 'rounded', state: 'rounded' }[n.kind] ?? 'rect');
}
function appearance(n) {
  return { fill: ({ start: '#d9ead3', end: '#d9ead3', decision: '#fff2cc', io: '#cfe2f3', box: '#e8eefc', topic: '#e8eefc', concept: '#d9ead3', state: '#e8eefc' }[n.kind] ?? '#ffffff'), stroke: '#333333', font: 13, border: 1.5, radius: ['start', 'end'].includes(n.kind) ? n.h / 2 : 12, shape: 'auto', ...n.style };
}
const appearanceControls = { nodeShape: 'shape', nodeFill: 'fill', nodeStroke: 'stroke', nodeFont: 'font', nodeBorder: 'border', nodeRadius: 'radius', nodeWidth: 'w', nodeHeight: 'h' };
function syncAppearance() {
  const n = sel?.type === 'node' ? byId(sel.id) : null;
  $('appearanceFields').disabled = !n;
  $('appearanceHint').textContent = n ? 'Ändringarna sparas direkt för den markerade bubblan.' : 'Markera en bubbla för att ändra utseendet.';
  if (!n) return;
  const style = appearance(n);
  for (const [id, key] of Object.entries(appearanceControls)) $(id).value = key === 'w' || key === 'h' ? n[key] : style[key];
}
for (const [id, key] of Object.entries(appearanceControls)) $(id).addEventListener('input', () => {
  const n = sel?.type === 'node' ? byId(sel.id) : null;
  if (!n || !$(id).checkValidity() || $(id).value === '') return;
  const value = $(id).type === 'number' ? Number($(id).value) : $(id).value;
  if (key === 'w' || key === 'h') n[key] = value;
  else (n.style ??= {})[key] = value;
  render();
});
$('resetAppearance').onclick = () => {
  const n = byId(sel?.id);
  if (!n) return;
  delete n.style;
  n.w = KINDS[n.kind].w; n.h = KINDS[n.kind].h;
  render();
};
function editorHelp() {
  const kind = $('editKind').value;
  $('textLabel').textContent = doc.type === 'algorithm' ? ({ process: 'Tilldelningar', decision: 'Villkor', io: 'Inmatning eller utmatning' }[kind] ?? 'Text') : 'Text';
  $('editHelp').textContent = doc.type === 'algorithm' ? ({ process: 'Exempel: x = 0; y = x + 1', decision: 'Exempel: x < 10. Koppla en Ja-gren och en Nej-gren.', io: 'Använd input namn eller print uttryck.' }[kind] ?? 'Ange text för start eller slut.') : ({ uml: 'Ange klassnamn. Attribut: name: str. Metod: greet(message: str): str. Koppla klasser och välj arv eller association på kopplingen.', org: 'Ange namn eller enhet. Lägg rollen i detaljfältet.', mindmap: 'Ange ett ämne och eventuella anteckningar.', concept: 'Ange ett begrepp. Namnge relationerna genom att dubbelklicka på kopplingarna.', state: 'Ange tillståndets namn. Namnge händelser på kopplingarna.' }[doc.type] ?? 'Ange text för flödessteget.');
}
svg.addEventListener('dblclick', (ev) => {
  const nodeEl = ev.target.closest('[data-node]'), edgeEl = ev.target.closest('[data-edge]');
  if (!nodeEl && !edgeEl) return;
  editing = nodeEl ? { type: 'node', id: nodeEl.dataset.node } : { type: 'edge', id: edgeEl.dataset.edge };
  const node = editing.type === 'node';
  const item = node ? byId(editing.id) : doc.edges.find((e) => e.id === editing.id);
  $('editorTitle').textContent = node ? 'Redigera bubbla' : 'Redigera koppling';
  $('kindField').hidden = !node;
  $('detailsField').hidden = !node || ['algorithm', 'uml'].includes(doc.type);
  $('umlFields').hidden = !node || doc.type !== 'uml';
  $('relationField').hidden = node || doc.type !== 'uml';
  $('editAttributes').value = item.attributes ?? '';
  $('editMethods').value = item.methods ?? '';
  $('editRelation').value = item.relation ?? 'association';
  $('detailsLabel').textContent = doc.type === 'org' ? 'Roll / ansvar' : doc.type === 'state' ? 'Åtgärder i tillståndet' : 'Anteckningar';
  $('editKind').replaceChildren(...PALETTES[doc.type].map((kind) => new Option(KINDS[kind].label, kind)));
  $('editKind').value = item.kind ?? PALETTES[doc.type][0];
  $('editText').value = node ? item.text : item.label;
  $('editDetails').value = item.details ?? '';
  $('branchField').hidden = node || doc.type !== 'algorithm' || byId(item.from)?.kind !== 'decision';
  $('editBranch').value = ['Ja', 'Nej'].includes(item.label) ? item.label : '';
  if (node) editorHelp();
  else { $('textLabel').textContent = doc.type === 'state' ? 'Händelse / övergång' : 'Kopplingens text'; $('editHelp').textContent = ''; }
  $('editor').showModal();
  $('editText').focus();
});
$('editKind').onchange = editorHelp;
$('editBranch').onchange = () => { if ($('editBranch').value) $('editText').value = $('editBranch').value; };
$('cancelEditor').onclick = () => $('editor').close();
$('editorForm').onsubmit = (ev) => {
  ev.preventDefault();
  if (editing.type === 'node') {
    const n = byId(editing.id);
    n.text = $('editText').value;
    n.kind = $('editKind').value;
    if (doc.type === 'uml') { n.attributes = $('editAttributes').value; n.methods = $('editMethods').value; }
    if (doc.type !== 'algorithm') n.details = $('editDetails').value;
  } else {
    const edge = doc.edges.find((e) => e.id === editing.id);
    edge.label = $('editText').value;
    if (doc.type === 'uml') edge.relation = $('editRelation').value;
  }
  stopSim(true); $('editor').close(); render();
};

document.addEventListener('keydown', (ev) => {
  if ($('editor').open) return;
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

$('generateCode').onclick = () => {
  try {
    $('generatedCode').value = generateCode(doc, $('codeLanguage').value);
    $('downloadCode').disabled = false;
    $('codeStatus').textContent = doc.type === 'uml' ? 'Klasskelett genererat. Implementera metodernas innehåll.' : 'Kod genererad. Python körs med Python 3; JavaScript körs med main() i webbläsaren.';
  } catch (err) {
    $('generatedCode').value = ''; $('downloadCode').disabled = true;
    $('codeStatus').textContent = err.message;
  }
};
$('codeLanguage').onchange = () => { $('generatedCode').value = ''; $('downloadCode').disabled = true; $('codeStatus').textContent = ''; };
$('downloadCode').onclick = () => {
  if (!$('generatedCode').value) return;
  const url = URL.createObjectURL(new Blob([$('generatedCode').value], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url;
  a.download = 'yggdrasil.' + ($('codeLanguage').value === 'python' ? 'py' : 'js'); a.click();
  URL.revokeObjectURL(url);
};
setDoc(doc);
