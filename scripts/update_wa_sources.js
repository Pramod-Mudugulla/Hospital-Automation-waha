const { db } = require('../server/db');

// Update appointments that were booked via the automated flow
const res = db.prepare("UPDATE appointments SET source = 'WhatsApp Automation' WHERE appointment_id LIKE 'APPT-179000%' OR appointment_id LIKE 'APPT-179001%'").run();
console.log(`Updated ${res.changes} appointments to WhatsApp Automation`);

// Check if patient 12764810604747 exists in patients table, if not add them
let pat = db.prepare("SELECT * FROM patients WHERE phone LIKE '%12764810604747%' LIMIT 1").get();
if (!pat) {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO patients (patient_id, full_name, phone, source, consent_status, created_at, updated_at) VALUES (?, ?, ?, 'WhatsApp', 'granted', ?, ?)").run(
    'PAT-WA-12764810604747', 'Kavitha Reddy', '12764810604747', now, now
  );
  console.log('Inserted patient Kavitha Reddy (12764810604747)');
  // Also create a confirmed appointment for them
  db.prepare(`
    INSERT INTO appointments (appointment_id, patient_id, department, doctor_id, doctor_name, slot_start, slot_end, status, source, attendance_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', 'WhatsApp Automation', 'scheduled', ?)
  `).run(
    'APPT-WA-001', 'PAT-WA-12764810604747', 'Cardiology', 'DOC-CARD-01', 'Dr. Anand Sharma', '2026-09-25 10:30 AM', '11:00 AM', now
  );
  console.log('Created confirmed WhatsApp appointment for Kavitha Reddy');
}

// Print summary
const waAppts = db.prepare("SELECT count(*) as c FROM appointments WHERE source = 'WhatsApp Automation'").get();
const manAppts = db.prepare("SELECT count(*) as c FROM appointments WHERE source = 'Manual'").get();
console.log(`Total WhatsApp Automation: ${waAppts.c}, Total Manual: ${manAppts.c}`);
