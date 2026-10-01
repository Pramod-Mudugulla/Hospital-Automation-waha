const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dbPath = 'C:/Users/pramo/.n8n/database.sqlite';
const db = new DatabaseSync(dbPath);

const wf = db.prepare("SELECT * FROM workflow_entity WHERE id = 'EGVERjnxRz6o7mmt'").get();
if (!wf) {
  console.error('Workflow EGVERjnxRz6o7mmt not found');
  process.exit(1);
}

const nodes = JSON.parse(wf.nodes);

for (const n of nodes) {
  if (n.name === 'Send WhatsApp Confirmation (WAHA)' || n.name === 'Send Emergency Alert via WAHA') {
    n.parameters.sendHeaders = true;
    n.parameters.headerParameters = {
      parameters: [
        { name: 'x-api-key', value: '62aaee3c52fd40a68de689e6319beb30' }
      ]
    };
    if (n.parameters.jsonBody) {
      n.parameters.jsonBody = n.parameters.jsonBody.replace(
        '"session": "{{ $json.session }}"',
        '"session": "{{ $json.session || \'Demo1\' }}"'
      );
    }
  }
}

db.prepare("UPDATE workflow_entity SET nodes = ? WHERE id = 'EGVERjnxRz6o7mmt'").run(JSON.stringify(nodes));
console.log('✅ Successfully updated active WAHA workflow in n8n database!');

// Also update the WAHA_Hospital_Workflow.json file
const jsonPath = path.join(__dirname, '..', 'WAHA_Hospital_Automation', 'WAHA_Hospital_Workflow.json');
const fileData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
fileData.nodes = nodes;
fs.writeFileSync(jsonPath, JSON.stringify(fileData, null, 2));
console.log('✅ Successfully updated WAHA_Hospital_Workflow.json file as well!');
