const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'democare.db');
const db = new DatabaseSync(dbPath);

// Initialize schema per Blueprint V3 Section E
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      patient_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      city TEXT,
      source TEXT,
      consent_status TEXT DEFAULT 'granted',
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS leads (
      lead_id TEXT PRIMARY KEY,
      patient_id TEXT,
      source TEXT,
      campaign TEXT,
      enquiry_text TEXT,
      department TEXT,
      priority TEXT DEFAULT 'normal',
      owner TEXT,
      status TEXT DEFAULT 'new',
      first_response_at TEXT,
      appointment_id TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS appointments (
      appointment_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      department TEXT NOT NULL,
      doctor_id TEXT,
      doctor_name TEXT,
      slot_start TEXT,
      slot_end TEXT,
      status TEXT DEFAULT 'confirmed',
      source TEXT DEFAULT 'Manual',
      reminder_24h INTEGER DEFAULT 0,
      reminder_3h INTEGER DEFAULT 0,
      attendance_status TEXT DEFAULT 'scheduled',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      followup_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      category TEXT,
      approved_date TEXT,
      approved_window TEXT,
      owner TEXT,
      status TEXT DEFAULT 'pending',
      attempt_count INTEGER DEFAULT 0,
      next_action_at TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS diagnostic_tasks (
      diagnostic_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      encounter_id TEXT,
      test_category TEXT,
      ordered_at TEXT,
      completed_at TEXT,
      report_ready_at TEXT,
      review_status TEXT DEFAULT 'pending',
      notification_status TEXT DEFAULT 'unsent',
      owner TEXT
    );

    CREATE TABLE IF NOT EXISTS communication_logs (
      message_id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      channel TEXT DEFAULT 'whatsapp',
      template_name TEXT,
      workflow_name TEXT,
      message_body TEXT,
      sent_at TEXT,
      delivery_status TEXT DEFAULT 'delivered',
      response_status TEXT DEFAULT 'pending',
      correlation_id TEXT
    );

    CREATE TABLE IF NOT EXISTS exceptions (
      exception_id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      record_id TEXT,
      error_type TEXT,
      severity TEXT DEFAULT 'medium',
      owner TEXT DEFAULT 'Front Desk Coordinator',
      due_at TEXT,
      status TEXT DEFAULT 'open',
      resolution_note TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS clinic_configs (
      clinic_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'America/New_York',
      phone TEXT,
      emergency_hotline TEXT,
      address TEXT,
      business_hours TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dental_services (
      service_id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 30,
      description TEXT,
      base_fee REAL,
      department TEXT DEFAULT 'General Dentistry'
    );

    CREATE TABLE IF NOT EXISTS conversation_states (
      session_id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL DEFAULT 'apex_dental',
      phone TEXT NOT NULL,
      patient_id TEXT,
      channel TEXT DEFAULT 'whatsapp',
      current_state TEXT NOT NULL DEFAULT 'NEW',
      intent TEXT,
      collected_data TEXT,
      pending_action TEXT,
      last_interaction_at TEXT,
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_conv_states_phone ON conversation_states(phone);

    CREATE TABLE IF NOT EXISTS inbound_events (
      event_id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      external_message_id TEXT UNIQUE,
      sender_phone TEXT,
      payload TEXT,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      event_id TEXT PRIMARY KEY,
      clinic_id TEXT DEFAULT 'apex_dental',
      workflow_name TEXT NOT NULL,
      workflow_version TEXT DEFAULT '1.0',
      actor_type TEXT DEFAULT 'automation',
      actor_id TEXT DEFAULT 'system',
      action TEXT NOT NULL,
      resource_type TEXT,
      record_id TEXT,
      result TEXT,
      metadata TEXT,
      timestamp TEXT,
      correlation_id TEXT
    );

    CREATE TABLE IF NOT EXISTS doctor_slots (
      slot_id TEXT PRIMARY KEY,
      department TEXT NOT NULL,
      doctor_id TEXT NOT NULL,
      doctor_name TEXT NOT NULL,
      slot_date TEXT NOT NULL,
      slot_time TEXT NOT NULL,
      is_booked INTEGER DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_slots_unique 
      ON doctor_slots(doctor_id, slot_date, slot_time);

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      inbound_message_id TEXT UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_messages_phone_created
      ON conversation_messages(phone, created_at DESC);
  `);

  try {
    db.exec("ALTER TABLE appointments ADD COLUMN source TEXT DEFAULT 'Manual'");
  } catch (_) {
    // Column already exists
  }
  try {
    db.exec("ALTER TABLE appointments ADD COLUMN service_id TEXT");
  } catch (_) {
    // Column already exists
  }
  try {
    db.exec("ALTER TABLE appointments ADD COLUMN slot_id TEXT");
  } catch (_) {
    // Column already exists
  }
  try {
    db.exec("ALTER TABLE patients ADD COLUMN consent_source TEXT DEFAULT 'unknown'");
  } catch (_) {
    // Column already exists
  }

  // Audit logs column migrations
  const auditColumns = ['clinic_id', 'actor_id', 'resource_type', 'result', 'metadata'];
  for (const col of auditColumns) {
    try {
      db.exec(`ALTER TABLE audit_logs ADD COLUMN ${col} TEXT`);
    } catch (_) {}
  }

  // Seed default clinic config
  const clinicCount = db.prepare('SELECT count(*) as count FROM clinic_configs').get().count;
  if (clinicCount === 0) {
    db.prepare(`
      INSERT INTO clinic_configs (clinic_id, name, specialty, timezone, phone, emergency_hotline, address, business_hours, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'apex_dental',
      'Apex Dental Care & Implant Center',
      'Advanced Comprehensive & Emergency Dentistry',
      'America/New_York',
      '+1-800-555-DENT (3368)',
      '+1-800-555-9111 (24/7 Dental Emergency)',
      '742 Evergreen Terrace, Medical Suite 300, New York, NY 10001',
      'Mon-Fri: 8:00 AM - 6:00 PM, Sat: 9:00 AM - 2:00 PM, Sun: Emergency On-Call',
      new Date().toISOString()
    );
  }

  // Seed dental services
  const serviceCount = db.prepare('SELECT count(*) as count FROM dental_services').get().count;
  if (serviceCount === 0) {
    const insertService = db.prepare(`
      INSERT INTO dental_services (service_id, clinic_id, name, category, duration_minutes, description, base_fee, department)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const services = [
      ['srv_consult', 'apex_dental', 'Comprehensive Dental Examination', 'Consultation', 30, 'Full oral exam, digital charting, and consultation', 85.00, 'General Dentistry'],
      ['srv_cleaning', 'apex_dental', 'Dental Cleaning & Polishing (Prophylaxis)', 'Hygiene', 45, 'Professional plaque/tartar removal and teeth polishing', 120.00, 'General Dentistry'],
      ['srv_tooth_pain', 'apex_dental', 'Emergency Tooth Pain Assessment', 'Emergency', 30, 'Targeted diagnosis, vitality test, and immediate pain relief', 95.00, 'Emergency Care'],
      ['srv_root_canal', 'apex_dental', 'Root Canal Therapy Consultation', 'Endodontics', 45, 'Evaluation of infected pulp and endodontic treatment plan', 150.00, 'Endodontics'],
      ['srv_extraction', 'apex_dental', 'Tooth / Wisdom Tooth Extraction Consult', 'Oral Surgery', 45, 'Surgical/simple extraction assessment and 3D imaging', 140.00, 'Oral Surgery'],
      ['srv_ortho', 'apex_dental', 'Orthodontic / Braces & Aligners Consult', 'Orthodontics', 45, 'Bite evaluation, clear aligner/braces feasibility scan', 100.00, 'Orthodontics'],
      ['srv_whitening', 'apex_dental', 'Professional Teeth Whitening', 'Cosmetic', 60, 'In-office laser enamel whitening treatment', 299.00, 'Cosmetic Dentistry'],
      ['srv_pediatric', 'apex_dental', 'Pediatric Dental Checkup', 'Pediatric', 30, 'Gentle examination, fluoride application, and cleaning for children', 75.00, 'Pediatric Dentistry']
    ];
    for (const s of services) {
      insertService.run(...s);
    }
  }

  // Seed sample doctor slots if empty or augment with Dental Specialists
  const dentalSlotsCount = db.prepare("SELECT count(*) as count FROM doctor_slots WHERE department IN ('General Dentistry', 'Emergency Care', 'Endodontics', 'Oral Surgery', 'Orthodontics', 'Pediatric Dentistry')").get().count;
  if (dentalSlotsCount === 0) {
    const insertSlot = db.prepare(`
      INSERT OR IGNORE INTO doctor_slots (slot_id, department, doctor_id, doctor_name, slot_date, slot_time, is_booked)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);

    const dentalDoctors = [
      { dept: 'General Dentistry', id: 'DOC-DENT-01', name: 'Dr. Sarah Jenkins' },
      { dept: 'Endodontics', id: 'DOC-DENT-02', name: 'Dr. Marcus Vance' },
      { dept: 'Oral Surgery', id: 'DOC-DENT-03', name: 'Dr. Michael Torres' },
      { dept: 'Orthodontics', id: 'DOC-DENT-04', name: 'Dr. Emily Chen' },
      { dept: 'Emergency Care', id: 'DOC-DENT-05', name: 'Dr. Alex Rivera' },
      { dept: 'Pediatric Dentistry', id: 'DOC-DENT-06', name: 'Dr. Aisha Patel' }
    ];

    const today = new Date();
    const dates = [];
    for (let i = 0; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
    if (!dates.includes('2026-10-05')) dates.push('2026-10-05');
    if (!dates.includes('2026-09-30')) dates.push('2026-09-30');

    const times = ['09:00 AM', '10:30 AM', '02:00 PM', '03:30 PM', '04:30 PM'];

    let dSlotId = 100;
    for (const doc of dentalDoctors) {
      for (const date of dates) {
        for (const time of times) {
          insertSlot.run(
            `SLOT-DENT-${dSlotId++}`,
            doc.dept,
            doc.id,
            doc.name,
            date,
            time
          );
        }
      }
    }
  }

  // Seed sample general hospital doctor slots if count is 0
  const countStmt = db.prepare('SELECT count(*) as count FROM doctor_slots');
  const count = countStmt.get().count;

  if (count === 0) {
    const insertSlot = db.prepare(`
      INSERT OR IGNORE INTO doctor_slots (slot_id, department, doctor_id, doctor_name, slot_date, slot_time, is_booked)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);

    const doctors = [
      { dept: 'Dermatology', id: 'DOC-DERM-01', name: 'Dr. Priya Patel' },
      { dept: 'Cardiology', id: 'DOC-CARD-01', name: 'Dr. Anand Sharma' },
      { dept: 'Orthopedics', id: 'DOC-ORTH-01', name: 'Dr. Rajesh Mehta' },
      { dept: 'General Medicine', id: 'DOC-GEN-01', name: 'Dr. Sunita Rao' }
    ];

    const today = new Date();
    const dates = [];
    for (let i = 0; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
    }
    if (!dates.includes('2026-09-05')) dates.push('2026-09-05');

    const times = ['10:00 AM', '11:30 AM', '02:00 PM', '04:30 PM'];

    let sId = 1;
    for (const doc of doctors) {
      for (const date of dates) {
        for (const time of times) {
          insertSlot.run(
            `SLOT-${sId++}`,
            doc.dept,
            doc.id,
            doc.name,
            date,
            time
          );
        }
      }
    }
  }

  // Seed test patients from Blueprint (DEMO-001, DEMO-002, DEMO-003)
  const patientCount = db.prepare('SELECT count(*) as count FROM patients').get().count;
  if (patientCount === 0) {
    const insertPatient = db.prepare(`
      INSERT INTO patients (patient_id, full_name, phone, email, city, source, consent_status, consent_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    insertPatient.run('DEMO-001', 'Rahul Sharma', '9999999999', 'rahul.demo@example.com', 'New York', 'Instagram', 'unknown', 'direct_web', now, now);
    insertPatient.run('DEMO-002', 'Anita Verma', '9888888888', 'anita.demo@example.com', 'Brooklyn', 'Google', 'unknown', 'direct_web', now, now);
    insertPatient.run('DEMO-003', 'Vikram Malhotra', '9777777777', 'vikram.demo@example.com', 'Queens', 'WhatsApp', 'opted_in', 'whatsapp_explicit', now, now);
  }
}

initSchema();

module.exports = { db };
