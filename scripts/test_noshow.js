async function testNoShow() {
  const appointment_id = "APPT-1789843996400";
  console.log(`Triggering No-Show Recovery for appointment: ${appointment_id} ...`);

  const res = await fetch('http://localhost:5678/webhook/hospital-demo-noshow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appointment_id })
  });

  const data = await res.json();
  console.log('1st Trigger Response (should initiate recovery):', data);

  // Now test Idempotency: Triggering again immediately
  console.log('\nTesting Idempotency (triggering second time for same appointment)...');
  const res2 = await fetch('http://localhost:5678/webhook/hospital-demo-noshow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appointment_id })
  });

  const data2 = await res2.json();
  console.log('2nd Trigger Response (should be SKIPPED_IDEMPOTENT):', data2);
}

testNoShow();
