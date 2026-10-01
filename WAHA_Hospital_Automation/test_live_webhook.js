// Test the LIVE webhook with the exact scenarios from the WhatsApp screenshot

async function sendToWebhook(patientName, msg) {
  const payload = {
    event: 'message',
    session: 'Demo1',
    payload: {
      id: 'test_' + Date.now(),
      timestamp: Math.floor(Date.now() / 1000),
      from: '919876543210@c.us',
      fromMe: false,
      body: msg,
      hasMedia: false,
      notifyName: patientName
    }
  };
  const start = Date.now();
  const res = await fetch('http://localhost:5678/webhook/waha-inbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await res.text();
  const time = ((Date.now() - start) / 1000).toFixed(1);
  let preview = '';
  try {
    const j = JSON.parse(body);
    preview = j.preview || body.slice(0, 120);
  } catch { preview = body.slice(0, 120); }
  return { status: res.status, time, preview };
}

async function runAll() {
  const scenarios = [
    { name: 'Nageshwara Reddy', msg: 'Hi' },
    { name: 'Nageshwara Reddy', msg: "I haven't mentioned anything yet" },
    { name: 'Nageshwara Reddy', msg: "I have a problem with my butt hole it's has a bump that hurts" },
    { name: 'Nageshwara Reddy', msg: 'Hello' },
    { name: 'Nageshwara Reddy', msg: 'Hi' },
  ];

  for (const s of scenarios) {
    console.log(`\n--- Patient: "${s.msg}" ---`);
    const r = await sendToWebhook(s.name, s.msg);
    console.log(`Status: ${r.status} | Time: ${r.time}s`);
    console.log(`Reply preview: ${r.preview}`);
    // Small delay between tests
    await new Promise(res => setTimeout(res, 1000));
  }
}

runAll().catch(console.error);
