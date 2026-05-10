import psycopg2
import bcrypt

conn = psycopg2.connect(
    host="localhost",
    port=5432,
    database="medipulse_db",
    user="postgres",
    password="sakthi@2004"
)
cur = conn.cursor()

patients = [
    ("arun@patient.in",    "arun1234"),
    ("meena@patient.in",   "meena1234"),
    ("rajesh@patient.in",  "rajesh1234"),
    ("kavitha@patient.in", "kavitha1234"),
    ("suresh@patient.in",  "suresh1234"),
    ("anitha@patient.in",  "anitha1234"),
    ("karthik@patient.in", "karthik1234"),
    ("lakshmi@patient.in", "lakshmi1234"),
    ("mohan@patient.in",   "mohan1234"),
    ("priya@patient.in",   "priya1234"),
    ("senthil@patient.in", "senthil1234"),
    ("deepa@patient.in",   "deepa1234"),
    ("ramesh@patient.in",  "ramesh1234"),
    ("vijaya@patient.in",  "vijaya1234"),
    ("sanjay@patient.in",  "sanjay1234"),
]

doctors = [
    ("venkat@medipulse.in", "venkat123"),
    ("nithya@medipulse.in", "nithya123"),
    ("sundar@medipulse.in", "sundar123"),
    ("arjun@medipulse.in",  "arjun123"),
    ("priya@medipulse.in",  "priya123"),
]

print("Resetting passwords...")

for email, password in patients + doctors:
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    cur.execute("UPDATE users SET password_hash = %s WHERE email = %s", (pw_hash, email))
    print(f"  done: {email}")

conn.commit()
cur.close()
conn.close()

print("")
print("All passwords reset!")
print("Doctor  -> venkat@medipulse.in / venkat123")
print("Patient -> meena@patient.in    / meena1234")
print("Patient -> arun@patient.in     / arun1234")