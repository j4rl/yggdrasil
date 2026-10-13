import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

// Load browser modules without requiring a package-wide Node module setting.
const urls = new Map();
function moduleUrl(file) {
  if (!urls.has(file)) {
    const source = readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8')
      .replace(/from '\.\/([^']+)'/g, (_, dependency) => `from '${moduleUrl(dependency)}'`);
    urls.set(file, `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  }
  return urls.get(file);
}
const { parseExpr } = await import(moduleUrl('sim.js'));
const { generateCode } = await import(moduleUrl('codegen.js'));
const cases = [
  ['sqrt(25)', 5], ['abs(-8)', 8], ['pow(2, 3)', 8],
  ['round(-1.5)', -1], ['floor(3.8)', 3], ['ceil(3.2)', 4],
  ['min(4, 9)', 4], ['max(4, 9)', 9], ['sin(rad(30))', .5],
  ['cos(rad(60))', .5], ['tan(rad(45))', 1], ['deg(rad(180))', 180],
  ['ln(8) / ln(2)', 3], ['log10(100)', 2], ['exp(2)', Math.exp(2)],
  ['2 * sqrt(pow(3, 2) + pow(4, 2))', 10],
];
for (const [expression, expected] of cases) {
  assert.ok(Math.abs(parseExpr(expression)({}) - expected) < 1e-10, expression);
}
for (const invalid of ['sqrt(-1)', 'ln(0)', 'log10(-2)', 'abs("text")']) {
  assert.throws(() => parseExpr(invalid)({}));
}
for (const invalid of ['random(1)', 'pow(2)', 'sqrt(1, 2)', 'unknown(3)', 'constructor(3)', 'sin(1,)', 'sqrt(4']) {
  assert.throws(() => parseExpr(invalid));
}
assert.equal(parseExpr('sqrt(x)')({ x: 9 }), 3);
const doc = {
  type: 'algorithm',
  nodes: [{ id: 's', kind: 'start', text: 'Start' }, {
    id: 'p', kind: 'process',
    text: cases.map(([expression], i) => `r${i} = ${expression}`).join(';') + ';slump = random();tarning = floor(random() * 6) + 1',
  }, { id: 'e', kind: 'end', text: 'Slut' }],
  edges: [{ from: 's', to: 'p' }, { from: 'p', to: 'e' }],
};
const context = vm.createContext({});
vm.runInContext(generateCode(doc, 'javascript'), context);
const javascript = context.main();
const pythonSource = generateCode(doc, 'python').replace("if __name__ == \"__main__\":\n    main()", 'import json\nprint(json.dumps(main()))');
const python = spawnSync('python', ['-c', pythonSource], { encoding: 'utf8' });
assert.equal(python.status, 0, python.stderr);
const exported = JSON.parse(python.stdout);
for (const result of [javascript, exported]) {
  cases.forEach(([, expected], i) => assert.ok(Math.abs(result[`r${i}`] - expected) < 1e-10));
  assert.ok(result.slump >= 0 && result.slump < 1);
  assert.ok(Number.isInteger(result.tarning) && result.tarning >= 1 && result.tarning <= 6);
}
// Verify every library example is accepted by the simulator.
const mainSource = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const examples = mainSource.slice(mainSource.indexOf('const arithmeticExamples = ['), mainSource.indexOf('for (const [target, examples]'));
const library = vm.runInNewContext(examples + '\nfunctionExamples');
const { compileStatements } = await import(moduleUrl('sim.js'));
for (const rows of Object.values(library)) for (const [, example] of rows) {
  compileStatements(example).forEach(run => run({ i: 0 }));
}
console.log('Math, library examples, JavaScript and Python export checks passed.');
