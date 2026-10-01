const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const workflowPath = path.join(__dirname, '..', 'WAHA_Hospital_Automation', 'WAHA_Hospital_Workflow.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const node = (name) => workflow.nodes.find((item) => item.name === name);
const code = (name, lines) => { node(name).parameters.jsCode = lines.join('\n'); };

if (!node('Choose Requested Slot')) {
  workflow.nodes.push({
    parameters: { jsCode: '' }, name: 'Choose Requested Slot', type: 'n8n-nodes-base.code',
    typeVersion: 2, position: [1040, 380]
  });
}

code('Parse WhatsApp & Guardrails', [
  "const cfgNode = $('Hospital & AI Settings').first().json;",
  'const body = cfgNode.inbound_raw.body || cfgNode.inbound_raw;',
  'const payload = body.payload || {};',
  "if (body.event !== 'message' || payload.fromMe === true) return [];",
  "const sender = payload.from || '';",
  "const phone = sender.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@lid', '');",
  "const text = String(payload.body || '').trim();",
  'if (!phone || !text) return [];',
  "const emergency = /chest pain|heart attack|trouble breathing|cannot breathe|unconscious|heavy bleeding|stroke|seizure/i.test(text);",
  "let department = '';",
  "if (/skin|rash|allergy|acne|face|itch|dermat|bump|pimple/i.test(text)) department = 'Dermatology';",
  "else if (/heart|cardio|chest|bp|pulse|palpitat/i.test(text)) department = 'Cardiology';",
  "else if (/bone|joint|fracture|knee|ortho|leg|back pain|sprain|ankle|hip|shoulder/i.test(text)) department = 'Orthopedics';",
  "else if (/fever|cough|cold|headache|stomach|flu|vomit|general|diabetes|infection/i.test(text)) department = 'General Medicine';",
  'return [{ json: {',
  "  session: body.session || 'Demo1', chat_id: sender, phone,",
  "  patient_name: payload._data?.notifyName || payload.notifyName || 'there',",
  '  inquiry_text: text, inbound_message_id: payload.id || null, department,',
  "  is_emergency: emergency, correlation_id: `WAHA-${Date.now()}-${Math.floor(Math.random() * 10000)}`",
  '} }];'
]);

code('Choose Requested Slot', [
  "const patient = $('Parse WhatsApp & Guardrails').first().json;",
  "const slots = $input.first().json.available_slots || [];",
  'const text = patient.inquiry_text.toLowerCase();',
  "const wantsBooking = /\\b(book|confirm|reserve|schedule)\\b/.test(text);",
  "const time = text.match(/\\b(?:0?[1-9]|1[0-2])(?::[0-5]\\d)?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)\\b/i)?.[0]?.replace(/\\./g, '').replace(/\\s+/g, ' ').toUpperCase();",
  "const doctor = slots.find((slot) => text.includes(slot.doctor_name.replace(/^Dr\\.\\s*/i, '').toLowerCase()));",
  'const timeMatches = time ? slots.filter((slot) => slot.slot_time.replace(/\\./g, \'\').toUpperCase() === time) : [];',
  'const selected_slot = doctor || (timeMatches.length === 1 ? timeMatches[0] : null);',
  'return [{ json: { ...$input.first().json, selected_slot, is_booking_request: wantsBooking && !!selected_slot } }];'
]);

code('Draft AI Message Prompt', [
  "const cfg = $('Hospital & AI Settings').first().json;",
  "const patient = $('Parse WhatsApp & Guardrails').first().json;",
  "const selection = $('Choose Requested Slot').first().json;",
  "const history = $('Fetch Conversation History').first().json.messages || [];",
  'const slots = (selection.available_slots || []).slice(0, 4);',
  "const slotInfo = slots.length ? slots.map((s) => `- ${s.doctor_name} (${s.department}): ${s.slot_date} at ${s.slot_time}`).join('\\n') : '- No matching online slots are currently available.';",
  "const booked = (() => { try { return $('Book Appointment in DB').first().json; } catch { return null; } })();",
  "const bookingNote = booked?.appointment_id ? `\\nA booking is confirmed: ${booked.appointment_id} for ${selection.selected_slot.doctor_name} on ${selection.selected_slot.slot_date} at ${selection.selected_slot.slot_time}.` : '';",
  "const system = `You are ${cfg.coordinatorName}, the WhatsApp reception coordinator at ${cfg.hospitalName}. You are continuing one private patient conversation.\\n\\nSafety and style rules:\\n- Reply only as the coordinator. Never write a patient message, a speaker label, a heading, or quotation marks.\\n- Use 1-3 short, natural sentences. Plain text only; use a line break only for confirmed appointment details.\\n- Never invent symptoms, names, prior statements, doctors, dates, or appointments. If the patient only greets you, greet them and ask one open question.\\n- If they correct an assumption, apologise briefly and reset the conversation.\\n- For symptoms, acknowledge the concern without diagnosing. Use respectful medical terms for sensitive areas. Recommend a consultation only after they describe the concern.\\n- Offer at most two relevant real slots. Do not book or imply a booking unless BOOKING CONFIRMED appears below.\\n- Do not ask patients to press keys or use canned commands.\\n\\nAvailable slots:\\n${slotInfo}${bookingNote}`;",
  'const messages = [{ role: \'system\', content: system }, ...history.map(({ role, content }) => ({ role, content })), { role: \'user\', content: patient.inquiry_text }];',
  "return [{ json: { model: cfg.ollamaModel, messages, session: patient.session, chat_id: patient.chat_id, phone: patient.phone, patient_name: patient.patient_name, patient_message: patient.inquiry_text, inbound_message_id: patient.inbound_message_id } }];"
]);

code('Format Human Reply', [
  "const prev = $('Draft AI Message Prompt').first().json;",
  "let text = String($input.first().json.message?.content || $input.first().json.response || '')",
  "  .replace(/^(here(?:'s| is)|sure)[^:]*:\\s*/i, '')",
  "  .replace(/^(sarah|assistant|[A-Z][a-z]+(?: [A-Z][a-z]+)*):\\s*/i, '')",
  "  .replace(/^[\\\"'`]+|[\\\"'`]+$/g, '').trim();",
  'const normalized = prev.patient_message.trim().toLowerCase();',
  "if (/^(hi|hello|hey)[!. ]*$/.test(normalized)) text = `Hi ${prev.patient_name} — how can I help today?`;",
  "if (/haven't mentioned|have not mentioned|didn't mention|did not mention/.test(normalized)) text = `You’re right — sorry about that. What would you like help with today?`;",
  "if (/butt hole|butthole|anal|rectal/.test(normalized) && /bump|pain|hurt|bleed|itch/.test(normalized)) text = `I’m sorry you’re dealing with that discomfort. A painful bump in the rectal area should be assessed by a doctor — would you like me to check a suitable appointment?`;",
  "if (!text || text.length > 700) text = `Thanks for your message, ${prev.patient_name}. How can I help today?`;",
  'return [{ json: { ...prev, text } }];'
]);

node('Generate Human Reply (Ollama)').parameters.jsonBody = "={{ JSON.stringify({ model: $json.model, messages: $json.messages, stream: false, options: { temperature: 0.25, num_predict: 100 } }) }}";
node('Book Appointment in DB').parameters.jsonBody = "={{ JSON.stringify({ patient_name: $('Parse WhatsApp & Guardrails').first().json.patient_name, phone: $('Parse WhatsApp & Guardrails').first().json.phone, department: $('Choose Requested Slot').first().json.selected_slot.department, doctor_name: $('Choose Requested Slot').first().json.selected_slot.doctor_name, doctor_id: $('Choose Requested Slot').first().json.selected_slot.doctor_id, slot_start: $('Choose Requested Slot').first().json.selected_slot.slot_time, slot_id: $('Choose Requested Slot').first().json.selected_slot.slot_id }) }}";
node('Is Booking Intent?').parameters.conditions.boolean[0].value1 = "={{ $('Choose Requested Slot').first().json.is_booking_request }}";
node('Send WhatsApp Reply via WAHA').parameters.jsonBody = "={{ JSON.stringify({ session: $('Format Human Reply').first().json.session || 'Demo1', chatId: $('Format Human Reply').first().json.chat_id, text: $('Format Human Reply').first().json.text }) }}";

if (!node('Fetch Conversation History')) workflow.nodes.push({
  parameters: { url: "=http://127.0.0.1:3001/api/conversations/{{ $('Parse WhatsApp & Guardrails').first().json.phone }}?limit=8", options: { timeout: 5000 } },
  name: 'Fetch Conversation History', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1220, 380]
});
if (!node('Store Conversation Turn')) workflow.nodes.push({
  parameters: {
    method: 'POST', url: 'http://127.0.0.1:3001/api/conversations', sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ phone: $('Format Human Reply').first().json.phone, user_message: $('Format Human Reply').first().json.patient_message, assistant_message: $('Format Human Reply').first().json.text, inbound_message_id: $('Format Human Reply').first().json.inbound_message_id }) }}", options: { timeout: 5000 }
  }, name: 'Store Conversation Turn', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1940, 460]
});

workflow.connections['Fetch Real Slots from DB'] = { main: [[{ node: 'Choose Requested Slot', type: 'main', index: 0 }]] };
workflow.connections['Choose Requested Slot'] = { main: [[{ node: 'Fetch Conversation History', type: 'main', index: 0 }]] };
workflow.connections['Fetch Conversation History'] = { main: [[{ node: 'Is Booking Intent?', type: 'main', index: 0 }]] };
workflow.connections['Format Human Reply'] = { main: [[{ node: 'Send WhatsApp Reply via WAHA', type: 'main', index: 0 }]] };
workflow.connections['Send WhatsApp Reply via WAHA'] = { main: [[{ node: 'Store Conversation Turn', type: 'main', index: 0 }]] };
workflow.connections['Store Conversation Turn'] = { main: [[{ node: 'Webhook Acknowledge', type: 'main', index: 0 }]] };

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

const n8nDb = new DatabaseSync('C:/Users/pramo/.n8n/database.sqlite');
const workflows = n8nDb.prepare("SELECT id FROM workflow_entity WHERE name LIKE '%WAHA%'").all();
for (const { id } of workflows) n8nDb.prepare('UPDATE workflow_entity SET nodes = ?, connections = ? WHERE id = ?').run(JSON.stringify(workflow.nodes), JSON.stringify(workflow.connections), id);
console.log(`Updated ${workflows.length} n8n workflow(s).`);
