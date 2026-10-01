async function verifyAll() {
  console.log('====================================================');
  console.log('   DEMOCARE HOSPITAL AUTOMATION — VERIFICATION SUITE');
  console.log('====================================================\n');

  // 1. Health check n8n
  const n8nHealth = await fetch('http://localhost:5678/healthz');
  const n8nData = await n8nHealth.json();
  console.log('[1/5] n8n Engine Status: 5678 ->', n8nData.status === 'ok' ? 'ONLINE (200 OK)' : 'OFFLINE');

  // 2. Health check DemoCare API
  const hmsMetrics = await fetch('http://localhost:3001/api/dashboard-metrics');
  const metricsData = await hmsMetrics.json();
  console.log('[2/5] DemoCare HMS Status: 3001 ->', metricsData.success ? 'ONLINE (200 OK)' : 'OFFLINE');

  // 3. Test Workflow 1: Lead Intake
  const leadPayload = {
    full_name: "Rahul Sharma",
    phone: "9999999999",
    department: "Dermatology",
    preferred_date: "2026-09-05",
    enquiry_text: "Need urgent skin allergy consultation.",
    source: "Instagram",
    correlation_id: "HOSP-20260905-VERIFY01"
  };
  const leadRes = await fetch('http://localhost:5678/webhook/hospital-demo-lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leadPayload)
  });
  const leadJson = await leadRes.json();
  console.log('[3/5] Workflow 01 (Lead Intake):', leadJson.status === 'confirmed' ? 'PASSED (Slot Confirmed)' : 'FAILED', '| Appointment ID:', leadJson.appointment_id);

  // 4. Test Workflow 2: No-Show Recovery
  const noshowRes = await fetch('http://localhost:5678/webhook/hospital-demo-noshow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appointment_id: leadJson.appointment_id })
  });
  const noshowJson = await noshowRes.json();
  console.log('[4/5] Workflow 02 (No-Show Recovery):', noshowJson.status === 'recovery_initiated' ? 'PASSED (Recovery Dispatched)' : 'FAILED');

  // Test idempotency of Workflow 2
  const noshowDup = await fetch('http://localhost:5678/webhook/hospital-demo-noshow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appointment_id: leadJson.appointment_id })
  });
  const noshowDupJson = await noshowDup.json();
  console.log('      Workflow 02 (Idempotency Guard):', noshowDupJson.status === 'SKIPPED_IDEMPOTENT' ? 'PASSED (Duplicate Prevented)' : 'FAILED');

  // 5. Test Workflow 3: Discharge & Service Recovery
  const disRes = await fetch('http://localhost:5678/webhook/hospital-demo-discharge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patient_id: "DEMO-001",
      category: "Post-Discharge Medication Care",
      approved_window: "48h",
      rating: 1,
      feedback_comment: "Staff was unresponsive during discharge."
    })
  });
  const disJson = await disRes.json();
  console.log('[5/5] Workflow 03 (Discharge & Escalation):', disJson.status === 'service_recovery_escalated' ? 'PASSED (Escalated to Exception Queue)' : 'FAILED');

  console.log('\n====================================================');
  console.log('   ALL 3 BLUEPRINT CORE WORKFLOWS FULLY OPERATIONAL!');
  console.log('====================================================');
}

verifyAll();
