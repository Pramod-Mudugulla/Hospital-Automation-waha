# 🏥 Hospital Automation with WAHA & n8n

A comprehensive, production-ready AI-driven Hospital & Clinic Automation system. Integrates **WAHA (WhatsApp HTTP API)**, **n8n workflow orchestration**, a robust **Node.js/Express HMS server**, and local private LLMs (**Ollama**) to deliver automated appointment scheduling, empathetic patient triage, medical emergency guardrails, and real-time electronic health records synchronization.

---

## 🌟 Architecture Overview

```
                      +---------------------------------------+
                      |       Patient on WhatsApp             |
                      +---------------------------------------+
                                          |
                                    (WAHA Webhook)
                                          v
+---------------------------------------------------------------------------------+
|                                 n8n Engine                                      |
|                                                                                 |
|   1. Inbound Webhook Parsing & Session State Tracking                           |
|   2. Emergency Guardrail Interceptor (Chest pain, breathing issues -> ER alert) |
|   3. Local LLM Coordinator (Ollama - Llama 3.2 / Gemma)                         |
|   4. Dynamic Slot Fetching & Smart Department Matching                          |
|   5. WhatsApp Message Dispatcher via WAHA Core API                              |
+---------------------------------------------------------------------------------+
                                          |
                                    (REST Calls)
                                          v
+---------------------------------------------------------------------------------+
|                        Hospital Management Server (HMS)                         |
|                                                                                 |
|   - Express.js Backend (Port 3001)                                              |
|   - SQLite Database (`democare.db`)                                            |
|   - Appointments, Doctor Availability, Leads, Diagnostic Tasks, Audit Logs     |
|   - Multimodal & Triage Service                                                 |
+---------------------------------------------------------------------------------+
```

---

## ✨ Key Features

1. **Empathetic AI Healthcare Coordinator**
   - Natural, conversational responses with human healthcare receptionist personas.
   - Zero rigid robotic templates (no "Reply 1 for Cardiology" or "Type CANCEL").
   - Instant local generation (~1s latency) via Ollama with zero external API fees and total patient privacy.

2. **Full Electronic Health Records (EHR) & Database Integration**
   - Live availability lookup from SQLite (`democare.db`).
   - Doctors, slots, patient records, and confirmed appointments update in real-time.
   - Comprehensive audit logging and exception management.

3. **24/7 Medical Emergency Safety Guardrail**
   - Intercepts acute, life-threatening symptoms (e.g., chest pain, shortness of breath, heavy bleeding).
   - Instantly routes emergency hotline numbers and immediate emergency room navigation.

4. **One-Command Startup & Teardown**
   - Includes Windows PowerShell automation scripts (`start.ps1` and `stop.ps1`) to launch Docker WAHA, HMS Express Server, and n8n in unison.

---

## 📁 Repository Structure

```
.
├── .gitignore                                      # Ignored dependencies, runtime state, and logs
├── democare.db                                     # Seeded SQLite hospital database
├── Dental_Automation_Production_Audit_AntiGravity.md # Full production audit & architecture docs
├── Hospital_AI_Automation_Master_Blueprint_V3_A_to_Z_260825_192146.pdf # Master specification blueprint
├── TESTING_AND_PRODUCTION_GUIDE.md                 # Production deployment & verification manual
├── package.json                                    # Node dependencies & metadata
├── start.ps1                                       # 1-click startup script for all services
├── stop.ps1                                        # Clean shutdown script
│
├── public/                                         # Front-end demo clinic web interfaces
├── scripts/                                        # Acceptance tests, smoke tests, workflow sync scripts
├── server/                                         # Express HMS backend (APIs, db.js, triage, multimodal)
├── WAHA_Hospital_Automation/                       # WAHA docker config, test flows, and workflow definitions
└── workflows/                                      # Exported n8n workflow JSON definitions
```

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** (v18+ recommended)
- **Docker Desktop** (for running the WAHA WhatsApp container)
- **Ollama** with a model pulled:
  ```bash
  ollama pull llama3.2:1b
  # or
  ollama pull gemma3:4b
  ```

### 1. Install Dependencies
```bash
npm install
```

### 2. Launch All Services (Automated)
Run the startup script in PowerShell:
```powershell
.\start.ps1
```
This automatically initiates:
- **WAHA Container** on port `3000`
- **Express HMS Server** on port `3001`
- **n8n Workflow Engine** on port `5678`

### 3. Or Run Manually

- **Start HMS Backend:**
  ```bash
  node server/index.js
  ```
- **Start WAHA:**
  ```bash
  docker compose -f WAHA_Hospital_Automation/docker-compose.waha.yml up -d
  ```
- **Start n8n:**
  ```bash
  npx n8n
  ```

---

## 🧪 Testing & Verification

Comprehensive simulation suites are included to test end-to-end booking flows without needing physical devices:

```bash
# Test the full conversational AI booking flow:
node WAHA_Hospital_Automation/test_full_ai_flow.js

# Test WAHA webhook simulation:
node WAHA_Hospital_Automation/test_waha_simulation.js

# Run production acceptance tests:
node scripts/run_production_acceptance_tests.js
```

---

## 🔒 Security & Privacy

- All patient conversations and bookings are processed locally or within self-hosted infrastructure.
- Zero patient telemetry or health queries are sent to public cloud LLM endpoints.
- Database access is parameterized to prevent injection attacks.

---

## 📄 License
ISC
