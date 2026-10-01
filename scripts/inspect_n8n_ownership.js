const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync('C:/Users/pramo/.n8n/database.sqlite', { readOnly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(({ name }) => name);
for (const table of tables.filter((name) => /workflow|project|user|role/i.test(name))) {
  console.log(`\n[${table}]`);
  console.log(db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map(({ name }) => name).join(', '));
  if (/workflow_entity|project_relation|project$/i.test(table)) {
    console.log(JSON.stringify(db.prepare(`SELECT * FROM ${JSON.stringify(table)} LIMIT 20`).all(), null, 2));
  }
}
