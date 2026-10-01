async function testDischarge() {
  console.log('--- Test Case 1: Satisfactory Discharge Follow-up (Rating: 5/5) ---');
  const payload1 = {
    patient_id: "DEMO-002",
    category: "Post-Discharge Surgical Care",
    approved_date: "2026-09-22",
    approved_window: "48h",
    rating: 5,
    feedback_comment: "Doctor and nursing staff were fantastic!"
  };

  const res1 = await fetch('http://localhost:5678/webhook/hospital-demo-discharge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload1)
  });
  const data1 = await res1.json();
  console.log('Result 1 (Satisfactory):', data1);

  console.log('\n--- Test Case 2: Service Recovery Trigger (Rating: 2/5 - Complaint) ---');
  const payload2 = {
    patient_id: "DEMO-003",
    category: "Post-Discharge Cardiac Care",
    approved_date: "2026-09-23",
    approved_window: "24h",
    rating: 2,
    feedback_comment: "Billing discharge process took 4 hours and delayed medicines."
  };

  const res2 = await fetch('http://localhost:5678/webhook/hospital-demo-discharge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload2)
  });
  const data2 = await res2.json();
  console.log('Result 2 (Service Recovery Escalation):', data2);
}

testDischarge();
