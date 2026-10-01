const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/pramo/.n8n/database.sqlite');
console.log('Columns:', db.prepare("PRAGMA table_info('webhook_entity')").all());

// Delete old orphaned webhook records
db.prepare("DELETE FROM webhook_entity").run();

// Insert the exact webhook paths for the active workflows
db.prepare(`
  INSERT INTO webhook_entity (workflowId, webhookPath, method, node, webhookId, pathLength)
  VALUES 
    ('oL0cAUZ4jMAINSur', 'hospital-demo-lead', 'POST', 'Webhook Lead In', 'hospital-demo-lead', 18),
    ('k2tcaGFSsA12MUBq', 'hospital-demo-noshow', 'POST', 'Webhook No-Show In', 'hospital-demo-noshow', 20),
    ('NNVsQXAR4E8ywM95', 'hospital-demo-discharge', 'POST', 'Webhook Discharge In', 'hospital-demo-discharge', 22)
`).run();

console.log('Updated webhook_entity:', db.prepare("SELECT * FROM webhook_entity").all());
