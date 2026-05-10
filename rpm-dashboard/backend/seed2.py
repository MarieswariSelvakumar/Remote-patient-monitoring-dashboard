import psycopg2, bcrypt

conn = psycopg2.connect(host='localhost', port=5432, database='medipulse_db', user='postgres', password='sakthi@2004')
cur = conn.cursor()

doctors = [
    ('Priya','Sharma','demo@medipulse.in','demo1234'),
    ('Venkat','Rajan','venkat@medipulse.in','venkat123'),
    ('Nithya','Mohan','nithya@medipulse.in','nithya123'),
    ('Sundar','Raj','sundar@medipulse.in','sundar123'),
    ('Arjun','Mehta','arjun@medipulse.in','arjun123'),
]

doctor_ids = {}
for fname,lname,email,pwd in doctors:
    cur.execute('SELECT id FROM users WHERE email=%s',(email,))
    row=cur.fetchone()
    if not row:
        pw=bcrypt.hashpw(pwd.encode(),bcrypt.gensalt()).decode()
        cur.execute("INSERT INTO users(email,password_hash,fname,lname,role) VALUES(%s,%s,%s,%s,'doctor') RETURNING id",(email,pw,fname,lname))
        did=cur.fetchone()[0]
        print(f'Added Dr. {fname} {lname}')
    else:
        did=row[0]
        print(f'Exists Dr. {fname} {lname}')
    doctor_ids[f'{fname} {lname}']=did

patients=[
    ('P-0041','Arun','Kumar','arun@patient.in','arun1234',58,'Male','Diabetic Hypertension','Priya Sharma'),
    ('P-0055','Meena','Subramani','meena@patient.in','meena1234',72,'Female','Congestive Heart Failure','Venkat Rajan'),
    ('P-0078','Rajesh','Pillai','rajesh@patient.in','rajesh1234',45,'Male','COPD Stage II','Nithya Mohan'),
    ('P-0092','Kavitha','Rajan','kavitha@patient.in','kavitha1234',52,'Female','Bronchial Asthma','Priya Sharma'),
    ('P-0105','Suresh','Babu','suresh@patient.in','suresh1234',65,'Male','Hypertension Stage 2','Venkat Rajan'),
    ('P-0118','Anitha','Devi','anitha@patient.in','anitha1234',48,'Female','Type 2 Diabetes','Nithya Mohan'),
    ('P-0134','Karthik','Raj','karthik@patient.in','karthik1234',34,'Male','Cardiac Arrhythmia','Priya Sharma'),
    ('P-0149','Lakshmi','Iyer','lakshmi@patient.in','lakshmi1234',67,'Female','Chronic Kidney Disease','Sundar Raj'),
    ('P-0162','Mohan','Das','mohan@patient.in','mohan1234',55,'Male','Post-Stroke Recovery','Arjun Mehta'),
    ('P-0175','Priya','Nair','priya@patient.in','priya1234',41,'Female','Severe Pneumonia','Nithya Mohan'),
    ('P-0188','Senthil','Kumar','senthil@patient.in','senthil1234',62,'Male','Post-MI Recovery','Priya Sharma'),
    ('P-0201','Deepa','Krishnan','deepa@patient.in','deepa1234',38,'Female','Hypothyroidism','Sundar Raj'),
    ('P-0214','Ramesh','Babu','ramesh@patient.in','ramesh1234',70,'Male','COPD + Type 2 Diabetes','Venkat Rajan'),
    ('P-0227','Vijaya','Lakshmi','vijaya@patient.in','vijaya1234',59,'Female','Hypertension + Obesity','Arjun Mehta'),
    ('P-0240','Sanjay','Patel','sanjay@patient.in','sanjay1234',46,'Male','Routine Monitoring','Sundar Raj'),
]

for pid,fname,lname,email,pwd,age,gender,condition,doc in patients:
    cur.execute('SELECT id FROM users WHERE email=%s',(email,))
    row=cur.fetchone()
    if not row:
        pw=bcrypt.hashpw(pwd.encode(),bcrypt.gensalt()).decode()
        cur.execute("INSERT INTO users(email,password_hash,fname,lname,role) VALUES(%s,%s,%s,%s,'patient') RETURNING id",(email,pw,fname,lname))
        uid=cur.fetchone()[0]
    else:
        uid=row[0]
    did=doctor_ids.get(doc)
    cur.execute('SELECT id FROM patients WHERE patient_id=%s',(pid,))
    if not cur.fetchone():
        cur.execute("INSERT INTO patients(patient_id,name,age,gender,condition,doctor_id,user_id) VALUES(%s,%s,%s,%s,%s,%s,%s)",(pid,f'{fname} {lname}',age,gender,condition,did,uid))
        print(f'Added {fname} {lname} ({pid})')
    else:
        cur.execute("UPDATE patients SET user_id=%s,doctor_id=%s WHERE patient_id=%s",(uid,did,pid))
        print(f'Updated {fname} {lname} ({pid})')

conn.commit()
cur.close()
conn.close()
print('Done! All seeded!')
