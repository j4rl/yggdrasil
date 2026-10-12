// SQL-schema med tabeller, nycklar och referensintegritet.
const TYPES = /^(INTEGER|INT|BIGINT|SMALLINT|TEXT|REAL|FLOAT|DOUBLE|BOOLEAN|DATE|DATETIME|TIMESTAMP|BLOB|VARCHAR\(\d+\)|CHAR\(\d+\)|DECIMAL\(\d+,\d+\)|NUMERIC(?:\(\d+(?:,\d+)?\))?)(?=\s|$)/i;
const ACTIONS = new Set(['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION']);
function sqlName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Ogiltigt SQL-namn: ${name}. Använd bokstäver A–Z, siffror och understreck.`);
  return name;
}
const quoted = name => `"${sqlName(name)}"`;

export function parseColumns(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Tabellen behöver minst en kolumn.');
  const columns = text.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const nameMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/.exec(line);
    if (!nameMatch) throw new Error(`Ogiltig kolumn: ${line}. Använd namn TYPE.`);
    const name = sqlName(nameMatch[1]);
    const rest = nameMatch[2].replace(/\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/g, (_, a, b) => `(${a}${b === undefined ? '' : ',' + b})`);
    const typeMatch = TYPES.exec(rest);
    if (!typeMatch) throw new Error(`Ogiltig datatyp för ${name}.`);
    const type = typeMatch[1].toUpperCase();
    const dimensions = type.match(/\d+/g)?.map(Number) ?? [];
    if (dimensions.some(n => !Number.isSafeInteger(n)) || (dimensions.length && dimensions[0] < 1) || (dimensions.length === 2 && dimensions[1] > dimensions[0])) throw new Error(`Ogiltig storlek för ${name}.`);
    let tail = rest.slice(typeMatch[0].length).trim();
    const column = { name, type, primary: false, notNull: false, unique: false, default: null };
    const used = new Set();
    while (tail) {
      const constraint = /^(PRIMARY KEY|PK|NOT NULL|UNIQUE|DEFAULT)(?=\s|$)/i.exec(tail);
      if (!constraint) throw new Error(`Okänd inställning för ${name}: ${tail}`);
      const key = constraint[1].toUpperCase().replace('PRIMARY KEY', 'PK');
      if (used.has(key)) throw new Error(`Dubblerad inställning ${key} för ${name}.`);
      used.add(key); tail = tail.slice(constraint[0].length).trim();
      if (key === 'PK') column.primary = true;
      if (key === 'NOT NULL') column.notNull = true;
      if (key === 'UNIQUE') column.unique = true;
      if (key === 'DEFAULT') {
        const value = /^(?:'(?:[^']|'')*'|-?\d+(?:\.\d+)?|NULL|TRUE|FALSE|CURRENT_TIMESTAMP)(?=\s|$)/i.exec(tail);
        if (!value) throw new Error(`Ogiltigt DEFAULT-värde för ${name}.`);
        column.default = value[0]; tail = tail.slice(value[0].length).trim();
      }
    }
    if ((column.primary || column.notNull) && /^null$/i.test(column.default ?? '')) throw new Error(`DEFAULT NULL kan inte användas för ${name}.`);
    return column;
  });
  if (new Set(columns.map(c => c.name.toLowerCase())).size !== columns.length) throw new Error('Kolumnnamn måste vara unika i tabellen.');
  return columns;
}

export function generateSQL(doc) {
  if (doc.type !== 'database' || !doc.nodes.length || doc.nodes.some(n => n.kind !== 'table')) throw new Error('Lägg till minst en tabell i ett databasdiagram.');
  const tables = doc.nodes.map(node => ({ node, name: sqlName(node.text.trim()), columns: parseColumns(node.columns) }));
  if (new Set(tables.map(t => t.name.toLowerCase())).size !== tables.length) throw new Error('Tabellnamn måste vara unika.');
  if (tables.some(t => /^sqlite_/i.test(t.name))) throw new Error('Tabellnamn med sqlite_ är reserverade av SQLite.');
  const map = new Map(tables.map(t => [t.node.id, t]));
  if (map.size !== tables.length) throw new Error('Tabellernas ID måste vara unika.');
  const references = new Map(tables.map(t => [t.node.id, []]));
  const used = new Set();
  for (const edge of doc.edges) {
    const source = map.get(edge.from), target = map.get(edge.to);
    if (!source || !target) throw new Error('En relation refererar till en tabell som saknas.');
    const from = source.columns.find(c => c.name === edge.fromColumn), to = target.columns.find(c => c.name === edge.toColumn);
    if (!from || !to) throw new Error(`Välj giltiga käll- och målkolumner för ${source.name} → ${target.name}.`);
    if (!to.unique && !(to.primary && target.columns.filter(c => c.primary).length === 1)) throw new Error(`${target.name}.${to.name} måste vara en ensam primärnyckel eller UNIQUE.`);
    if (from.type !== to.type) throw new Error(`Datatyperna för ${source.name}.${from.name} och ${target.name}.${to.name} måste matcha.`);
    const action = edge.onDelete ?? 'RESTRICT';
    if (!ACTIONS.has(action)) throw new Error('Ogiltig ON DELETE-inställning.');
    if (action === 'SET NULL' && (from.notNull || from.primary)) throw new Error(`SET NULL kräver att ${source.name}.${from.name} tillåter NULL.`);
    const key = JSON.stringify([edge.from, from.name]);
    if (used.has(key)) throw new Error(`${source.name}.${from.name} har flera referenser. Använd separata kolumner.`);
    used.add(key);
    references.get(edge.from).push(`FOREIGN KEY (${quoted(from.name)}) REFERENCES ${quoted(target.name)} (${quoted(to.name)}) ON DELETE ${action}`);
  }
  const lines = ['-- Genererat från Yggdrasil. SQL-schema för SQLite.', '-- Aktivera foreign_keys i SQLite-anslutningen för att kontrollera relationer.', ''];
  for (const table of tables) {
    const definitions = table.columns.map(c => `${quoted(c.name)} ${c.type}${c.notNull || c.primary ? ' NOT NULL' : ''}${c.unique ? ' UNIQUE' : ''}${c.default !== null ? ' DEFAULT ' + c.default : ''}`);
    const primary = table.columns.filter(c => c.primary);
    if (primary.length) definitions.push(`PRIMARY KEY (${primary.map(c => quoted(c.name)).join(', ')})`);
    definitions.push(...references.get(table.node.id));
    lines.push(`CREATE TABLE ${quoted(table.name)} (`, definitions.map(d => '  ' + d).join(',\n'), ');', '');
  }
  return lines.join('\n');
}
