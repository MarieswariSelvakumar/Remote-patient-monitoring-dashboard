import pandas as pd
import psycopg2
import bcrypt
import random
from datetime import datetime, timedelta

# --- DB CONNECTION ---
conn = psycopg2.connect(
    host="localhost",
    port=5432,
    database="medipulse_db",
    user="postgres",
    password="sakthi@2004"
)
cur = conn.cursor()
print("✅ Database connected!")

# --- READ EXCEL ---
xl = pd.ExcelFile("RPM_CARE_FULL_DATASET.xlsx")
print("✅ Excel file loaded!")

# STEP 1: SEED DOCTORS
doctors_raw = pd.read_excel(xl, sheet_name="DOCTORS", header=1)
doctors_raw.columns = doctors_raw.iloc[0]
doctors = doctors_raw.iloc[1:].reset_index(drop=True)
doctors.columns = ["doc_id","name","spec","dept","email","password","patients_count","status"]

for _, r in doctors.iterrows():
    pw_hash = bcrypt.hashpw(str(r["password"]).encode(), bcrypt.gensalt()).decode()
    name_parts = str(r["name"]).replace("Dr. ", "").split()
    fname = name_parts[0]
    lname = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""
    cur.execute("""
        INSERT INTO users (email, password_hash, fname, lname, role)
        VALUES (%s, %s, %s, %s, 'doctor')
        ON CONFLICT (email) DO NOTHING
    """, (r["email"], pw_hash, fname, lname))

conn.commit()
print("✅ Doctors seeded!")

# STEP 2: SEED PATIENTS
patients_raw = pd.read_excel(xl, sheet_name="PATIENTS_MASTER", header=1)
patients_raw.columns = patients_raw.iloc[0]
patients = patients_raw.iloc[1:].reset_index(drop=True)
patients.columns = [
    "patient_id","name","age","gender","blood_group","condition",
    "doctor_name","ward","email","password","hr","bp_sys","bp_dia",
    "spo2","temp","rr","glucose","weight","height","o2_flow","pain",
    "consciousness","risk"
]

for _, r in patients.iterrows():
    pw_hash = bcrypt.hashpw(str(r["password"]).encode(), bcrypt.gensalt()).decode()
    name_parts = str(r["name"]).split()
    fname = name_parts[0]
    lname = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""
    cur.execute("""
        INSERT INTO users (email, password_hash, fname, lname, role)
        VALUES (%s, %s, %s, %s, 'patient')
        ON CONFLICT (email) DO NOTHING
    """, (r["email"], pw_hash, fname, lname))

    doc_first = str(r["doctor_name"]).replace("Dr. ", "").split()[0]
    cur.execute("SELECT id FROM users WHERE fname = %s AND role = 'doctor'", (doc_first,))
    doc_row = cur.fetchone()
    doctor_id = doc_row[0] if doc_row else None

    cur.execute("""
        INSERT INTO patients (patient_id, name, age, gender, condition, doctor_id)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (patient_id) DO NOTHING
    """, (r["patient_id"], r["name"], int(r["age"]), r["gender"], r["condition"], doctor_id))

conn.commit()
print("✅ Patients seeded!")

# STEP 3: SEED VITALS
vitals_raw = pd.read_excel(xl, sheet_name="VITALS_READINGS", header=1)
vitals_raw.columns = vitals_raw.iloc[0]
vitals = vitals_raw.iloc[1:].reset_index(drop=True)
vitals.columns = [
    "reading_id","patient_id","name","date","time","hr",
    "bp_sys","bp_dia","spo2","temp","rr","glucose","o2_flow","pain","alert"
]

for _, r in vitals.iterrows():
    cur.execute("SELECT id FROM patients WHERE patient_id = %s", (r["patient_id"],))
    row = cur.fetchone()
    if not row:
        continue
    pid = row[0]
    alert_text = str(r["alert"])
    is_anomaly = "CRITICAL" in alert_text or "ABNORMAL" in alert_text
    cur.execute("""
        INSERT INTO vital_readings
        (patient_id, heart_rate, bp_systolic, bp_diastolic, spo2, temperature, glucose, is_anomaly)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """, (pid, float(r["hr"]), float(r["bp_sys"]), float(r["bp_dia"]),
          float(r["spo2"]), float(r["temp"]), float(r["glucose"]), bool(is_anomaly)))

conn.commit()
print("✅ Vitals seeded! (300 rows)")

# STEP 4: SEED ALERTS
alerts_raw = pd.read_excel(xl, sheet_name="ALERTS_LOG", header=1)
alerts_raw.columns = alerts_raw.iloc[0]
alerts = alerts_raw.iloc[1:].reset_index(drop=True)
alerts.columns = ["alert_id","timestamp","patient_id","name","vital_type","value","normal","deviation","severity"]

for _, r in alerts.iterrows():
    cur.execute("SELECT id FROM patients WHERE patient_id = %s", (r["patient_id"],))
    row = cur.fetchone()
    if not row:
        continue
    cur.execute("""
        INSERT INTO alerts (patient_id, alert_type, message)
        VALUES (%s, %s, %s)
    """, (row[0], str(r["severity"]), f'{r["vital_type"]}: {r["value"]} (Normal: {r["normal"]})'))

conn.commit()
print("✅ Alerts seeded!")

# STEP 5: SEED DEVICES (Telecom)
cur.execute("SELECT id FROM patients ORDER BY id")
all_patients = cur.fetchall()

device_types = ["Smartwatch", "ECG Patch", "BP Monitor", "SpO2 Sensor", "Temperature Sensor"]
device_names = ["FitBand Pro", "CardioSense X1", "BPTrack Plus", "OxyPulse", "ThermoWatch"]

for i, (pid,) in enumerate(all_patients):
    mac = f"AA:BB:CC:DD:{i:02X}:{(i*3):02X}"
    battery = round(random.uniform(45, 100), 1)
    signal  = round(random.uniform(-90, -40), 1)
    cur.execute("""
        INSERT INTO devices (patient_id, device_name, device_type, mac_address, battery_level, signal_strength, status)
        VALUES (%s, %s, %s, %s, %s, %s, 'active')
        ON CONFLICT (mac_address) DO NOTHING
    """, (pid, device_names[i % 5], device_types[i % 5], mac, battery, signal))

conn.commit()
print("✅ Devices seeded! (15 devices)")

# STEP 6: SEED NETWORK LOGS (Telecom)
cur.execute("SELECT id, patient_id FROM devices ORDER BY id")
all_devices = cur.fetchall()

network_types = ["4G LTE", "5G", "WiFi", "3G"]

for dev_id, pat_id in all_devices:
    for j in range(20):
        signal   = round(random.uniform(-95, -40), 1)
        latency  = round(random.uniform(10, 250), 2)
        ploss    = round(random.uniform(0, 15), 2)
        ts       = datetime.now() - timedelta(minutes=j * 15)
        cur.execute("""
            INSERT INTO network_logs
            (device_id, patient_id, signal_strength, network_type, latency_ms, packet_loss, is_connected, timestamp)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (dev_id, pat_id, signal, random.choice(network_types), latency, ploss, signal > -90, ts))

conn.commit()
print("✅ Network logs seeded! (300 rows)")

# STEP 7: SEED TRANSMISSION LOGS (Telecom)
data_types = ["vitals", "ecg", "alert", "location", "device_status"]
statuses   = ["success", "success", "success", "failed", "retry"]

for dev_id, pat_id in all_devices:
    for j in range(20):
        status  = random.choice(statuses)
        retries = 0 if status == "success" else random.randint(1, 3)
        ts      = datetime.now() - timedelta(minutes=j * 15)
        cur.execute("""
            INSERT INTO transmission_logs
            (device_id, patient_id, data_type, data_size_kb, status, retry_count, timestamp)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (dev_id, pat_id, random.choice(data_types), round(random.uniform(0.5, 50), 2), status, retries, ts))

conn.commit()
print("✅ Transmission logs seeded! (300 rows)")

# STEP 8: SEED NOTIFICATIONS (Telecom)
cur.execute("SELECT id FROM users WHERE role = 'doctor' LIMIT 1")
doc = cur.fetchone()
doc_id = doc[0] if doc else None

messages = [
    "Critical vital sign detected! Immediate attention required.",
    "SpO2 dropped below 93% — Emergency protocol triggered!",
    "Heart rate elevated above 110 bpm.",
    "Blood pressure critically high — 160/98 mmHg.",
    "Device battery low — Please charge wearable device.",
    "Daily health report is ready for review.",
    "Appointment reminder: Patient follow-up in 30 minutes.",
]

for (pid,) in all_patients:
    for j in range(3):
        cur.execute("""
            INSERT INTO notifications (patient_id, doctor_id, type, channel, message, status)
            VALUES (%s, %s, %s, %s, %s, 'sent')
        """, (pid, doc_id, random.choice(["alert","reminder","emergency"]),
              random.choice(["SMS","push","email"]), random.choice(messages)))

conn.commit()
print("✅ Notifications seeded! (45 rows)")

cur.close()
conn.close()
print("")
print("🎉 Database seeding COMPLETE!")
print("   → users             : doctors + patients")
print("   → patients          : 15 patients")
print("   → vital_readings    : 300 rows")
print("   → alerts            : anomaly alerts")
print("   → devices           : 15 wearable devices  📡")
print("   → network_logs      : 300 rows (telecom)   📶")
print("   → transmission_logs : 300 rows (telecom)   📤")
print("   → notifications     : 45 rows  (SMS/push)  🔔")
