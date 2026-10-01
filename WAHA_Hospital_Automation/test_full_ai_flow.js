// test_full_ai_flow.js
// Tests the full DB-driven AI Healthcare Coordinator logic

const HOSPITAL_CONFIG = {
  hospitalName: "DemoCare Multispeciality Hospital",
  coordinatorName: "Sarah",
  contactPhone: "+91-9876543210",
  emergencyHotline: "+91-9876543210 (or 108)",
  hospitalAddress: "DemoCare Tower, 4th Block, Healthcare Boulevard",
  workingHours: "Mon-Sat 8:00 AM - 8:00 PM",
  ollamaModel: "llama3.2:1b"
};

function classifyDepartment(text) {
  if (/skin|rash|allergy|acne|face|itch|dermat/i.test(text)) return 'Dermatology';
  if (/heart|cardio|chest|bp|pulse|palpitat/i.test(text)) return 'Cardiology';
  if (/bone|joint|fracture|knee|ortho|leg|back pain/i.test(text)) return 'Orthopedics';
  if (/fever|cough|cold|headache|stomach|flu|general/i.test(text)) return 'General Medicine';
  return '';
}

function detectBookingIntent(text) {
  return /book|schedule|confirm|reserve|yes please|that time works/i.test(text);
}

async function simulatePatientMessage(patientName, text) {
  console.log(`\n==================================================`);
  console.log(`👤 Patient: ${patientName}`);
  console.log(`💬 WhatsApp Message: "${text}"`);

  // 1. Department classification
  const dept = classifyDepartment(text);
  console.log(`🩺 Detected Department: ${dept || 'General (All)'}`);

  // 2. Fetch real slots from DB
  const slotUrl = dept ? `http://localhost:3001/api/slots?department=${encodeURIComponent(dept)}` : 'http://localhost:3001/api/slots';
  const slotsRes = await fetch(slotUrl);
  const slotsData = await slotsRes.json();
  const availableSlots = (slotsData.available_slots || []).slice(0, 5);

  const slotSummary = availableSlots.length > 0 
    ? availableSlots.map(s => `- ${s.doctor_name} (${s.department}): ${s.slot_date} at ${s.slot_time}`).join('\n')
    : 'No open slots listed for this specific time, but consultations can be arranged upon request.';

  // 3. Check if booking intent
  const isBooking = detectBookingIntent(text);
  let bookingDetails = null;

  if (isBooking && availableSlots.length > 0) {
    const chosenSlot = availableSlots[0];
    console.log(`📝 Patient requested booking -> Reserving slot in DB for ${chosenSlot.doctor_name}...`);
    const bookRes = await fetch('http://localhost:3001/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patient_name: patientName,
        phone: '+91-9876543210',
        department: chosenSlot.department,
        doctor_name: chosenSlot.doctor_name,
        doctor_id: chosenSlot.doctor_id,
        slot_start: chosenSlot.slot_time,
        slot_id: chosenSlot.slot_id,
        source: 'WhatsApp Automation'
      })
    });
    const bookData = await bookRes.json();
    bookingDetails = {
      appointmentId: bookData.appointment_id,
      doctor: chosenSlot.doctor_name,
      department: chosenSlot.department,
      date: chosenSlot.slot_date,
      time: chosenSlot.slot_time
    };
    console.log(`✅ Booked in democare.db! Appointment ID: ${bookingDetails.appointmentId}`);
  }

  // 4. Construct prompt for Ollama
  let prompt = '';
  if (bookingDetails) {
    prompt = `You are ${HOSPITAL_CONFIG.coordinatorName}, a warm, caring, and professional human healthcare coordinator at ${HOSPITAL_CONFIG.hospitalName}.
Patient Name: ${patientName}
Patient Message: "${text}"

STATUS: The appointment was just officially reserved in our hospital database!
Appointment ID: ${bookingDetails.appointmentId}
Doctor: ${bookingDetails.doctor} (${bookingDetails.department})
Scheduled For: ${bookingDetails.date} at ${bookingDetails.time}
Hospital Address: ${HOSPITAL_CONFIG.hospitalAddress}

Write a natural, warm WhatsApp confirmation message to ${patientName}:
- Greet them warmly and confirm their appointment is locked in.
- Mention Dr. ${bookingDetails.doctor}, the date (${bookingDetails.date}), time (${bookingDetails.time}), and reference #${bookingDetails.appointmentId}.
- Mention the hospital address warmly and let them know you are here if they have any questions.
- Keep it friendly, human, and concise (2-4 sentences max). Never say robotic things like "Reply RESCHEDULE" or "Press 1".`;
  } else {
    prompt = `You are ${HOSPITAL_CONFIG.coordinatorName}, a warm, caring, and professional human healthcare coordinator at ${HOSPITAL_CONFIG.hospitalName}.
Patient Name: ${patientName}
Patient WhatsApp Message: "${text}"

REAL AVAILABLE DOCTOR SLOTS CURRENTLY IN OUR DATABASE:
${slotSummary}

Write a natural, human WhatsApp reply to ${patientName}:
- Greet them warmly by name.
- If they described symptoms or an ailment, show empathy and suggest the specialist doctor and timing options from our database list above.
- If they asked general questions, answer helpfully and suggest 2-3 available timings.
- Keep it natural, warm, and concise (2-4 sentences max) as if a real person at the clinic desk is typing on WhatsApp.
- DO NOT sound like an automated bot. NEVER use rigid templates or say "Reply 1" or "Reply RESCHEDULE".`;
  }

  // 5. Generate with Ollama
  const start = Date.now();
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: HOSPITAL_CONFIG.ollamaModel,
      prompt: prompt,
      stream: false,
      options: { temperature: 0.7, num_predict: 140 }
    })
  });
  const data = await res.json();
  const time = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`🤖 AI Receptionist Reply (${time}s):`);
  console.log(data.response.trim().replace(/^["']|["']$/g, ''));
}

async function runTest() {
  // Test 1: Patient asking about symptoms (Dermatology)
  await simulatePatientMessage('Vijaya', 'Hi Sarah, I noticed a red allergy rash on my neck today. Can I see a doctor?');

  // Test 2: Patient confirming booking
  await simulatePatientMessage('Vijaya', 'Yes please book Dr Priya for 10am');
}

runTest().catch(console.error);
