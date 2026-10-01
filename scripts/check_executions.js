const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/pramo/.n8n/database.sqlite');
const execs = db.prepare('SELECT id, workflowId, mode, status, startedAt, stoppedAt FROM execution_entity ORDER BY startedAt DESC LIMIT 5').all();
console.log('Recent Executions:', execs);

if (execs.length > 0) {
  const latest = db.prepare('SELECT * FROM execution_data WHERE executionId = ?').get(execs[0].id);
  if (latest) {
    console.log('Execution Data keys:', Object.keys(latest));
    // Check if error or resultData exists
    try {
      const parsed = JSON.parse(latest.data);
      console.log('Result Data:', JSON.stringify(parsed.resultData, null, 2).slice(0, 1000));
    } catch (e) {
      console.log('Raw data preview:', (latest.data || '').slice(0, 500));
    }
  }
}
