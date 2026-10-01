const express = require('express');
const cors = require('cors');
const path = require('path');
const { db } = require('./db');
const { processConversationTurn, getClinicConfig, recordAuditLog } = require('./conversation_engine');
const { translateToEnglish, translateFromEnglish, synthesizeSpeechAudio, transcribeVoiceNote } = require('./multimodal_service');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Multimodal Audio TTS Endpoint (WhatsApp Voice Note Generator)
app.get('/api/audio/tts', async (req, res) => {
  const text = req.query.text;
  const lang = req.query.lang || 'en';
  if (!text) return res.status(400).send('text query parameter is required');

  const audioBuffer = await synthesizeSpeechAudio(text, lang);
  if (!audioBuffer) {
    return res.status(502).json({ success: false, error: 'Audio synthesis unavailable' });
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', 'inline; filename="voice_note.mp3"');
  res.send(audioBuffer);
});

// Voice Note STT Transcription Endpoint
app.post('/api/audio/transcribe', async (req, res) => {
  const result = await transcribeVoiceNote(req.body);
  res.json(result);
});

// Clinic Profile & Configuration
app.get('/api/clinic-config', (req, res) => {
  const config = getClinicConfig(req.query.clinic_id || 'apex_dental');
  res.json({ success: true, config });
});

// Dental Services Catalog
app.get('/api/dental-services', (req, res) => {
  const services = db.prepare('SELECT * FROM dental_services ORDER BY category ASC, base_fee ASC').all();
  res.json({ success: true, services });
});

// Phase 1 & 4: Multi-Turn Dental Conversational Engine API (with Multilingual & Audio support)
app.post('/api/chat', async (req, res) => {
  let { phone, message, patient_name, channel, inbound_message_id, prefer_audio = false, audio_url, audio_base64 } = req.body;

  // Handle incoming voice note if text was not provided
  if (!message && (audio_url || audio_base64)) {
    const trans = await transcribeVoiceNote({ audioUrl: audio_url, audioBase64: audio_base64 });
    message = trans.transcript;
    prefer_audio = true;
  }

  if (!phone || !message) {
    return res.status(400).json({ success: false, error: 'phone and message (or voice note) are required' });
  }

  try {
    // 1. Language Detection & Translation to English
    const { englishText, detectedLanguage, wasTranslated } = await translateToEnglish(message);

    // 2. Deterministic State Machine Processing
    const result = await processConversationTurn({
      phone,
      message: englishText,
      patientName: patient_name || null,
      channel: channel || 'whatsapp',
      inboundMessageId: inbound_message_id || null
    });

    // 3. Translate response back to patient's native language if needed
    const finalReply = wasTranslated ? await translateFromEnglish(result.reply, detectedLanguage) : result.reply;

    // 4. Generate optional voice note audio URL
    const audioUrl = prefer_audio
      ? `/api/audio/tts?text=${encodeURIComponent(finalReply)}&lang=${detectedLanguage}`
      : null;

    // Save to conversation audit memory
    const now = new Date().toISOString();
    try {
      db.prepare(`
        INSERT INTO conversation_messages (phone, role, content, inbound_message_id, created_at)
        VALUES (?, 'user', ?, ?, ?)
      `).run(phone, message, inbound_message_id || null, now);
      db.prepare(`
        INSERT INTO conversation_messages (phone, role, content, created_at)
        VALUES (?, 'assistant', ?, ?)
      `).run(phone, finalReply, now);
    } catch (_) {}

    res.json({
      success: true,
      ...result,
      reply: finalReply,
      original_english_reply: result.reply,
      detected_language: detectedLanguage,
      was_translated: wasTranslated,
      audio_url: audioUrl
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Phase 2: Unified Channel Inbound Adapter (WhatsApp, Instagram, Web, SMS) with Translation & Audio
app.post('/api/channels/inbound', async (req, res) => {
  let {
    channel = 'whatsapp',
    clinic_id = 'apex_dental',
    external_message_id,
    sender_phone,
    sender_name,
    message,
    audio_url,
    audio_base64,
    prefer_audio = false,
    metadata = {}
  } = req.body;

  // Handle incoming voice note transcription
  if (!message && (audio_url || audio_base64)) {
    const trans = await transcribeVoiceNote({ audioUrl: audio_url, audioBase64: audio_base64 });
    message = trans.transcript;
    prefer_audio = true;
  }

  if (!sender_phone || !message) {
    return res.status(400).json({ success: false, error: 'sender_phone and message (or audio) are required' });
  }

  const messageId = external_message_id || `EXT-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  // Deduplication & Idempotency check (Gate C / Section 8)
  const existingEvent = db.prepare('SELECT * FROM inbound_events WHERE external_message_id = ?').get(messageId);
  if (existingEvent) {
    return res.json({
      success: true,
      duplicate: true,
      note: 'Event previously received and processed (idempotent)',
      event_id: existingEvent.event_id
    });
  }

  // Record inbound event
  const eventId = `EVT-${Date.now()}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO inbound_events (event_id, channel, external_message_id, sender_phone, payload, processed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(eventId, channel, messageId, sender_phone, JSON.stringify(req.body), now);

  // 1. Language Detection & Translation to English
  const { englishText, detectedLanguage, wasTranslated } = await translateToEnglish(message);

  // 2. Process via Conversational State Machine
  const turnResult = await processConversationTurn({
    phone: sender_phone,
    message: englishText,
    patientName: sender_name || null,
    channel,
    inboundMessageId: messageId
  });

  // 3. Translate response back to patient's native language
  const finalReply = wasTranslated ? await translateFromEnglish(turnResult.reply, detectedLanguage) : turnResult.reply;

  // 4. Generate optional voice note audio URL
  const responseAudioUrl = prefer_audio
    ? `/api/audio/tts?text=${encodeURIComponent(finalReply)}&lang=${detectedLanguage}`
    : null;

  // Save to conversation history
  try {
    db.prepare(`
      INSERT INTO conversation_messages (phone, role, content, inbound_message_id, created_at)
      VALUES (?, 'user', ?, ?, ?)
    `).run(sender_phone, message, messageId, now);
    db.prepare(`
      INSERT INTO conversation_messages (phone, role, content, created_at)
      VALUES (?, 'assistant', ?, ?)
    `).run(sender_phone, finalReply, now);
  } catch (_) {}

  // Record Communication log with 'sent' status (NEVER claim 'delivered' without provider confirmation)
  const commId = `MSG-${Date.now()}`;
  db.prepare(`
    INSERT INTO communication_logs (message_id, patient_id, channel, template_name, workflow_name, message_body, sent_at, delivery_status, response_status, correlation_id)
    VALUES (?, ?, ?, 'CHANNEL_REPLY', 'UNIFIED_CHANNEL_ADAPTER', ?, ?, 'sent', 'pending', ?)
  `).run(commId, sender_phone, channel, finalReply, now, `CORR-${messageId}`);

  res.json({
    success: true,
    channel,
    conversation_id: `CONV-${sender_phone}`,
    external_message_id: messageId,
    reply: finalReply,
    original_english_reply: turnResult.reply,
    detected_language: detectedLanguage,
    was_translated: wasTranslated,
    audio_url: responseAudioUrl,
    state: turnResult.state,
    action: turnResult.action || null,
    appointment_id: turnResult.appointmentId || null,
    verified: turnResult.verified || false
  });
});

// Phase 2: Provider Delivery Status Webhook (Tracks true delivery)
app.patch('/api/communication-logs/:id/delivery-status', (req, res) => {
  const { delivery_status } = req.body;
  const allowed = ['queued', 'sending', 'sent', 'delivered', 'read', 'failed'];
  if (!allowed.includes(delivery_status)) {
    return res.status(400).json({ success: false, error: `Invalid delivery_status. Allowed: ${allowed.join(', ')}` });
  }

  const result = db.prepare('UPDATE communication_logs SET delivery_status = ? WHERE message_id = ?').run(delivery_status, req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ success: false, error: 'Communication log not found' });
  }

  recordAuditLog({
    action: `MESSAGE_${delivery_status.toUpperCase()}`,
    recordId: req.params.id,
    result: delivery_status
  });

  res.json({ success: true, message_id: req.params.id, delivery_status });
});

// WhatsApp conversation memory. Keep only the most recent turns in prompts;
// the full audit trail remains available in this table.
app.get('/api/conversations/:phone', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const messages = db.prepare(`
    SELECT role, content, created_at
    FROM conversation_messages
    WHERE phone = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(req.params.phone, limit).reverse();
  res.json({ success: true, messages });
});

// Conversation inbox for front-desk staff. It intentionally exposes only a
// short preview; opening a thread fetches the full recent conversation.
app.get('/api/conversations', (req, res) => {
  const conversations = db.prepare(`
    SELECT c.phone, c.role, c.content, c.created_at, p.full_name AS patient_name
    FROM conversation_messages c
    JOIN (
      SELECT phone, MAX(id) AS latest_id
      FROM conversation_messages
      GROUP BY phone
    ) latest ON latest.latest_id = c.id
    LEFT JOIN patients p ON p.phone = c.phone
    ORDER BY c.id DESC
    LIMIT 50
  `).all();
  res.json({ success: true, conversations });
});

app.post('/api/conversations', (req, res) => {
  const { phone, user_message, assistant_message, inbound_message_id } = req.body;
  if (!phone || !user_message || !assistant_message) {
    return res.status(400).json({ success: false, error: 'phone, user_message, and assistant_message are required' });
  }

  const now = new Date().toISOString();
  try {
    db.exec('BEGIN');
    db.prepare(`
      INSERT INTO conversation_messages (phone, role, content, inbound_message_id, created_at)
      VALUES (?, 'user', ?, ?, ?)
    `).run(phone, user_message, inbound_message_id || null, now);
    db.prepare(`
      INSERT INTO conversation_messages (phone, role, content, created_at)
      VALUES (?, 'assistant', ?, ?)
    `).run(phone, assistant_message, now);
    db.exec('COMMIT');
    res.json({ success: true });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    if (err.message && err.message.includes('UNIQUE constraint failed: conversation_messages.inbound_message_id')) {
      return res.json({ success: true, note: 'Duplicate message ignored (idempotent)' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1. Patient Upsert & Lookup
app.post('/api/patients', (req, res) => {
  const { patient_id, full_name, phone, email, city, source } = req.body;
  const id = patient_id || `PAT-${Date.now()}`;
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT * FROM patients WHERE patient_id = ?').get(id);
  if (existing) {
    const fieldsToUpdate = [];
    const values = [];
    if (full_name) { fieldsToUpdate.push('full_name = ?'); values.push(full_name); }
    if (phone) { fieldsToUpdate.push('phone = ?'); values.push(phone); }
    if (email) { fieldsToUpdate.push('email = ?'); values.push(email); }
    if (city) { fieldsToUpdate.push('city = ?'); values.push(city); }
    if (source) { fieldsToUpdate.push('source = ?'); values.push(source); }
    fieldsToUpdate.push('updated_at = ?');
    values.push(now, id);
    db.prepare(`UPDATE patients SET ${fieldsToUpdate.join(', ')} WHERE patient_id = ?`).run(...values);
    return res.json({ success: true, patient_id: id, action: 'updated' });
  }

  db.prepare(`
    INSERT INTO patients (patient_id, full_name, phone, email, city, source, consent_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'granted', ?, ?)
  `).run(id, full_name || 'Unknown', phone || null, email || null, city || null, source || 'Direct', now, now);

  res.json({ success: true, patient_id: id, action: 'created' });
});

app.get('/api/patients', (req, res) => {
  const patients = db.prepare('SELECT * FROM patients ORDER BY created_at DESC LIMIT 100').all();
  res.json({ success: true, patients });
});

// 2. Doctor Slot Availability & Query (Supports both /api/slots and /api/doctor-slots)
const handleSlotQuery = (req, res) => {
  const { department, date, time_preference, service_id } = req.query;
  let targetDept = department;
  if (!targetDept && service_id) {
    const s = db.prepare('SELECT department FROM dental_services WHERE service_id = ?').get(service_id);
    if (s) targetDept = s.department;
  }
  let query = 'SELECT * FROM doctor_slots WHERE is_booked = 0';
  const params = [];
  if (targetDept) {
    query += ' AND department = ?';
    params.push(targetDept);
  }
  if (date) {
    query += ' AND slot_date = ?';
    params.push(date);
  }
  if (time_preference === 'morning') {
    query += " AND (slot_time LIKE '%AM%')";
  } else if (time_preference === 'afternoon') {
    query += " AND (slot_time LIKE '%PM%')";
  }
  query += ' ORDER BY slot_date ASC, slot_time ASC';
  const slots = db.prepare(query).all(...params);
  res.json({ success: true, count: slots.length, slots, available_slots: slots });
};

app.get('/api/doctor-slots', handleSlotQuery);
app.get('/api/slots', handleSlotQuery);

// 3. Lead Capture (Blueprint Section H & I)
app.post('/api/leads', (req, res) => {
  const { lead_id, patient_id, source, campaign, enquiry_text, department, priority, owner, status, appointment_id } = req.body;
  const id = lead_id || `LEAD-${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO leads (lead_id, patient_id, source, campaign, enquiry_text, department, priority, owner, status, first_response_at, appointment_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, patient_id || null, source || 'Direct', campaign || 'Q3-Campaign', enquiry_text || '', department || 'General Medicine', priority || 'normal', owner || 'Intake AI', status || 'qualified', now, appointment_id || null, now);

  res.json({ success: true, lead_id: id });
});

// 4. Appointment Create / Update with Atomic Slot Reservation & Verification (Gate A)
app.post('/api/appointments', (req, res) => {
  const { appointment_id, patient_id, patient_name, phone, department, service_id, doctor_id, doctor_name, slot_start, slot_end, status, slot_id, source, idempotency_key } = req.body;
  const id = appointment_id || (idempotency_key ? `APPT-${idempotency_key}` : `APPT-${Date.now()}`);
  const now = new Date().toISOString();
  const bookingSource = source || (req.body.booked_via || (phone ? 'WhatsApp Automation' : 'Manual'));

  // Idempotency: Return existing appointment if already created with this ID
  const existingAppt = db.prepare('SELECT * FROM appointments WHERE appointment_id = ?').get(id);
  if (existingAppt) {
    return res.json({ success: true, appointment_id: id, status: existingAppt.status, note: 'Idempotent request: appointment already exists' });
  }

  try {
    db.exec('BEGIN');

    // Atomic Slot Reservation: Enforce single-booking concurrency guarantee
    if (slot_id) {
      const reserved = db.prepare('UPDATE doctor_slots SET is_booked = 1 WHERE slot_id = ? AND is_booked = 0').run(slot_id);
      if (reserved.changes !== 1) {
        db.exec('ROLLBACK');
        return res.status(409).json({
          success: false,
          error_code: 'SLOT_ALREADY_BOOKED',
          error: 'Selected slot is no longer available or was reserved by another patient'
        });
      }
    }

    let resolvedPatientId = patient_id;
    if (!resolvedPatientId && phone) {
      const matchedPatient = db.prepare('SELECT patient_id FROM patients WHERE phone = ? LIMIT 1').get(phone);
      if (matchedPatient) {
        resolvedPatientId = matchedPatient.patient_id;
      }
    }

    if (!resolvedPatientId) {
      resolvedPatientId = `PAT-${Date.now()}`;
      const patientNow = new Date().toISOString();
      db.prepare(`
        INSERT INTO patients (patient_id, full_name, phone, source, consent_status, consent_source, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'opted_in', 'booking_flow', ?, ?)
      `).run(resolvedPatientId, patient_name || 'Patient', phone || null, bookingSource.includes('WhatsApp') ? 'WhatsApp' : 'Manual', patientNow, patientNow);
    }

    db.prepare(`
      INSERT INTO appointments (appointment_id, patient_id, department, service_id, doctor_id, doctor_name, slot_id, slot_start, slot_end, status, source, attendance_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
    `).run(id, resolvedPatientId, department || 'General Dentistry', service_id || 'srv_consult', doctor_id || null, doctor_name || null, slot_id || null, slot_start || null, slot_end || null, status || 'confirmed', bookingSource, now);

    // Backend Verification: Must prove row exists in system of record before confirming
    const verifyRow = db.prepare('SELECT * FROM appointments WHERE appointment_id = ? AND status = ?').get(id, status || 'confirmed');
    if (!verifyRow) {
      throw new Error('Database verification failed: appointment record could not be verified');
    }

    db.exec('COMMIT');

    recordAuditLog({
      action: 'APPOINTMENT_CREATED',
      recordId: id,
      result: 'success',
      metadata: { appointment_id: id, slot_id, patient_id: resolvedPatientId }
    });

    res.json({
      success: true,
      appointment_id: id,
      status: status || 'confirmed',
      slot_id: slot_id || null,
      verified: true
    });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// Phase 1 Verification Endpoint (Section 35 & Gate A)
app.get('/api/appointments/verify/:id', (req, res) => {
  const appointment = db.prepare(`
    SELECT a.*, p.full_name as patient_name, p.phone as patient_phone, p.consent_status,
           s.slot_date, s.slot_time, s.is_booked as slot_is_booked
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.patient_id
    LEFT JOIN doctor_slots s ON a.slot_id = s.slot_id
    WHERE a.appointment_id = ?
  `).get(req.params.id);

  if (!appointment) {
    return res.status(404).json({
      verified: false,
      error: 'Appointment record not found in system of record'
    });
  }

  const isVerified = appointment.status === 'confirmed' && (!appointment.slot_id || appointment.slot_is_booked === 1);

  res.json({
    verified: isVerified,
    appointment_id: appointment.appointment_id,
    status: appointment.status,
    patient_name: appointment.patient_name,
    doctor_name: appointment.doctor_name,
    department: appointment.department,
    slot_start: appointment.slot_start,
    slot_id: appointment.slot_id,
    slot_locked: appointment.slot_is_booked === 1
  });
});

// Phase 3: Explicit Cancellation Endpoint
app.post('/api/appointments/:id/cancel', (req, res) => {
  const appt = db.prepare('SELECT * FROM appointments WHERE appointment_id = ?').get(req.params.id);
  if (!appt) {
    return res.status(404).json({ success: false, error: 'Appointment not found' });
  }

  try {
    db.exec('BEGIN');
    db.prepare("UPDATE appointments SET status = 'cancelled' WHERE appointment_id = ?").run(req.params.id);
    if (appt.slot_id) {
      db.prepare("UPDATE doctor_slots SET is_booked = 0 WHERE slot_id = ?").run(appt.slot_id);
    }
    db.exec('COMMIT');

    recordAuditLog({
      action: 'APPOINTMENT_CANCELLED',
      recordId: req.params.id,
      result: 'cancelled',
      metadata: { appointment_id: req.params.id, slot_id: appt.slot_id }
    });

    res.json({
      success: true,
      appointment_id: req.params.id,
      status: 'cancelled',
      slot_released: appt.slot_id || null,
      message: 'Appointment successfully cancelled and slot released'
    });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// Phase 3: Atomic Slot Swap Rescheduling Endpoint (Section 32)
app.post('/api/appointments/:id/reschedule', (req, res) => {
  const { new_slot_id, new_slot_start, new_slot_end, new_doctor_id, new_doctor_name } = req.body;
  if (!new_slot_id) {
    return res.status(400).json({ success: false, error: 'new_slot_id is required for rescheduling' });
  }

  const appt = db.prepare('SELECT * FROM appointments WHERE appointment_id = ?').get(req.params.id);
  if (!appt) {
    return res.status(404).json({ success: false, error: 'Appointment not found' });
  }

  try {
    db.exec('BEGIN');

    // 1. Lock new slot (must succeed)
    const reserveNew = db.prepare('UPDATE doctor_slots SET is_booked = 1 WHERE slot_id = ? AND is_booked = 0').run(new_slot_id);
    if (reserveNew.changes !== 1) {
      db.exec('ROLLBACK');
      return res.status(409).json({
        success: false,
        error_code: 'SLOT_ALREADY_BOOKED',
        error: 'Target reschedule slot is already booked'
      });
    }

    // 2. Free old slot
    if (appt.slot_id) {
      db.prepare('UPDATE doctor_slots SET is_booked = 0 WHERE slot_id = ?').run(appt.slot_id);
    }

    // 3. Update appointment record
    db.prepare(`
      UPDATE appointments
      SET slot_id = ?, slot_start = ?, slot_end = ?, doctor_id = ?, doctor_name = ?, status = 'confirmed', updated_at = ?
      WHERE appointment_id = ?
    `).run(
      new_slot_id,
      new_slot_start || appt.slot_start,
      new_slot_end || appt.slot_end,
      new_doctor_id || appt.doctor_id,
      new_doctor_name || appt.doctor_name,
      new Date().toISOString(),
      req.params.id
    );

    db.exec('COMMIT');

    recordAuditLog({
      action: 'APPOINTMENT_RESCHEDULED',
      recordId: req.params.id,
      result: 'rescheduled',
      metadata: { appointment_id: req.params.id, old_slot_id: appt.slot_id, new_slot_id }
    });

    res.json({
      success: true,
      appointment_id: req.params.id,
      status: 'confirmed',
      old_slot_released: appt.slot_id || null,
      new_slot_locked: new_slot_id,
      message: 'Appointment successfully rescheduled with atomic slot swap'
    });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/appointments', (req, res) => {
  const appointments = db.prepare(`
    SELECT a.*, COALESCE(a.source, p.source, 'Manual') as source,
           p.full_name as patient_name, p.phone as patient_phone, p.source as patient_source
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.patient_id
    ORDER BY a.created_at DESC
    LIMIT 100
  `).all();
  res.json({ success: true, appointments });
});

// Schedule view: appointments grouped by doctor for a given date range
app.get('/api/appointments/schedule', (req, res) => {
  const appointments = db.prepare(`
    SELECT a.appointment_id, a.department, a.doctor_name, a.slot_start, a.slot_end,
           a.status, a.attendance_status, a.created_at,
           COALESCE(a.source, p.source, 'Manual') as source,
           p.full_name as patient_name, p.phone as patient_phone, p.source as patient_source
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.patient_id
    ORDER BY a.doctor_name ASC, a.slot_start ASC
  `).all();
  res.json({ success: true, appointments });
});

// Look up confirmed appointments by patient phone or session
app.get('/api/appointments/by-phone/:phone', (req, res) => {
  const phone = req.params.phone;
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const searchPattern = cleanPhone.length >= 7 ? `%${cleanPhone.slice(-8)}%` : `%${cleanPhone}%`;
  const appointments = db.prepare(`
    SELECT a.*, COALESCE(a.source, p.source, 'Manual') as source,
           p.full_name as patient_name, p.phone as patient_phone
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.patient_id
    WHERE p.phone = ? OR p.phone LIKE ?
    ORDER BY a.created_at DESC
  `).all(phone, searchPattern);
  res.json({ success: true, appointments });
});

app.get('/api/appointments/:id', (req, res) => {
  const appointment = db.prepare(`
    SELECT a.*, COALESCE(a.source, p.source, 'Manual') as source,
           p.full_name as patient_name, p.phone as patient_phone
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.patient_id
    WHERE a.appointment_id = ?
  `).get(req.params.id);

  if (!appointment) {
    return res.status(404).json({ success: false, error: 'Appointment not found' });
  }
  res.json({ success: true, appointment });
});

app.patch('/api/appointments/:id', (req, res) => {
  const { attendance_status, status } = req.body;
  const updates = [];
  const params = [];

  if (attendance_status) {
    updates.push('attendance_status = ?');
    params.push(attendance_status);
  }
  if (status) {
    updates.push('status = ?');
    params.push(status);
  }
  params.push(req.params.id);

  if (updates.length > 0) {
    db.prepare(`UPDATE appointments SET ${updates.join(', ')} WHERE appointment_id = ?`).run(...params);
  }

  const updated = db.prepare('SELECT * FROM appointments WHERE appointment_id = ?').get(req.params.id);
  res.json({ success: true, appointment: updated });
});

// 5. Follow-Up Task Management (Blueprint Section V: Tool 2 & Section R)
app.post('/api/follow-ups', (req, res) => {
  const { followup_id, patient_id, category, approved_date, approved_window, owner, status } = req.body;
  const id = followup_id || `FOL-${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO follow_ups (followup_id, patient_id, category, approved_date, approved_window, owner, status, attempt_count, next_action_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, patient_id, category || 'Post-Discharge', approved_date || now, approved_window || '48h', owner || 'Care Coordinator', status || 'pending', approved_date || now, now);

  res.json({ success: true, task_id: id, status: 'created' });
});

app.get('/api/follow-ups', (req, res) => {
  const tasks = db.prepare(`
    SELECT f.*, p.full_name as patient_name, p.phone as patient_phone
    FROM follow_ups f
    LEFT JOIN patients p ON f.patient_id = p.patient_id
    ORDER BY f.created_at DESC
    LIMIT 50
  `).all();
  res.json({ success: true, tasks });
});

// 6. Communication Logs with Idempotency Check (Blueprint Section Z)
app.get('/api/communication-logs/check', (req, res) => {
  const { appointment_id, template_name, correlation_id } = req.query;
  let stmt;
  if (correlation_id) {
    stmt = db.prepare('SELECT * FROM communication_logs WHERE correlation_id = ?');
    const match = stmt.get(correlation_id);
    return res.json({ exists: !!match, record: match || null });
  }
  if (appointment_id && template_name) {
    stmt = db.prepare('SELECT * FROM communication_logs WHERE template_name = ? AND message_body LIKE ?');
    const match = stmt.get(template_name, `%${appointment_id}%`);
    return res.json({ exists: !!match, record: match || null });
  }
  res.json({ exists: false });
});

app.post('/api/communication-logs', (req, res) => {
  const { message_id, patient_id, channel, template_name, workflow_name, message_body, delivery_status, response_status, correlation_id } = req.body;
  const id = message_id || `MSG-${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO communication_logs (message_id, patient_id, channel, template_name, workflow_name, message_body, sent_at, delivery_status, response_status, correlation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, patient_id || 'UNKNOWN', channel || 'whatsapp', template_name || 'DIRECT_MESSAGE', workflow_name || 'HOSPITAL_AI', message_body || '', now, delivery_status || 'delivered', response_status || 'delivered', correlation_id || `CORR-${Date.now()}`);

  res.json({ success: true, message_id: id });
});

app.get('/api/communication-logs', (req, res) => {
  const { patient_id, phone } = req.query;
  let query = `
    SELECT c.*, p.full_name as patient_name
    FROM communication_logs c
    LEFT JOIN patients p ON c.patient_id = p.patient_id
  `;
  const params = [];
  if (patient_id) {
    query += ' WHERE c.patient_id = ?';
    params.push(patient_id);
  } else if (phone) {
    query += ' WHERE c.patient_id = ? OR p.phone = ?';
    params.push(phone, phone);
  }
  query += ' ORDER BY c.sent_at DESC LIMIT 10';
  const logs = db.prepare(query).all(...params);
  res.json({ success: true, logs });
});

// 7. Exceptions Queue (Blueprint Section AA & G)
app.post('/api/exceptions', (req, res) => {
  const { exception_id, workflow_name, record_id, error_type, severity, owner, due_at, status, resolution_note } = req.body;
  const id = exception_id || `EXC-${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO exceptions (exception_id, workflow_name, record_id, error_type, severity, owner, due_at, status, resolution_note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, workflow_name || 'HOSPITAL_FLOW', record_id || 'N/A', error_type || 'Unknown Error', severity || 'medium', owner || 'Hospital Admin', due_at || now, status || 'open', resolution_note || null, now);

  res.json({ success: true, exception_id: id });
});

app.get('/api/exceptions', (req, res) => {
  const exceptions = db.prepare('SELECT * FROM exceptions ORDER BY created_at DESC LIMIT 50').all();
  res.json({ success: true, exceptions });
});

app.patch('/api/exceptions/:id', (req, res) => {
  const status = req.body.status === 'resolved' ? 'resolved' : 'open';
  const result = db.prepare('UPDATE exceptions SET status = ? WHERE exception_id = ?').run(status, req.params.id);
  if (result.changes !== 1) return res.status(404).json({ success: false, error: 'Exception not found' });
  res.json({ success: true, status });
});

// 8. Audit Logs
app.post('/api/audit-logs', (req, res) => {
  const { event_id, workflow_name, workflow_version, actor_type, action, record_id, correlation_id } = req.body;
  const id = event_id || `AUD-${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO audit_logs (event_id, workflow_name, workflow_version, actor_type, action, record_id, timestamp, correlation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, workflow_name || 'UNKNOWN', workflow_version || '1.0', actor_type || 'automation', action || 'EXECUTE', record_id || null, now, correlation_id || null);

  res.json({ success: true, event_id: id });
});

// 9. Daily Management Summary Metrics (Blueprint Section AA & V: Tool 3 + Production Audit Section 18)
app.get('/api/dashboard-metrics', (req, res) => {
  const leadsCount = db.prepare("SELECT count(*) as total, sum(CASE WHEN status != 'new' THEN 1 ELSE 0 END) as qualified FROM leads").get();
  const apptsCount = db.prepare("SELECT count(*) as total, sum(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmed, sum(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled, sum(CASE WHEN attendance_status = 'no_show' THEN 1 ELSE 0 END) as no_shows, sum(CASE WHEN attendance_status = 'attended' OR attendance_status = 'recovered' THEN 1 ELSE 0 END) as attended FROM appointments").get();
  const recoveredNoShows = db.prepare("SELECT count(*) as total FROM appointments WHERE attendance_status = 'recovered'").get();
  const followups = db.prepare("SELECT count(*) as total, sum(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending FROM follow_ups").get();
  const exceptions = db.prepare("SELECT count(*) as total, sum(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open, sum(CASE WHEN error_type = 'ACUTE_DENTAL_EMERGENCY' THEN 1 ELSE 0 END) as emergencies FROM exceptions").get();
  const commsCount = db.prepare("SELECT count(*) as total, sum(CASE WHEN delivery_status = 'delivered' THEN 1 ELSE 0 END) as delivered, sum(CASE WHEN delivery_status = 'sent' THEN 1 ELSE 0 END) as sent FROM communication_logs").get();
  const auditCount = db.prepare("SELECT count(*) as total FROM audit_logs").get();
  const whatsappAppts = db.prepare(`
    SELECT count(*) as total 
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.patient_id
    WHERE a.source LIKE '%WhatsApp%' OR a.source LIKE '%automation%' OR p.source = 'WhatsApp'
  `).get();

  const deptDistribution = db.prepare(`
    SELECT department, count(*) as count 
    FROM appointments 
    GROUP BY department
  `).all();

  res.json({
    success: true,
    clinic: getClinicConfig(),
    metrics: {
      new_leads: leadsCount.total || 0,
      qualified_leads: leadsCount.qualified || 0,
      booked_appointments: apptsCount.total || 0,
      confirmed_appointments: apptsCount.confirmed || 0,
      cancelled_appointments: apptsCount.cancelled || 0,
      whatsapp_appointments: whatsappAppts.total || 0,
      no_shows: apptsCount.no_shows || 0,
      recovered_no_shows: recoveredNoShows.total || 0,
      pending_follow_ups: followups.pending || 0,
      open_exceptions: exceptions.open || 0,
      emergency_exceptions: exceptions.emergencies || 0,
      total_messages_logged: commsCount.total || 0,
      verified_delivered_messages: commsCount.delivered || 0,
      total_audit_events: auditCount.total || 0,
      department_distribution: deptDistribution
    }
  });
});

app.listen(PORT, () => {
  console.log(`DemoCare Multispeciality Hospital Mock Service running on http://localhost:${PORT}`);
});
