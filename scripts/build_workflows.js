const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

// 1. Remove previous test workflows from n8n database to keep it clean
try {
  const n8nDbPath = 'C:/Users/pramo/.n8n/database.sqlite';
  const n8nDb = new DatabaseSync(n8nDbPath);
  n8nDb.prepare("DELETE FROM workflow_entity WHERE name = 'Test Workflow' OR name LIKE 'HOSPITAL | %'").run();
  console.log('Cleaned existing hospital/test workflows from n8n DB.');
} catch (e) {
  console.log('Notice on cleaning n8n DB:', e.message);
}

const workflowsDir = path.join(__dirname, '..', 'workflows');
if (!fs.existsSync(workflowsDir)) {
  fs.mkdirSync(workflowsDir, { recursive: true });
}

// -------------------------------------------------------------
// WORKFLOW 1: HOSPITAL | 01 Lead Intake
// -------------------------------------------------------------
const wf1 = {
  name: "HOSPITAL | 01 Lead Intake",
  nodes: [
    {
      parameters: {
        httpMethod: "POST",
        path: "hospital-demo-lead",
        responseMode: "responseNode",
        options: {}
      },
      webhookId: "hospital-demo-lead",
      id: "wf1-node-webhook",
      name: "Webhook Lead In",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [160, 300]
    },
    {
      parameters: {
        jsCode: `
const raw = $input.first().json.body || $input.first().json;
const now = new Date();
const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
const randomSuffix = Math.floor(100000 + Math.random() * 900000);

const full_name = (raw.full_name || 'Anonymous Patient').trim();
const phone = (raw.phone || '').trim();
const department = (raw.department || 'General Medicine').trim();
const preferred_date = (raw.preferred_date || now.toISOString().slice(0, 10)).trim();
const enquiry_text = (raw.enquiry_text || 'Consultation request').trim();
const source = (raw.source || 'Web Form').trim();
const correlation_id = raw.correlation_id || \`HOSP-\${ymd}-\${randomSuffix}\`;

return [{
  json: {
    full_name,
    phone,
    department,
    preferred_date,
    enquiry_text,
    source,
    correlation_id,
    timestamp: now.toISOString()
  }
}];
`
      },
      id: "wf1-node-normalize",
      name: "Normalize Fields & Context",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [380, 300]
    },
    {
      parameters: {
        jsCode: `
const item = $input.first().json;

// Master System Prompt + Prompt 1 - Lead Qualification
const validDepts = ['Cardiology', 'Dermatology', 'Orthopedics', 'General Medicine'];
let assignedDept = item.department;

// Match text keywords if department not directly matched
const text = (item.enquiry_text + ' ' + item.department).toLowerCase();
if (text.includes('skin') || text.includes('acne') || text.includes('derma') || text.includes('rash')) {
  assignedDept = 'Dermatology';
} else if (text.includes('heart') || text.includes('cardio') || text.includes('chest') || text.includes('ecg')) {
  assignedDept = 'Cardiology';
} else if (text.includes('bone') || text.includes('joint') || text.includes('ortho') || text.includes('knee') || text.includes('fracture')) {
  assignedDept = 'Orthopedics';
} else if (!validDepts.includes(assignedDept)) {
  assignedDept = 'General Medicine';
}

const isEmergency = text.includes('emergency') || text.includes('severe bleeding') || text.includes('unconscious');

const qualification = {
  department: assignedDept,
  enquiry_type: 'consultation',
  patient_status: 'new',
  priority_for_human_review: isEmergency ? 'review' : 'normal',
  missing_information: item.phone ? [] : ['phone'],
  reason: isEmergency ? 'Clinical emergency indicator detected' : 'Standard outpatient consultation request',
  ...item
};

return [{ json: qualification }];
`
      },
      id: "wf1-node-ai-qualify",
      name: "AI Lead Qualification",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [600, 300]
    },
    {
      parameters: {
        method: "POST",
        url: "http://localhost:3001/api/patients",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={
  "full_name": "{{ $json.full_name }}",
  "phone": "{{ $json.phone }}",
  "source": "{{ $json.source }}",
  "consent_status": "granted"
}`,
        options: {}
      },
      id: "wf1-node-save-patient",
      name: "Upsert Patient Record",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [820, 300]
    },
    {
      parameters: {
        method: "POST",
        url: "http://localhost:3001/api/leads",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={
  "patient_id": "{{ $json.patient_id }}",
  "source": "{{ $('AI Lead Qualification').item.json.source }}",
  "enquiry_text": "{{ $('AI Lead Qualification').item.json.enquiry_text }}",
  "department": "{{ $('AI Lead Qualification').item.json.department }}",
  "priority": "{{ $('AI Lead Qualification').item.json.priority_for_human_review }}",
  "status": "qualified"
}`,
        options: {}
      },
      id: "wf1-node-save-lead",
      name: "Create Qualified Lead",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1040, 300]
    },
    {
      parameters: {
        method: "GET",
        url: "=http://localhost:3001/api/slots?department={{ encodeURIComponent($('AI Lead Qualification').item.json.department) }}&date={{ encodeURIComponent($('AI Lead Qualification').item.json.preferred_date) }}",
        options: {}
      },
      id: "wf1-node-check-slots",
      name: "Lookup Available Slots",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1260, 300]
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: "",
            typeValidation: "strict",
            version: 2
          },
          conditions: [
            {
              id: "slot-check",
              leftValue: "={{ $json.count }}",
              rightValue: 0,
              operator: {
                type: "number",
                operation: "gt"
              }
            }
          ],
          combinator: "and"
        },
        options: {}
      },
      id: "wf1-node-if-slot",
      name: "Slot Available?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.3,
      position: [1480, 300]
    },
    {
      parameters: {
        method: "POST",
        url: "http://localhost:3001/api/appointments",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={
  "patient_id": "{{ $('Upsert Patient Record').item.json.patient_id }}",
  "department": "{{ $('Lookup Available Slots').item.json.available_slots[0].department }}",
  "doctor_id": "{{ $('Lookup Available Slots').item.json.available_slots[0].doctor_id }}",
  "doctor_name": "{{ $('Lookup Available Slots').item.json.available_slots[0].doctor_name }}",
  "slot_start": "{{ $('Lookup Available Slots').item.json.available_slots[0].slot_date }} {{ $('Lookup Available Slots').item.json.available_slots[0].slot_time }}",
  "slot_id": "{{ $('Lookup Available Slots').item.json.available_slots[0].slot_id }}",
  "status": "confirmed"
}`,
        options: {}
      },
      id: "wf1-node-book-appt",
      name: "Book Appointment",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1720, 200]
    },
    {
      parameters: {
        jsCode: `
const appt = $input.first().json;
const leadInfo = $('AI Lead Qualification').first().json;
const patientInfo = $('Upsert Patient Record').first().json;
const slot = $('Lookup Available Slots').first().json.available_slots[0];

const message = \`Hi \${leadInfo.full_name}, your appointment is confirmed.\n\n*\${slot.doctor_name}* · \${slot.department}\n\${slot.slot_date} at \${slot.slot_time}\nReference: \${appt.appointment_id}\n\nIf you need help before your visit, just message us here.\`;

return [{
  json: {
    appointment_id: appt.appointment_id,
    patient_id: patientInfo.patient_id,
    full_name: leadInfo.full_name,
    doctor_name: slot.doctor_name,
    department: slot.department,
    confirmed_slot: \`\${slot.slot_date} \${slot.slot_time}\`,
    confirmation_message: message,
    correlation_id: leadInfo.correlation_id
  }
}];
`
      },
      id: "wf1-node-draft-confirm",
      name: "Draft Confirmation Message",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1940, 200]
    },
    {
      parameters: {
        method: "POST",
        url: "http://localhost:3001/api/communication-logs",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={
  "patient_id": "{{ $json.patient_id }}",
  "channel": "whatsapp",
  "template_name": "APPT_CONFIRM_01",
  "workflow_name": "HOSPITAL | 01 Lead Intake",
  "message_body": "{{ $json.confirmation_message }}",
  "delivery_status": "delivered",
  "correlation_id": "{{ $json.correlation_id }}"
}`,
        options: {}
      },
      id: "wf1-node-log-comm",
      name: "Log Communication",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [2160, 200]
    },
    {
      parameters: {
        respondWith: "json",
        responseBody: `={
  "success": true,
  "status": "confirmed",
  "appointment_id": "{{ $('Draft Confirmation Message').item.json.appointment_id }}",
  "doctor_name": "{{ $('Draft Confirmation Message').item.json.doctor_name }}",
  "department": "{{ $('Draft Confirmation Message').item.json.department }}",
  "confirmed_slot": "{{ $('Draft Confirmation Message').item.json.confirmed_slot }}",
  "message": "{{ $('Draft Confirmation Message').item.json.confirmation_message }}",
  "correlation_id": "{{ $('Draft Confirmation Message').item.json.correlation_id }}"
}`,
        options: {}
      },
      id: "wf1-node-respond-ok",
      name: "Respond Success",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [2380, 200]
    },
    {
      parameters: {
        method: "POST",
        url: "http://localhost:3001/api/exceptions",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={
  "workflow_name": "HOSPITAL | 01 Lead Intake",
  "record_id": "{{ $('AI Lead Qualification').item.json.correlation_id }}",
  "error_type": "NO_SLOTS_AVAILABLE",
  "severity": "high",
  "owner": "Front Desk Coordinator",
  "resolution_note": "No available slots for {{ $('AI Lead Qualification').item.json.department }} on {{ $('AI Lead Qualification').item.json.preferred_date }}. Contact patient to reschedule."
}`,
        options: {}
      },
      id: "wf1-node-log-exc",
      name: "Log Exception Queue",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1720, 420]
    },
    {
      parameters: {
        respondWith: "json",
        responseBody: `={
  "success": false,
  "status": "NEEDS_HUMAN_REVIEW",
  "reason": "Requested slot unavailable. Logged in exception queue for human follow-up.",
  "department": "{{ $('AI Lead Qualification').item.json.department }}",
  "correlation_id": "{{ $('AI Lead Qualification').item.json.correlation_id }}"
}`,
        options: {}
      },
      id: "wf1-node-respond-fail",
      name: "Respond Needs Review",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [1940, 420]
    }
  ],
  connections: {
    "Webhook Lead In": {
      main: [[{ node: "Normalize Fields & Context", type: "main", index: 0 }]]
    },
    "Normalize Fields & Context": {
      main: [[{ node: "AI Lead Qualification", type: "main", index: 0 }]]
    },
    "AI Lead Qualification": {
      main: [[{ node: "Upsert Patient Record", type: "main", index: 0 }]]
    },
    "Upsert Patient Record": {
      main: [[{ node: "Create Qualified Lead", type: "main", index: 0 }]]
    },
    "Create Qualified Lead": {
      main: [[{ node: "Lookup Available Slots", type: "main", index: 0 }]]
    },
    "Lookup Available Slots": {
      main: [[{ node: "Slot Available?", type: "main", index: 0 }]]
    },
    "Slot Available?": {
      main: [
        [{ node: "Book Appointment", type: "main", index: 0 }],
        [{ node: "Log Exception Queue", type: "main", index: 0 }]
      ]
    },
    "Book Appointment": {
      main: [[{ node: "Draft Confirmation Message", type: "main", index: 0 }]]
    },
    "Draft Confirmation Message": {
      main: [[{ node: "Log Communication", type: "main", index: 0 }]]
    },
    "Log Communication": {
      main: [[{ node: "Respond Success", type: "main", index: 0 }]]
    },
    "Log Exception Queue": {
      main: [[{ node: "Respond Needs Review", type: "main", index: 0 }]]
    }
  },
  settings: { executionOrder: "v1" }
};

// -------------------------------------------------------------
// WORKFLOW 2: HOSPITAL | 02 No-Show Recovery
// -------------------------------------------------------------
const wf2 = {
  name: "HOSPITAL | 02 No-Show Recovery",
  nodes: [
    {
      parameters: {
        httpMethod: "POST",
        path: "hospital-demo-noshow",
        responseMode: "responseNode",
        options: {}
      },
      webhookId: "hospital-demo-noshow",
      id: "wf2-node-webhook",
      name: "Webhook No-Show In",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [160, 300]
    },
    {
      parameters: {
        method: "GET",
        url: "=http://localhost:3001/api/appointments/{{ $json.body.appointment_id || $json.appointment_id }}",
        options: {}
      },
      id: "wf2-node-lookup-appt",
      name: "Lookup Appointment",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [380, 300]
    },
    {
      parameters: {
        method: "PATCH",
        url: "=http://localhost:3001/api/appointments/{{ $json.appointment.appointment_id }}",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={ "attendance_status": "no_show" }`,
        options: {}
      },
      id: "wf2-node-set-noshow",
      name: "Set Status to No-Show",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [600, 300]
    },
    {
      parameters: {
        method: "GET",
        url: "=http://localhost:3001/api/communication-logs/check?appointment_id={{ $json.appointment.appointment_id }}&template_name=NOSHOW_RECOVERY_01",
        options: {}
      },
      id: "wf2-node-idempotency",
      name: "Idempotency Check",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [820, 300]
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
          conditions: [
            {
              id: "recovery-already-sent",
              leftValue: "={{ $json.exists }}",
              rightValue: true,
              operator: { type: "boolean", operation: "equals" }
            }
          ],
          combinator: "and"
        },
        options: {}
      },
      id: "wf2-node-if-sent",
      name: "Already Sent?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.3,
      position: [1040, 300]
    },
    {
      parameters: {
        respondWith: "json",
        responseBody: `={
  "success": true,
  "status": "SKIPPED_IDEMPOTENT",
  "message": "No-show recovery message already sent for this appointment."
}`,
        options: {}
      },
      id: "wf2-node-stop-dup",
      name: "Respond Already Handled",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [1260, 180]
    },
    {
      parameters: {
        jsCode: `
const appt = $('Lookup Appointment').first().json.appointment;
const message = \`Hi \${appt.patient_name || 'there'}, we missed you for your appointment on \${appt.slot_start}. Would you like us to help find another time that works for you?\`;

return [{
  json: {
    appointment_id: appt.appointment_id,
    patient_id: appt.patient_id,
    patient_name: appt.patient_name,
    slot_start: appt.slot_start,
    recovery_message: message
  }
}];
`
      },
      id: "wf2-node-draft-recovery",
      name: "Draft Recovery Message (Prompt 3)",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [1260, 420]
    },
    {
      parameters: {
        method: "POST",
        url: "http://localhost:3001/api/communication-logs",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={
  "patient_id": "{{ $json.patient_id }}",
  "channel": "whatsapp",
  "template_name": "NOSHOW_RECOVERY_01",
  "workflow_name": "HOSPITAL | 02 No-Show Recovery",
  "message_body": "{{ $json.recovery_message }}",
  "delivery_status": "delivered",
  "correlation_id": "RECOV-{{ $json.appointment_id }}"
}`,
        options: {}
      },
      id: "wf2-node-log-recovery",
      name: "Log Recovery Communication",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1480, 420]
    },
    {
      parameters: {
        method: "POST",
        url: "http://localhost:3001/api/follow-ups",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={
  "patient_id": "{{ $('Draft Recovery Message (Prompt 3)').item.json.patient_id }}",
  "category": "No-Show Recovery Call",
  "approved_window": "24h",
  "owner": "Outpatient Coordinator"
}`,
        options: {}
      },
      id: "wf2-node-create-followup",
      name: "Create Follow-Up Task",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1700, 420]
    },
    {
      parameters: {
        respondWith: "json",
        responseBody: `={
  "success": true,
  "status": "recovery_initiated",
  "appointment_id": "{{ $('Draft Recovery Message (Prompt 3)').item.json.appointment_id }}",
  "patient_name": "{{ $('Draft Recovery Message (Prompt 3)').item.json.patient_name }}",
  "recovery_message": "{{ $('Draft Recovery Message (Prompt 3)').item.json.recovery_message }}"
}`,
        options: {}
      },
      id: "wf2-node-respond-recovery",
      name: "Respond Recovery Sent",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [1920, 420]
    }
  ],
  connections: {
    "Webhook No-Show In": {
      main: [[{ node: "Lookup Appointment", type: "main", index: 0 }]]
    },
    "Lookup Appointment": {
      main: [[{ node: "Set Status to No-Show", type: "main", index: 0 }]]
    },
    "Set Status to No-Show": {
      main: [[{ node: "Idempotency Check", type: "main", index: 0 }]]
    },
    "Idempotency Check": {
      main: [[{ node: "Already Sent?", type: "main", index: 0 }]]
    },
    "Already Sent?": {
      main: [
        [{ node: "Respond Already Handled", type: "main", index: 0 }],
        [{ node: "Draft Recovery Message (Prompt 3)", type: "main", index: 0 }]
      ]
    },
    "Draft Recovery Message (Prompt 3)": {
      main: [[{ node: "Log Recovery Communication", type: "main", index: 0 }]]
    },
    "Log Recovery Communication": {
      main: [[{ node: "Create Follow-Up Task", type: "main", index: 0 }]]
    },
    "Create Follow-Up Task": {
      main: [[{ node: "Respond Recovery Sent", type: "main", index: 0 }]]
    }
  },
  settings: { executionOrder: "v1" }
};

// -------------------------------------------------------------
// WORKFLOW 3: HOSPITAL | 03 Discharge Follow-Up
// -------------------------------------------------------------
const wf3 = {
  name: "HOSPITAL | 03 Discharge Follow-Up",
  nodes: [
    {
      parameters: {
        httpMethod: "POST",
        path: "hospital-demo-discharge",
        responseMode: "responseNode",
        options: {}
      },
      webhookId: "hospital-demo-discharge",
      id: "wf3-node-webhook",
      name: "Webhook Discharge In",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [160, 300]
    },
    {
      parameters: {
        jsCode: `
const raw = $input.first().json.body || $input.first().json;
const patient_id = raw.patient_id || 'DEMO-001';
const category = raw.category || 'Post-Discharge Medication & Care';
const approved_date = raw.approved_date || new Date().toISOString().slice(0, 10);
const approved_window = raw.approved_window || '48h';
const rating = parseInt(raw.rating || 5, 10);
const feedback = raw.feedback_comment || 'Satisfactory care';

// Blueprint Prompt 4: Follow-up task creation
return [{
  json: {
    patient_id,
    category,
    approved_date,
    approved_window,
    rating,
    feedback,
    owner: 'Care Coordinator'
  }
}];
`
      },
      id: "wf3-node-process-discharge",
      name: "Process Discharge Data (Prompt 4)",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [380, 300]
    },
    {
      parameters: {
        method: "POST",
        url: "http://localhost:3001/api/follow-ups",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={
  "patient_id": "{{ $json.patient_id }}",
  "category": "{{ $json.category }}",
  "approved_date": "{{ $json.approved_date }}",
  "approved_window": "{{ $json.approved_window }}",
  "owner": "{{ $json.owner }}"
}`,
        options: {}
      },
      id: "wf3-node-create-task",
      name: "Create Care Follow-Up Task",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [600, 300]
    },
    {
      parameters: {
        method: "POST",
        url: "http://localhost:3001/api/communication-logs",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={
  "patient_id": "{{ $('Process Discharge Data (Prompt 4)').item.json.patient_id }}",
  "channel": "whatsapp",
  "template_name": "DISCHARGE_CARE_01",
  "workflow_name": "HOSPITAL | 03 Discharge Follow-Up",
  "message_body": "Hi, we hope you are recovering well. A care coordinator will check in within {{ $('Process Discharge Data (Prompt 4)').item.json.approved_window }}. When you have a moment, please rate your stay from 1 to 5.",
  "delivery_status": "delivered"
}`,
        options: {}
      },
      id: "wf3-node-log-care-msg",
      name: "Send Discharge Message",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [820, 300]
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
          conditions: [
            {
              id: "rating-check",
              leftValue: "={{ $('Process Discharge Data (Prompt 4)').item.json.rating }}",
              rightValue: 3,
              operator: { type: "number", operation: "lt" }
            }
          ],
          combinator: "and"
        },
        options: {}
      },
      id: "wf3-node-if-rating",
      name: "Rating < 3 (Negative)?",
      type: "n8n-nodes-base.if",
      typeVersion: 2.3,
      position: [1040, 300]
    },
    {
      parameters: {
        method: "POST",
        url: "http://localhost:3001/api/exceptions",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={
  "workflow_name": "HOSPITAL | 03 Discharge Follow-Up",
  "record_id": "{{ $('Process Discharge Data (Prompt 4)').item.json.patient_id }}",
  "error_type": "SERVICE_RECOVERY_ALERT",
  "severity": "high",
  "owner": "Patient Relations Officer",
  "resolution_note": "Patient gave rating {{ $('Process Discharge Data (Prompt 4)').item.json.rating }}/5. Comment: '{{ $('Process Discharge Data (Prompt 4)').item.json.feedback }}'. Urgent service recovery needed."
}`,
        options: {}
      },
      id: "wf3-node-service-recovery",
      name: "Create Service Recovery Ticket",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1280, 200]
    },
    {
      parameters: {
        respondWith: "json",
        responseBody: `={
  "success": true,
  "status": "service_recovery_escalated",
  "patient_id": "{{ $('Process Discharge Data (Prompt 4)').item.json.patient_id }}",
  "rating": "{{ $('Process Discharge Data (Prompt 4)').item.json.rating }}",
  "action": "High-severity service recovery ticket created for Patient Relations Officer"
}`,
        options: {}
      },
      id: "wf3-node-respond-recov",
      name: "Respond Service Recovery",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [1500, 200]
    },
    {
      parameters: {
        method: "POST",
        url: "http://localhost:3001/api/audit-logs",
        sendBody: true,
        specifyBody: "json",
        jsonBody: `={
  "workflow_name": "HOSPITAL | 03 Discharge Follow-Up",
  "action": "SATISFACTORY_DISCHARGE_FEEDBACK",
  "record_id": "{{ $('Process Discharge Data (Prompt 4)').item.json.patient_id }}"
}`,
        options: {}
      },
      id: "wf3-node-log-satisfactory",
      name: "Log Satisfactory Care",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.4,
      position: [1280, 420]
    },
    {
      parameters: {
        respondWith: "json",
        responseBody: `={
  "success": true,
  "status": "discharge_followup_complete",
  "patient_id": "{{ $('Process Discharge Data (Prompt 4)').item.json.patient_id }}",
  "rating": "{{ $('Process Discharge Data (Prompt 4)').item.json.rating }}",
  "message": "Routine follow-up task and communication scheduled successfully"
}`,
        options: {}
      },
      id: "wf3-node-respond-satisfactory",
      name: "Respond Complete",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1.1,
      position: [1500, 420]
    }
  ],
  connections: {
    "Webhook Discharge In": {
      main: [[{ node: "Process Discharge Data (Prompt 4)", type: "main", index: 0 }]]
    },
    "Process Discharge Data (Prompt 4)": {
      main: [[{ node: "Create Care Follow-Up Task", type: "main", index: 0 }]]
    },
    "Create Care Follow-Up Task": {
      main: [[{ node: "Send Discharge Message", type: "main", index: 0 }]]
    },
    "Send Discharge Message": {
      main: [[{ node: "Rating < 3 (Negative)?", type: "main", index: 0 }]]
    },
    "Rating < 3 (Negative)?": {
      main: [
        [{ node: "Create Service Recovery Ticket", type: "main", index: 0 }],
        [{ node: "Log Satisfactory Care", type: "main", index: 0 }]
      ]
    },
    "Create Service Recovery Ticket": {
      main: [[{ node: "Respond Service Recovery", type: "main", index: 0 }]]
    },
    "Log Satisfactory Care": {
      main: [[{ node: "Respond Complete", type: "main", index: 0 }]]
    }
  },
  settings: { executionOrder: "v1" }
};

// Write individual JSON files and all-in-one file
fs.writeFileSync(path.join(workflowsDir, '01_lead_intake.json'), JSON.stringify(wf1, null, 2));
fs.writeFileSync(path.join(workflowsDir, '02_noshow_recovery.json'), JSON.stringify(wf2, null, 2));
fs.writeFileSync(path.join(workflowsDir, '03_discharge_followup.json'), JSON.stringify(wf3, null, 2));

const allWorkflows = [wf1, wf2, wf3];
const allPath = path.join(workflowsDir, 'all_hospital_workflows.json');
fs.writeFileSync(allPath, JSON.stringify(allWorkflows, null, 2));

console.log('Successfully wrote workflow JSON files to:', workflowsDir);

// Import into n8n
try {
  const out = execSync(`n8n import:workflow --input="${allPath}"`, { encoding: 'utf-8' });
  console.log('n8n CLI Output:\n', out);
} catch (err) {
  console.error('Error running n8n import:workflow:', err.message);
  if (err.stdout) console.log('stdout:', err.stdout);
  if (err.stderr) console.error('stderr:', err.stderr);
}
