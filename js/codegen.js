import { validate, parseExpr, compileStatements, compileIO, labelKind } from './sim.js';

const quote = JSON.stringify;
function expression(src, python) {
  parseExpr(src);
  const tokens = src.match(/"[^"]*"|'[^']*'|[\p{L}_][\p{L}\p{N}_]*|\d+(?:\.\d+)?|==|!=|<=|>=|&&|\|\||[-+*\/%()<>!]/gu) ?? [];
  let pos = 0;
  const levels = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];
  function primary() {
    const t = tokens[pos++];
    if (t === '(') { const result = binary(0); pos++; return `(${result})`; }
    if (/^["']/.test(t)) return quote(t.slice(1, -1));
    if (['true', 'sant'].includes(t)) return python ? 'True' : 'true';
    if (['false', 'falskt'].includes(t)) return python ? 'False' : 'false';
    if (/^[\p{L}_]/u.test(t)) return `v[${quote(t)}]`;
    return t;
  }
  function unary() {
    if (['!', '-'].includes(tokens[pos])) {
      const op = tokens[pos++];
      return `(${op === '!' && python ? 'not ' : op}${unary()})`;
    }
    return primary();
  }
  function binary(level) {
    if (level === levels.length) return unary();
    let left = binary(level + 1);
    while (levels[level].includes(tokens[pos])) {
      const op = tokens[pos++], right = binary(level + 1);
      const translated = python ? ({ '&&': 'and', '||': 'or' }[op] ?? op) : ({ '==': '===', '!=': '!==' }[op] ?? op);
      left = `(${left} ${translated} ${right})`;
    }
    return left;
  }
  return binary(0);
}

function algorithm(doc, python) {
  const problems = validate(doc);
  if (problems.length) throw new Error(problems.join('\n'));
  if (doc.nodes.some(n => !['start', 'end', 'process', 'decision', 'io'].includes(n.kind))) throw new Error('Algoritmen innehåller en okänd nodtyp.');
  const ids = new Map(doc.nodes.map((n, i) => [n.id, i]));
  if (ids.size !== doc.nodes.length || doc.edges.some(e => !ids.has(e.from) || !ids.has(e.to))) throw new Error('Ogiltiga nod-ID eller kopplingar.');
  const start = ids.get(doc.nodes.find(n => n.kind === 'start').id);
  const lines = python ? [
    '# Genererad från Yggdrasil. Kör med Python 3.',
    'def read_value(name):', '    raw = input(name + ": ")', '    try:', '        return float(raw) if raw.strip() else raw', '    except ValueError:', '        return raw', '',
    'def main():', '    v = {}', `    state = ${start}`, '    steps = 0', '    while state is not None:', '        steps += 1', '        if steps > 10000:', '            raise RuntimeError("För många steg")'
  ] : [
    '// Genererad från Yggdrasil. Kör i webbläsaren eller anropa main(input, output).',
    'function main(read = name => prompt(name + ":"), write = value => console.log(value)) {',
    '  const v = Object.create(null);', `  let state = ${start};`, '  let steps = 0;', '  while (state !== null) {', '    if (++steps > 10000) throw new Error("För många steg");', '    switch (state) {'
  ];
  doc.nodes.forEach((n, i) => {
    const outs = doc.edges.filter(e => e.from === n.id);
    const statements = [];
    if (n.kind === 'process') {
      compileStatements(n.text);
      for (const part of n.text.split(';').map(s => s.trim()).filter(Boolean)) {
        const [, name, src] = /^([\p{L}_][\p{L}\p{N}_]*)\s*=(?!=)\s*(.+)$/su.exec(part);
        statements.push(`v[${quote(name)}] = ${expression(src, python)}${python ? '' : ';'}`);
      }
    } else if (n.kind === 'io') {
      const io = compileIO(n.text);
      if (io.type === 'input') {
        if (python) statements.push(`v[${quote(io.name)}] = read_value(${quote(io.name)})`);
        else statements.push(`const raw${i} = read(${quote(io.name)});`, `if (raw${i} === null) throw new Error("Inmatning avbröts");`, `v[${quote(io.name)}] = String(raw${i}).trim() !== "" && !Number.isNaN(Number(raw${i})) ? Number(raw${i}) : raw${i};`);
      } else {
        const src = n.text.trim().replace(/^print\s+/i, '');
        statements.push(python ? `print(${expression(src, true)})` : `write(String(${expression(src, false)}));`);
      }
    }
    let next = n.kind === 'end' ? (python ? 'None' : 'null') : String(ids.get(outs[0]?.to));
    if (n.kind === 'decision') {
      const yes = ids.get(outs.find(e => labelKind(e.label) === 'yes').to);
      const no = ids.get(outs.find(e => labelKind(e.label) === 'no').to);
      next = python ? `${yes} if (${expression(n.text, true)}) else ${no}` : `(${expression(n.text, false)}) ? ${yes} : ${no}`;
    }
    if (python) lines.push(`        ${i === 0 ? 'if' : 'elif'} state == ${i}:`, ...statements.map(s => '            ' + s), `            state = ${next}`);
    else lines.push(`      case ${i}: {`, ...statements.map(s => '        ' + s), `        state = ${next};`, '        break;', '      }');
  });
  lines.push(...(python ? ['    return v', '', 'if __name__ == "__main__":', '    main()', ''] : ['    }', '  }', '  return v;', '}', '', '// main();', '']));
  return lines.join('\n');
}

const RESERVED = new Set(('class def return if else elif while for in pass True False None true false null new function let const var constructor self super this import export extends async await yield try catch finally throw raise delete default switch case break continue with lambda global nonlocal from as and or not is assert del except exec print input main').split(' '));
function identifier(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || RESERVED.has(name) || /^__.*__$/.test(name)) throw new Error(`Ogiltigt eller reserverat kodnamn: ${name}`);
  return name;
}
function member(line) {
  const match = /^[+\-#~]?\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z_][A-Za-z0-9_]*))?$/.exec(line.trim());
  if (!match) throw new Error(`Ogiltigt attribut/argument: ${line}`);
  return { name: identifier(match[1]), type: match[2] ?? 'object' };
}
const typeName = type => ({ string: 'str', number: 'float', boolean: 'bool', void: 'None', any: 'object' }[type] ?? type);
const rows = text => (text ?? '').split('\n').map(s => s.trim()).filter(Boolean);
function uml(doc, python) {
  if (!doc.nodes.length || doc.nodes.some(n => n.kind !== 'class')) throw new Error('Lägg till minst en UML-klass.');
  const classes = doc.nodes.map(n => ({ node: n, name: identifier(n.text.trim()), attributes: rows(n.attributes).map(member), methods: rows(n.methods).map(line => {
    const m = /^[+\-#~]?\s*([A-Za-z_][A-Za-z0-9_]*)\(([^()]*)\)\s*(?::\s*([A-Za-z_][A-Za-z0-9_]*))?$/.exec(line);
    if (!m) throw new Error(`Ogiltig metod: ${line}`);
    const params = m[2].trim() ? m[2].split(',').map(member) : [];
    if (new Set(params.map(p => p.name)).size !== params.length) throw new Error('Dubbla parameternamn.');
    return { name: identifier(m[1]), params, type: m[3] ?? 'void' };
  }) }));
  if (new Set(classes.map(c => c.name)).size !== classes.length) throw new Error('Klassnamn måste vara unika.');
  const map = new Map(classes.map(c => [c.node.id, c]));
  if (map.size !== classes.length || doc.edges.some(e => !map.has(e.from) || !map.has(e.to))) throw new Error('Ogiltiga UML-kopplingar.');
  const ordered = [], visiting = new Set(), visited = new Set();
  const visit = c => {
    if (visiting.has(c)) throw new Error('Arv får inte bilda en cirkel.');
    if (visited.has(c)) return;
    visiting.add(c);
    const parents = doc.edges.filter(e => e.from === c.node.id && e.relation === 'inheritance').map(e => map.get(e.to));
    if (parents.length > 1) throw new Error('Endast enkelarv stöds.');
    c.parent = parents[0];
    if (c.parent) visit(c.parent);
    visiting.delete(c); visited.add(c); ordered.push(c);
  };
  classes.forEach(visit);
  const lines = python ? ['# UML-klasskelett. Implementera metodernas innehåll.', 'from __future__ import annotations', ''] : ['// UML-klasskelett. Implementera metodernas innehåll.', ''];
  for (const c of ordered) {
    const names = [...c.attributes, ...c.methods].map(m => m.name);
    if (new Set(names).size !== names.length) throw new Error(`Dubbla medlemsnamn i ${c.name}.`);
    for (const e of doc.edges.filter(e => e.from === c.node.id && e.relation !== 'inheritance')) lines.push(`${python ? '#' : '//'} Association: ${c.name} -> ${map.get(e.to).name}${e.label ? ' (' + e.label.replace(/[\r\n]/g, ' ') + ')' : ''}`);
    if (python) {
      lines.push(`class ${c.name}${c.parent ? '(' + c.parent.name + ')' : ''}:`, '    def __init__(self):');
      if (c.parent) lines.push('        super().__init__()');
      c.attributes.forEach(a => lines.push(`        self.${a.name}: ${typeName(a.type)} = None`));
      if (!c.parent && !c.attributes.length) lines.push('        pass');
      c.methods.forEach(m => lines.push('', `    def ${m.name}(self${m.params.map(p => ', ' + p.name + ': ' + typeName(p.type)).join('')}) -> ${typeName(m.type)}:`, '        raise NotImplementedError("Implementera metoden")'));
      lines.push('');
    } else {
      lines.push(`class ${c.name}${c.parent ? ' extends ' + c.parent.name : ''} {`, '  constructor() {');
      if (c.parent) lines.push('    super();');
      c.attributes.forEach(a => lines.push(`    this.${a.name} = null; // ${a.type}`));
      lines.push('  }');
      c.methods.forEach(m => lines.push('', `  ${m.name}(${m.params.map(p => p.name).join(', ')}) {`, '    throw new Error("Implementera metoden");', '  }'));
      lines.push('}', '');
    }
  }
  return lines.join('\n');
}
export function generateCode(doc, language) {
  if (!['python', 'javascript'].includes(language)) throw new Error('Välj Python eller JavaScript.');
  if (doc.type === 'algorithm') return algorithm(doc, language === 'python');
  if (doc.type === 'uml') return uml(doc, language === 'python');
  throw new Error('Kodgenerering stöds för algoritmdiagram och UML-klassdiagram.');
}
