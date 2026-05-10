from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from database import get_connection
from typing import Optional, List
import bcrypt
import asyncio
import json
from alert_service import (send_full_alert, send_appointment_reminder,
                           send_voice_alert_email, send_appointment_booked_email,
                           send_appointment_status_email)
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from datetime import datetime, timedelta

app = FastAPI(title="MediPulse RPM API")

scheduler = AsyncIOScheduler()

@app.on_event("startup")
async def startup_event():
    scheduler.add_job(check_appointment_reminders, "interval", minutes=1)
    scheduler.start()
    print("✅ Notification scheduler started")

@app.on_event("shutdown")
async def shutdown_event():
    scheduler.shutdown()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    fname: str
    lname: str
    email: str
    password: str
    role: str
    age: Optional[int] = None
    gender: Optional[str] = None
    condition: Optional[str] = None
    specialization: Optional[str] = None

# ═══════════════════════════════════════════════
# WEBSOCKET MANAGER — Real-time Voice Alerts
# ═══════════════════════════════════════════════

class ConnectionManager:
    def __init__(self):
        self.doctor_connections: List[WebSocket] = []
        self.patient_connections: List[WebSocket] = []

    async def connect_doctor(self, websocket: WebSocket):
        await websocket.accept()
        self.doctor_connections.append(websocket)
        print(f"✅ Doctor WS connected | Online: {len(self.doctor_connections)}")

    async def connect_patient(self, websocket: WebSocket):
        await websocket.accept()
        self.patient_connections.append(websocket)
        print(f"✅ Patient WS connected | Online: {len(self.patient_connections)}")

    def disconnect_doctor(self, websocket: WebSocket):
        if websocket in self.doctor_connections:
            self.doctor_connections.remove(websocket)

    def disconnect_patient(self, websocket: WebSocket):
        if websocket in self.patient_connections:
            self.patient_connections.remove(websocket)

    async def broadcast_to_doctors(self, message: dict):
        dead = []
        for ws in self.doctor_connections:
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.doctor_connections.remove(ws)
        print(f"📡 Broadcast to {len(self.doctor_connections)} doctors: {message.get('message', '')}")

manager = ConnectionManager()

# Doctor listens for alerts
@app.websocket("/ws/doctor")
async def doctor_ws(websocket: WebSocket):
    await manager.connect_doctor(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep-alive ping
    except WebSocketDisconnect:
        manager.disconnect_doctor(websocket)

# Patient sends voice alerts
@app.websocket("/ws/patient")
async def patient_ws(websocket: WebSocket):
    await manager.connect_patient(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)

            # Instantly broadcast to all doctors
            await manager.broadcast_to_doctors({
                "type": "VOICE_ALERT",
                "patient_name": payload.get("patient_name", "Unknown"),
                "patient_id": payload.get("patient_id"),
                "alert_type": payload.get("alert_type", "HIGH"),
                "message": payload.get("message", ""),
                "transcript": payload.get("transcript", ""),
                "timestamp": datetime.now().isoformat(),
            })

            # Send email for CRITICAL/HIGH voice alerts
            alert_type_v = payload.get("alert_type", "HIGH")
            if alert_type_v in ("CRITICAL", "HIGH"):
                asyncio.create_task(asyncio.to_thread(
                    send_voice_alert_email,
                    payload.get("patient_name", "Unknown"),
                    payload.get("transcript") or payload.get("message", ""),
                    alert_type_v
                ))

            # Save to DB
            try:
                conn = get_connection()
                cur = conn.cursor()
                cur.execute("""
                    INSERT INTO alerts (patient_id, alert_type, message, is_read)
                    VALUES (%s, %s, %s, false)
                """, (
                    payload.get("patient_id"),
                    payload.get("alert_type", "HIGH"),
                    f"🎙️ VOICE: {payload.get('message', '')}",
                ))
                conn.commit()
                cur.close()
                conn.close()
            except Exception as e:
                print(f"DB error: {e}")

    except WebSocketDisconnect:
        manager.disconnect_patient(websocket)

# REST fallback if WebSocket not available
@app.post("/api/voice-alert")
async def voice_alert_rest(body: dict):
    await manager.broadcast_to_doctors({
        "type": "VOICE_ALERT",
        "patient_name": body.get("patient_name", "Unknown"),
        "patient_id": body.get("patient_id"),
        "alert_type": body.get("alert_type", "HIGH"),
        "message": body.get("message", ""),
        "transcript": body.get("transcript", ""),
        "timestamp": datetime.now().isoformat(),
    })
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO alerts (patient_id, alert_type, message, is_read)
            VALUES (%s, %s, %s, false)
        """, (body.get("patient_id"), body.get("alert_type", "HIGH"), f"🎙️ VOICE: {body.get('message', '')}"))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"DB error: {e}")
    return {"status": "ok", "doctors_online": len(manager.doctor_connections)}

# ═══════════════════════════════
# AUTH
# ═══════════════════════════════

@app.post("/api/login")
def login(body: LoginRequest):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, email, password_hash, fname, lname, role FROM users WHERE email = %s", (body.email,))
    user = cur.fetchone()
    cur.close()
    conn.close()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not bcrypt.checkpw(body.password.encode(), user[2].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    patient_id = None
    if user[5] == "patient":
        conn2 = get_connection()
        cur2 = conn2.cursor()
        cur2.execute("SELECT id FROM patients WHERE name LIKE %s", (f"{user[3]}%",))
        row = cur2.fetchone()
        cur2.close()
        conn2.close()
        if row:
            patient_id = row[0]
    return {"id": user[0], "email": user[1], "fname": user[3], "lname": user[4], "role": user[5], "patientDbId": patient_id}

@app.post("/api/register")
def register(body: RegisterRequest):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id FROM users WHERE email = %s", (body.email,))
    if cur.fetchone():
        cur.close()
        conn.close()
        raise HTTPException(status_code=400, detail="Email already registered")
    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    cur.execute("INSERT INTO users (email, password_hash, fname, lname, role) VALUES (%s, %s, %s, %s, %s) RETURNING id",
               (body.email, pw_hash, body.fname, body.lname, body.role))
    user_id = cur.fetchone()[0]
    patient_id = None
    if body.role == "patient":
        cur.execute("SELECT COUNT(*) FROM patients")
        count = cur.fetchone()[0]
        new_pid = f"P-{1000 + count + 1:04d}"
        cur.execute("INSERT INTO patients (patient_id, name, age, gender, condition, doctor_id) VALUES (%s, %s, %s, %s, %s, NULL) RETURNING id",
                   (new_pid, f"{body.fname} {body.lname}", body.age or 0, body.gender or "Unknown", body.condition or "General"))
        patient_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return {"id": user_id, "email": body.email, "fname": body.fname, "lname": body.lname, "role": body.role, "patientDbId": patient_id, "message": "Registration successful!"}

# ═══════════════════════════════
# PATIENTS
# ═══════════════════════════════

@app.get("/api/patients")
def get_patients():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT p.id, p.patient_id, p.name, p.age, p.gender, p.condition,
               u.fname || ' ' || u.lname as doctor_name, p.created_at
        FROM patients p LEFT JOIN users u ON p.doctor_id = u.id ORDER BY p.id
    """)
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

@app.get("/api/patients/{patient_id}")
def get_patient(patient_id: int):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT p.id, p.patient_id, p.name, p.age, p.gender, p.condition,
               u.fname || ' ' || u.lname as doctor_name
        FROM patients p LEFT JOIN users u ON p.doctor_id = u.id WHERE p.id = %s
    """, (patient_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Patient not found")
    return dict(zip(["id","patient_id","name","age","gender","condition","doctor_name"], row))

# ═══════════════════════════════
# DOCTORS
# ═══════════════════════════════

@app.get("/api/doctors")
def get_doctors():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id, fname, lname, email, role, 'General' as specialization FROM users WHERE role = 'doctor' ORDER BY fname")
    cols = ["id","fname","lname","email","role","specialization"]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    conn.close()
    spec_map = {"priya":"Cardiology","venkat":"General Medicine","nithya":"Pulmonology","sundar":"Endocrinology","arjun":"Neurology"}
    for r in rows:
        r["specialization"] = spec_map.get(r["fname"].lower(), "General")
    if not rows:
        seed_demo_doctors()
    return rows

def seed_demo_doctors():
    doctors = [("Priya","Sharma","demo@medipulse.in","demo1234"),("Venkat","Rajan","venkat@medipulse.in","venkat123"),
               ("Nithya","Mohan","nithya@medipulse.in","nithya123"),("Sundar","Raj","sundar@medipulse.in","sundar123"),
               ("Arjun","Mehta","arjun@medipulse.in","arjun123")]
    conn = get_connection()
    cur = conn.cursor()
    for fname, lname, email, pw in doctors:
        cur.execute("SELECT id FROM users WHERE email = %s", (email,))
        if not cur.fetchone():
            h = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
            cur.execute("INSERT INTO users (email, password_hash, fname, lname, role) VALUES (%s,%s,%s,%s,'doctor')", (email,h,fname,lname))
    conn.commit()
    cur.close()
    conn.close()

# ═══════════════════════════════
# VITALS
# ═══════════════════════════════

@app.get("/api/vitals/{patient_id}")
def get_vitals(patient_id: int):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id,patient_id,heart_rate,bp_systolic,bp_diastolic,spo2,temperature,glucose,is_anomaly,timestamp FROM vital_readings WHERE patient_id=%s ORDER BY timestamp DESC LIMIT 50", (patient_id,))
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

@app.post("/api/vitals")
async def post_vital(body: dict):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("INSERT INTO vital_readings (patient_id,heart_rate,bp_systolic,bp_diastolic,spo2,temperature,glucose,is_anomaly) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
               (body["patient_id"],body["heart_rate"],body["bp_systolic"],body["bp_diastolic"],body["spo2"],body["temperature"],body.get("glucose",0),body.get("is_anomaly",False)))
    new_id = cur.fetchone()[0]
    hr,spo2,bp,temp = body.get("heart_rate",0),body.get("spo2",100),body.get("bp_systolic",120),body.get("temperature",36.8)
    is_critical = hr>120 or hr<45 or spo2<90 or bp>180 or temp>39.5
    is_high = hr>110 or hr<50 or spo2<93 or bp>160 or temp>38.5
    if is_critical or is_high:
        cur.execute("SELECT name FROM patients WHERE id=%s", (body["patient_id"],))
        row = cur.fetchone()
        pname = row[0] if row else "Unknown"
        atype = "CRITICAL" if is_critical else "HIGH RISK"
        cur.execute("INSERT INTO alerts (patient_id,alert_type,message,is_read) VALUES (%s,%s,%s,false)",
                   (body["patient_id"],atype,f"HR:{hr} BP:{bp} SpO2:{spo2} Temp:{temp} — {atype}"))
        asyncio.create_task(send_full_alert(patient_name=pname, vitals=body, alert_type=atype))
    conn.commit()
    cur.close()
    conn.close()
    return {"id": new_id, "status": "saved"}

# ═══════════════════════════════
# ALERTS
# ═══════════════════════════════

@app.get("/api/alerts/{patient_id}")
def get_alerts(patient_id: int):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id,patient_id,alert_type,message,is_read,created_at FROM alerts WHERE patient_id=%s ORDER BY created_at DESC", (patient_id,))
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

@app.get("/api/alerts")
def get_all_alerts():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT a.id,a.patient_id,p.name as patient_name,a.alert_type,a.message,a.is_read,a.created_at
        FROM alerts a JOIN patients p ON a.patient_id=p.id ORDER BY a.created_at DESC LIMIT 50
    """)
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

# ═══════════════════════════════
# DEVICES + NETWORK
# ═══════════════════════════════

@app.get("/api/devices/{patient_id}")
def get_devices(patient_id: int):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id,patient_id,device_name,device_type,mac_address,battery_level,signal_strength,status,last_ping FROM devices WHERE patient_id=%s", (patient_id,))
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

@app.get("/api/network/{patient_id}")
def get_network_logs(patient_id: int):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT n.id,n.signal_strength,n.network_type,n.latency_ms,n.packet_loss,n.is_connected,n.timestamp FROM network_logs n WHERE n.patient_id=%s ORDER BY n.timestamp DESC LIMIT 20", (patient_id,))
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

@app.get("/api/notifications/{patient_id}")
def get_notifications(patient_id: int):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT id,type,channel,message,status,sent_at FROM notifications WHERE patient_id=%s ORDER BY sent_at DESC", (patient_id,))
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

# ═══════════════════════════════
# APPOINTMENTS
# ═══════════════════════════════

class AppointmentRequest(BaseModel):
    patient_id: int
    doctor_id: int
    title: str
    scheduled_at: str
    duration_mins: Optional[int] = 30
    notes: Optional[str] = ""

class AppointmentStatusUpdate(BaseModel):
    status: str

@app.post("/api/appointments")
def create_appointment(body: AppointmentRequest):
    import uuid
    conn = get_connection()
    cur = conn.cursor()
    meet_link = f"https://meet.jit.si/medipulse-{uuid.uuid4().hex[:12]}"
    try:
        scheduled = datetime.fromisoformat(body.scheduled_at.replace("T"," ").strip())
    except:
        scheduled = datetime.strptime(body.scheduled_at, "%Y-%m-%dT%H:%M")
    cur.execute("INSERT INTO appointments (patient_id,doctor_id,title,scheduled_at,duration_mins,notes,meet_link,status) VALUES (%s,%s,%s,%s,%s,%s,%s,'pending') RETURNING id",
               (body.patient_id,body.doctor_id,body.title,scheduled,body.duration_mins,body.notes,meet_link))
    new_id = cur.fetchone()[0]

    # Fetch patient + doctor emails for notification
    try:
        cur.execute("""
            SELECT u.email, u.fname, u.lname
            FROM patients p JOIN users u ON u.fname || ' ' || u.lname LIKE p.name || '%'
            WHERE p.id = %s LIMIT 1
        """, (body.patient_id,))
        pat = cur.fetchone()
        cur.execute("SELECT email, fname, lname FROM users WHERE id = %s", (body.doctor_id,))
        doc = cur.fetchone()
        if pat and doc:
            import threading
            threading.Thread(target=send_appointment_booked_email, args=(
                f"{pat[1]} {pat[2]}", pat[0],
                f"{doc[1]} {doc[2]}", doc[0],
                body.title, scheduled, meet_link
            ), daemon=True).start()
    except Exception as e:
        print(f"Appointment email error: {e}")

    conn.commit()
    cur.close()
    conn.close()
    return {"id": new_id, "meet_link": meet_link, "status": "pending"}

@app.get("/api/appointments/doctor/{doctor_id}")
def get_doctor_appointments(doctor_id: int):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT a.id,a.title,a.scheduled_at,a.duration_mins,a.status,a.meet_link,a.notes,
               p.name as patient_name,p.condition as patient_condition
        FROM appointments a JOIN patients p ON a.patient_id=p.id WHERE a.doctor_id=%s ORDER BY a.scheduled_at DESC
    """, (doctor_id,))
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

@app.get("/api/appointments/patient/{patient_id}")
def get_patient_appointments(patient_id: int):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT a.id,a.title,a.scheduled_at,a.duration_mins,a.status,a.meet_link,a.notes,
               u.fname||' '||u.lname as doctor_name
        FROM appointments a JOIN users u ON a.doctor_id=u.id WHERE a.patient_id=%s ORDER BY a.scheduled_at DESC
    """, (patient_id,))
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

@app.patch("/api/appointments/{appointment_id}")
def update_appointment_status(appointment_id: int, body: AppointmentStatusUpdate):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("UPDATE appointments SET status=%s WHERE id=%s", (body.status, appointment_id))

    # Send email to patient when accepted or rejected
    if body.status in ("accepted", "rejected"):
        try:
            cur.execute("""
                SELECT a.title, a.scheduled_at, a.meet_link,
                       p.name as patient_name,
                       pu.email as patient_email,
                       u.fname || ' ' || u.lname as doctor_name
                FROM appointments a
                JOIN patients p ON a.patient_id = p.id
                LEFT JOIN users pu ON pu.fname || ' ' || pu.lname LIKE p.name || '%'
                JOIN users u ON a.doctor_id = u.id
                WHERE a.id = %s
            """, (appointment_id,))
            row = cur.fetchone()
            if row:
                title, scheduled_at, meet_link, pat_name, pat_email, doc_name = row
                if pat_email:
                    import threading
                    threading.Thread(target=send_appointment_status_email, args=(
                        pat_name, pat_email, doc_name,
                        title, scheduled_at, body.status, meet_link or ""
                    ), daemon=True).start()
        except Exception as e:
            print(f"Status email error: {e}")

    conn.commit()
    cur.close()
    conn.close()
    return {"status": "updated"}

# ═══════════════════════════════
# CHAT
# ═══════════════════════════════

class ChatMessage(BaseModel):
    appointment_id: int
    sender_id: int
    sender_role: str
    message: str

@app.post("/api/chat")
def send_message(body: ChatMessage):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("INSERT INTO chat_messages (appointment_id,sender_id,sender_role,message) VALUES (%s,%s,%s,%s) RETURNING id,sent_at",
               (body.appointment_id,body.sender_id,body.sender_role,body.message))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return {"id": row[0], "sent_at": str(row[1])}

@app.get("/api/chat/{appointment_id}")
def get_messages(appointment_id: int):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT c.id,c.sender_id,c.sender_role,c.message,c.sent_at,u.fname||' '||u.lname as sender_name
        FROM chat_messages c JOIN users u ON c.sender_id=u.id WHERE c.appointment_id=%s ORDER BY c.sent_at ASC
    """, (appointment_id,))
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    cur.close()
    conn.close()
    return rows

# ═══════════════════════════════
# SCHEDULER
# ═══════════════════════════════

async def check_appointment_reminders():
    try:
        conn = get_connection()
        cur = conn.cursor()
        now,in30,win = datetime.now(), datetime.now()+timedelta(minutes=30), datetime.now()+timedelta(minutes=31)
        cur.execute("""
            SELECT a.id,a.title,a.scheduled_at,u.email,u.fname,u.lname,p.name
            FROM appointments a JOIN users u ON a.doctor_id=u.id JOIN patients p ON a.patient_id=p.id
            WHERE a.scheduled_at BETWEEN %s AND %s AND a.status='accepted'
        """, (in30, win))
        for row in cur.fetchall():
            send_appointment_reminder(doctor_email=row[3],doctor_phone="",patient_name=row[6],appointment_title=row[1],scheduled_at=row[2])
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Reminder error: {e}")

# ═══════════════════════════════
# TEST + HEALTH
# ═══════════════════════════════

@app.get("/api/test-alert")
@app.post("/api/test-alert")
async def test_alert():
    result = await send_full_alert(patient_name="Test Patient",
        vitals={"heart_rate":125,"bp_systolic":170,"bp_diastolic":95,"spo2":89,"temperature":39.8},alert_type="CRITICAL")
    return {"message": "Test alert sent!", "result": result}

@app.get("/")
def root():
    return {
        "status": "MediPulse RPM API Running! ✅",
        "version": "2.0",
        "websocket_doctor": "ws://localhost:8000/ws/doctor",
        "websocket_patient": "ws://localhost:8000/ws/patient",
        "doctors_online": len(manager.doctor_connections),
        "patients_online": len(manager.patient_connections),
    }
