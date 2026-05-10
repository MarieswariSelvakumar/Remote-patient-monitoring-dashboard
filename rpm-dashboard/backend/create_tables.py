import psycopg2

conn = psycopg2.connect(
    host="localhost",
    port=5432,
    database="medipulse_db",
    user="postgres",
    password="sakthi@2004"
)
cur = conn.cursor()

# ═══════════════════════════════
# APPOINTMENTS TABLE
# ═══════════════════════════════
cur.execute("""
    CREATE TABLE IF NOT EXISTS appointments (
        id SERIAL PRIMARY KEY,
        patient_id INTEGER REFERENCES patients(id),
        doctor_id INTEGER REFERENCES users(id),
        title VARCHAR(200),
        scheduled_at TIMESTAMP,
        duration_mins INTEGER DEFAULT 30,
        status VARCHAR(20) DEFAULT 'pending',
        meet_link VARCHAR(300),
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
    );
""")
print("✅ appointments table created!")

# ═══════════════════════════════
# CHAT MESSAGES TABLE
# ═══════════════════════════════
cur.execute("""
    CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        appointment_id INTEGER REFERENCES appointments(id),
        sender_id INTEGER REFERENCES users(id),
        sender_role VARCHAR(20),
        message TEXT NOT NULL,
        sent_at TIMESTAMP DEFAULT NOW()
    );
""")
print("✅ chat_messages table created!")

conn.commit()
cur.close()
conn.close()
print("")
print("🎉 All tables created successfully!")
