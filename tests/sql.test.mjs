import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { sampleDoc, makeNode } from '../js/model.js';
import { generateSQL, parseColumns } from '../js/sql.js';

const doc = sampleDoc('database');
const sql = generateSQL(doc);
const run = spawnSync('python', ['-c', `import sqlite3, sys
c = sqlite3.connect(':memory:')
c.execute('PRAGMA foreign_keys = ON')
c.executescript(sys.stdin.read())
c.execute("INSERT INTO customers VALUES (1, 'Ada', 'ada@example.org')")
c.execute('INSERT INTO orders (id, customer_id) VALUES (1, 1)')
assert c.execute('SELECT total FROM orders').fetchone()[0] == 0
try:
 c.execute('INSERT INTO orders (id, customer_id) VALUES (2, 99)')
 raise AssertionError('Foreign key missing')
except sqlite3.IntegrityError: pass
try:
 c.execute('DELETE FROM customers WHERE id = 1')
 raise AssertionError('Restriction missing')
except sqlite3.IntegrityError: pass
`], { input: sql, encoding: 'utf8' });
assert.equal(run.status, 0, run.stderr);
const invalid = structuredClone(doc);
invalid.edges[0].toColumn = 'name';
assert.throws(() => generateSQL(invalid), /primärnyckel|UNIQUE/);
invalid.edges[0].toColumn = 'id'; invalid.edges[0].onDelete = 'SET NULL';
assert.throws(() => generateSQL(invalid), /tillåter NULL/);
invalid.edges[0].onDelete = 'CASCADE'; invalid.edges[0].fromColumn = 'missing';
assert.throws(() => generateSQL(invalid), /giltiga/);
assert.throws(() => parseColumns('id INTEGER PK\nID TEXT'), /unika/);
assert.throws(() => parseColumns('id TEXT; DROP TABLE users'), /datatyp/);
assert.throws(() => parseColumns('id INTEGER DEFAULT 0; DROP TABLE users'), /DEFAULT/);
assert.throws(() => parseColumns('id DECIMAL(2,5)'), /storlek/);
assert.equal(parseColumns("label TEXT DEFAULT 'it''s fine'")[0].default, "'it''s fine'");
const self = { type: 'database', nodes: [makeNode('table', 100, 100, 'tree')], edges: [] };
self.nodes[0].columns = 'id INTEGER PK\nparent_id INTEGER';
self.edges.push({ id: 'self', from: self.nodes[0].id, to: self.nodes[0].id, fromColumn: 'parent_id', toColumn: 'id', onDelete: 'SET NULL' });
const composite = makeNode('table', 200, 100, 'pairs');
composite.columns = 'a INTEGER PK\nb INTEGER PK'; self.nodes.push(composite);
const extras = spawnSync('python', ['-c', `import sqlite3, sys
c=sqlite3.connect(':memory:')
c.execute('PRAGMA foreign_keys=ON')
c.executescript(sys.stdin.read())
c.execute('INSERT INTO tree VALUES (1, NULL)')
c.execute('INSERT INTO tree VALUES (2, 1)')
c.execute('DELETE FROM tree WHERE id=1')
assert c.execute('SELECT parent_id FROM tree').fetchone()[0] is None
c.execute('INSERT INTO pairs VALUES (1, 2)')
try:
 c.execute('INSERT INTO pairs VALUES (1, 2)')
 raise AssertionError('Composite PK missing')
except sqlite3.IntegrityError: pass
`], { input: generateSQL(self), encoding: 'utf8' });
assert.equal(extras.status, 0, extras.stderr);
console.log('SQL OK: körbart schema, nycklar, referensintegritet, defaultvärden, självreferens och validering.');
