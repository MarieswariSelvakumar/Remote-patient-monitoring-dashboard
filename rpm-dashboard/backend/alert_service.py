"""
MediPulse — Notification Service
Email (Gmail SMTP) + SMS (Fast2SMS) + Appointment Reminders
Updated: Doctor + Patient both get emails | Voice Alert | Appointment emails
"""

import smtplib
import asyncio
import httpx
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from typing import Optional, List
from dotenv import load_dotenv

load_dotenv()

# ══════════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════════
GMAIL_USER     = "smarieswari37@gmail.com"
GMAIL_PASSWORD = "kvqq sekz qzii kwau"
FAST2SMS_KEY   = ""
DOCTOR_PHONE   = ""

# Add more doctor emails here if needed
DOCTOR_EMAILS: List[str] = [
    "smarieswari37@gmail.com",
]

print(f"📧 GMAIL_USER   : {GMAIL_USER}")
print(f"🔑 APP_PASSWORD : {'set' if GMAIL_PASSWORD else 'MISSING'}")
print(f"📬 DOCTOR_EMAILS: {DOCTOR_EMAILS}")


# ══════════════════════════════════════════════
# HELPER — send one HTML email
# ══════════════════════════════════════════════
def _send_html(to: str, subject: str, html: str) -> bool:
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = GMAIL_USER
        msg["To"]      = to
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(GMAIL_USER, GMAIL_PASSWORD)
            s.sendmail(GMAIL_USER, to, msg.as_string())
        print(f"✅ Email -> {to}")
        return True
    except Exception as e:
        print(f"❌ Email failed -> {to}: {e}")
        return False


def _header(title: str, color: str) -> str:
    return f"""
    <div style="background:#0a0e1a;padding:20px 28px">
      <span style="color:#00d4ff;font-size:18px;font-weight:700;letter-spacing:2px">MEDIPULSE RPM</span>
    </div>
    <div style="background:{color};padding:14px 28px">
      <div style="color:white;font-size:19px;font-weight:700">{title}</div>
      <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-top:3px">{datetime.now().strftime("%d %b %Y, %I:%M %p")}</div>
    </div>"""

def _footer() -> str:
    return '<div style="background:#f8f9fa;padding:14px 28px;font-size:11px;color:#888;border-top:1px solid #eee">MediPulse Remote Patient Monitoring · Auto-generated · Do not reply</div>'

def _wrap(inner: str) -> str:
    return f'<html><body style="font-family:Arial,sans-serif;background:#f0f4f8;padding:20px;"><div style="max-width:560px;margin:auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1)">{inner}</div></body></html>'


# ══════════════════════════════════════════════
# 1. CRITICAL VITALS ALERT — Doctor + Patient
# ══════════════════════════════════════════════
def send_email_alert(patient_name: str, vitals: dict, alert_type: str,
                     patient_email: Optional[str] = None):
    color = "#ff2d55" if alert_type == "CRITICAL" else "#ff8c42"
    icon  = "🚨" if alert_type == "CRITICAL" else "⚠️"

    # Build abnormal readings list
    items = []
    if vitals.get("heart_rate", 0) > 110:
        items.append(f"❤️ Heart Rate: <b style='color:red'>{vitals['heart_rate']} bpm</b> (Normal: 60–100)")
    if vitals.get("heart_rate", 0) < 50:
        items.append(f"❤️ Heart Rate: <b style='color:red'>{vitals['heart_rate']} bpm</b> (Dangerously LOW)")
    if vitals.get("spo2", 100) < 93:
        items.append(f"🫁 SpO₂: <b style='color:red'>{vitals['spo2']}%</b> (Normal: 95–100)")
    if vitals.get("bp_systolic", 0) > 160:
        items.append(f"🩺 BP: <b style='color:red'>{vitals['bp_systolic']}/{vitals.get('bp_diastolic',80)} mmHg</b> (High)")
    if vitals.get("temperature", 0) > 38.5:
        items.append(f"🌡️ Temp: <b style='color:orange'>{vitals['temperature']}°C</b> (Fever)")

    rows = "".join(f"<li style='margin:6px 0'>{i}</li>" for i in items)
    vitals_table = f"""
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="border-bottom:1px solid #ddd"><td style="padding:5px;color:#666">Heart Rate</td><td style="padding:5px;font-weight:600">{vitals.get('heart_rate','--')} bpm</td></tr>
      <tr style="border-bottom:1px solid #ddd"><td style="padding:5px;color:#666">Blood Pressure</td><td style="padding:5px;font-weight:600">{vitals.get('bp_systolic','--')}/{vitals.get('bp_diastolic','--')} mmHg</td></tr>
      <tr style="border-bottom:1px solid #ddd"><td style="padding:5px;color:#666">SpO₂</td><td style="padding:5px;font-weight:600">{vitals.get('spo2','--')}%</td></tr>
      <tr><td style="padding:5px;color:#666">Temperature</td><td style="padding:5px;font-weight:600">{vitals.get('temperature','--')}°C</td></tr>
    </table>"""

    # Doctor email
    doc_body = f"""
    {_header(f'{icon} {alert_type} ALERT — Immediate Action Required', color)}
    <div style="padding:24px 28px">
      <p style="font-size:15px;color:#1a1a2e">Patient <b style="color:#0066cc">{patient_name}</b> has abnormal vitals:</p>
      <div style="background:#fff5f5;border:1px solid #ffcccc;border-radius:8px;padding:16px;margin-bottom:16px">
        <b style="color:#cc0000">⚠️ Abnormal Readings:</b>
        <ul style="margin:8px 0 0;padding-left:20px;color:#333">{rows}</ul>
      </div>
      <div style="background:#f0f8ff;border:1px solid #b3d9ff;border-radius:8px;padding:14px;margin-bottom:20px">
        <b style="color:#0066cc">📊 All Vitals:</b><br><br>{vitals_table}
      </div>
      <a href="http://localhost:3000" style="background:#00d4ff;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">🏥 Open Dashboard →</a>
    </div>
    {_footer()}"""

    # Patient email
    pat_body = f"""
    {_header(f'{icon} Health Alert — {alert_type} Detected', color)}
    <div style="padding:24px 28px">
      <p style="font-size:15px;color:#1a1a2e">Dear <b>{patient_name}</b>, abnormal readings were detected. Your doctor has been notified. <b style="color:red">Do not ignore this alert.</b></p>
      <div style="background:#fff5f5;border:1px solid #ffcccc;border-radius:8px;padding:16px;margin-bottom:16px">
        <b style="color:#cc0000">⚠️ Abnormal Readings:</b>
        <ul style="margin:8px 0 0;padding-left:20px;color:#333">{rows}</ul>
      </div>
      <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:14px;margin-bottom:20px">
        <b>📌 What to do now:</b>
        <ul style="margin:8px 0 0;padding-left:20px;color:#555;font-size:13px">
          <li>Stay calm, sit or lie down</li>
          <li>Contact your doctor immediately</li>
          <li>Call emergency services if severe discomfort</li>
        </ul>
      </div>
      <a href="http://localhost:3000" style="background:#00d4ff;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">📱 Open My Dashboard →</a>
    </div>
    {_footer()}"""

    results = []
    for de in DOCTOR_EMAILS:
        results.append(_send_html(de, f"{icon} MEDIPULSE {alert_type} — {patient_name}", _wrap(doc_body)))
    if patient_email:
        results.append(_send_html(patient_email, f"{icon} MediPulse Health Alert — {alert_type}", _wrap(pat_body)))
    return any(results)


# ══════════════════════════════════════════════
# 2. VOICE ALERT EMAIL — Doctor instant email
# ══════════════════════════════════════════════
def send_voice_alert_email(patient_name: str, transcript: str, alert_type: str):
    color = "#ff2d55" if alert_type == "CRITICAL" else "#ff8c42"
    icon  = "🚨" if alert_type == "CRITICAL" else "⚠️"

    body = f"""
    {_header(f'{icon} VOICE ALERT — Patient Reported Concern', color)}
    <div style="padding:24px 28px">
      <p style="font-size:15px;color:#1a1a2e">Patient <b style="color:#0066cc">{patient_name}</b> used Voice Assistant and said:</p>
      <div style="background:#fff5f5;border:1px solid #ffcccc;border-radius:8px;padding:16px;margin-bottom:16px;font-size:15px">
        🎙️ <i style="color:#333">"{transcript}"</i>
      </div>
      <div style="background:#f0f8ff;border:1px solid #b3d9ff;border-radius:8px;padding:14px;margin-bottom:20px">
        <b>Alert Level:</b> <span style="color:{color};font-weight:700">{alert_type}</span>
      </div>
      <a href="http://localhost:3000" style="background:#00d4ff;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">🏥 Open Dashboard →</a>
    </div>
    {_footer()}"""

    results = []
    for de in DOCTOR_EMAILS:
        results.append(_send_html(de, f"{icon} VOICE ALERT — {patient_name}: \"{transcript[:50]}\"", _wrap(body)))
    return any(results)


# ══════════════════════════════════════════════
# 3. APPOINTMENT BOOKED — Doctor + Patient
# ══════════════════════════════════════════════
def send_appointment_booked_email(patient_name: str, patient_email: str,
                                   doctor_name: str, doctor_email: str,
                                   title: str, scheduled_at, meet_link: str = ""):
    try:
        time_str = scheduled_at.strftime("%d %b %Y at %I:%M %p") if hasattr(scheduled_at, 'strftime') else str(scheduled_at)
    except:
        time_str = str(scheduled_at)

    # Patient
    pat_body = f"""
    {_header('📅 Appointment Requested!', '#00d4ff')}
    <div style="padding:24px 28px">
      <p>Dear <b>{patient_name}</b>, your appointment has been submitted.</p>
      <div style="background:#f0f8ff;border-radius:8px;padding:16px;margin-bottom:20px">
        <div style="margin-bottom:8px"><b>👨‍⚕️ Doctor:</b> Dr. {doctor_name}</div>
        <div style="margin-bottom:8px"><b>📋 Type:</b> {title}</div>
        <div style="margin-bottom:8px"><b>🕐 Time:</b> {time_str}</div>
        <div><b>📌 Status:</b> <span style="color:orange;font-weight:600">Pending doctor confirmation</span></div>
      </div>
      <a href="http://localhost:3000" style="background:#00d4ff;color:#000;padding:11px 22px;border-radius:7px;text-decoration:none;font-weight:700">View Appointments →</a>
    </div>
    {_footer()}"""

    # Doctor
    doc_body = f"""
    {_header('🗓️ New Appointment Request', '#7c3aed')}
    <div style="padding:24px 28px">
      <p>Dr. <b>{doctor_name}</b>, new appointment request received.</p>
      <div style="background:#f5f3ff;border-radius:8px;padding:16px;margin-bottom:20px">
        <div style="margin-bottom:8px"><b>👤 Patient:</b> {patient_name}</div>
        <div style="margin-bottom:8px"><b>📋 Type:</b> {title}</div>
        <div><b>🕐 Requested Time:</b> {time_str}</div>
      </div>
      <a href="http://localhost:3000" style="background:#7c3aed;color:#fff;padding:11px 22px;border-radius:7px;text-decoration:none;font-weight:700">Accept / Decline →</a>
    </div>
    {_footer()}"""

    r1 = _send_html(patient_email, f"📅 Appointment Requested — {title} with Dr. {doctor_name}", _wrap(pat_body)) if patient_email else False
    r2 = _send_html(doctor_email, f"🗓️ New Request from {patient_name} — {title}", _wrap(doc_body)) if doctor_email else False
    return r1 or r2


# ══════════════════════════════════════════════
# 4. APPOINTMENT STATUS — Patient email
# ══════════════════════════════════════════════
def send_appointment_status_email(patient_name: str, patient_email: str,
                                   doctor_name: str, title: str,
                                   scheduled_at, status: str, meet_link: str = ""):
    if not patient_email:
        return False
    try:
        time_str = scheduled_at.strftime("%d %b %Y at %I:%M %p") if hasattr(scheduled_at, 'strftime') else str(scheduled_at)
    except:
        time_str = str(scheduled_at)

    accepted = status.lower() == "accepted"
    color    = "#00c853" if accepted else "#ff2d55"
    icon     = "✅" if accepted else "❌"
    label    = "Accepted" if accepted else "Declined"

    meet_btn = f'<a href="{meet_link}" style="background:#00c853;color:#fff;padding:11px 22px;border-radius:7px;text-decoration:none;font-weight:700;display:inline-block;margin-bottom:12px">🎥 Join Video Call →</a><br>' if accepted and meet_link else ""

    body = f"""
    {_header(f'{icon} Appointment {label}', color)}
    <div style="padding:24px 28px">
      <p>Dear <b>{patient_name}</b>, your appointment has been <b style="color:{color}">{label}</b> by Dr. {doctor_name}.</p>
      <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin-bottom:20px">
        <div style="margin-bottom:8px"><b>📋 Type:</b> {title}</div>
        <div style="margin-bottom:8px"><b>🕐 Time:</b> {time_str}</div>
        <div><b>👨‍⚕️ Doctor:</b> Dr. {doctor_name}</div>
      </div>
      {meet_btn}
      <a href="http://localhost:3000" style="background:#00d4ff;color:#000;padding:11px 22px;border-radius:7px;text-decoration:none;font-weight:700">View Dashboard →</a>
    </div>
    {_footer()}"""

    return _send_html(patient_email, f"{icon} Appointment {label} — {title} with Dr. {doctor_name}", _wrap(body))


# ══════════════════════════════════════════════
# 5. APPOINTMENT REMINDER (30 min before)
# ══════════════════════════════════════════════
def send_appointment_reminder(doctor_email, doctor_phone, patient_name,
                               appointment_title, scheduled_at):
    try:
        time_str = scheduled_at.strftime("%d %b %Y at %I:%M %p")
    except:
        time_str = str(scheduled_at)

    body = f"""
    {_header('📅 Appointment in 30 Minutes', '#00d4ff')}
    <div style="padding:24px 28px">
      <div style="background:#f0f8ff;border-radius:8px;padding:16px;margin-bottom:20px">
        <div style="margin-bottom:8px"><b>👤 Patient:</b> {patient_name}</div>
        <div style="margin-bottom:8px"><b>📋 Type:</b> {appointment_title}</div>
        <div><b>🕐 Time:</b> {time_str}</div>
      </div>
      <a href="http://localhost:3000" style="background:#00d4ff;color:#000;padding:11px 22px;border-radius:7px;text-decoration:none;font-weight:700">Join Call →</a>
    </div>
    {_footer()}"""

    return _send_html(doctor_email, f"📅 Reminder: {appointment_title} with {patient_name} — 30 min", _wrap(body))


# ══════════════════════════════════════════════
# SMS
# ══════════════════════════════════════════════
async def send_sms_alert(patient_name: str, vitals: dict, alert_type: str):
    if not FAST2SMS_KEY or not DOCTOR_PHONE:
        return False
    try:
        hr  = vitals.get("heart_rate", "--")
        sp  = vitals.get("spo2", "--")
        bp  = f"{vitals.get('bp_systolic','--')}/{vitals.get('bp_diastolic','--')}"
        msg = f"MEDIPULSE {alert_type}\nPatient: {patient_name}\nHR:{hr}bpm BP:{bp} SpO2:{sp}%\nTime:{datetime.now().strftime('%H:%M')}\nImmediate action!"
        async with httpx.AsyncClient() as c:
            r = await c.post("https://www.fast2sms.com/dev/bulkV2",
                headers={"authorization": FAST2SMS_KEY},
                data={"route":"q","message":msg,"language":"english","flash":0,"numbers":DOCTOR_PHONE},
                timeout=10)
            return r.json().get("return", False)
    except Exception as e:
        print(f"❌ SMS: {e}")
        return False


# ══════════════════════════════════════════════
# COMBINED
# ══════════════════════════════════════════════
async def send_full_alert(patient_name: str, vitals: dict, alert_type: str = "CRITICAL",
                          patient_email: Optional[str] = None):
    email_ok = send_email_alert(patient_name, vitals, alert_type, patient_email)
    sms_ok   = await send_sms_alert(patient_name, vitals, alert_type)
    return {"email": email_ok, "sms": sms_ok}
