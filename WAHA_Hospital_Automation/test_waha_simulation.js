// ==============================================================================
// WAHA Webhook Simulation Test Script
// Simulates WAHA events being sent to n8n (/webhook-test/waha-inbound or /webhook/waha-inbound)
// ==============================================================================

const N8N_ENDPOINT = 'http://localhost:5678/webhook/waha-inbound';

async function sendWahaEvent(scenarioName, payload) {
  console.log(`\n--------------------------------------------------------------`);
  console.log(`🧪 TESTING SCENARIO: ${scenarioName}`);
  console.log(`--------------------------------------------------------------`);
  console.log(`Sending simulated WAHA payload to: ${N8N_ENDPOINT}`);

  try {
    const res = await fetch(N8N_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log(`HTTP Response Status: ${res.status}`);
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      console.log(`Response Payload:\n`, JSON.stringify(json, null, 2));
    } catch {
      console.log(`Raw Body:\n`, text);
    }
  } catch (err) {
    console.error(`❌ Request Failed:`, err.message);
    console.log(`💡 Hint: Make sure n8n is running and the WAHA workflow is imported and active!`);
  }
}

async function runAllTests() {
  console.log(`==============================================================`);
  console.log(`   DEMOCARE HOSPITAL — WAHA INBOUND WEBHOOK SIMULATION TEST   `);
  console.log(`==============================================================`);

  // Scenario 1: Normal Inbound Patient Booking (Dermatology)
  await sendWahaEvent('1. Normal Patient WhatsApp Inbound (Rahul Sharma)', {
    event: 'message',
    session: 'default',
    payload: {
      id: 'false_919876543210@c.us_3EB0C5478A',
      timestamp: Math.floor(Date.now() / 1000),
      from: '919876543210@c.us',
      fromMe: false,
      to: '918000000000@c.us',
      body: 'Hello DemoCare, I have a severe skin allergy and rash. I want to book an appointment with a skin specialist.',
      hasMedia: false,
      notifyName: 'Rahul Sharma'
    }
  });

  // Scenario 2: Emergency Detection (Immediate Guardrail Trigger)
  await sendWahaEvent('2. Emergency Keyword Guardrail (Chest Pain)', {
    event: 'message',
    session: 'default',
    payload: {
      id: 'false_919876543211@c.us_3EB0C5478B',
      timestamp: Math.floor(Date.now() / 1000),
      from: '919876543211@c.us',
      fromMe: false,
      to: '918000000000@c.us',
      body: 'EMERGENCY! My grandfather is having severe chest pain and breathing difficulty!',
      hasMedia: false,
      notifyName: 'Amit Verma'
    }
  });

  // Scenario 3: Bot Self-Sent Message (Should be ignored to prevent loop)
  await sendWahaEvent('3. Bot Self-Message Loop Guard (fromMe: true)', {
    event: 'message',
    session: 'default',
    payload: {
      id: 'true_918000000000@c.us_3EB0C5478C',
      timestamp: Math.floor(Date.now() / 1000),
      from: '918000000000@c.us',
      fromMe: true, // Self-sent
      to: '919876543210@c.us',
      body: 'Your appointment is confirmed.',
      hasMedia: false
    }
  });

  console.log(`\n==============================================================`);
  console.log(`   TEST COMPLETED. Check n8n Executions or DemoCare HMS.      `);
  console.log(`==============================================================\n`);
}

runAllTests();
