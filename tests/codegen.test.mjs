import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { sampleDoc, autoLayout } from '../js/model.js';
import { generateCode } from '../js/codegen.js';

function runAlgorithm(doc, input) {
  const context = vm.createContext({});
  vm.runInContext(generateCode(doc, 'javascript'), context);
  const output = [];
  context.main(() => String(input), s => output.push(s));
  const py = spawnSync('python', ['-c', generateCode(doc, 'python')], { input: `${input}\n`, encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  return { js: output, py: py.stdout };
}
const algorithm = sampleDoc('algorithm');
for (const [input, expected] of [[5, 15], [0, 0], [1, 1]]) {
  const result = runAlgorithm(algorithm, input);
  assert.deepEqual(result.js, [String(expected)]);
  assert.match(result.py, new RegExp(`${expected}(?:\\.0)?\\s*$`));
}
algorithm.nodes.find(n => n.kind === 'decision').text = '!(i > n) && true';
assert.deepEqual(runAlgorithm(algorithm, 5).js, ['15']);
assert.match(runAlgorithm(algorithm, 5).py, /15(?:\.0)?\s*$/);
const invalid = structuredClone(algorithm);
invalid.edges = invalid.edges.filter(e => e.label !== 'Nej');
assert.throws(() => generateCode(invalid, 'python'), /Nej/);
const uml = sampleDoc('uml');
for (const language of ['python', 'javascript']) {
  const code = generateCode(uml, language);
  if (language === 'python') {
    const result = spawnSync('python', ['-c', code + '\ns = Student()\nassert isinstance(s, Person)\nassert s.name is None\nassert s.school is None\n'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } else vm.runInNewContext(code + '\nif (!(new Student() instanceof Person)) throw new Error("Inheritance");');
}
uml.nodes[0].methods = 'greet(x: str, x: str): str';
assert.throws(() => generateCode(uml, 'python'), /parameternamn/);
uml.nodes[0].methods = '';
uml.edges.push({ id: 'cycle', from: uml.nodes[0].id, to: uml.nodes[1].id, relation: 'inheritance' });
assert.throws(() => generateCode(uml, 'javascript'), /cirkel/);
const mindmap = sampleDoc('mindmap');
autoLayout(mindmap);
assert(mindmap.nodes.some(n => n.x < mindmap.nodes[0].x));
assert(mindmap.nodes.some(n => n.x > mindmap.nodes[0].x));
assert(mindmap.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
console.log('Kodgenerering: Python/JavaScript, grenar, loopar, logik, UML-arv, felhantering och mindmap OK.');
