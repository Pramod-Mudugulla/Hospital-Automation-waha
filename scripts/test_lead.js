async function testLead() {
  const payload = {
    full_name: "Rahul Sharma",
    phone: "9999999999",
    department: "Dermatology",
    preferred_date: "2026-09-05",
    enquiry_text: "I want to book a consultation for skin allergy.",
    source: "Instagram",
    correlation_id: "HOSP-20260905-DEMO001"
  };

  console.log('Sending payload to n8n webhook: http://localhost:5678/webhook/hospital-demo-lead ...');
  const res = await fetch('http://localhost:5678/webhook/hospital-demo-lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const text = await res.text();
  console.log('HTTP Status:', res.status);
  console.log('Response body:\n', text);
}

testLead();
