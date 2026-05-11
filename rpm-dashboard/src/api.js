const BASE = "http://10.107.140.56:8000/api";

// Demo accounts - works without backend
const DEMO_USERS = {
  "doctor@demo.com": {
    role: "doctor", fname: "Priya", lname: "Sharma",
    id: 1, email: "doctor@demo.com"
  },
  "patient@demo.com": {
    role: "patient", fname: "Arun", lname: "Kumar",
    id: 2, patientDbId: 1, email: "patient@demo.com",
    condition: "Hypertension", age: 45, gender: "Male"
  },
};

export async function loginUser(email, password) {
  if (DEMO_USERS[email] && password === "demo123") return DEMO_USERS[email];
  try {
    const res = await fetch(`${BASE}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (!res.ok) throw new Error("Invalid email or password");
    return res.json();
  } catch { throw new Error("Invalid email or password"); }
}

export async function registerUser(data) {
  try {
    const res = await fetch(`${BASE}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.detail || "Registration failed");
    return json;
  } catch (e) { throw new Error(e.message || "Registration failed"); }
}

export async function getPatients() {
  try { const res = await fetch(`${BASE}/patients`); return res.json(); } catch { return []; }
}
export async function getPatient(id) {
  try { const res = await fetch(`${BASE}/patients/${id}`); return res.json(); } catch { return null; }
}
export async function getVitals(patientId) {
  try { const res = await fetch(`${BASE}/vitals/${patientId}`); return res.json(); } catch { return []; }
}
export async function postVital(data) {
  try {
    const res = await fetch(`${BASE}/vitals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return res.json();
  } catch { return {}; }
}
export async function getAlerts(patientId) {
  try { const res = await fetch(`${BASE}/alerts/${patientId}`); return res.json(); } catch { return []; }
}
export async function getAllAlerts() {
  try { const res = await fetch(`${BASE}/alerts`); return res.json(); } catch { return []; }
}
export async function getDevices(patientId) {
  try { const res = await fetch(`${BASE}/devices/${patientId}`); return res.json(); } catch { return []; }
}
export async function getNetworkLogs(patientId) {
  try { const res = await fetch(`${BASE}/network/${patientId}`); return res.json(); } catch { return []; }
}
export async function getTransmissionLogs(patientId) {
  try { const res = await fetch(`${BASE}/transmission/${patientId}`); return res.json(); } catch { return []; }
}
export async function createAppointment(data) {
  try {
    const res = await fetch(`${BASE}/appointments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return res.json();
  } catch { return {}; }
}
export async function getDoctorAppointments(doctorId) {
  try { const res = await fetch(`${BASE}/appointments/doctor/${doctorId}`); return res.json(); } catch { return []; }
}
export async function getPatientAppointments(patientId) {
  try { const res = await fetch(`${BASE}/appointments/patient/${patientId}`); return res.json(); } catch { return []; }
}
export async function updateAppointmentStatus(appointmentId, status) {
  try {
    const res = await fetch(`${BASE}/appointments/${appointmentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    return res.json();
  } catch { return {}; }
}
export async function sendMessage(data) {
  try {
    const res = await fetch(`${BASE}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return res.json();
  } catch { return {}; }
}
export async function getMessages(appointmentId) {
  try { const res = await fetch(`${BASE}/chat/${appointmentId}`); return res.json(); } catch { return []; }
}