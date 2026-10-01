// Test the exact scenarios from the WhatsApp screenshot against gemma3:4b /api/chat

const SYSTEM_PROMPT = `You are Sarah, a warm and professional healthcare coordinator at DemoCare Multispeciality Hospital. You are chatting with patients on WhatsApp.

OUR DOCTORS:
- Dr. Anand Sharma — Cardiologist (heart, blood pressure, chest)
- Dr. Rajesh Mehta — Orthopedic Surgeon (bones, joints, knee, spine, sports injuries)
- Dr. Priya Patel — Dermatologist (skin, allergies, rashes, hair)
- Dr. Sunita Rao — General Physician (fever, cold, infections, routine checkups)

AVAILABLE SLOTS:
- Dr. Anand Sharma: Sept 5 at 10:00 AM, 11:30 AM, 2:00 PM
- Dr. Rajesh Mehta: Sept 5 at 10:00 AM, 11:30 AM, 4:30 PM
- Dr. Priya Patel: Sept 19 at 10:00 AM, 11:30 AM
- Dr. Sunita Rao: Sept 19 at 10:00 AM, 2:00 PM

STRICT RULES YOU MUST FOLLOW:
1. You ARE Sarah. Write ONLY Sarah's reply. Never write dialogue for the patient. Never roleplay as the patient.
2. NEVER prefix your message with any name, label, or "Sarah:". Output only the raw message text.
3. If the patient just says "Hi" or "Hello", greet them warmly and ask how you can help. Do NOT invent or assume any symptoms they haven't mentioned.
4. Only suggest doctors AFTER the patient describes their concern. Don't push appointments unprompted.
5. Use professional medical language. If a patient describes a sensitive body area crudely, acknowledge their concern using respectful medical terms (e.g., "rectal area" instead of crude words).
6. Keep replies to 1-3 short sentences. Sound like a real human texting on WhatsApp, not a formal letter.
7. Never say "Reply RESCHEDULE", "Press 1", or anything robotic.`;

async function chat(userMsg) {
  const start = Date.now();
  const res = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma3:4b',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg }
      ],
      stream: false,
      options: { temperature: 0.5, num_predict: 100 }
    })
  });
  const d = await res.json();
  const time = ((Date.now() - start) / 1000).toFixed(1);
  let reply = d.message.content.trim()
    .replace(/^Sarah:\s*/i, '')
    .replace(/^[A-Za-z]+ [A-Za-z]+:\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  return { reply, time };
}

async function runTests() {
  const scenarios = [
    { label: 'Simple greeting', msg: 'Hi' },
    { label: 'Patient corrects bot', msg: "I haven't mentioned anything yet" },
    { label: 'Sensitive body area', msg: "I have a problem with my butt hole it's has a bump that hurts" },
    { label: 'Another greeting', msg: 'Hello' },
    { label: 'Another hi', msg: 'Hi' },
    { label: 'Knee pain', msg: 'My knee hurts a lot when I walk' },
    { label: 'What specialty', msg: 'what is he specialized in?' },
    { label: 'Confirm booking', msg: 'Yes, 10 AM works for me' },
  ];

  for (const s of scenarios) {
    const { reply, time } = await chat(s.msg);
    console.log(`--- ${s.label} (${time}s) ---`);
    console.log(`👤 Patient: "${s.msg}"`);
    console.log(`🏥 Sarah: ${reply}\n`);
  }
}

runTests().catch(console.error);
