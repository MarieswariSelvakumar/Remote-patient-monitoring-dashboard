import psycopg2
conn = psycopg2.connect(host='localhost', port=5432, database='medipulse_db', user='postgres', password='sakthi@2004')
cur = conn.cursor()
cur.execute("ALTER TABLE patients ADD COLUMN IF NOT EXISTS user_id INTEGER;")
conn.commit()
print('Column added!')
cur.close()
conn.close()
