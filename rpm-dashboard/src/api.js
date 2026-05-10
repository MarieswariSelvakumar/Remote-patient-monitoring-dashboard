const BASE = "http://10.107.140.56:8000/api";

export async function loginUser(email, password) {
  const res = await fetch(`${BASE}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error("Invalid email or password");
  return res.json();
}
export async function registerUser(data) {
  const res = await fetch(`${BASE}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.detail || "Registration failed");
  return json;
}
export async function getPatients() { const res = await fetch(`${BASE}/patients`); return res.json(); }
export async function getPatient(id) { const res = await fetch(`${BASE}/patients/${id}`); return res.json(); }
export async function getVitals(patientId) { const res = await fetch(`${BASE}/vitals/${patientId}`); return res.json(); }
export async function postVital(data) {
  const res = await fetch(`${BASE}/vitals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  return res.json();
}
export async function getAlerts(patientId) { const res = await fetch(`${BASE}/alerts/${patientId}`); return res.json(); }
export async function getAllAlerts() { const res = await fetch(`${BASE}/alerts`); return res.json(); }
export async function getDevices(patientId) { const res = await fetch(`${BASE}/devices/${patientId}`); return res.json(); }
export async function getNetworkLogs(patientId) { const res = await fetch(`${BASE}/network/${patientId}`); return res.json(); }
export async function getTransmissionLogs(patientId) { const res = await fetch(`${BASE}/transmission/${patientId}`); return res.json(); }
export async function createAppointment(data) {
  const res = await fetch(`${BASE}/appointments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  return res.json();
}
export async function getDoctorAppointments(doctorId) { const res = await fetch(`${BASE}/appointments/doctor/${doctorId}`); return res.json(); }
export async function getPatientAppointments(patientId) { const res = await fetch(`${BASE}/appointments/patient/${patientId}`); return res.json(); }
export async function updateAppointmentStatus(appointmentId, status) {
  const res = await fetch(`${BASE}/appointments/${appointmentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  return res.json();
}
export async function sendMessage(data) {
  const res = await fetch(`${BASE}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  return res.json();
}
export async function getMessages(appointmentId) { const res = await fetch(`${BASE}/chat/${appointmentId}`); return res.json(); }
