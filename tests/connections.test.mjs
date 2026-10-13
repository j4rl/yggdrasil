import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function connect(a, b)'), source.indexOf('function deleteSelected()'));
let counter = 0;
const instruction = {};
const context = vm.createContext({
  doc: { type: 'flowchart', nodes: [{ id: 'a', kind: 'process' }, { id: 'b', kind: 'process' }, { id: 'c', kind: 'process' }], edges: [] },
  connecting: true, connectFrom: null, sel: null,
  uid: () => `e${++counter}`,
  stopSim() {}, render() {}, showPanel() {},
  openEditor(selection) { context.edited = selection; },
  $: () => instruction,
});
vm.runInContext('const byId = id => doc.nodes.find(n => n.id === id);\n' + functions, context);
const choose = (id, shift = false) => context.chooseConnection(id, shift);

choose('a');
assert.equal(context.connectFrom, 'a');
assert.equal(context.doc.edges.length, 0);
choose('a');
assert.equal(context.connecting, true);
assert.equal(context.doc.edges.length, 0);
choose('b');
assert.equal(context.doc.edges.length, 1);
assert.equal(context.doc.edges[0].from, 'a');
assert.equal(context.doc.edges[0].to, 'b');
assert.equal(context.connecting, false);
assert.equal(context.sel.type, 'edge');

choose('a');
choose('b');
assert.equal(context.doc.edges.length, 1);
assert.equal(context.connectFrom, 'a');
assert.equal(context.connecting, true);
choose('c');
assert.equal(context.doc.edges.length, 2);
assert.equal(context.connect('missing', 'a'), null);

context.doc.edges = [];
context.sel = { type: 'node', id: 'a' };
choose('b', true);
assert.equal(context.doc.edges[0].from, 'a');
assert.equal(context.connecting, false);

context.doc.type = 'algorithm';
context.doc.nodes[0].kind = 'decision';
context.doc.edges = [];
context.connect('a', 'b');
context.connect('a', 'c');
assert.equal(context.doc.edges[0].label, 'Ja');
assert.equal(context.doc.edges[1].label, 'Nej');

context.doc.type = 'database';
context.doc.edges = [];
choose('a');
choose('a');
assert.equal(context.doc.edges.length, 1);
assert.equal(context.edited.id, context.doc.edges[0].id);
choose('a');
choose('a');
assert.equal(context.doc.edges.length, 2);

// Exercise the keyboard listener with the same connection flow as pointer clicks.
context.svg = { addEventListener(type, listener) { context.keyboardListener = listener; } };
const keyboardStart = source.indexOf("svg.addEventListener('keydown'");
vm.runInContext(source.slice(keyboardStart, source.indexOf('let resizeFrame;', keyboardStart)), context);
context.doc.type = 'flowchart';
context.doc.edges = [];
context.connecting = true;
context.connectFrom = null;
const key = (id, value) => context.keyboardListener({
  key: value, shiftKey: false, preventDefault() {},
  target: { closest: () => ({ dataset: { node: id } }) },
});
key('a', 'Enter');
key('b', ' ');
assert.equal(context.doc.edges.length, 1);
assert.equal(context.doc.edges[0].from, 'a');
assert.equal(context.doc.edges[0].to, 'b');
console.log('Connection checks passed.');
