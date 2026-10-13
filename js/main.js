import { KINDS, PALETTES, newDoc, makeNode, sampleDoc, autoLayout, uid } from './model.js';
import { Simulator, validate } from './sim.js';
import { toMermaid, fromMermaid } from './mermaid.js';
import { generateCode } from './codegen.js';
import { generateSQL } from './sql.js';
import { routeConnection, routeGeometry } from './routing.js';

const NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const svg = $('canvas');
const STORE = 'yggdrasil.doc';

let doc = load() ?? newDoc('algorithm');
let sel = null; // { type: 'node' | 'edge', id }
let connecting = false;
let connectFrom = null;
let sim = null;
let timer = null;
let zoom = 1;
let generatedFrom = null;

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

function edgeGeometry(e, previousRoutes = []) {
  const a = byId(e.from), b = byId(e.to);
  if (!a || !b) return null;
  if (a === b) {
    const x = a.x + a.w / 2, y = a.y, r = 65;
    return { d: `M${x},${y - 20} C${x + r},${y - r} ${x + r},${y + r} ${x},${y + 20}`, lx: x + r, ly: y };
  }
  const p = clip(a, b.x, b.y), r = clip(b, a.x, a.y);
  // Rectangular routing bounds need cardinal attachment points for curved shapes.
  const direct = routeConnection(p, r, doc.nodes.filter(n => n !== a && n !== b), a.id, b.id, previousRoutes);
  if (direct.length === 2) { previousRoutes.push(direct); return routeGeometry(direct); }
  const dx = b.x - a.x, dy = b.y - a.y;
  const horizontal = Math.abs(dx) / (a.w + b.w) >= Math.abs(dy) / (a.h + b.h);
  const start = horizontal ? clip(a, a.x + Math.sign(dx || 1), a.y) : clip(a, a.x, a.y + Math.sign(dy || 1));
  const end = horizontal ? clip(b, b.x - Math.sign(dx || 1), b.y) : clip(b, b.x, b.y - Math.sign(dy || 1));
  const route = routeConnection(start, end, doc.nodes, a.id, b.id, previousRoutes);
  previousRoutes.push(route);
  return routeGeometry(route);
}

function render() {
  svg.replaceChildren();
  const defs = el('defs', {}, svg);
  const mk = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#333' }, mk);

  const previousRoutes = [];
  for (const e of doc.edges) {
    const g = edgeGeometry(e, previousRoutes);
    if (!g) continue;
    const grp = el('g', { class: `edge${sel?.id === e.id ? ' selected' : ''}`, 'data-edge': e.id, tabindex: 0, role: 'button', 'aria-label': `Koppling från ${byId(e.from)?.text ?? ''} till ${byId(e.to)?.text ?? ''}. Enter redigerar.` }, svg);
    el('path', { d: g.d, class: 'hit' }, grp);
    const line = el('path', { d: g.d, class: 'line' }, grp);
    if (!['org', 'mindmap', 'concept'].includes(doc.type)) line.setAttribute('marker-end', 'url(#arrow)');
    const label = doc.type === 'database' ? `${e.fromColumn || '?'} → ${e.toColumn || '?'}` : e.label;
    if (label) el('text', { x: g.lx, y: g.ly }, grp).textContent = label;
  }

  for (const n of doc.nodes) {
    const cls = ['node', n.kind];
    if (sel?.id === n.id) cls.push('selected');
    if (connectFrom === n.id) cls.push('selected');
    if (sim?.visited.has(n.id)) cls.push('visited');
    if (sim && !sim.done && sim.current === n.id) cls.push('active');
    if (sim?.done && sim.error && sim.current === n.id) cls.push('active');
    const g = el('g', { class: cls.join(' '), 'data-node': n.id, tabindex: 0, role: 'button', 'aria-label': `${KINDS[n.kind]?.label ?? 'Del'}: ${n.text}. Enter redigerar.` }, svg);
    const style = appearance(n), shape = nodeShape(n);
    let outline;
    if (shape === 'diamond' || shape === 'io') outline = el('polygon', { points: shapePoints(n), class: 'shape' }, g);
    else if (shape === 'ellipse') outline = el('ellipse', { cx: n.x, cy: n.y, rx: n.w / 2, ry: n.h / 2, class: 'shape' }, g);
    else outline = el('rect', { x: n.x - n.w / 2, y: n.y - n.h / 2, width: n.w, height: n.h, rx: shape === 'rounded' ? style.radius : 0, class: 'shape' }, g);
    Object.assign(outline.style, { fill: style.fill, stroke: style.stroke, strokeWidth: style.border });
    if (sim?.visited.has(n.id)) outline.style.stroke = '#22aa77';
    if (sim?.current === n.id) { outline.style.stroke = '#ff6600'; outline.style.fill = '#ffe0b3'; }
    const classDetails = n.kind === 'table' ? n.columns ?? '' : n.kind === 'class' ? [n.attributes, n.methods].filter(Boolean).join('\n') : '';
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
    if (n.kind === 'table' || n.kind === 'class') {
      const padding = 14;
      const left = n.x - n.w / 2 + padding;
      const right = n.x + n.w / 2 - padding;
      const top = n.y - n.h / 2;
      const lineHeight = style.font * 1.5;
      const headerHeight = lineHeight + padding * 2;
      el('tspan', { x: n.x, y: top + headerHeight / 2, 'font-weight': 600 }, t).textContent = n.text;
      el('line', { x1: left - padding, x2: right + padding, y1: top + headerHeight, y2: top + headerHeight, stroke: style.stroke, 'stroke-width': style.border, 'pointer-events': 'none' }, g);
      let rowY = top + headerHeight + padding + lineHeight / 2;
      if (n.kind === 'class') {
        const max = Math.max(3, Math.floor((n.w - padding * 2) / (style.font * .6)));
        const sections = [n.attributes ?? '', n.methods ?? ''];
        if (n.details) sections.push(n.details);
        sections.forEach((section, index) => {
          if (index) {
            const dividerY = rowY - lineHeight / 2;
            el('line', { x1: left - padding, x2: right + padding, y1: dividerY, y2: dividerY, stroke: style.stroke, 'stroke-width': style.border, 'pointer-events': 'none' }, g);
            rowY += padding;
          }
          const rows = section.split('\n').map(line => line.trim()).filter(Boolean);
          for (const row of rows) {
            // A method's parameter types belong to its signature, not its return type.
            const parts = index === 0 ? /^([^:]+):\s*(.+)$/.exec(row) : index === 1 ? /^(.*\))\s*:\s*(.+)$/.exec(row) : null;
            if (parts) {
              const halfMax = Math.max(3, Math.floor((n.w / 2 - padding * 1.5) / (style.font * .6)));
              const names = wrap(parts[1].trim(), halfMax);
              const types = wrap(parts[2].trim(), halfMax);
              names.forEach((line, i) => el('tspan', { x: left, y: rowY + i * lineHeight, style: 'text-anchor:start' }, t).textContent = line);
              types.forEach((line, i) => el('tspan', { x: right, y: rowY + i * lineHeight, style: 'text-anchor:end' }, t).textContent = line);
              rowY += Math.max(names.length, types.length) * lineHeight;
            } else {
              const wrapped = wrap(row, max);
              wrapped.forEach((line, i) => el('tspan', { x: left, y: rowY + i * lineHeight, style: 'text-anchor:start' }, t).textContent = line);
              rowY += wrapped.length * lineHeight;
            }
          }
          if (!rows.length) rowY += lineHeight;
        });
        continue;
      }
      for (const column of (n.columns ?? '').split('\n').map(line => line.trim()).filter(Boolean)) {
        const [, name, definition = ''] = /^(\S+)(?:\s+(.+))?$/.exec(column);
        const max = Math.max(3, Math.floor((n.w / 2 - padding * 1.5) / (style.font * .6)));
        const names = wrap(name, max);
        const definitions = wrap(definition, max);
        names.forEach((line, i) => {
          el('tspan', { x: left, y: rowY + i * lineHeight, style: 'text-anchor:start' }, t).textContent = line;
        });
        definitions.forEach((line, i) => {
          el('tspan', { x: right, y: rowY + i * lineHeight, style: 'text-anchor:end' }, t).textContent = line;
        });
        rowY += Math.max(names.length, definitions.length) * lineHeight;
      }
      continue;
    }
    lines.forEach((l, i) => {
      const ts = el('tspan', { x: n.x, y: n.y + (i - (lines.length - 1) / 2) * (style.font * 1.25) }, t);
      ts.textContent = l;
    });
  }
  renderSide();
  syncAppearance();
  save();
}

const diagramInfo = {
  flowchart: ['Visa en process steg för steg, från start till mål.', 'En romb visar ett val. Skriv gärna Ja och Nej på grenarna.'],
  algorithm: ['Bygg en algoritm, följ dess steg och skapa körbar kod.', 'Börja med Start. Processer räknar, villkor väljer och In/Ut läser eller visar värden.'],
  database: ['Planera tabeller och relationer. Exportera som SQL.', 'Koppla tabellen med främmande nyckel till tabellen den refererar till.'],
  uml: ['Beskriv klasser, deras egenskaper och hur de hör ihop.', 'Dubbelklicka på en klass för attribut och metoder. Välj arv på en koppling.'],
  org: ['Visa roller, grupper och vem som ansvarar för vad.', 'Markera en enhet innan du lägger till nästa för att koppla dem automatiskt.'],
  mindmap: ['Samla idéer och låt dem förgrena sig från ett huvudämne.', 'Markera ett ämne och lägg till ett nytt. Det blir en gren från det markerade ämnet.'],
  concept: ['Visa begrepp och beskriv sambanden mellan dem.', 'Skriv på kopplingarna vad sambandet betyder, till exempel ”består av”.'],
  state: ['Visa möjliga tillstånd och händelser som växlar mellan dem.', 'Skriv händelsen på kopplingen, till exempel ”Starta” eller ”Pausa”.'],
};
const pieceInfo = {
  start: ['○', 'Här börjar flödet'], end: ['◉', 'Här slutar flödet'],
  process: ['▭', 'Ett steg eller en beräkning'], decision: ['◇', 'Ett villkor eller ett val'],
  io: ['▱', 'Läs in eller visa ett värde'], box: ['▤', 'En person, roll eller grupp'],
  topic: ['○', 'En idé eller ett ämne'], concept: ['▢', 'Ett begrepp att förklara'],
  state: ['▢', 'Ett möjligt läge'], class: ['▤', 'Egenskaper och metoder'], table: ['▦', 'Kolumner och nycklar'],
};
function renderSide() {
  $('diagramTitle').textContent = $('docType').selectedOptions[0]?.textContent ?? 'Diagram';
  $('diagramDescription').textContent = diagramInfo[doc.type]?.[0] ?? '';
  $('diagramTip').textContent = diagramInfo[doc.type]?.[1] ?? '';
  $('nodeCount').textContent = `${doc.nodes.length} delar · ${doc.edges.length} kopplingar`;
  $('emptyCanvas').hidden = doc.nodes.length > 0;
  $('canvasInstruction').textContent = connecting ? (connectFrom ? 'Välj den andra delen för att skapa kopplingen.' : 'Klicka på delen du vill koppla från.') : 'Dra för att flytta. Dubbelklicka för att skriva.';
  $('btnConnect').setAttribute('aria-pressed', String(connecting));
  svg.classList.toggle('connecting', connecting);

  const probs = doc.type === 'algorithm' ? validate(doc) : [];
  const ul = $('problems');
  ul.replaceChildren();
  if (doc.type !== 'algorithm') ul.append(Object.assign(document.createElement('li'), { className: 'ok', textContent: 'Tips: följ kopplingarna och kontrollera att texten förklarar din idé.' }));
  else if (!probs.length) ul.append(Object.assign(document.createElement('li'), { className: 'ok', textContent: 'Inga problem hittades.' }));
  else probs.forEach((p) => ul.append(Object.assign(document.createElement('li'), { textContent: p })));
  $('checkDescription').textContent = doc.type === 'algorithm' ? 'Vi kontrollerar start, slut, villkor och beräkningar. Testa sedan ett steg i taget.' : doc.type === 'database' ? 'Tabellnamn, kolumner och nycklar kontrolleras när du genererar SQL i Exportera.' : doc.type === 'uml' ? 'Klassnamn, metoder och arv kontrolleras när du genererar kod i Exportera.' : 'Läs diagrammet från början. Är delarna och sambanden lätta att förstå?';
  $('codeTitle').textContent = doc.type === 'database' ? 'SQL-export' : 'Generera kod';
  $('codeLanguageField').hidden = doc.type === 'database';
  $('generateCode').textContent = doc.type === 'database' ? 'Generera SQL' : 'Generera';
  $('codePanel').hidden = !['algorithm', 'uml', 'database'].includes(doc.type);
  if ($('generatedCode').value && generatedFrom !== JSON.stringify(doc)) { $('generatedCode').value = ''; $('downloadCode').disabled = true; $('codeStatus').textContent = 'Diagrammet har ändrats. Generera koden igen.'; }
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
    const [symbol, description] = pieceInfo[kind] ?? ['+', 'Lägg till en del'];
    const icon = document.createElement('span'); icon.className = 'piece-symbol'; icon.textContent = symbol; icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.textContent = KINDS[kind].label;
    const help = document.createElement('small'); help.textContent = description; label.append(help);
    b.append(icon, label); b.setAttribute('aria-label', `Lägg till ${KINDS[kind].label}`);
    b.onclick = () => addNode(kind);
    p.append(b);
  }
}

function addNode(kind) {
  const wrapEl = $('canvasWrap');
  const n = makeNode(kind, (wrapEl.scrollLeft + wrapEl.clientWidth / 2) / zoom + Math.random() * 30, (wrapEl.scrollTop + wrapEl.clientHeight / 2) / zoom + Math.random() * 30);
  doc.nodes.push(n);
  if (['org', 'mindmap'].includes(doc.type) && sel?.type === 'node') doc.edges.push({ id: uid('e'), from: sel.id, to: n.id, label: '' });
  sel = { type: 'node', id: n.id };
  showPanel('panelEdit');
  stopSim(true);
  render();
}

function connect(a, b) {
  const from = byId(a);
  if (!from || !byId(b) || (a === b && doc.type !== 'database') || doc.edges.some((e) => e.from === a && e.to === b && doc.type !== 'database')) return null;
  let label = '';
  if (doc.type === 'algorithm' && from.kind === 'decision') {
    const used = doc.edges.filter((e) => e.from === a).map((e) => e.label);
    label = used.includes('Ja') ? 'Nej' : 'Ja';
  }
  const edge = { id: uid('e'), from: a, to: b, label };
  doc.edges.push(edge);
  stopSim(true);
  return edge;
}

function chooseConnection(id, shiftKey = false) {
  const from = connectFrom ?? (shiftKey && sel?.type === 'node' ? sel.id : null);
  if (!from) {
    connectFrom = id;
    connecting = true;
    sel = { type: 'node', id };
    render();
    return;
  }
  const edge = connect(from, id);
  if (!edge) {
    connectFrom = from;
    connecting = true;
    render();
    $('canvasInstruction').textContent = from === id ? 'Välj en annan del för att skapa kopplingen.' : 'Kopplingen finns redan. Välj en annan del.';
    return;
  }
  connectFrom = null;
  connecting = false;
  sel = { type: 'edge', id: edge.id };
  showPanel('panelEdit');
  render();
  if (doc.type === 'database') openEditor(sel);
}

function deleteSelected() {
  if (!sel) return;
  if (sel.type === 'node') {
    doc.nodes = doc.nodes.filter((n) => n.id !== sel.id);
    doc.edges = doc.edges.filter((e) => e.from !== sel.id && e.to !== sel.id);
  } else doc.edges = doc.edges.filter((e) => e.id !== sel.id);
  if (connectFrom && !byId(connectFrom)) connectFrom = null;
  sel = null;
  stopSim(true);
  render();
}

function point(ev) {
  const r = svg.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / zoom, y: (ev.clientY - r.top) / zoom };
}

svg.addEventListener('pointerdown', (ev) => {
  const nodeEl = ev.target.closest('[data-node]');
  const edgeEl = ev.target.closest('[data-edge]');
  if (nodeEl) {
    const n = byId(nodeEl.dataset.node);
    if (connecting || ev.shiftKey) {
      chooseConnection(n.id, ev.shiftKey);
      return;
    }
    sel = { type: 'node', id: n.id };
    showPanel('panelEdit');
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
    showPanel('panelEdit');
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
  $('selectionEmpty').hidden = !!sel;
  $('selectionDetails').hidden = !sel;
  $('appearance').hidden = !n;
  $('btnEdit').disabled = !sel;
  $('btnDelete').disabled = !sel;
  if (sel) {
    const edge = sel.type === 'edge' ? doc.edges.find(e => e.id === sel.id) : null;
    $('selectionKind').textContent = n ? KINDS[n.kind]?.label ?? 'Del' : 'Koppling';
    $('selectionTitle').textContent = n ? n.text || 'Namnlös del' : `${byId(edge?.from)?.text ?? ''} → ${byId(edge?.to)?.text ?? ''}`;
  }
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
  $('arithmeticLibrary').hidden = doc.type !== 'algorithm' || editing?.type !== 'node' || kind !== 'process';
  $('textLabel').textContent = doc.type === 'algorithm' ? ({ process: 'Tilldelningar', decision: 'Villkor', io: 'Inmatning eller utmatning' }[kind] ?? 'Text') : 'Text';
  $('editHelp').textContent = doc.type === 'algorithm' ? ({ process: 'Exempel: x = 0; y = x + 1', decision: 'Exempel: x < 10. Koppla en Ja-gren och en Nej-gren.', io: 'Använd input namn eller print uttryck.' }[kind] ?? 'Ange text för start eller slut.') : ({ database: 'Ange tabellnamn och kolumner. Koppla den refererande tabellen till den refererade tabellen och välj kolumner på kopplingen.', uml: 'Ange klassnamn. Attribut: name: str. Metod: greet(message: str): str. Koppla klasser och välj arv eller association på kopplingen.', org: 'Ange namn eller enhet. Lägg rollen i detaljfältet.', mindmap: 'Ange ett ämne och eventuella anteckningar.', concept: 'Ange ett begrepp. Namnge relationerna genom att dubbelklicka på kopplingarna.', state: 'Ange tillståndets namn. Namnge händelser på kopplingarna.' }[doc.type] ?? 'Ange text för flödessteget.');
}
function openEditor(selection) {
  if (!selection) return;
  editing = { ...selection };
  $('arithmeticLibrary').hidden = true;
  $('arithmeticLibrary').open = false;
  const node = editing.type === 'node';
  const item = node ? byId(editing.id) : doc.edges.find((e) => e.id === editing.id);
  $('editorTitle').textContent = node ? 'Redigera bubbla' : 'Redigera koppling';
  $('kindField').hidden = !node;
  $('detailsField').hidden = !node || ['algorithm', 'uml', 'database'].includes(doc.type);
  $('databaseFields').hidden = !node || doc.type !== 'database';
  $('foreignKeyFields').hidden = node || doc.type !== 'database';
  $('editColumns').value = item.columns ?? 'id INTEGER PK';
  if (!node && doc.type === 'database') {
    for (const [id, tableId, selected] of [['editFromColumn', item.from, item.fromColumn], ['editToColumn', item.to, item.toColumn]]) {
      const names = (byId(tableId)?.columns ?? '').split('\n').map(line => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(line)?.[1]).filter(Boolean);
      $(id).replaceChildren(new Option('Välj kolumn', ''), ...names.map(name => new Option(name, name)));
      $(id).value = selected ?? '';
    }
    $('editOnDelete').value = item.onDelete ?? 'RESTRICT';
  }
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
  $('textLabel').parentElement.hidden = !node && doc.type === 'database';
  if (node) editorHelp();
  else { $('textLabel').textContent = doc.type === 'state' ? 'Händelse / övergång' : 'Kopplingens text'; $('editHelp').textContent = ''; }
  $('editor').showModal();
  (node || doc.type !== 'database' ? $('editText') : $('editFromColumn')).focus();
}
svg.addEventListener('dblclick', (ev) => {
  const node = ev.target.closest('[data-node]'), edge = ev.target.closest('[data-edge]');
  if (node || edge) openEditor(node ? { type: 'node', id: node.dataset.node } : { type: 'edge', id: edge.dataset.edge });
});
$('btnEdit').onclick = $('editSelected').onclick = () => openEditor(sel);

$('editKind').onchange = editorHelp;
const arithmeticExamples = [
  ['Addition (+)', 'summa = 8 + 3', 'Lägg ihop två tal.'],
  ['Subtraktion (−)', 'skillnad = 8 - 3', 'Beräkna skillnaden mellan två tal.'],
  ['Multiplikation (×)', 'produkt = 8 * 3', 'Multiplicera två tal.'],
  ['Division (÷)', 'kvot = 8 / 3', 'Dividera två tal. Resultatet kan vara ett decimaltal.'],
  ['Rest (%)', 'rest = 8 % 3', 'Resten vid division: 8 % 3 blir 2.'],
  ['Parenteser', 'resultat = (8 + 3) * 2', 'Styr ordningen på beräkningen.'],
  ['Kvadrat', 'kvadrat = 4 * 4', 'Multiplicera ett tal med sig självt.'],
  ['Öka en räknare', 'i = i + 1', 'Öka variabeln i med ett. Ge i ett värde först, till exempel i = 0.'],
];
const functionExamples = {
  arithmeticExamples,
  mathExamples: [
    ['Kvadratrot', 'rot = sqrt(25)', 'Kvadratroten av ett icke-negativt tal.'],
    ['Absolutbelopp', 'belopp = abs(-8)', 'Talets avstånd från noll.'],
    ['Potens', 'potens = pow(2, 3)', '2 upphöjt till 3 blir 8.'],
    ['Avrunda', 'avrundat = round(3.5)', 'Närmaste heltal; halva steg avrundas uppåt.'],
    ['Avrunda nedåt', 'nedat = floor(3.8)', 'Närmaste heltal nedåt.'],
    ['Avrunda uppåt', 'uppat = ceil(3.2)', 'Närmaste heltal uppåt.'],
    ['Minimum', 'minsta = min(4, 9)', 'Det minsta av två tal.'],
    ['Maximum', 'storsta = max(4, 9)', 'Det största av två tal.'],
  ],
  randomExamples: [
    ['Slumptal 0–1', 'slump = random()', 'Ett nytt decimaltal från 0 till under 1 vid varje körning.'],
    ['Tärning 1–6', 'tarning = floor(random() * 6) + 1', 'Ett slumpmässigt heltal mellan 1 och 6.'],
    ['Slumptal 10–20', 'slump = 10 + random() * (20 - 10)', 'Ett decimaltal från 10 till under 20.'],
  ],
  trigExamples: [
    ['Sinus', 'sinus = sin(rad(30))', 'Sinus av 30 grader.'],
    ['Cosinus', 'cosinus = cos(rad(60))', 'Cosinus av 60 grader.'],
    ['Tangens', 'tangens = tan(rad(45))', 'Tangens av 45 grader.'],
    ['Grader till radianer', 'radianer = rad(180)', 'Omvandla en vinkel i grader till radianer.'],
    ['Radianer till grader', 'grader = deg(3.141592653589793)', 'Omvandla en vinkel i radianer till grader.'],
  ],
  logExamples: [
    ['Naturlig logaritm', 'logaritm = ln(10)', 'Logaritm med basen e.'],
    ['Tiologaritm', 'logaritm = log10(100)', 'Logaritm med basen 10; log10(100) blir 2.'],
    ['Valfri logaritmbas', 'logaritm = ln(8) / ln(2)', 'Logaritm av 8 med basen 2 blir 3. Basen ska vara positiv och skild från 1.'],
    ['Exponentialfunktion', 'exponent = exp(2)', 'e upphöjt till 2.'],
  ],
};
for (const [target, examples] of Object.entries(functionExamples)) {
for (const [name, example, description] of examples) {
  const button = document.createElement('button');
  button.type = 'button';
  const title = document.createElement('strong'); title.textContent = name;
  const code = document.createElement('code'); code.textContent = example;
  const help = document.createElement('span'); help.textContent = description;
  button.append(title, code, help);
  button.onclick = () => {
    const field = $('editText');
    const existing = field.value.trimEnd();
    field.value = existing + (existing ? (existing.endsWith(';') ? '\n' : ';\n') : '') + example;
    field.focus();
    field.setSelectionRange(field.value.length - example.length, field.value.length);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  $(target).append(button);
}
}
$('editBranch').onchange = () => { if ($('editBranch').value) $('editText').value = $('editBranch').value; };
$('cancelEditor').onclick = () => $('editor').close();
$('editorForm').onsubmit = (ev) => {
  ev.preventDefault();
  if (editing.type === 'node') {
    const n = byId(editing.id);
    n.text = $('editText').value;
    n.kind = $('editKind').value;
    if (doc.type === 'database') n.columns = $('editColumns').value;
    if (doc.type === 'uml') { n.attributes = $('editAttributes').value; n.methods = $('editMethods').value; }
    if (doc.type !== 'algorithm') n.details = $('editDetails').value;
  } else {
    const edge = doc.edges.find((e) => e.id === editing.id);
    edge.label = $('editText').value;
    if (doc.type === 'database') { edge.fromColumn = $('editFromColumn').value; edge.toColumn = $('editToColumn').value; edge.onDelete = $('editOnDelete').value; }
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
  connecting = false;
  generatedFrom = null;
  $('codeStatus').textContent = '';
  $('docType').value = doc.type;
  buildPalette();
  render();
  $('mermaid').value = toMermaid(doc);
  requestAnimationFrame(fitDiagram);
}

$('docType').onchange = (e) => {
  const type = e.target.value;
  if (doc.nodes.length && !confirm('Byta diagramtyp skapar ett tomt diagram. Fortsätta?')) { e.target.value = doc.type; return; }
  setDoc(newDoc(type));
};
$('btnNew').onclick = () => { if (!doc.nodes.length || confirm('Rensa diagrammet?')) setDoc(newDoc(doc.type)); };
$('btnSample').onclick = () => setDoc(sampleDoc(doc.type));
$('btnConnect').onclick = () => { connecting = !connecting; connectFrom = null; render(); };
$('btnDelete').onclick = deleteSelected;
$('btnLayout').onclick = () => { autoLayout(doc); render(); fitDiagram(); };
function suggestedFilename(extension, date = new Date()) {
  const prefix = { flowchart: 'flodesschema', algorithm: 'algoritm', database: 'databasdiagram', uml: 'uml-klassdiagram', org: 'organisationsschema', mindmap: 'mindmap', concept: 'begreppskarta', state: 'tillstandsdiagram' }[doc.type] ?? doc.type;
  const pad = value => String(value).padStart(2, '0');
  return `${prefix}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.${extension}`;
}
$('btnSave').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  a.download = suggestedFilename('json');
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
    $('generatedCode').value = doc.type === 'database' ? generateSQL(doc) : generateCode(doc, $('codeLanguage').value);
    generatedFrom = JSON.stringify(doc);
    $('downloadCode').disabled = false;
    $('codeStatus').textContent = doc.type === 'database' ? 'SQL-schema genererat för SQLite.' : doc.type === 'uml' ? 'Klasskelett genererat. Implementera metodernas innehåll.' : 'Kod genererad. Python körs med Python 3; JavaScript körs med main() i webbläsaren.';
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
  a.download = suggestedFilename(doc.type === 'database' ? 'sql' : $('codeLanguage').value === 'python' ? 'py' : 'js'); a.click();
  URL.revokeObjectURL(url);
};
function showPanel(id, focus = false) {
  for (const tab of document.querySelectorAll('[data-panel]')) {
    const active = tab.dataset.panel === id;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    $(tab.dataset.panel).hidden = !active;
    if (active && focus) tab.focus();
  }
}
const tabs = [...document.querySelectorAll('[data-panel]')];
tabs.forEach((tab, i) => {
  tab.onclick = () => showPanel(tab.dataset.panel);
  tab.onkeydown = ev => {
    let target;
    if (ev.key === 'ArrowRight') target = (i + 1) % tabs.length;
    if (ev.key === 'ArrowLeft') target = (i + tabs.length - 1) % tabs.length;
    if (ev.key === 'Home') target = 0;
    if (ev.key === 'End') target = tabs.length - 1;
    if (target !== undefined) { ev.preventDefault(); showPanel(tabs[target].dataset.panel, true); }
  };
});
function setZoom(value) {
  const wrap = $('canvasWrap');
  const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / zoom;
  const cy = (wrap.scrollTop + wrap.clientHeight / 2) / zoom;
  zoom = Math.max(.25, Math.min(2, value));
  svg.setAttribute('width', 3000 * zoom); svg.setAttribute('height', 2000 * zoom);
  $('zoomLevel').textContent = `${Math.round(zoom * 100)}%`;
  wrap.scrollLeft = cx * zoom - wrap.clientWidth / 2;
  wrap.scrollTop = cy * zoom - wrap.clientHeight / 2;
}
function fitDiagram() {
  const wrap = $('canvasWrap');
  if (!doc.nodes.length) { setZoom(1); wrap.scrollLeft = 0; wrap.scrollTop = 0; return; }
  const left = Math.min(...doc.nodes.map(n => n.x - n.w / 2));
  const right = Math.max(...doc.nodes.map(n => n.x + n.w / 2)) + 80;
  const top = Math.min(...doc.nodes.map(n => n.y - n.h / 2));
  const bottom = Math.max(...doc.nodes.map(n => n.y + n.h / 2));
  setZoom(Math.min(1.2, (wrap.clientWidth - 70) / (right - left), (wrap.clientHeight - 100) / (bottom - top)));
  wrap.scrollLeft = (left + right) / 2 * zoom - wrap.clientWidth / 2;
  wrap.scrollTop = (top + bottom) / 2 * zoom - wrap.clientHeight / 2;
}
svg.addEventListener('focusin', ev => {
  const node = ev.target.closest('[data-node]'), edge = ev.target.closest('[data-edge]');
  if (!node && !edge) return;
  sel = node ? { type: 'node', id: node.dataset.node } : { type: 'edge', id: edge.dataset.edge };
  svg.querySelectorAll('.selected').forEach(g => g.classList.remove('selected'));
  (node ?? edge).classList.add('selected'); syncAppearance();
});
svg.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' || ev.key === ' ') {
    ev.preventDefault();
    const node = ev.target.closest('[data-node]');
    if (node && (connecting || ev.shiftKey)) chooseConnection(node.dataset.node, ev.shiftKey);
    else openEditor(sel);
  }
});
let resizeFrame;
window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(fitDiagram); });
if (window.matchMedia('(max-width: 520px)').matches) document.querySelector('.quick-guide').open = false;
$('zoomIn').onclick = () => setZoom(zoom + .1);
$('zoomOut').onclick = () => setZoom(zoom - .1);
$('fitDiagram').onclick = fitDiagram;
$('emptySample').onclick = () => $('btnSample').click();
$('exportJson').onclick = () => $('btnSave').click();
$('generatedCode').placeholder = 'Din kod visas här när du klickar på Generera.';
setDoc(doc);
