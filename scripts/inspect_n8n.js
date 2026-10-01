const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/pramo/.n8n/database.sqlite');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables matching webhook:');
for (const t of tables) {
  if (t.name.toLowerCase().includes('webhook')) {
    console.log(t.name, db.prepare(`SELECT * FROM ${t.name}`).all());
  }
}
