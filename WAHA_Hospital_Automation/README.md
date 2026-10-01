# 🟢 WAHA AI Human Healthcare Coordinator — Setup & Guide

This workflow transforms WhatsApp into a **warm, natural, human healthcare receptionist** for your hospital or clinic.

Instead of sending rigid robotic templates (like *"Reply RESCHEDULE"* or *"Press 1 for Cardiology"*), it uses a **fast local LLM (Ollama `llama3.2:1b`)** and connects directly to your hospital database (`democare.db`) to have natural, empathetic, and intelligent conversations with patients.

---

## 🌟 Key Features

1. **Natural Human Conversation**:
   - Responds like a warm, caring clinic coordinator (default persona: *"Sarah"*).
   - Empathizes with symptoms, offers polite suggestions, and answers questions in 2–3 friendly sentences.
   - **Zero robotic phrases** (no "Reply 1", no "Reply RESCHEDULE").

2. **Real Live Database Integration (`democare.db`)**:
   - Queries `http://127.0.0.1:3001/api/slots` dynamically based on patient symptoms.
   - Recommends **actual available doctors, departments, dates, and times**:
     - *Dermatology:* Dr. Priya Patel
     - *Cardiology:* Dr. Anand Sharma
     - *Orthopedics:* Dr. Rajesh Mehta
     - *General Medicine:* Dr. Sunita Rao
   - When a patient confirms a booking, it locks the appointment in `democare.db` and sends a warm confirmation with the reference ID.

3. **Ultra-Fast Local AI via Ollama**:
   - Powered by `llama3.2:1b` on `http://127.0.0.1:11434`.
   - Generates replies in **~1.0 to 1.2 seconds**!
   - 100% private, runs offline, zero API fees.

4. **1-Click Central Customization (`Hospital & AI Settings` node)**:
   - Easily change your hospital name, receptionist name, address, emergency hotline, or AI prompt instructions in **one single place**.

5. **24/7 Medical Emergency Safety Guardrail**:
   - Instantly intercepts acute symptoms (e.g. *chest pain*, *unconscious*, *cannot breathe*, *heavy bleeding*) and sends immediate emergency hotline numbers and ER directions.

---

## ⚙️ How to Customize Hospital Name, Receptionist & Templates

Open the workflow in n8n (**[http://localhost:5678](http://localhost:5678)**) and double-click the very first node: **`Hospital & AI Settings`**.

You can edit these settings anytime:

```javascript
const config = {
  // 🏥 1. Hospital / Organization Profile
  hospitalName: "DemoCare Multispeciality Hospital", // Change to your hospital name
  coordinatorName: "Sarah",                          // Change receptionist persona name
  contactPhone: "+91-9876543210",                    // Hospital helpline
  emergencyHotline: "+91-9876543210 (or dial 108)",   // 24/7 Emergency number
  hospitalAddress: "DemoCare Tower, 4th Block, Healthcare Boulevard",
  workingHours: "Monday - Saturday: 8:00 AM - 8:00 PM (Emergency 24/7)",

  // 🤖 2. Fast Local AI Engine (Ollama)
  ollamaEndpoint: "http://127.0.0.1:11434/api/generate",
  ollamaModel: "llama3.2:1b", // Fast 1B model (1s latency). Can also use 'llama3.1:8b'

  // 💬 3. Tone & Behavior Instructions
  personaInstructions: "You are Sarah, a warm, caring, and professional human healthcare coordinator..."
};
```

---

## 🚀 How to Activate & Test

### 1. In n8n UI ([http://localhost:5678](http://localhost:5678)):
1. Open the workflow: **`WAHA | AI Human Healthcare Coordinator`**.
2. Toggle the switch in the top-right corner to **Active** (or click **Save**).

### 2. Send a WhatsApp Message from your other phone:
Send a message to your WhatsApp number connected to WAHA:

* **Symptom inquiry:**  
  *"Hi Sarah, I noticed a red allergic rash on my neck today. Can I see a doctor?"*  
  👉 *AI replies warmly with Dr. Priya Patel's available slots from the database in ~1s.*

* **Availability question:**  
  *"Hello, do you have any doctors available today?"*  
  👉 *AI offers 2-3 current open slots across specialties.*

* **Confirm booking:**  
  *"Yes please, 10:00 AM works for me."*  
  👉 *Workflow books the slot in `democare.db` and the AI sends a warm confirmation with the appointment ID.*

* **Emergency guardrail:**  
  *"Urgent! My grandfather has severe chest pain and trouble breathing!"*  
  👉 *Immediate emergency alert dispatched with 24/7 hotline and emergency room address.*

---

## 🧪 Simulation Testing (Without WhatsApp)

To verify the AI responses without needing to send a WhatsApp message:
```bash
node "d:\antigravity n8n\WAHA_Hospital_Automation\test_full_ai_flow.js"
```
