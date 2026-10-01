const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dbPath = 'C:/Users/pramo/.n8n/database.sqlite';
const db = new DatabaseSync(dbPath);

// Find the active WAHA workflow
const activeWf = db.prepare("SELECT * FROM workflow_entity WHERE name LIKE '%WAHA%' AND active = 1").get();
if (!activeWf) {
  console.log('Active WAHA workflow not found by active flag, finding by name...');
}

const wfId = activeWf ? activeWf.id : 'AhiGyGASFPFfsJDC';
console.log('Targeting workflow ID:', wfId);

const jsonPath = path.join(__dirname, '..', 'WAHA_Hospital_Automation', 'WAHA_Hospital_Workflow.json');
const fileData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

// Fix expressions in fileData.nodes
for (const n of fileData.nodes) {
  if (n.name === 'Send WhatsApp Confirmation (WAHA)') {
    n.parameters.sendHeaders = true;
    n.parameters.headerParameters = {
      parameters: [
        { name: 'x-api-key', value: '62aaee3c52fd40a68de689e6319beb30' }
      ]
    };
    n.parameters.jsonBody = `={
  "session": "{{ $('Parse WAHA Payload & Guardrails').first().json.session || 'Demo1' }}",
  "chatId": "{{ $('Parse WAHA Payload & Guardrails').first().json.chat_id }}",
  "text": "🏥 *DemoCare Multispeciality Hospital*\\n\\nHello {{ $('Parse WAHA Payload & Guardrails').first().json.patient_name }}, your consultation has been successfully booked!\\n\\n📋 *Appointment Details:*\\n• Department: *{{ $('Select Next Doctor Slot').first().json.department }}*\\n• Doctor: *{{ $('Select Next Doctor Slot').first().json.doctor_name }}*\\n• Schedule: *{{ $('Select Next Doctor Slot').first().json.confirmed_slot }}*\\n• Appointment ID: *{{ $json.appointment_id }}*\\n\\n📍 *Hospital Address:* DemoCare Tower, 4th Block, Healthcare Boulevard.\\n📞 *Helpdesk:* +91-9876543210\\n\\nReply *RESCHEDULE* if you need a different time."
}`;
  }

  if (n.name === 'Send Emergency Alert via WAHA') {
    n.parameters.sendHeaders = true;
    n.parameters.headerParameters = {
      parameters: [
        { name: 'x-api-key', value: '62aaee3c52fd40a68de689e6319beb30' }
      ]
    };
    n.parameters.jsonBody = `={
  "session": "{{ $('Parse WAHA Payload & Guardrails').first().json.session || 'Demo1' }}",
  "chatId": "{{ $('Parse WAHA Payload & Guardrails').first().json.chat_id }}",
  "text": "⚠️ *URGENT MEDICAL ADVISORY — DEMOCARE HOSPITAL*\\n\\nDear {{ $('Parse WAHA Payload & Guardrails').first().json.patient_name }}, our automated triage detected signs of an acute medical emergency in your message.\\n\\n🚨 *Please immediately call our 24/7 Emergency Line:* +91-9876543210 or emergency dial 108.\\n\\n📍 Our Emergency & Trauma Wing is open 24/7 at DemoCare Multispeciality Hospital."
}`;
  }

  if (n.name === 'Webhook Acknowledge') {
    n.parameters.responseBody = `={
  "success": true,
  "status": "waha_processed",
  "recipient": "{{ $('Parse WAHA Payload & Guardrails').first().json.chat_id }}",
  "appointment_id": "{{ $json.appointment_id }}",
  "department": "{{ $('Select Next Doctor Slot').first().json.department }}",
  "confirmed_slot": "{{ $('Select Next Doctor Slot').first().json.confirmed_slot }}"
}`;
  }
}

fs.writeFileSync(jsonPath, JSON.stringify(fileData, null, 2));
console.log('✅ Updated WAHA_Hospital_Workflow.json file');

// Update in database for all WAHA workflows to be 100% sure
const wfs = db.prepare("SELECT id FROM workflow_entity WHERE name LIKE '%WAHA%'").all();
for (const w of wfs) {
  db.prepare("UPDATE workflow_entity SET nodes = ? WHERE id = ?").run(JSON.stringify(fileData.nodes), w.id);
  console.log(`✅ Updated workflow ${w.id} in database`);
}
