async function testScenarios() {
  const slotsRes = await fetch('http://localhost:3001/api/slots');
  const slotsData = await slotsRes.json();
  const slotsList = (slotsData.available_slots || []).slice(0, 8).map(s => `- ${s.doctor_name} (${s.department}): ${s.slot_date} at ${s.slot_time}`).join('\n');

  const inquiries = [
    { name: 'Vijaya', text: 'Hi do you have doctors available today?' },
    { name: 'Rahul', text: 'I have an allergic red rash on my cheeks and arms' },
    { name: 'Anita', text: 'I want to see a cardiologist for a routine heart checkup' }
  ];

  for (const item of inquiries) {
    const prompt = `You are Sarah, a warm, caring, and professional human healthcare coordinator at DemoCare Multispeciality Hospital.
Patient Name: ${item.name}
Patient Message: "${item.text}"

LIVE AVAILABLE DOCTOR SLOTS FROM OUR HOSPITAL DATABASE:
${slotsList}

Write a natural, warm WhatsApp response to ${item.name} as a real receptionist:
- Greet them warmly by name.
- If they mentioned symptoms, show empathy and suggest the right doctor and timings from our database list.
- If they asked general availability, offer 2-3 of the available options.
- Keep it natural, friendly, and concise (2-3 sentences max).
- DO NOT sound like a robotic automated bot. Never say 'Reply 1' or 'Reply RESCHEDULE'.`;

    const start = Date.now();
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:1b',
        prompt: prompt,
        stream: false,
        options: { temperature: 0.7, num_predict: 120 }
      })
    });
    const d = await res.json();
    const sec = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`=== Patient: ${item.name} (${sec}s) ===`);
    console.log(`Message: "${item.text}"`);
    console.log('AI Reply:\n' + d.response.trim() + '\n');
  }
}

testScenarios().catch(console.error);
