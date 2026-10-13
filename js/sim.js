import { YES, NO } from './model.js';
import { MATH_FUNCTIONS } from './math.js';

// Säker uttrycksutvärderare (ingen eval).
const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|("[^"]*"|'[^']*')|([\p{L}_][\p{L}\p{N}_]*)|(==|!=|<=|>=|&&|\|\||[-+*\/%(),<>!]))/uy;
const LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

function tokenize(src) {
  const tokens = [];
  let pos = 0;
  while (pos < src.length && /\S/.test(src.slice(pos))) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`Ogiltigt tecken vid "${src.slice(pos).trim().slice(0, 10)}"`);
    if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'str', v: m[2].slice(1, -1) });
    else if (m[3] !== undefined) tokens.push({ t: 'id', v: m[3] });
    else tokens.push({ t: 'op', v: m[4] });
    pos = TOKEN.lastIndex;
  }
  return tokens;
}

export function parseExpr(src) {
  const tokens = tokenize(src);
  let i = 0;
  const peekOp = (ops) => tokens[i]?.t === 'op' && ops.includes(tokens[i].v);

  function primary() {
    const tk = tokens[i++];
    if (!tk) throw new Error('Uttrycket slutar för tidigt');
    if (tk.t === 'num' || tk.t === 'str') return () => tk.v;
    if (tk.t === 'id') {
      if (peekOp(['('])) {
        const fn = Object.hasOwn(MATH_FUNCTIONS, tk.v) ? MATH_FUNCTIONS[tk.v] : null;
        if (!fn) throw new Error(`Okänd matematisk funktion: ${tk.v}`);
        i++;
        const args = [];
        if (!peekOp([')'])) {
          args.push(binary(0));
          while (peekOp([','])) { i++; args.push(binary(0)); }
        }
        if (!peekOp([')'])) throw new Error('Saknar )');
        i++;
        if (args.length !== fn.args) throw new Error(`${tk.v} kräver ${fn.args} argument`);
        return vars => {
          const values = args.map(arg => arg(vars));
          if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${tk.v} kräver ändliga tal`);
          const result = fn.run(...values);
          if (!Number.isFinite(result)) throw new Error(`Ogiltigt värde för ${tk.v}`);
          return result;
        };
      }
      if (tk.v === 'true' || tk.v === 'sant') return () => true;
      if (tk.v === 'false' || tk.v === 'falskt') return () => false;
      return (vars) => {
        if (!(tk.v in vars)) throw new Error(`Variabeln "${tk.v}" saknar värde`);
        return vars[tk.v];
      };
    }
    if (tk.v === '(') {
      const e = binary(0);
      if (!peekOp([')'])) throw new Error('Saknar )');
      i++;
      return e;
    }
    throw new Error(`Oväntat "${tk.v}"`);
  }
  function unary() {
    if (peekOp(['!', '-'])) {
      const op = tokens[i++].v;
      const e = unary();
      return op === '!' ? (v) => !e(v) : (v) => -e(v);
    }
    return primary();
  }
  function binary(l) {
    if (l === LEVELS.length) return unary();
    let left = binary(l + 1);
    while (peekOp(LEVELS[l])) {
      const op = tokens[i++].v;
      const a = left;
      const b = binary(l + 1);
      left = combine(op, a, b);
    }
    return left;
  }
  const fn = binary(0);
  if (i < tokens.length) throw new Error(`Oväntat "${tokens[i].v}"`);
  return fn;
}

function combine(op, a, b) {
  switch (op) {
    case '||': return (v) => a(v) || b(v);
    case '&&': return (v) => a(v) && b(v);
    case '==': return (v) => a(v) === b(v);
    case '!=': return (v) => a(v) !== b(v);
    case '<': return (v) => a(v) < b(v);
    case '<=': return (v) => a(v) <= b(v);
    case '>': return (v) => a(v) > b(v);
    case '>=': return (v) => a(v) >= b(v);
    case '+': return (v) => a(v) + b(v);
    case '-': return (v) => a(v) - b(v);
    case '*': return (v) => a(v) * b(v);
    case '/': return (v) => { const d = b(v); if (d === 0) throw new Error('Division med noll'); return a(v) / d; };
    default: return (v) => { const d = b(v); if (d === 0) throw new Error('Division med noll'); return a(v) % d; };
  }
}

const ASSIGN = /^([\p{L}_][\p{L}\p{N}_]*)\s*=(?!=)\s*(.+)$/su;

export function compileStatements(src) {
  const parts = src.split(';').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Tom process');
  return parts.map((p) => {
    const m = ASSIGN.exec(p);
    if (!m) throw new Error(`Ogiltig sats: "${p}" (använd namn = uttryck)`);
    const expr = parseExpr(m[2]);
    return (vars) => { vars[m[1]] = expr(vars); };
  });
}

const INPUT = /^input\s+([\p{L}_][\p{L}\p{N}_]*)$/iu;
const PRINT = /^print\s+(.+)$/is;

export function compileIO(src) {
  const s = src.trim();
  let m = INPUT.exec(s);
  if (m) return { type: 'input', name: m[1] };
  m = PRINT.exec(s);
  if (m) return { type: 'print', expr: parseExpr(m[1]) };
  throw new Error('In/Ut ska vara "input namn" eller "print uttryck"');
}

export const labelKind = (l) => {
  const s = (l || '').trim().toLowerCase();
  return YES.includes(s) ? 'yes' : NO.includes(s) ? 'no' : null;
};

// Semantisk kontroll av algoritmflödesschema.
export function validate(doc) {
  const problems = [];
  const outs = (id) => doc.edges.filter((e) => e.from === id);
  const starts = doc.nodes.filter((n) => n.kind === 'start');
  if (starts.length !== 1) problems.push(`Det ska finnas exakt en Start (hittade ${starts.length})`);
  if (!doc.nodes.some((n) => n.kind === 'end')) problems.push('Det saknas en Slut');
  for (const n of doc.nodes) {
    const o = outs(n.id);
    const name = `"${n.text.replace(/\s+/g, ' ').slice(0, 20)}"`;
    try {
      if (n.kind === 'process') compileStatements(n.text);
      if (n.kind === 'io') compileIO(n.text);
      if (n.kind === 'decision') parseExpr(n.text);
    } catch (e) { problems.push(`${name}: ${e.message}`); }
    if (n.kind === 'end' && o.length) problems.push(`${name}: Slut får inte ha utgående pilar`);
    else if (n.kind === 'decision') {
      const k = o.map((e) => labelKind(e.label));
      if (!k.includes('yes') || !k.includes('no') || o.length !== 2) problems.push(`${name}: villkor behöver en Ja- och en Nej-pil`);
    } else if (n.kind !== 'end' && o.length !== 1) problems.push(`${name}: ska ha exakt en utgående pil`);
  }
  if (starts.length === 1) {
    const seen = new Set([starts[0].id]);
    const stack = [starts[0].id];
    while (stack.length) for (const e of outs(stack.pop())) if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); }
    for (const n of doc.nodes) if (!seen.has(n.id)) problems.push(`"${n.text.slice(0, 20)}" nås aldrig från Start`);
  }
  return problems;
}

export class Simulator {
  constructor(doc, io) {
    this.doc = doc;
    this.io = io;
    this.reset();
  }

  reset() {
    const start = this.doc.nodes.find((n) => n.kind === 'start');
    this.vars = {};
    this.current = start ? start.id : null;
    this.visited = new Set();
    this.steps = 0;
    this.done = !start;
    this.error = start ? null : 'Start saknas';
  }

  step() {
    if (this.done) return;
    const node = this.doc.nodes.find((n) => n.id === this.current);
    if (!node) { this.fail('Noden finns inte'); return; }
    if (++this.steps > 10000) { this.fail('För många steg (möjlig oändlig loop)'); return; }
    try {
      const outs = this.doc.edges.filter((e) => e.from === node.id);
      let next = outs[0];
      if (node.kind === 'end') { this.finish(node); return; }
      if (node.kind === 'process') compileStatements(node.text).forEach((run) => run(this.vars));
      else if (node.kind === 'io') this.runIO(node);
      else if (node.kind === 'decision') {
        const want = parseExpr(node.text)(this.vars) ? 'yes' : 'no';
        next = outs.find((e) => labelKind(e.label) === want);
        if (!next) throw new Error(`Villkoret saknar ${want === 'yes' ? 'Ja' : 'Nej'}-pil`);
      }
      this.visited.add(node.id);
      if (!next) throw new Error('Noden saknar utgående pil');
      this.current = next.to;
    } catch (e) {
      this.fail(e.message);
    }
  }

  runIO(node) {
    const c = compileIO(node.text);
    if (c.type === 'print') { this.io.print(String(c.expr(this.vars))); return; }
    const raw = this.io.input(c.name);
    if (raw === null) throw new Error('Inmatning avbröts');
    this.vars[c.name] = raw.trim() !== '' && !isNaN(Number(raw)) ? Number(raw) : raw;
  }

  finish(node) {
    this.visited.add(node.id);
    this.done = true;
  }

  fail(msg) {
    this.error = msg;
    this.done = true;
  }
}
