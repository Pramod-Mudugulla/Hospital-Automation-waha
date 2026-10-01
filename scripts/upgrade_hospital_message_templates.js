const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const replacements = [
  ['Dear ${leadInfo.full_name}, your appointment with ${slot.doctor_name} in ${slot.department} is confirmed for ${slot.slot_date} at ${slot.slot_time} at DemoCare Multispeciality Hospital. For any assistance, please contact +91-9876543210.', 'Hi ${leadInfo.full_name}, your appointment is confirmed.\\n\\n*${slot.doctor_name}* · ${slot.department}\\n${slot.slot_date} at ${slot.slot_time}\\nReference: ${appt.appointment_id}\\n\\nIf you need help before your visit, just message us here.'],
  ['Dear ${appt.patient_name || \'Patient\'}, we noticed you were unable to attend your appointment at DemoCare Multispeciality Hospital on ${appt.slot_start}. Would you like to reschedule your consultation? Please reply to this message or visit https://democare.hospital/reschedule?id=${appt.appointment_id}. We are here to assist you.', 'Hi ${appt.patient_name || \'there\'}, we missed you for your appointment on ${appt.slot_start}. Would you like us to help find another time that works for you?'],
  ['Dear patient, we hope your recovery is smooth. Please remember your follow-up window is {{ $(\'Process Discharge Data (Prompt 4)\').item.json.approved_window }}. Rate your hospital stay from 1 to 5.', 'Hi, we hope you are recovering well. A care coordinator will check in within {{ $(\'Process Discharge Data (Prompt 4)\').item.json.approved_window }}. When you have a moment, please rate your stay from 1 to 5.']
];

function upgrade(workflow) {
  for (const item of workflow.nodes || []) {
    if (item.parameters?.jsCode) {
      for (const [from, to] of replacements.slice(0, 2)) item.parameters.jsCode = item.parameters.jsCode.replace(from, to);
    }
    if (item.parameters?.jsonBody) {
      const [from, to] = replacements[2];
      item.parameters.jsonBody = item.parameters.jsonBody.replace(from, to);
    }
  }
  return workflow;
}

const dir = path.join(__dirname, '..', 'workflows');
for (const filename of ['01_lead_intake.json', '02_noshow_recovery.json', '03_discharge_followup.json', 'all_hospital_workflows.json']) {
  const file = path.join(dir, filename);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const next = Array.isArray(parsed) ? parsed.map(upgrade) : upgrade(parsed);
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
}

const db = new DatabaseSync('C:/Users/pramo/.n8n/database.sqlite');
const workflows = db.prepare("SELECT id, name, nodes FROM workflow_entity WHERE name LIKE 'HOSPITAL | %'").all();
for (const workflow of workflows) {
  const patched = upgrade({ nodes: JSON.parse(workflow.nodes) });
  db.prepare('UPDATE workflow_entity SET nodes = ? WHERE id = ?').run(JSON.stringify(patched.nodes), workflow.id);
}
console.log(`Updated templates in ${workflows.length} deployed workflow(s).`);
