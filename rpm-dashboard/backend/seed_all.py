import psycopg2
import bcrypt

conn = psycopg2.connect(host='localhost', port=5432, database='medipulse_db', user='postgres', password='sakthi@2004')
cur = conn.cursor()

# ═══ DOCTORS ═══
doctors = [
    ('Priya','Sharma','demo@medipulse.in','demo1234','Cardiology'),
    ('Venkat','Rajan','venkat@medipulse.in','venkat123','General Medicine'),
    ('Nithya','Mohan','nithya@medipulse.in','nithya123','Pulmonology'),
    ('Sundar','Raj','sundar@medipulse.in','sundar123','Endocrinology'),
    ('Arjun','Mehta','arjun@medipulse.in','arjun123','Neurology'),
]
    
doctor_ids = {}
for fname, lname, email, password, spec in doctors:
    cur.execute('SELECT id FROM users WHERE email = %s', (email,))
    row = cur.fetchone()
    if not row:
        pw = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        cur.execute("INSERT INTO users (email,password_hash,fname,lname,role) VALUES (%s,%s,%s,%s,'doctor') RETURNING id", (email,pw,fname,lname))
        did = cur.fetchone()[0]
        print(f'✅ Doctor: Dr. {fname} {lname}')
    else:
        did = row[0]
        print(f'⏭️  Doctor exists: Dr. {fname} {lname}')
    doctor_ids[f"{fname} {lname}"] = did

# ═══ PATIENTS ═══
patients = [
    ('P-0041','Arun','Kumar','arun@patient.in','arun1234',58,'Male','Diabetic Hypertension','Priya Sharma',93,112,138,88,37.8,'HIGH'),
    ('P-0055','Meena','Subramani','meena@patient.in','meena1234',72,'Female','Congestive Heart Failure','Venkat Rajan',94,88,162,98,37.2,'CRITICAL'),
    ('P-0078','Rajesh','Pillai','rajesh@patient.in','rajesh1234',45,'Male','COPD Stage II','Nithya Mohan',98,74,118,76,36.8,'LOW'),
    ('P-0092','Kavitha','Rajan','kavitha@patient.in','kavitha1234',52,'Female','Bronchial Asthma','Priya Sharma',95,82,126,80,37.0,'MEDIUM'),
    ('P-0105','Suresh','Babu','suresh@patient.in','suresh1234',65,'Male','Hypertension Stage 2','Venkat Rajan',96,95,155,92,37.3,'HIGH'),
    ('P-0118','Anitha','Devi','anitha@patient.in','anitha1234',48,'Female','Type 2 Diabetes','Nithya Mohan',97,79,132,84,36.9,'MEDIUM'),
    ('P-0134','Karthik','Raj','karthik@patient.in','karthik1234',34,'Male','Cardiac Arrhythmia','Priya Sharma',94,118,142,90,38.1,'CRITICAL'),
    ('P-0149','Lakshmi','Iyer','lakshmi@patient.in','lakshmi1234',67,'Female','Chronic Kidney Disease','Sundar Raj',95,76,148,94,37.1,'HIGH'),
    ('P-0162','Mohan','Das','mohan@patient.in','mohan1234',55,'Male','Post-Stroke Recovery','Arjun Mehta',96,84,136,86,37.0,'MEDIUM'),
    ('P-0175','Priya','Nair','priya@patient.in','priya1234',41,'Female','Severe Pneumonia','Nithya Mohan',91,96,128,82,38.8,'CRITICAL'),
    ('P-0188','Senthil','Kumar','senthil@patient.in','senthil1234',62,'Male','Post-MI Recovery','Priya Sharma',95,90,144,88,37.4,'HIGH'),
    ('P-0201','Deepa','Krishnan','deepa@patient.in','deepa1234',38,'Female','Hypothyroidism','Sundar Raj',98,68,118,74,36.6,'LOW'),
    ('P-0214','Ramesh','Babu','ramesh@patient.in','ramesh1234',70,'Male','COPD + Type 2 Diabetes','Venkat Rajan',92,98,158,96,37.6,'CRITICAL'),
    ('P-0227','Vijaya','Lakshmi','vijaya@patient.in','vijaya1234',59,'Female','Hypertension + Obesity','Arjun Mehta',96,80,150,92,37.2,'HIGH'),
    ('P-0240','Sanjay','Patel','sanjay@patient.in','sanjay1234',46,'Male','Routine Monitoring','Sundar Raj',99,70,118,76,36.8,'LOW'),
]

for pid, fname, lname, email, password, age, gender, condition, doc_name, spo2, hr, bp_sys, bp_dia, temp, risk in patients:
    # Create user
    cur.execute('SELECT id FROM users WHERE email = %s', (email,))
    row = cur.fetchone()
    if not row:
        pw = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        cur.execute("INSERT INTO users (email,password_hash,fname,lname,role) VALUES (%s,%s,%s,%s,'patient') RETURNING id", (email,pw,fname,lname))
        uid = cur.fetchone()[0]
    else:
        uid = row[0]

    # Get doctor id
    doc_id = doctor_ids.get(doc_name)

    # Create or update patient record
    cur.execute('SELECT id FROM patients WHERE patient_id = %s', (pid,))
    pat_row = cur.fetchone()
    if not pat_row:
        cur.execute("""
            INSERT INTO patients (patient_id, name, age, gender, condition, doctor_id, user_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (pid, f"{fname} {lname}", age, gender, condition, doc_id, uid))
        print(f'✅ Patient: {fname} {lname} ({pid})')
    else:
        # Update user_id and doctor_id if missing
        cur.execute("UPDATE patients SET user_id=%s, doctor_id=%s WHERE patient_id=%s", (uid, doc_id, pid))
        print(f'🔄 Updated: {fname} {lname} ({pid})')

conn.commit()
cur.close()
conn.close()
print('\n🎉 All 15 patients + 5 doctors seeded successfully!')
print('\nPatient Login Examples:')
print('  meena@patient.in / meena1234  → CRITICAL')
print('  rajesh@patient.in / rajesh1234 → LOW (NORMAL)')
print('  karthik@patient.in / karthik1234 → CRITICAL')
