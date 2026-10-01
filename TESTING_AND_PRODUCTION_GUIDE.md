# DemoCare Hospital AI Automation — Complete Testing & Production Guide

This guide covers:
1. **How to test this system 100% for free** on your personal phone using free WhatsApp gateways, open-source GitHub projects, and tunnels.
2. **How to integrate and deploy this for a real hospital** with their official phone number, Instagram page, and Hospital Management System (HIS / EHR).

---

## PART 1: How to Test It Yourself 100% For Free

You can test real WhatsApp messages on your own phone without paying a single dollar. Here are the 3 best free methods:

```
[ Your Phone (WhatsApp) ] 
       ▲
       │ (Real WhatsApp Message)
       ▼
[ Free Gateway / Meta Cloud API / Twilio ]
       ▲
       │ (HTTP Webhook via ngrok)
       ▼
[ Your Local n8n Instance (:5678) ]
       ▲
       ▼
[ DemoCare HMS Server (:3001) ]
```

---

### Option A: Free Open-Source WhatsApp Gateway (WAHA / WPPConnect)
*Best if you want to use your personal SIM card or a spare number with zero paperwork.*

There are open-source GitHub projects that connect your WhatsApp Web session into a local REST API that n8n can call directly.

#### Recommended: **WAHA (WhatsApp HTTP API)**
* GitHub: [devlikeapro/waha](https://github.com/devlikeapro/waha)
* Runs as a lightweight Docker container.

#### Step-by-Step Setup:
1. **Run WAHA via Docker:**
   ```bash
   docker run -it --rm -p 3000:3000/tcp devlikeapro/waha
   ```
2. **Scan the QR Code:**
   * Open `http://localhost:3000/dashboard` in your browser.
   * Open WhatsApp on your phone ➔ **Linked Devices** ➔ Scan the QR code.
   * Your local server is now connected to real WhatsApp!
3. **Send a Test WhatsApp Message from n8n or Terminal:**
   ```bash
   curl -X POST http://localhost:3000/api/sendText \
     -H "Content-Type: application/json" \
     -d '{
       "chatId": "919876543210@c.us",
       "text": "Hello! Your appointment with Dr. Priya Patel is confirmed for 10:00 AM."
     }'
   ```
4. **In n8n:**
   * Replace the test response node with an **HTTP Request** node calling `http://localhost:3000/api/sendText`.
   * Set the Webhook URL in WAHA to: `http://localhost:5678/webhook/hospital-demo-lead` so incoming WhatsApp messages trigger n8n!

---

### Option B: Meta WhatsApp Cloud API (Free Official Developer Tier)
*Best if you want official Meta APIs without third-party tools.*

Meta gives every developer account **1,000 free service conversations every month** and a free pre-configured test phone number.

#### Step-by-Step Setup:
1. Go to [developers.facebook.com](https://developers.facebook.com) and log in.
2. Click **Create App** ➔ Choose type **Other** ➔ Select **Business**.
3. Under Add Products, select **WhatsApp** ➔ Click **Set up**.
4. Meta gives you:
   * A **Temporary Access Token**
   * A **Phone Number ID**
   * A **Test Phone Number** (e.g., `+1 555-019-XXXX`)
5. In the **"To"** dropdown, add and verify your personal mobile number via an SMS OTP.
6. Click **Send message** — you will instantly receive a real WhatsApp message on your phone!
7. **Connecting to n8n:**
   * In n8n, add the native **WhatsApp** node.
   * Enter your Meta **Access Token** and **Phone Number ID**.
   * Now every time an appointment or no-show occurs, n8n pings your real WhatsApp.

---

### Option C: Twilio WhatsApp Sandbox (Free Developer Account)
*Best for zero-configuration testing.*

1. Create a free account at [twilio.com](https://www.twilio.com).
2. Go to **Messaging** ➔ **Try it out** ➔ **Send a WhatsApp message**.
3. Twilio gives you a sandbox number. Send a message from your WhatsApp saying `join <keyword>` (e.g. `join bright-wolf`).
4. In n8n, use the native **Twilio** node to send real WhatsApp messages directly to your phone.

---

### Making Localhost Public for Free (ngrok / Cloudflare Tunnel)
Meta and external webhooks cannot reach `http://localhost:5678`. To give your local n8n a secure public HTTPS URL:

```bash
# Using ngrok (Instant)
npx ngrok http 5678
```
*You get a public URL like:* `https://abc-123.ngrok-free.app`  
In Meta Developers or your forms, set your webhook URL to:  
`https://abc-123.ngrok-free.app/webhook/hospital-demo-lead`

---

## PART 2: How to Integrate for a Real Hospital (Production Deployment)

When deploying for a commercial hospital client, reliability, security, and official credentials are required.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            HOSPITAL CHANNELS                                │
│   Instagram DMs (Meta Graph)  │  Official WhatsApp (+91-XXXXX) │ Web Forms  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATION LAYER                               │
│              n8n on Cloud VPS (Docker + SSL + PostgreSQL)                    │
│                     automation.yourhospital.com                             │
└───────────────────┬─────────────────────────────────────┬───────────────────┘
                    ▼                                     ▼
┌──────────────────────────────────────┐ ┌────────────────────────────────────┐
│          HOSPITAL SYSTEM             │ │           STAFF DESK               │
│   EHR / HIS Database (SQL/REST)      │ │   Patient Relations Officer Queue  │
│  (Practo / KareXpert / In-House)     │ │     (Exception & Escalations)      │
└──────────────────────────────────────┘ └────────────────────────────────────┘
```

---

### Step 1: Cloud Hosting for n8n & Database (24/7 Uptime)
A hospital system cannot run on a laptop. Deploy n8n on a reliable Cloud VPS (DigitalOcean, AWS, Hetzner, or Google Cloud):

1. **VPS Specs:** Ubuntu 22.04 LTS, 2 vCPUs, 4GB RAM ($12–$20/month).
2. **Domain:** Point a subdomain (e.g. `automation.hospitalname.com`) to the VPS IP.
3. **Docker Compose Setup (`docker-compose.yml`):**
   ```yaml
   version: '3.8'
   services:
     postgres:
       image: postgres:15
       restart: always
       environment:
         POSTGRES_USER: n8n
         POSTGRES_PASSWORD: StrongPasswordHere
         POSTGRES_DB: n8n
       volumes:
         - pg_data:/var/lib/postgresql/data

     n8n:
       image: n8nio/n8n:latest
       restart: always
       ports:
         - "5678:5678"
       environment:
         - DB_TYPE=postgresdb
         - DB_POSTGRESDB_HOST=postgres
         - DB_POSTGRESDB_DATABASE=n8n
         - DB_POSTGRESDB_USER=n8n
         - DB_POSTGRESDB_PASSWORD=StrongPasswordHere
         - N8N_HOST=automation.hospitalname.com
         - N8N_PORT=5678
         - N8N_PROTOCOL=https
         - WEBHOOK_URL=https://automation.hospitalname.com/
       volumes:
         - n8n_data:/home/node/.n8n

   volumes:
     pg_data:
     n8n_data:
   ```
4. Put **Nginx with Let's Encrypt SSL** in front of n8n for automatic HTTPS renewal.

---

### Step 2: Onboarding the Hospital’s Official Phone Number
Hospitals must send messages from their official recognized number (e.g., `+91 80 XXXXXXXX` or customer care line):

1. **Choose an API Provider:**
   * **Direct Meta Cloud API:** Lowest per-message cost, managed inside Meta Business Manager.
   * **Business Solution Provider (Twilio / Gupshup / 360dialog):** Recommended if the hospital wants high-deliverability enterprise routing and priority support.
2. **Meta Business Verification:**
   * Go to `business.facebook.com` ➔ Security Center.
   * Upload hospital business registration / healthcare license, GST certificate, and utility bill.
   * Verification takes 1–3 business days.
3. **Pre-Approved Message Templates (Mandatory):**
   WhatsApp enforces a **24-hour service window**:
   * If a patient messages first: You can send free-form replies for 24 hours.
   * If the hospital messages first (e.g. **No-Show Follow-Up** or **48h Post-Discharge Survey**): You MUST submit a pre-approved template under category **UTILITY**.
   
   *Example Template to submit in Meta:*
   ```text
   Hi {{1}}, we noticed you were unable to attend your consultation at DemoCare Hospital on {{2}}. 
   Would you like to reschedule with Dr. {{3}}? 
   Reply 'YES' or tap the button below to pick a new slot.
   ```

---

### Step 3: Connecting the Hospital’s Instagram Page
1. Convert the hospital's Instagram to a **Professional Business Account**.
2. Link the Instagram page to the hospital's verified **Facebook Business Page**.
3. In Meta Developers (`developers.facebook.com`):
   * Add the **Instagram Graph API** / **Messenger API for Instagram**.
   * Subscribe to the `messages` webhook pointing to: `https://automation.hospitalname.com/webhook/hospital-demo-lead`.
   * When a patient DMs the hospital page on Instagram, n8n receives the event, looks up doctor availability in real time, and sends a reply directly into their Instagram DM.

---

### Step 4: Connecting n8n to the Hospital's HIS / EHR Database
Every hospital has an existing Hospital Information System (e.g., Practo, KareXpert, MocDoc, Cerner, or an in-house SQL database).

You integrate n8n with their system using one of three standard methods:

| Integration Method | How It Works | Best For |
| :--- | :--- | :--- |
| **1. REST API / Webhooks (Best Practice)** | The hospital's software triggers a webhook to n8n when an appointment status changes to `NO_SHOW` or `DISCHARGED`. | Modern cloud HIS platforms with API support. |
| **2. Direct SQL Query / Polling** | n8n connects directly to a read-only replica of the hospital database (MySQL/Postgres/MSSQL) every 15 minutes to find new appointments or discharges. | Legacy on-premise hospital servers. |
| **3. Zapier / Make / Webhook Relay** | Middleware that receives updates from Google Sheets, Web forms, or CRM and forwards them to n8n. | Clinics using lightweight tools. |

---

### Step 5: Staff Hand-off & Escalation Protocol
Automation handles 90% of routine workflows, but edge cases must reach human staff quickly:

1. **Negative Feedback (Rating $\le 2$):**
   * n8n automatically detects the low rating.
   * Pushes a high-priority ticket to the **Exception Queue** in your dashboard.
   * Sends an instant alert to the hospital's internal **Telegram / Slack / WhatsApp staff group**:
     > *"🚨 URGENT: Patient Rohan Verma left a 1-star review post-discharge. Issue: Delayed pain medication. Patient Relations Officer please contact +91-9876543210 within 15 minutes."*
2. **Medical Emergencies:**
   * Master System Prompt detects emergency keywords (*"chest pain"*, *"unconscious"*, *"heavy bleeding"*).
   * Instantly overrides the booking engine and displays:
     > *"⚠️ If this is a medical emergency, please call our emergency helpline at 108 or visit our 24/7 Emergency Wing immediately."*

---

## Summary Checklist for Pitching to Real Hospitals

- [ ] **Cloud VPS running n8n + SSL domain** (`automation.hospital.com`)
- [ ] **Meta Business Verification complete** (1–3 days)
- [ ] **WhatsApp Cloud API / Twilio connected** to official hospital number
- [ ] **Pre-approved Utility templates** submitted for No-Shows and Discharges
- [ ] **Read/Write access** to hospital doctor slot calendar or HIS API
- [ ] **Emergency guardrail prompts verified** for patient safety
