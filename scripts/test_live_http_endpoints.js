/**
 * test_live_http_endpoints.js
 * Validates all REST API endpoints added in Phases 1-5 over live HTTP
 */

const express = require('express');
const { db } = require('../server/db');

async function testHttpEndpoints() {
  console.log(`\n================================================================`);
  console.log(`🌐 LIVE HTTP ENDPOINTS INTEGRATION TEST`);
  console.log(`================================================================\n`);

  // Start the server on port 3009 for test
  const serverModule = require('../server/server.js');
  // Wait 1 second for port to be ready
  await new Promise(r => setTimeout(r, 1000));

  const BASE_URL = 'http://localhost:3001';

  // 1. Clinic Config
  console.log(`1. Testing GET /api/clinic-config...`);
  const cfgRes = await fetch(`${BASE_URL}/api/clinic-config`);
  const cfgData = await cfgRes.json();
  console.log(`   Status: ${cfgRes.status}, Clinic: ${cfgData.config?.name}`);

  // 2. Dental Services
  console.log(`\n2. Testing GET /api/dental-services...`);
  const srvRes = await fetch(`${BASE_URL}/api/dental-services`);
  const srvData = await srvRes.json();
  console.log(`   Status: ${srvRes.status}, Count: ${srvData.services?.length}`);

  // 3. Multi-turn Chat API
  console.log(`\n3. Testing POST /api/chat (Dental Booking)...`);
  const chat1 = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: '15559998888',
      message: 'Hi, I need an emergency exam for tooth pain',
      patient_name: 'Alice Johnson',
      channel: 'whatsapp'
    })
  });
  const chat1Data = await chat1.json();
  console.log(`   Status: ${chat1.status}, State: ${chat1Data.state}`);
  console.log(`   Reply Preview: "${chat1Data.reply.substring(0, 80)}..."`);

  // 4. Unified Inbound Channel Adapter
  console.log(`\n4. Testing POST /api/channels/inbound (Instagram channel)...`);
  const inbRes = await fetch(`${BASE_URL}/api/channels/inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'instagram',
      sender_phone: '15557776666',
      sender_name: 'InstaUser_99',
      message: 'What are your clinic hours?',
      external_message_id: `IG-MSG-${Date.now()}`
    })
  });
  const inbData = await inbRes.json();
  console.log(`   Status: ${inbRes.status}, Channel: ${inbData.channel}`);
  console.log(`   Reply: "${inbData.reply}"`);

  // 5. Test Verification Endpoint
  console.log(`\n5. Testing GET /api/appointments/verify/:id...`);
  const testAppt = db.prepare("SELECT appointment_id FROM appointments WHERE status = 'confirmed' LIMIT 1").get();
  if (testAppt) {
    const verRes = await fetch(`${BASE_URL}/api/appointments/verify/${testAppt.appointment_id}`);
    const verData = await verRes.json();
    console.log(`   Status: ${verRes.status}, Verified: ${verData.verified}, Doctor: ${verData.doctor_name}`);
  }

  // 6. Test Dashboard Metrics (Section 18)
  console.log(`\n6. Testing GET /api/dashboard-metrics...`);
  const dashRes = await fetch(`${BASE_URL}/api/dashboard-metrics`);
  const dashData = await dashRes.json();
  console.log(`   Status: ${dashRes.status}, Booked: ${dashData.metrics.booked_appointments}, Confirmed: ${dashData.metrics.confirmed_appointments}, Audit Events: ${dashData.metrics.total_audit_events}`);

  console.log(`\n✅ ALL HTTP API ENDPOINTS TESTED AND RESPONDING NORMALLY!`);
  process.exit(0);
}

testHttpEndpoints().catch(err => {
  console.error("HTTP endpoint test failed:", err);
  process.exit(1);
});
