document.addEventListener('DOMContentLoaded', () => {
  // ============================================================
  // Sidebar Navigation
  // ============================================================
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  const sidebar = document.getElementById('sidebar');
  const hamburger = document.getElementById('hamburger-btn');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      item.classList.add('active');
      const target = item.getAttribute('data-tab');
      const el = document.getElementById(target);
      if (el) el.classList.add('active');
      // Close mobile sidebar
      if (window.innerWidth <= 768) sidebar.classList.remove('open');

      // Refresh data when switching tabs
      if (target === 'tab-dashboard') fetchDashboardData();
      if (target === 'tab-schedule') fetchSchedule();
      if (target === 'tab-messages') fetchConversations();
      if (target === 'tab-operations') fetchAppointmentsForSelect();
      if (target === 'tab-exceptions') fetchDashboardData();
    });
  });

  if (hamburger) {
    hamburger.addEventListener('click', () => sidebar.classList.toggle('open'));
  }

  // ============================================================
  // Greeting
  // ============================================================
  const greetEl = document.getElementById('greeting-time');
  if (greetEl) {
    const h = new Date().getHours();
    greetEl.textContent = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  }

  // Set today's date as default for lead form
  const leadDate = document.getElementById('lead_date');
  if (leadDate) leadDate.value = new Date().toISOString().split('T')[0];
  const leadCorr = document.getElementById('lead_correlation');
  if (leadCorr) {
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    leadCorr.value = `HOSP-${ymd}-${String(Math.floor(Math.random() * 999) + 1).padStart(3, '0')}`;
  }

  // ============================================================
  // Rating slider
  // ============================================================
  const ratingInput = document.getElementById('dis_rating');
  const ratingVal = document.getElementById('rating-val');
  if (ratingInput && ratingVal) {
    const updateRating = () => {
      const v = parseInt(ratingInput.value, 10);
      ratingVal.textContent = `${v} ★`;
      ratingVal.style.color = v < 3 ? '#EF4444' : '#10B981';
    };
    ratingInput.addEventListener('input', updateRating);
    updateRating();
  }

  // ============================================================
  // Lead Intake Form
  // ============================================================
  const leadForm = document.getElementById('lead-form');
  const liveIndicator = document.getElementById('live-indicator');
  const resultBox = document.getElementById('intake-result-box');

  if (leadForm) {
    leadForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        full_name: document.getElementById('lead_name').value.trim(),
        phone: document.getElementById('lead_phone').value.trim(),
        department: document.getElementById('lead_dept').value,
        preferred_date: document.getElementById('lead_date').value,
        enquiry_text: document.getElementById('lead_enquiry').value.trim(),
        source: document.getElementById('lead_source').value,
        correlation_id: document.getElementById('lead_correlation').value
      };

      resetPipeline();
      liveIndicator.textContent = 'Processing...';
      liveIndicator.className = 'live-pill running';
      resultBox.style.display = 'none';

      setStepState('pipe-1', 'running', 'Triggering...');
      await sleep(300);
      setStepState('pipe-1', 'done', 'Received');
      setStepState('pipe-2', 'running', 'Qualifying...');
      await sleep(400);
      setStepState('pipe-2', 'done', payload.department);
      setStepState('pipe-3', 'running', 'Syncing...');
      await sleep(300);
      setStepState('pipe-3', 'done', 'Synced');
      setStepState('pipe-4', 'running', 'Looking up slots...');

      try {
        const res = await fetch('http://localhost:5678/webhook/hospital-demo-lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        setStepState('pipe-4', 'done', 'Confirmed');
        setStepState('pipe-5', 'done', 'Sent');
        liveIndicator.textContent = 'Success';
        liveIndicator.className = 'live-pill success';

        resultBox.style.display = 'block';
        document.getElementById('res-corr').textContent = data.correlation_id || payload.correlation_id;
        document.getElementById('res-msg').textContent = data.message || 'Appointment confirmed.';
        document.getElementById('res-meta').innerHTML = `
          <strong>Doctor:</strong> ${data.doctor_name || 'Assigned'} |
          <strong>Dept:</strong> ${data.department || payload.department} |
          <strong>Slot:</strong> ${data.confirmed_slot || payload.preferred_date} |
          <strong>Appt:</strong> ${data.appointment_id || 'CONFIRMED'}
        `;
        fetchDashboardData();
      } catch (err) {
        setStepState('pipe-4', 'running', 'Error');
        liveIndicator.textContent = 'Error';
        liveIndicator.className = 'live-pill danger';
        resultBox.style.display = 'block';
        document.getElementById('res-msg').textContent = 'Error: ' + err.message;
      }
    });
  }

  // ============================================================
  // No-Show Recovery
  // ============================================================
  const btnNoShow = document.getElementById('btn-trigger-noshow');
  const noshowSelect = document.getElementById('noshow-appt-select');
  const noshowResult = document.getElementById('noshow-result-card');
  const noshowMsg = document.getElementById('noshow-msg-text');
  const noshowIdempotent = document.getElementById('noshow-idempotent-note');

  if (btnNoShow) {
    btnNoShow.addEventListener('click', async () => {
      const apptId = noshowSelect.value;
      if (!apptId) { alert('Select an appointment first.'); return; }
      btnNoShow.disabled = true;
      btnNoShow.querySelector('span').textContent = 'Starting...';
      try {
        const res = await fetch('http://localhost:5678/webhook/hospital-demo-noshow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appointment_id: apptId })
        });
        const data = await res.json();
        noshowResult.style.display = 'block';
        if (data.status === 'SKIPPED_IDEMPOTENT') {
          noshowMsg.textContent = 'IDEMPOTENCY: ' + data.message;
          noshowIdempotent.textContent = 'Duplicate Prevented';
        } else {
          noshowMsg.textContent = data.recovery_message || 'Recovery message sent.';
          noshowIdempotent.textContent = 'Key Saved';
        }
        fetchDashboardData();
      } catch (e) { alert('Error: ' + e.message); }
      finally {
        btnNoShow.disabled = false;
        btnNoShow.querySelector('span').textContent = 'Start recovery outreach';
      }
    });
  }

  // ============================================================
  // Discharge Follow-Up
  // ============================================================
  const dischargeForm = document.getElementById('discharge-form');
  const dischargeResult = document.getElementById('discharge-result-card');
  const dischargeMsg = document.getElementById('discharge-msg-text');
  const dischargeBadges = document.getElementById('discharge-badge-row');

  if (dischargeForm) {
    dischargeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        patient_id: document.getElementById('dis_patient').value,
        category: document.getElementById('dis_category').value,
        approved_window: document.getElementById('dis_window').value,
        rating: parseInt(document.getElementById('dis_rating').value, 10),
        feedback_comment: document.getElementById('dis_comment').value.trim()
      };
      try {
        const res = await fetch('http://localhost:5678/webhook/hospital-demo-discharge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        dischargeResult.style.display = 'block';
        if (data.status === 'service_recovery_escalated') {
          dischargeMsg.textContent = `ESCALATED: Rating ${data.rating}/5. ${data.action}`;
          dischargeBadges.innerHTML = '<span class="badge danger">High Severity</span><span class="badge warning">Officer Assigned</span>';
        } else {
          dischargeMsg.textContent = `Rating ${data.rating}/5. Routine follow-up scheduled.`;
          dischargeBadges.innerHTML = '<span class="badge success">Satisfactory</span><span class="badge info">Follow-up Created</span>';
        }
        fetchDashboardData();
      } catch (err) { alert('Error: ' + err.message); }
    });
  }

  // ============================================================
  // Refresh Buttons & Metric Card Quick-Links
  // ============================================================
  document.getElementById('btn-refresh-data')?.addEventListener('click', fetchDashboardData);
  document.getElementById('btn-refresh-exceptions')?.addEventListener('click', fetchDashboardData);
  document.getElementById('btn-refresh-conversations')?.addEventListener('click', fetchConversations);
  document.getElementById('btn-refresh-schedule')?.addEventListener('click', () => fetchSchedule());

  // Quick-link from WhatsApp Metric Card directly to Schedule with WhatsApp filter
  document.getElementById('card-metric-whatsapp')?.addEventListener('click', () => {
    currentScheduleFilter = 'whatsapp';
    document.querySelectorAll('#schedule-filter-group .filter-chip').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === 'whatsapp');
    });
    document.getElementById('nav-schedule')?.click();
  });

  // Schedule Filter Chips
  document.querySelectorAll('#schedule-filter-group .filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#schedule-filter-group .filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentScheduleFilter = btn.dataset.filter || 'all';
      renderSchedule();
    });
  });

  // Exception resolution
  document.getElementById('table-exceptions-body')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-resolve-exception]');
    if (!button) return;
    button.disabled = true;
    try {
      const res = await fetch(`/api/exceptions/${encodeURIComponent(button.dataset.resolveException)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' })
      });
      if (!res.ok) throw new Error('Could not resolve');
      fetchDashboardData();
    } catch (e) {
      alert(e.message);
      button.disabled = false;
    }
  });

  // ============================================================
  // Helpers
  // ============================================================
  function setStepState(id, state, statusText) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `step-item ${state}`;
    const s = el.querySelector('.step-status');
    if (s && statusText) s.textContent = statusText;
  }

  function resetPipeline() {
    ['pipe-1', 'pipe-2', 'pipe-3', 'pipe-4', 'pipe-5'].forEach(id => setStepState(id, 'ready', 'Idle'));
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
    );
  }

  function formatDateTime(value) {
    if (!value) return 'Just now';
    return new Date(value).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function isWhatsAppAppt(a) {
    if (!a) return false;
    const s = `${a.source || ''} ${a.patient_source || ''}`.toLowerCase();
    return s.includes('whatsapp') || s.includes('automation') || s.includes('bot');
  }

  // ============================================================
  // Data Fetching: Dashboard
  // ============================================================
  async function fetchDashboardData() {
    try {
      const res = await fetch('/api/dashboard-metrics');
      const data = await res.json();
      if (data.success && data.metrics) {
        const m = data.metrics;
        document.getElementById('kpi-leads').textContent = m.new_leads || 0;
        document.getElementById('kpi-appts').textContent = m.booked_appointments || 0;
        const waEl = document.getElementById('kpi-whatsapp');
        if (waEl) waEl.textContent = m.whatsapp_appointments || 0;
        document.getElementById('kpi-noshows').textContent = m.no_shows || 0;
        document.getElementById('kpi-followups').textContent = m.pending_follow_ups || 0;
        document.getElementById('kpi-exceptions').textContent = m.open_exceptions || 0;
        const openStr = `${m.open_exceptions || 0}`;
        document.getElementById('badge-exception-count').textContent = `${openStr} Open`;
        const pill = document.getElementById('nav-exception-pill');
        if (pill) pill.textContent = openStr;
      }

      // Communications table
      const commsRes = await fetch('/api/communication-logs');
      const commsData = await commsRes.json();
      const commsBody = document.getElementById('table-comms-body');
      if (commsBody && commsData.logs) {
        commsBody.innerHTML = commsData.logs.map(log => {
          const time = new Date(log.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return `<tr>
            <td><code>${time}</code></td>
            <td><strong>${escapeHtml(log.patient_name || log.patient_id)}</strong></td>
            <td><span class="badge info">${escapeHtml(log.template_name)}</span></td>
            <td style="max-width:380px;line-height:1.4;" title="${escapeHtml(log.message_body)}">${escapeHtml(log.message_body)}</td>
            <td><span class="badge success">${escapeHtml(log.delivery_status)}</span></td>
          </tr>`;
        }).join('');
      }

      // Exceptions table
      const excRes = await fetch('/api/exceptions');
      const excData = await excRes.json();
      const excBody = document.getElementById('table-exceptions-body');
      if (excBody && excData.exceptions) {
        excBody.innerHTML = excData.exceptions.map(exc => {
          const sevClass = exc.severity === 'high' ? 'danger' : 'warning';
          return `<tr>
            <td><span class="badge ${sevClass}">${escapeHtml(exc.severity.toUpperCase())}</span></td>
            <td>${escapeHtml(exc.workflow_name)}</td>
            <td>${escapeHtml(exc.resolution_note || exc.error_type)}</td>
            <td>${escapeHtml(exc.owner)}</td>
            <td>${exc.status === 'open'
              ? `<button class="btn-table" data-resolve-exception="${escapeHtml(exc.exception_id)}">Resolve</button>`
              : '<span class="badge success">Resolved</span>'}</td>
          </tr>`;
        }).join('');
      }
    } catch (e) {
      console.error('Dashboard error:', e);
    }
  }

  // ============================================================
  // Data Fetching: Schedule (with WhatsApp vs Manual Filtering)
  // ============================================================
  let cachedAppointments = [];
  let currentScheduleFilter = 'all';

  async function fetchSchedule() {
    const container = document.getElementById('schedule-container');
    if (!container) return;
    container.innerHTML = '<p class="empty-state">Loading schedule...</p>';

    try {
      const res = await fetch('/api/appointments/schedule');
      const data = await res.json();
      cachedAppointments = data.appointments || [];

      // Update counters in toolbar
      const totalCount = cachedAppointments.length;
      const waCount = cachedAppointments.filter(isWhatsAppAppt).length;
      const manualCount = totalCount - waCount;

      const cntAll = document.getElementById('count-all-appts');
      if (cntAll) cntAll.textContent = totalCount;
      const cntWa = document.getElementById('count-wa-appts');
      if (cntWa) cntWa.textContent = waCount;
      const cntMan = document.getElementById('count-manual-appts');
      if (cntMan) cntMan.textContent = manualCount;

      renderSchedule();
    } catch (e) {
      container.innerHTML = '<p class="empty-state">Could not load schedule.</p>';
    }
  }

  function renderSchedule() {
    const container = document.getElementById('schedule-container');
    if (!container) return;

    if (!cachedAppointments.length) {
      container.innerHTML = '<p class="empty-state">No appointments booked yet.</p>';
      return;
    }

    // Filter appointments
    let filtered = cachedAppointments;
    if (currentScheduleFilter === 'whatsapp') {
      filtered = cachedAppointments.filter(isWhatsAppAppt);
    } else if (currentScheduleFilter === 'manual') {
      filtered = cachedAppointments.filter(a => !isWhatsAppAppt(a));
    }

    if (!filtered.length) {
      const label = currentScheduleFilter === 'whatsapp' ? 'WhatsApp confirmed' : 'reception desk';
      container.innerHTML = `<p class="empty-state">No ${label} appointments found.</p>`;
      return;
    }

    // Group by doctor
    const byDoctor = {};
    filtered.forEach(a => {
      const key = a.doctor_name || 'Unassigned';
      if (!byDoctor[key]) byDoctor[key] = { dept: a.department, appts: [] };
      byDoctor[key].appts.push(a);
    });

    container.innerHTML = Object.entries(byDoctor).map(([doctor, info]) => `
      <div class="doctor-schedule-card">
        <div class="doctor-card-header">
          <div>
            <div class="doctor-name">${escapeHtml(doctor)}</div>
            <div class="doctor-dept">${escapeHtml(info.dept)}</div>
          </div>
          <span class="doctor-appt-count">${info.appts.length} appointment${info.appts.length !== 1 ? 's' : ''}</span>
        </div>
        <table class="schedule-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Channel</th>
              <th>Phone</th>
              <th>Time Slot</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${info.appts.map(a => {
              const isWA = isWhatsAppAppt(a);
              return `
                <tr>
                  <td><strong>${escapeHtml(a.patient_name || 'Unknown')}</strong></td>
                  <td>
                    ${isWA 
                      ? `<span class="source-tag source-whatsapp" title="Confirmed through WhatsApp Automation">
                          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                          WhatsApp AI
                        </span>`
                      : `<span class="source-tag source-reception">🏥 Reception</span>`
                    }
                  </td>
                  <td><code style="font-size:0.78rem;">${escapeHtml(a.patient_phone || '-')}</code></td>
                  <td><strong>${escapeHtml(a.slot_start || '-')}</strong>${a.slot_end ? ' - ' + escapeHtml(a.slot_end) : ''}</td>
                  <td><span class="appt-status-dot ${a.attendance_status}"></span>${escapeHtml(a.attendance_status)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `).join('');
  }

  // ============================================================
  // Data Fetching: Conversations (WhatsApp)
  // ============================================================
  async function fetchConversations() {
    const list = document.getElementById('conversation-list');
    if (!list) return;
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      const conversations = data.conversations || [];
      if (!conversations.length) {
        list.innerHTML = '<p class="empty-state">No conversations yet.</p>';
        return;
      }
      list.innerHTML = conversations.map((c, i) => `
        <button class="conversation-row ${i === 0 ? 'active' : ''}" data-phone="${escapeHtml(c.phone)}" data-name="${escapeHtml(c.patient_name || 'Patient')}">
          <strong>${escapeHtml(c.patient_name || c.phone)}</strong>
          <span>${escapeHtml(c.content)}</span>
          <time>${formatDateTime(c.created_at)}</time>
        </button>
      `).join('');
      list.querySelectorAll('.conversation-row').forEach(row => {
        row.addEventListener('click', () => {
          list.querySelectorAll('.conversation-row').forEach(r => r.classList.remove('active'));
          row.classList.add('active');
          fetchConversation(row.dataset.phone, row.dataset.name);
        });
      });
      fetchConversation(conversations[0].phone, conversations[0].patient_name || 'Patient');
    } catch (e) {
      list.innerHTML = '<p class="empty-state">Inbox unavailable.</p>';
    }
  }

  async function fetchConversation(phone, name) {
    const thread = document.getElementById('conversation-thread');
    const banner = document.getElementById('thread-patient-appointment');
    const badge = document.getElementById('thread-appt-badge');
    if (!thread) return;
    document.getElementById('thread-name').textContent = name;
    document.getElementById('thread-phone').textContent = phone;
    thread.innerHTML = '<p class="empty-state">Loading messages...</p>';

    // Check if this patient has a confirmed appointment
    try {
      const apptRes = await fetch(`/api/appointments/by-phone/${encodeURIComponent(phone)}`);
      const apptData = await apptRes.json();
      const appts = apptData.appointments || [];
      if (appts.length > 0 && banner) {
        const latest = appts[0];
        const isWA = isWhatsAppAppt(latest);
        banner.style.display = 'flex';
        banner.innerHTML = `
          <div class="appointment-callout-card">
            <div class="callout-icon">📅</div>
            <div class="callout-content">
              <div class="callout-title">Confirmed Appointment: <strong>${escapeHtml(latest.doctor_name || 'Assigned Doctor')}</strong> (${escapeHtml(latest.department)})</div>
              <div class="callout-meta">
                <span>⏰ <strong>${escapeHtml(latest.slot_start || 'Scheduled')}</strong></span>
                <span>•</span>
                <span class="callout-badge wa">${isWA ? '🤖 Confirmed via WhatsApp Automation' : '🏥 Booked at Reception'}</span>
                <span>•</span>
                <span>Status: <strong>${escapeHtml(latest.status || 'Confirmed')}</strong></span>
              </div>
            </div>
          </div>
        `;
        if (badge) {
          badge.style.display = 'inline-flex';
          badge.textContent = isWA ? '💬 WhatsApp Confirmed' : '🏥 Reception Booking';
        }
      } else {
        if (banner) banner.style.display = 'none';
        if (badge) badge.style.display = 'none';
      }
    } catch (_) {
      if (banner) banner.style.display = 'none';
      if (badge) badge.style.display = 'none';
    }

    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(phone)}?limit=50`);
      const data = await res.json();
      const msgs = data.messages || [];
      thread.innerHTML = msgs.map(m => `
        <div class="chat-bubble ${m.role === 'assistant' ? 'assistant' : ''}">
          ${escapeHtml(m.content)}
          <small>${m.role === 'assistant' ? 'Coordinator' : 'Patient'} · ${formatDateTime(m.created_at)}</small>
        </div>
      `).join('') || '<p class="empty-state">No messages.</p>';
      // Auto-scroll to bottom
      requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
    } catch (e) {
      thread.innerHTML = '<p class="empty-state">Could not load messages.</p>';
    }
  }

  // ============================================================
  // Data Fetching: Appointments for No-Show Select
  // ============================================================
  async function fetchAppointmentsForSelect() {
    try {
      const res = await fetch('/api/appointments');
      const data = await res.json();
      const sel = document.getElementById('noshow-appt-select');
      if (!sel || !data.appointments) return;
      if (!data.appointments.length) {
        sel.innerHTML = '<option value="">No appointments yet</option>';
        return;
      }
      sel.innerHTML = data.appointments.map(a => `
        <option value="${a.appointment_id}">
          ${escapeHtml(a.patient_name || 'Patient')} — ${a.department} (${a.slot_start}) [${a.attendance_status}]
        </option>
      `).join('');
    } catch (e) { console.error('Appointments error:', e); }
  }

  async function fetchPatientsForSelect() {
    const select = document.getElementById('dis_patient');
    if (!select) return;
    try {
      const res = await fetch('/api/patients');
      const data = await res.json();
      if (!data.patients?.length) return;
      select.innerHTML = data.patients.map(p =>
        `<option value="${escapeHtml(p.patient_id)}">${escapeHtml(p.full_name)}${p.phone ? ` (${escapeHtml(p.phone)})` : ''}</option>`
      ).join('');
    } catch (e) { console.error('Patients error:', e); }
  }

  // ============================================================
  // Health Check
  // ============================================================
  async function checkServiceHealth() {
    const hms = document.getElementById('hms-status');
    const n8n = document.getElementById('n8n-status');
    const [hmsResult, n8nResult] = await Promise.allSettled([
      fetch('/api/dashboard-metrics'),
      fetch('http://localhost:5678/healthz', { mode: 'no-cors' })
    ]);
    if (hms) hms.classList.toggle('is-offline', hmsResult.status !== 'fulfilled');
    if (n8n) n8n.classList.toggle('is-offline', n8nResult.status !== 'fulfilled');
  }

  // ============================================================
  // Initial Load
  // ============================================================
  fetchDashboardData();
  fetchAppointmentsForSelect();
  fetchPatientsForSelect();
  fetchConversations();
  checkServiceHealth();
});
