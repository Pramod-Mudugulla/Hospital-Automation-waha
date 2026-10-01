/**
 * conversation_engine.js
 * Multi-Turn Deterministic Healthcare & Dental Conversation Engine
 * Implements Production Audit Gates A, B, C, E:
 * - Persistent conversation state machine
 * - Configurable dental services and specialists
 * - Strict multi-turn booking with explicit patient confirmation
 * - Atomic DB reservation & verification (zero false-success)
 * - Clinical emergency interception & triage guardrails
 * - Human front-desk escalation queue
 * - Cancellation & Rescheduling with atomic slot swap
 */

const { db } = require('./db');

// Supported states in the booking & care state machine
const STATES = {
  NEW: 'NEW',
  IDENTIFYING: 'IDENTIFYING',
  COLLECTING_SERVICE: 'COLLECTING_SERVICE',
  COLLECTING_DATE: 'COLLECTING_DATE',
  OFFERING_SLOTS: 'OFFERING_SLOTS',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  BOOKED: 'BOOKED',
  AWAITING_CANCEL_CONFIRMATION: 'AWAITING_CANCEL_CONFIRMATION',
  CANCELLED: 'CANCELLED',
  AWAITING_RESCHEDULE_SELECTION: 'AWAITING_RESCHEDULE_SELECTION',
  AWAITING_RESCHEDULE_CONFIRMATION: 'AWAITING_RESCHEDULE_CONFIRMATION',
  RESCHEDULED: 'RESCHEDULED',
  HUMAN_REVIEW: 'HUMAN_REVIEW'
};

// Emergency keywords requiring immediate clinical safety triage
const EMERGENCY_REGEX = /(severe\s+pain|unbearable\s+pain|bleeding\s+heavily|heavy\s+bleeding|unconscious|cannot\s+breathe|trouble\s+breathing|swelling\s+eye|facial\s+swelling|broken\s+jaw|trauma|fever.*tooth|tooth.*fever)/i;

// Human handoff triggers
const HUMAN_HANDOFF_REGEX = /(speak\s+to\s+a\s+human|human|receptionist|agent|talk\s+to\s+someone|manager|front\s+desk|dispute|complaint|billing\s+issue)/i;

// Medical advice / prescription boundaries
const MEDICAL_ADVICE_REGEX = /(what|which|can\s+you|should\s+i|prescribe|recommend)\s+.*(antibiotic|medicine|medication|painkiller|pill|drug|dosage)|(prescribe|diagnose|do\s+i\s+have\s+cancer|what\s+disease)/i;

// Fetch clinic profile
function getClinicConfig(clinicId = 'apex_dental') {
  const config = db.prepare('SELECT * FROM clinic_configs WHERE clinic_id = ?').get(clinicId);
  return config || {
    clinic_id: 'apex_dental',
    name: 'Apex Dental Care & Implant Center',
    specialty: 'Advanced Comprehensive & Emergency Dentistry',
    phone: '+1-800-555-DENT',
    emergency_hotline: '+1-800-555-9111 (24/7 Dental Emergency)',
    address: '742 Evergreen Terrace, Medical Suite 300, New York, NY 10001',
    business_hours: 'Mon-Fri: 8:00 AM - 6:00 PM, Sat: 9:00 AM - 2:00 PM'
  };
}

// Fetch active conversation state for phone
function getConversationState(phone, clinicId = 'apex_dental') {
  let stateRow = db.prepare('SELECT * FROM conversation_states WHERE phone = ?').get(phone);
  if (!stateRow) {
    const sessionId = `SESS-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO conversation_states (session_id, clinic_id, phone, current_state, collected_data, last_interaction_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, clinicId, phone, STATES.NEW, JSON.stringify({}), now);
    stateRow = {
      session_id: sessionId,
      clinic_id: clinicId,
      phone,
      current_state: STATES.NEW,
      collected_data: '{}',
      last_interaction_at: now
    };
  }
  let parsedData = {};
  try {
    parsedData = JSON.parse(stateRow.collected_data || '{}');
  } catch (_) {}
  return { ...stateRow, data: parsedData };
}

// Update conversation state in DB
function updateConversationState(phone, newState, collectedData = {}, pendingAction = null) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE conversation_states
    SET current_state = ?, collected_data = ?, pending_action = ?, last_interaction_at = ?
    WHERE phone = ?
  `).run(newState, JSON.stringify(collectedData), pendingAction, now, phone);
}

// Service resolution from natural text
function resolveDentalService(text) {
  const clean = text.toLowerCase();
  const services = db.prepare('SELECT * FROM dental_services').all();

  if (/clean|hygiene|scale|prophylaxis|tartar/i.test(clean)) {
    return services.find(s => s.service_id === 'srv_cleaning') || services[0];
  }
  if (/pain|ache|hurt|emergency|broken\s*tooth|crack/i.test(clean)) {
    return services.find(s => s.service_id === 'srv_tooth_pain') || services[0];
  }
  if (/root\s*canal|endodont/i.test(clean)) {
    return services.find(s => s.service_id === 'srv_root_canal') || services[0];
  }
  if (/extract|wisdom|pull.*tooth|remove.*tooth/i.test(clean)) {
    return services.find(s => s.service_id === 'srv_extraction') || services[0];
  }
  if (/brace|align|ortho|invisalign|crooked/i.test(clean)) {
    return services.find(s => s.service_id === 'srv_ortho') || services[0];
  }
  if (/white|bleach|brighten/i.test(clean)) {
    return services.find(s => s.service_id === 'srv_whitening') || services[0];
  }
  if (/kid|child|pediatric/i.test(clean)) {
    return services.find(s => s.service_id === 'srv_pediatric') || services[0];
  }
  if (/checkup|exam|consult|look\s*at/i.test(clean)) {
    return services.find(s => s.service_id === 'srv_consult') || services[0];
  }
  return null;
}

// Extract date preference from text
function resolveDatePreference(text) {
  const clean = text.toLowerCase();
  const today = new Date();
  
  if (clean.includes('today')) {
    return today.toISOString().split('T')[0];
  }
  if (clean.includes('tomorrow')) {
    const tmrw = new Date(today);
    tmrw.setDate(today.getDate() + 1);
    return tmrw.toISOString().split('T')[0];
  }
  
  // Specific ISO date match (e.g. 2026-10-05)
  const isoMatch = text.match(/\b(202\d-[01]\d-[0-3]\d)\b/);
  if (isoMatch) return isoMatch[1];

  return null;
}

// Extract time preference
function resolveTimePreference(text) {
  const clean = text.toLowerCase();
  if (clean.includes('morning') || clean.includes('am')) return 'morning';
  if (clean.includes('afternoon') || clean.includes('pm') || clean.includes('evening')) return 'afternoon';
  return null;
}

// Write immutable audit log
function recordAuditLog({ workflowName = 'CONVERSATION_ENGINE', actorType = 'patient_assistant', action, recordId, result = 'success', metadata = null, correlationId = null }) {
  const eventId = `AUD-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO audit_logs (event_id, clinic_id, workflow_name, workflow_version, actor_type, actor_id, action, resource_type, record_id, result, metadata, timestamp, correlation_id)
    VALUES (?, 'apex_dental', ?, '2.0', ?, 'engine', ?, 'appointment', ?, ?, ?, ?, ?)
  `).run(
    eventId,
    workflowName,
    actorType,
    action,
    recordId || null,
    result,
    metadata ? JSON.stringify(metadata) : null,
    now,
    correlationId || null
  );
  return eventId;
}

/**
 * Main conversational step processor
 * @param {Object} params
 * @param {string} params.phone - Patient's normalized phone number
 * @param {string} params.message - Raw text message received
 * @param {string} [params.patientName] - Optional known patient name
 * @param {string} [params.channel] - 'whatsapp' | 'instagram' | 'web' | 'sms'
 * @param {string} [params.inboundMessageId] - Deduplication ID
 */
async function processConversationTurn({ phone, message, patientName = null, channel = 'whatsapp', inboundMessageId = null }) {
  const clinic = getClinicConfig();
  const conv = getConversationState(phone, clinic.clinic_id);
  const text = (message || '').trim();
  const lowerText = text.toLowerCase();
  let state = conv.current_state;
  let data = conv.data;

  // 1. Clinical Emergency Interceptor (P0 Safety Rule)
  if (EMERGENCY_REGEX.test(text)) {
    const excId = `EXC-${Date.now()}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO exceptions (exception_id, workflow_name, record_id, error_type, severity, owner, due_at, status, resolution_note, created_at)
      VALUES (?, 'CLINICAL_SAFETY_INTERCEPTOR', ?, 'ACUTE_DENTAL_EMERGENCY', 'urgent', 'On-Call Dental Surgeon', ?, 'open', ?, ?)
    `).run(excId, phone, now, `Patient reported urgent symptoms: "${text}"`, now);

    recordAuditLog({
      action: 'CLINICAL_EMERGENCY_INTERCEPTED',
      recordId: excId,
      result: 'escalated',
      metadata: { phone, text }
    });

    updateConversationState(phone, STATES.HUMAN_REVIEW, { ...data, lastEmergency: text }, 'EMERGENCY_ESCALATION');

    return {
      reply: `⚠️ EMERGENCY CARE NOTICE: If you are experiencing severe pain, uncontrolled bleeding, facial swelling extending to your neck or eye, or difficulty breathing, please seek immediate emergency care.\n\n` +
             `🏥 Emergency Clinic Address: ${clinic.address}\n` +
             `📞 24/7 Dental Emergency Hotline: ${clinic.emergency_hotline}\n` +
             `Our clinical on-call team has been immediately alerted to your message.`,
      state: STATES.HUMAN_REVIEW,
      action: 'emergency_escalated',
      exceptionId: excId
    };
  }

  // 2. Human Escalation Request (Section 13)
  if (HUMAN_HANDOFF_REGEX.test(text)) {
    const excId = `EXC-${Date.now()}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO exceptions (exception_id, workflow_name, record_id, error_type, severity, owner, due_at, status, resolution_note, created_at)
      VALUES (?, 'HUMAN_HANDOFF_REQUEST', ?, 'PATIENT_REQUESTED_STAFF', 'high', 'Front Desk Coordinator', ?, 'open', ?, ?)
    `).run(excId, phone, now, `Patient requested human staff: "${text}"`, now);

    recordAuditLog({
      action: 'HUMAN_ESCALATION',
      recordId: excId,
      result: 'transferred',
      metadata: { phone, text }
    });

    updateConversationState(phone, STATES.HUMAN_REVIEW, { ...data, handoffReason: text }, 'HUMAN_REVIEW');

    return {
      reply: `I understand! I have connected your request directly with our Front Desk Coordinator at ${clinic.name}.\n\n` +
             `A receptionist will review our conversation and contact you shortly at this number. For immediate assistance, you can also call us directly at ${clinic.phone}.`,
      state: STATES.HUMAN_REVIEW,
      action: 'human_escalated',
      exceptionId: excId
    };
  }

  // 3. Medical Advice Disclaimer Guardrail (Section 14)
  if (MEDICAL_ADVICE_REGEX.test(text)) {
    return {
      reply: `As an administrative healthcare assistant, I cannot legally diagnose conditions, recommend medications, or prescribe dosages.\n\n` +
             `Our licensed dental surgeons at ${clinic.name} can examine you and provide full clinical care. Would you like to schedule an in-person consultation or emergency exam?`,
      state,
      action: 'medical_advice_refused'
    };
  }

  // 4. Cancellation Flow (Section 31)
  if (/cancel\s*(my)?\s*app(oint)?ment/i.test(text) || state === STATES.AWAITING_CANCEL_CONFIRMATION) {
    if (state === STATES.AWAITING_CANCEL_CONFIRMATION) {
      if (/yes|confirm|cancel\s*it|sure|please/i.test(lowerText) && !/no|don't|keep/i.test(lowerText)) {
        const apptId = data.appointmentToCancel;
        if (!apptId) {
          updateConversationState(phone, STATES.NEW, {});
          return { reply: "No pending appointment was found to cancel. How else may I assist you today?", state: STATES.NEW };
        }

        // Execute atomic cancellation & slot release
        try {
          db.exec('BEGIN');
          const appt = db.prepare('SELECT * FROM appointments WHERE appointment_id = ?').get(apptId);
          if (appt) {
            db.prepare("UPDATE appointments SET status = 'cancelled' WHERE appointment_id = ?").run(apptId);
            if (appt.slot_id) {
              db.prepare("UPDATE doctor_slots SET is_booked = 0 WHERE slot_id = ?").run(appt.slot_id);
            }
          }
          db.exec('COMMIT');

          recordAuditLog({
            action: 'APPOINTMENT_CANCELLED',
            recordId: apptId,
            result: 'cancelled',
            metadata: { phone, apptId, slot_id: appt ? appt.slot_id : null }
          });

          updateConversationState(phone, STATES.CANCELLED, {});
          return {
            reply: `✅ Your appointment #${apptId} has been successfully cancelled, and the time slot has been released back into our schedule. If you wish to re-book in the future, just send us a message!`,
            state: STATES.CANCELLED,
            action: 'appointment_cancelled',
            appointmentId: apptId
          };
        } catch (err) {
          try { db.exec('ROLLBACK'); } catch (_) {}
          return { reply: "An error occurred while cancelling your appointment. Please contact our front desk at " + clinic.phone, state };
        }
      } else {
        updateConversationState(phone, STATES.NEW, {});
        return { reply: "Your appointment cancellation has been called off. Your booking remains active and confirmed!", state: STATES.NEW };
      }
    } else {
      // Find active appointment for phone
      const activeAppt = db.prepare(`
        SELECT a.*, p.full_name as patient_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.patient_id
        WHERE p.phone = ? AND a.status = 'confirmed'
        ORDER BY a.created_at DESC
        LIMIT 1
      `).get(phone);

      if (!activeAppt) {
        return {
          reply: `I checked our system, but could not locate an active confirmed appointment under the number ${phone}. Would you like to schedule a new visit?`,
          state: STATES.NEW
        };
      }

      data.appointmentToCancel = activeAppt.appointment_id;
      updateConversationState(phone, STATES.AWAITING_CANCEL_CONFIRMATION, data, 'CANCEL_CONFIRMATION');

      return {
        reply: `I found your confirmed appointment:\n` +
               `📅 Appointment ID: #${activeAppt.appointment_id}\n` +
               `🩺 Service: ${activeAppt.department}\n` +
               `👨‍⚕️ Provider: ${activeAppt.doctor_name || 'Assigned Specialist'}\n` +
               `⏰ Time: ${activeAppt.slot_start || 'Scheduled Slot'}\n\n` +
               `Are you sure you would like to cancel this appointment? Please reply with *Yes, cancel* to confirm, or *No* to keep it.`,
        state: STATES.AWAITING_CANCEL_CONFIRMATION
      };
    }
  }

  // 5. Rescheduling Flow (Section 32)
  if (/reschedule/i.test(text) || state === STATES.AWAITING_RESCHEDULE_SELECTION || state === STATES.AWAITING_RESCHEDULE_CONFIRMATION) {
    if (state === STATES.AWAITING_RESCHEDULE_CONFIRMATION) {
      if (/yes|confirm|proceed|ok/i.test(lowerText)) {
        const apptId = data.appointmentToReschedule;
        const newSlot = data.selectedSlot;

        if (!apptId || !newSlot) {
          updateConversationState(phone, STATES.NEW, {});
          return { reply: "Rescheduling session expired. Please let me know if you would like to reschedule.", state: STATES.NEW };
        }

        // Execute Atomic Slot Swap Transaction (P0 Concurrency Rule)
        try {
          db.exec('BEGIN');
          // 1. Lock new slot
          const reserveNew = db.prepare('UPDATE doctor_slots SET is_booked = 1 WHERE slot_id = ? AND is_booked = 0').run(newSlot.slot_id);
          if (reserveNew.changes !== 1) {
            db.exec('ROLLBACK');
            return {
              reply: `I'm sorry, that selected time slot was just claimed by another patient. Let's find another opening for you! What other date or time works?`,
              state: STATES.AWAITING_RESCHEDULE_SELECTION
            };
          }

          // 2. Free old slot
          const oldAppt = db.prepare('SELECT slot_id FROM appointments WHERE appointment_id = ?').get(apptId);
          if (oldAppt && oldAppt.slot_id) {
            db.prepare('UPDATE doctor_slots SET is_booked = 0 WHERE slot_id = ?').run(oldAppt.slot_id);
          }

          // 3. Update appointment
          db.prepare(`
            UPDATE appointments
            SET doctor_id = ?, doctor_name = ?, slot_start = ?, slot_end = ?, slot_id = ?, department = ?, updated_at = ?
            WHERE appointment_id = ?
          `).run(
            newSlot.doctor_id,
            newSlot.doctor_name,
            `${newSlot.slot_date} ${newSlot.slot_time}`,
            newSlot.slot_time,
            newSlot.slot_id,
            newSlot.department,
            new Date().toISOString(),
            apptId
          );

          db.exec('COMMIT');

          recordAuditLog({
            action: 'APPOINTMENT_RESCHEDULED',
            recordId: apptId,
            result: 'rescheduled',
            metadata: { apptId, oldSlotId: oldAppt ? oldAppt.slot_id : null, newSlotId: newSlot.slot_id }
          });

          updateConversationState(phone, STATES.RESCHEDULED, {});
          return {
            reply: `🎉 Your appointment has been successfully rescheduled!\n\n` +
                   `📋 Appointment ID: #${apptId}\n` +
                   `👨‍⚕️ Doctor: ${newSlot.doctor_name}\n` +
                   `📅 New Date: ${newSlot.slot_date}\n` +
                   `⏰ New Time: ${newSlot.slot_time}\n` +
                   `📍 Location: ${clinic.address}\n\n` +
                   `We look forward to seeing you then!`,
            state: STATES.RESCHEDULED,
            action: 'appointment_rescheduled',
            appointmentId: apptId
          };
        } catch (err) {
          try { db.exec('ROLLBACK'); } catch (_) {}
          console.error('Reschedule transaction error:', err.message);
          return { reply: "Unable to complete reschedule at this time. Please call " + clinic.phone, state, error: err.message };
        }
      }
    } else {
      // Find active appointment
      const activeAppt = db.prepare(`
        SELECT a.*, p.full_name as patient_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.patient_id
        WHERE p.phone = ? AND a.status = 'confirmed'
        ORDER BY a.created_at DESC
        LIMIT 1
      `).get(phone);

      if (!activeAppt) {
        return {
          reply: `I could not find an existing confirmed appointment under your number to reschedule. Would you like to book a new appointment instead?`,
          state: STATES.NEW
        };
      }

      data.appointmentToReschedule = activeAppt.appointment_id;
      // Fetch open slots for doctor/department
      const openSlots = db.prepare(`
        SELECT * FROM doctor_slots
        WHERE department = ? AND is_booked = 0
        ORDER BY slot_date ASC, slot_time ASC
        LIMIT 3
      `).all(activeAppt.department);

      if (openSlots.length === 0) {
        return {
          reply: `We found your appointment with ${activeAppt.doctor_name}, but currently do not have other open slots in ${activeAppt.department}. Our front desk can assist you with special scheduling: ${clinic.phone}`,
          state: STATES.NEW
        };
      }

      data.offeredSlots = openSlots;
      data.selectedSlot = openSlots[0];
      updateConversationState(phone, STATES.AWAITING_RESCHEDULE_CONFIRMATION, data);

      return {
        reply: `I can help reschedule your appointment #${activeAppt.appointment_id}.\n` +
               `Here is the earliest available opening:\n` +
               `👉 ${openSlots[0].slot_date} at ${openSlots[0].slot_time} with ${openSlots[0].doctor_name}\n\n` +
               `Would you like me to reschedule your visit to this time? (Reply *Yes* to confirm)`,
        state: STATES.AWAITING_RESCHEDULE_CONFIRMATION
      };
    }
  }

  // 6. Explicit Patient Confirmation for Booking (P0.5 Gate A Rule)
  if (state === STATES.AWAITING_CONFIRMATION) {
    if (/yes|confirm|book|sure|perfect|sounds\s*good|that\s*works|please/i.test(lowerText) && !/no|don't|cancel/i.test(lowerText)) {
      const selectedSlot = data.selectedSlot;
      const service = data.service || { name: 'Dental Consultation', department: 'General Dentistry' };

      if (!selectedSlot || !selectedSlot.slot_id) {
        updateConversationState(phone, STATES.NEW, {});
        return {
          reply: "Your booking session has timed out or was reset. Which dental service would you like to schedule?",
          state: STATES.NEW
        };
      }

      // Execute Atomic Database Write & Verification (P0.1, P0.4)
      const now = new Date().toISOString();
      const apptId = `APPT-${Date.now()}`;
      let patientId = data.patientId;

      try {
        db.exec('BEGIN');

        // 1. ATOMIC SLOT RESERVATION: Fail immediately if another patient secured it
        const slotReservation = db.prepare(`
          UPDATE doctor_slots
          SET is_booked = 1
          WHERE slot_id = ? AND is_booked = 0
        `).run(selectedSlot.slot_id);

        if (slotReservation.changes !== 1) {
          db.exec('ROLLBACK');
          // Offer other slots, never send false success!
          const altSlots = db.prepare(`
            SELECT * FROM doctor_slots
            WHERE department = ? AND is_booked = 0
            ORDER BY slot_date ASC, slot_time ASC
            LIMIT 2
          `).all(selectedSlot.department);

          data.offeredSlots = altSlots;
          updateConversationState(phone, STATES.OFFERING_SLOTS, data);

          let altText = altSlots.map((s, idx) => `${idx + 1}. ${s.slot_date} at ${s.slot_time} (with ${s.doctor_name})`).join('\n');
          return {
            reply: `⚠️ The ${selectedSlot.slot_date} at ${selectedSlot.slot_time} slot was just reserved by another patient. ` +
                   `We have these alternative openings available:\n${altText}\n\nWhich of these would you prefer?`,
            state: STATES.OFFERING_SLOTS,
            error: 'SLOT_ALREADY_BOOKED'
          };
        }

        // 2. Patient Record Creation / Upsert with Real Consent Tracking (P0.3)
        let existingPatient = db.prepare('SELECT * FROM patients WHERE phone = ? LIMIT 1').get(phone);
        if (!existingPatient) {
          patientId = `PAT-${Date.now()}`;
          db.prepare(`
            INSERT INTO patients (patient_id, full_name, phone, source, consent_status, consent_source, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'opted_in', 'whatsapp_explicit_booking', ?, ?)
          `).run(patientId, patientName || data.patientName || 'Patient', phone, channel, now, now);
        } else {
          patientId = existingPatient.patient_id;
        }

        // 3. Insert Appointment Record
        db.prepare(`
          INSERT INTO appointments (appointment_id, patient_id, department, service_id, doctor_id, doctor_name, slot_id, slot_start, slot_end, status, source, attendance_status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, 'scheduled', ?)
        `).run(
          apptId,
          patientId,
          selectedSlot.department,
          service.service_id || 'srv_consult',
          selectedSlot.doctor_id,
          selectedSlot.doctor_name,
          selectedSlot.slot_id,
          `${selectedSlot.slot_date} ${selectedSlot.slot_time}`,
          selectedSlot.slot_time,
          `${channel.toUpperCase()} Automation`,
          now
        );

        // 4. Create Lead Record
        db.prepare(`
          INSERT INTO leads (lead_id, patient_id, source, campaign, enquiry_text, department, priority, owner, status, first_response_at, appointment_id, created_at)
          VALUES (?, ?, ?, 'Direct-Booking', ?, ?, 'high', 'Apex Dental AI', 'booked', ?, ?, ?)
        `).run(`LEAD-${Date.now()}`, patientId, channel, `Booked ${service.name}`, selectedSlot.department, now, apptId, now);

        // 5. Verification step: Confirm database write actually exists! (P0.1)
        const verificationCheck = db.prepare('SELECT * FROM appointments WHERE appointment_id = ? AND status = ?').get(apptId, 'confirmed');
        if (!verificationCheck) {
          throw new Error('Database verification failed: appointment record not verified');
        }

        db.exec('COMMIT');

        // Log Communication Record with 'sent' (NOT fake 'delivered') (P0.2)
        const commId = `MSG-${Date.now()}`;
        db.prepare(`
          INSERT INTO communication_logs (message_id, patient_id, channel, template_name, workflow_name, message_body, sent_at, delivery_status, response_status, correlation_id)
          VALUES (?, ?, ?, 'BOOKING_CONFIRMATION', 'CONVERSATION_ENGINE', ?, ?, 'sent', 'pending', ?)
        `).run(commId, patientId, channel, `Booking confirmed for ${apptId}`, now, `CORR-${apptId}`);

        // Record Immutable Audit Log
        recordAuditLog({
          action: 'APPOINTMENT_CREATED',
          recordId: apptId,
          result: 'success',
          metadata: { apptId, slot_id: selectedSlot.slot_id, patientId, phone }
        });

        updateConversationState(phone, STATES.BOOKED, { lastAppointmentId: apptId });

        return {
          reply: `🎉 Wonderful! Your dental appointment has been officially confirmed and reserved in our clinic system.\n\n` +
                 `📋 Appointment Reference: #${apptId}\n` +
                 `🩺 Service: ${service.name}\n` +
                 `👨‍⚕️ Specialist: ${selectedSlot.doctor_name} (${selectedSlot.department})\n` +
                 `📅 Date: ${selectedSlot.slot_date}\n` +
                 `⏰ Time: ${selectedSlot.slot_time}\n` +
                 `📍 Address: ${clinic.address}\n\n` +
                 `Please arrive 10 minutes early. If you need any directions or adjustments, reply here anytime!`,
          state: STATES.BOOKED,
          action: 'appointment_confirmed',
          appointmentId: apptId,
          verified: true
        };

      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        recordAuditLog({
          action: 'APPOINTMENT_BOOKING_FAILED',
          result: 'failed',
          metadata: { phone, error: err.message }
        });
        return {
          reply: `We encountered an issue securing that slot. Our front desk has been notified and will assist you directly at ${clinic.phone}.`,
          state: STATES.HUMAN_REVIEW,
          error: err.message
        };
      }
    } else {
      // Patient rejected the proposed slot
      updateConversationState(phone, STATES.NEW, {});
      return {
        reply: "No problem at all! Let me know what date, time of day, or specific dental service works better for you, and I will gladly find alternatives.",
        state: STATES.NEW
      };
    }
  }

  // 7. Slot Selection from Offered Slots
  if (state === STATES.OFFERING_SLOTS && data.offeredSlots && data.offeredSlots.length > 0) {
    let chosen = null;
    if (lowerText.includes('1') || lowerText.includes('first') || lowerText.includes(data.offeredSlots[0].slot_time.toLowerCase())) {
      chosen = data.offeredSlots[0];
    } else if (data.offeredSlots[1] && (lowerText.includes('2') || lowerText.includes('second') || lowerText.includes(data.offeredSlots[1].slot_time.toLowerCase()))) {
      chosen = data.offeredSlots[1];
    } else if (data.offeredSlots[2] && (lowerText.includes('3') || lowerText.includes('third') || lowerText.includes(data.offeredSlots[2].slot_time.toLowerCase()))) {
      chosen = data.offeredSlots[2];
    } else {
      // Try fuzzy time match
      chosen = data.offeredSlots.find(s => lowerText.includes(s.slot_time.replace(/[^0-9]/g, '')));
    }

    if (chosen) {
      data.selectedSlot = chosen;
      updateConversationState(phone, STATES.AWAITING_CONFIRMATION, data);
      return {
        reply: `Great choice! I have marked **${chosen.slot_date} at ${chosen.slot_time}** with **${chosen.doctor_name}** (${chosen.department}).\n\n` +
               `Shall I confirm and officially book this appointment for you? (Please reply **Yes** to confirm)`,
        state: STATES.AWAITING_CONFIRMATION,
        selectedSlot: chosen
      };
    }
  }

  // 8. General Dental Service Inquiry & Booking Initiation
  const detectedService = resolveDentalService(text);
  const detectedDate = resolveDatePreference(text);
  const detectedTimePref = resolveTimePreference(text);

  if (detectedService || /book|appointment|schedule|visit|see\s*a\s*dentist|cleaning|tooth/i.test(text)) {
    const service = detectedService || {
      service_id: 'srv_consult',
      name: 'General Dental Consultation',
      department: 'General Dentistry'
    };
    data.service = service;

    // Query real available slots matching the service department
    let slotQuery = `
      SELECT * FROM doctor_slots
      WHERE department = ? AND is_booked = 0
    `;
    const params = [service.department];

    if (detectedDate) {
      slotQuery += ' AND slot_date = ?';
      params.push(detectedDate);
    }
    if (detectedTimePref === 'morning') {
      slotQuery += " AND (slot_time LIKE '%AM%')";
    } else if (detectedTimePref === 'afternoon') {
      slotQuery += " AND (slot_time LIKE '%PM%')";
    }
    slotQuery += ' ORDER BY slot_date ASC, slot_time ASC LIMIT 3';

    let availableSlots = db.prepare(slotQuery).all(...params);

    // Fallback if specific filtered date has no slots: find next available in that department
    if (availableSlots.length === 0) {
      availableSlots = db.prepare(`
        SELECT * FROM doctor_slots
        WHERE department = ? AND is_booked = 0
        ORDER BY slot_date ASC, slot_time ASC
        LIMIT 3
      `).all(service.department);
    }

    if (availableSlots.length === 0) {
      return {
        reply: `We currently do not have open online slots for ${service.name}. Our clinic team can arrange a priority consultation for you—please call our reception at ${clinic.phone}.`,
        state: STATES.NEW
      };
    }

    data.offeredSlots = availableSlots;

    let slotListText = availableSlots.map((s, i) => `Option ${i + 1}: 📅 ${s.slot_date} at ⏰ ${s.slot_time} (${s.doctor_name})`).join('\n');

    // If patient already gave very specific time or we offer the slots:
    if (availableSlots.length === 1 || (detectedDate && detectedTimePref)) {
      data.selectedSlot = availableSlots[0];
      updateConversationState(phone, STATES.AWAITING_CONFIRMATION, data);
      return {
        reply: `I found an available opening for **${service.name}**:\n\n` +
               `👉 **${availableSlots[0].slot_date} at ${availableSlots[0].slot_time}** with **${availableSlots[0].doctor_name}**\n\n` +
               `Would you like me to book this appointment for you? (Please reply with **Yes** to confirm)`,
        state: STATES.AWAITING_CONFIRMATION,
        offeredSlots: availableSlots
      };
    }

    updateConversationState(phone, STATES.OFFERING_SLOTS, data);
    return {
      reply: `I would be happy to help schedule your **${service.name}** at ${clinic.name}!\n\n` +
             `Here are the next available openings:\n` +
             `${slotListText}\n\n` +
             `Which option works best for you? (Reply with **Option 1**, **Option 2**, or your preferred time)`,
      state: STATES.OFFERING_SLOTS,
      offeredSlots: availableSlots
    };
  }

  // 9. Informational Inquiries (Hours, Address, Pricing, Services)
  if (/hour|open|close|timing/i.test(text)) {
    return {
      reply: `Apex Dental Clinic Hours:\n${clinic.business_hours}\nFor after-hours dental emergencies, our 24/7 hotline is ${clinic.emergency_hotline}.`,
      state: STATES.NEW
    };
  }
  if (/where|location|address|directions/i.test(text)) {
    return {
      reply: `Our clinic is located at:\n📍 ${clinic.address}\nWe have reserved patient parking in the building!`,
      state: STATES.NEW
    };
  }
  if (/price|cost|fee|charge/i.test(text)) {
    const services = db.prepare('SELECT name, base_fee FROM dental_services LIMIT 5').all();
    const priceList = services.map(s => `• ${s.name}: from $${s.base_fee}`).join('\n');
    return {
      reply: `Here are sample consultation and service estimates at ${clinic.name}:\n${priceList}\n\nWe accept all major PPO insurance plans. Would you like to schedule an examination?`,
      state: STATES.NEW
    };
  }

  // Default Welcoming Reception Greeting
  return {
    reply: `Hello! Welcome to ${clinic.name}. 🦷\n\n` +
           `I can assist you with:\n` +
           `1. Booking a Dental Cleaning, Checkup, or Specialist Consultation\n` +
           `2. Urgent Tooth Pain or Emergency Appointments\n` +
           `3. Rescheduling or Cancelling existing appointments\n` +
           `4. Clinic hours, location, and fees\n\n` +
           `How can I help you today?`,
    state: STATES.NEW
  };
}

module.exports = {
  STATES,
  getClinicConfig,
  getConversationState,
  updateConversationState,
  processConversationTurn,
  recordAuditLog
};
