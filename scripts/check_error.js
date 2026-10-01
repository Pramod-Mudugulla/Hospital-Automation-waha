const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/pramo/.n8n/database.sqlite');
const latest = db.prepare('SELECT * FROM execution_data WHERE executionId = 65').get();
const parsed = JSON.parse(latest.data);
console.log('Parsed top-level length:', parsed.length);
// n8n uses flatted or json-stringify-safe format: array of items
console.log('Error object:', parsed[4]);
console.log('Last node executed:', parsed[2]?.lastNodeExecuted || parsed[parsed[2]?.lastNodeExecuted]);
