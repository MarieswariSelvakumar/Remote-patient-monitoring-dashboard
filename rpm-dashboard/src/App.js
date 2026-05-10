import { useState, useEffect, useRef, useCallback } from "react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { loginUser, registerUser, getPatients, getVitals, getAlerts, getAllAlerts, postVital, getDevices, getNetworkLogs, createAppointment, getDoctorAppointments, getPatientAppointments, updateAppointmentStatus, sendMessage, getMessages } from "./api";

/* ═══════════════════════════════════════════════════════
   STATIC PATIENT DATA (Fallback + baseline info)
═══════════════════════════════════════════════════════ */
const PATIENTS_DATASET = [
  {
    id: "P-0041", name: "Arun Kumar", age: 58, gender: "Male",
    condition: "Diabetic, Hypertension", doctor: "Dr. Priya Sharma", ward: "Cardiology",
    baseline: { hr: 112, bp_sys: 138, bp_dia: 88, spo2: 93.0, temp: 37.8 },
    risk: "HIGH",
  },
  {
    id: "P-0055", name: "Meena Subramani", age: 72, gender: "Female",
    condition: "Heart Failure", doctor: "Dr. Venkat Rajan", ward: "Cardiology",
    baseline: { hr: 88, bp_sys: 162, bp_dia: 98, spo2: 94.0, temp: 37.2 },
    risk: "CRITICAL",
  },
  {
    id: "P-0078", name: "Rajesh Pillai", age: 45, gender: "Male",
    condition: "COPD", doctor: "Dr. Nithya Mohan", ward: "Pulmonology",
    baseline: { hr: 74, bp_sys: 118, bp_dia: 76, spo2: 98.0, temp: 36.8 },
    risk: "LOW",
  },
];

/* ── Vitals simulation ── */
function simVital(base, noise, anomalyChance = 0.04) {
  const spike = Math.random() < anomalyChance;
  return Math.round((base + (Math.random() - 0.5) * noise + (spike ? noise * 3 : 0)) * 10) / 10;
}
// Smooth gradual vitals — small drift from previous value
const _vitalState = {};
function genLiveVitals(patient) {
  const b = patient.baseline;
  const key = b.hr + "_" + b.bp_sys; // unique key per patient baseline
  const prev = _vitalState[key] || {
    hr: b.hr, bp_sys: b.bp_sys, bp_dia: b.bp_dia, spo2: b.spo2, temp: b.temp
  };
  // Small drift: max ±1 per update, occasional spike
  const drift = (max, spike = false) => (Math.random() - 0.5) * max * (spike && Math.random() < 0.03 ? 6 : 1);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const next = {
    hr:     clamp(Math.round((prev.hr     + drift(1.2)) * 10) / 10, b.hr - 18, b.hr + 18),
    bp_sys: clamp(Math.round((prev.bp_sys + drift(0.8)) * 10) / 10, b.bp_sys - 20, b.bp_sys + 20),
    bp_dia: clamp(Math.round((prev.bp_dia + drift(0.5)) * 10) / 10, b.bp_dia - 10, b.bp_dia + 10),
    spo2:   clamp(Math.round((prev.spo2   + drift(0.15)) * 10) / 10, b.spo2 - 3, 100),
    temp:   clamp(Math.round((prev.temp   + drift(0.04)) * 10) / 10, b.temp - 0.5, b.temp + 0.8),
    ts: new Date().toLocaleTimeString(),
  };
  _vitalState[key] = next;
  return next;
}
function genSparkData(base, noise, n = 20) {
  return Array.from({ length: n }, () => ({ v: base + (Math.random() - 0.5) * noise }));
}
function checkVitalAlert(v) {
  const a = [];
  if (v.hr > 105 || v.hr < 50) a.push({ type: "danger", msg: `Heart Rate ${v.hr} bpm — ABNORMAL` });
  if (v.bp_sys > 140) a.push({ type: "danger", msg: `Systolic BP ${v.bp_sys} mmHg — HIGH` });
  if (v.spo2 < 94) a.push({ type: "danger", msg: `SpO₂ ${v.spo2}% — CRITICALLY LOW` });
  if (v.temp > 37.8) a.push({ type: "warn", msg: `Temperature ${v.temp}°C — Fever` });
  return a;
}
function mlRisk(hist) {
  if (hist.length < 2) return { score: 0, label: "Loading...", color: "#6b7280", insights: [], cardiac: 0, respiratory: 0, deterioration: 0 };
  const n = hist.slice(-8);
  const avgHR  = n.reduce((s, v) => s + v.hr, 0) / n.length;
  const avgO2  = n.reduce((s, v) => s + v.spo2, 0) / n.length;
  const avgBP  = n.reduce((s, v) => s + v.bp_sys, 0) / n.length;
  const avgTmp = n.reduce((s, v) => s + v.temp, 0) / n.length;
  const hrTrend  = n.length > 3 ? n[n.length-1].hr - n[0].hr : 0;
  const o2Trend  = n.length > 3 ? n[n.length-1].spo2 - n[0].spo2 : 0;
  const bpTrend  = n.length > 3 ? n[n.length-1].bp_sys - n[0].bp_sys : 0;
  let sc = 0;
  const insights = [];
  if (avgHR > 120) { sc += 35; insights.push("🔴 Tachycardia — HR critically high"); }
  else if (avgHR > 100) { sc += 20; insights.push("🟡 Heart rate elevated above normal"); }
  else if (avgHR < 50) { sc += 30; insights.push("🔴 Bradycardia — HR dangerously low"); }
  if (avgO2 < 90) { sc += 45; insights.push("🔴 SpO₂ critically low — oxygen therapy needed"); }
  else if (avgO2 < 94) { sc += 28; insights.push("🟡 SpO₂ below safe threshold"); }
  else if (avgO2 < 96) { sc += 10; insights.push("🟢 SpO₂ slightly low — monitor closely"); }
  if (avgBP > 180) { sc += 40; insights.push("🔴 Hypertensive crisis — immediate attention"); }
  else if (avgBP > 160) { sc += 25; insights.push("🟡 BP significantly elevated"); }
  else if (avgBP > 140) { sc += 12; insights.push("🟡 BP above normal range"); }
  if (avgTmp > 39.5) { sc += 20; insights.push("🔴 High fever — infection risk"); }
  else if (avgTmp > 38.5) { sc += 12; insights.push("🟡 Fever detected"); }
  else if (avgTmp > 38) { sc += 5; insights.push("🟢 Mild temperature elevation"); }
  if (hrTrend > 15) { sc += 10; insights.push("📈 HR trending upward rapidly"); }
  if (o2Trend < -3) { sc += 15; insights.push("📉 SpO₂ declining — deteriorating"); }
  if (bpTrend > 20) { sc += 10; insights.push("📈 BP rising trend detected"); }
  sc = Math.min(100, Math.round(sc));
  const cardiac      = Math.min(100, Math.round((avgHR > 100 ? 40 : avgHR > 90 ? 20 : 5) + (avgBP > 160 ? 40 : avgBP > 140 ? 20 : 5) + (hrTrend > 10 ? 15 : 0)));
  const respiratory  = Math.min(100, Math.round((avgO2 < 90 ? 70 : avgO2 < 94 ? 45 : avgO2 < 96 ? 20 : 5) + (o2Trend < -2 ? 20 : 0)));
  const deterioration = Math.min(100, Math.round(sc * 0.85 + (hrTrend > 10 || o2Trend < -2 ? 15 : 0)));
  if (insights.length === 0) insights.push("✅ All vitals within acceptable range");
  if (sc >= 70) return { score: sc, label: "CRITICAL", color: "#ff2d55", insights, cardiac, respiratory, deterioration };
  if (sc >= 45) return { score: sc, label: "HIGH RISK", color: "#ff6b35", insights, cardiac, respiratory, deterioration };
  if (sc >= 25) return { score: sc, label: "MODERATE", color: "#ff8c42", insights, cardiac, respiratory, deterioration };
  return { score: sc, label: "STABLE", color: "#00ff9d", insights, cardiac, respiratory, deterioration };
}
function downloadCSV(filename, content) {
  const blob = new Blob([content], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
}

/* ═══════════════════════════════════════════════════════
   STYLES
═══════════════════════════════════════════════════════ */
const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --bg:#020d0f;--panel:#061418;--panel2:#0a1e24;--border:#1a3a42;
    --accent:#00bcd4;--accent2:#4dd0e1;--warn:#ff8c42;--danger:#ff2d55;
    --text:#b2ebf2;--text-dim:#4a7a85;--text-bright:#e0f7fa;
    --mono:'Space Mono',monospace;--sans:'DM Sans',sans-serif;
  }
  body{background:var(--bg);color:var(--text);font-family:var(--sans);overflow-x:hidden;}
  ::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px;}
  .grid-bg{position:fixed;inset:0;pointer-events:none;z-index:0;
    background-image:linear-gradient(rgba(0,230,118,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,230,118,0.03) 1px,transparent 1px);
    background-size:44px 44px;}
  .auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;position:relative;z-index:1;background:#020d0f;}
  .auth-medical-bg{position:fixed;inset:0;z-index:0;overflow:hidden;}
  /* Deep teal radial glow */
  .auth-medical-bg::before{content:'';position:absolute;inset:0;
    background:
      radial-gradient(ellipse 80% 60% at 15% 50%,rgba(0,188,212,0.07) 0%,transparent 65%),
      radial-gradient(ellipse 60% 80% at 85% 30%,rgba(77,208,225,0.05) 0%,transparent 55%),
      radial-gradient(ellipse 50% 50% at 50% 90%,rgba(0,188,212,0.04) 0%,transparent 50%);}
  /* Medical hex pattern */
  .auth-medical-bg::after{content:'';position:absolute;inset:0;opacity:0.06;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V18L28 2l28 16v32L28 66zM28 98L0 82V50l28-16 28 16v32L28 98z' fill='none' stroke='%2300bcd4' stroke-width='1'/%3E%3C/svg%3E");
    background-size:56px 100px;}
  /* Subtle grid overlay */
  .auth-bg-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(0,188,212,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(0,188,212,0.025) 1px,transparent 1px);background-size:40px 40px;}
  /* Medical cross pattern subtle */
  .auth-bg-cross{position:absolute;inset:0;opacity:0.03;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Crect x='25' y='10' width='10' height='40' fill='%2300bcd4'/%3E%3Crect x='10' y='25' width='40' height='10' fill='%2300bcd4'/%3E%3C/svg%3E");
    background-size:60px 60px;}
  /* ECG animated line */
  .ecg-bg-line{position:absolute;width:200%;height:60px;bottom:6%;animation:ecgBgScroll 14s linear infinite;overflow:hidden;}
  @keyframes ecgBgScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
  .auth-container{position:relative;z-index:1;width:100%;max-width:1100px;margin:0 auto;display:flex;gap:60px;align-items:center;justify-content:center;padding:40px 20px;min-height:100vh;}
  .auth-info-panel{flex:1;max-width:500px;}
  .auth-form-panel{width:420px;flex-shrink:0;}
  @media(max-width:900px){.auth-info-panel{display:none;}.auth-form-panel{width:100%;max-width:460px;}}
  .auth-glow{display:none;}
  .auth-card{background:rgba(6,20,24,0.88);border:1px solid rgba(0,188,212,0.25);border-radius:20px;padding:44px;width:100%;max-width:420px;position:relative;overflow:hidden;animation:cardIn 0.4s ease;backdrop-filter:blur(16px);box-shadow:0 8px 48px rgba(0,0,0,0.5),0 0 0 1px rgba(0,188,212,0.08),inset 0 1px 0 rgba(0,188,212,0.1);}
  .auth-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--accent),var(--accent2),transparent);}
  @keyframes cardIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  .auth-logo{display:flex;align-items:center;gap:10px;margin-bottom:32px;}
  .logo-dot{width:11px;height:11px;border-radius:50%;background:#00bcd4;box-shadow:0 0 12px #00bcd4;animation:pulseDot 2s ease-in-out infinite;}
  @keyframes pulseDot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(0.75)}}
  .logo-text{font-family:var(--mono);font-size:1.1rem;color:var(--accent);letter-spacing:2.5px;}
  .auth-title{font-size:1.65rem;font-weight:600;color:var(--text-bright);margin-bottom:6px;}
  .auth-sub{font-size:0.82rem;color:var(--text-dim);margin-bottom:28px;}
  .f-group{margin-bottom:15px;}
  .f-label{display:block;font-family:var(--mono);font-size:0.6rem;color:var(--text-dim);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:7px;}
  .f-input{width:100%;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:11px 14px;color:var(--text-bright);font-size:0.85rem;font-family:var(--sans);outline:none;transition:all 0.2s;}
  .f-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(0,212,255,0.09);}
  .f-input.err{border-color:var(--danger);}
  .btn-auth{width:100%;padding:12px;border:none;border-radius:9px;background:linear-gradient(135deg,#00bcd4,#4dd0e1);color:#020f0a;font-family:var(--mono);font-size:0.72rem;letter-spacing:1.5px;font-weight:700;cursor:pointer;transition:all 0.2s;margin-top:8px;}
  .btn-auth:hover{background:#2de0ff;transform:translateY(-1px);}
  .btn-auth:disabled{opacity:0.6;cursor:default;transform:none;}
  .demo-box{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:16px;}
  .demo-box-title{font-family:var(--mono);font-size:0.6rem;color:var(--text-dim);letter-spacing:1.5px;margin-bottom:8px;}
  .demo-accounts{display:flex;flex-direction:column;gap:6px;}
  .demo-acc{display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.12);border-radius:6px;cursor:pointer;transition:all 0.2s;}
  .demo-acc:hover{background:rgba(0,212,255,0.1);border-color:var(--accent);}
  .demo-acc-name{font-size:0.8rem;color:var(--text-bright);font-weight:500;}
  .demo-acc-email{font-family:var(--mono);font-size:0.6rem;color:var(--accent);}
  .demo-acc-role{font-family:var(--mono);font-size:0.58rem;padding:2px 7px;border-radius:3px;}
  .demo-role-d{background:rgba(0,212,255,0.1);color:var(--accent);}
  .demo-role-p{background:rgba(0,255,157,0.1);color:var(--accent2);}
  .topbar{position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:14px 28px;background:rgba(3,13,26,0.92);border-bottom:1px solid var(--border);backdrop-filter:blur(14px);}
  .top-right{display:flex;align-items:center;gap:18px;}
  .sys-status{font-family:var(--mono);font-size:0.62rem;color:var(--accent2);letter-spacing:1px;display:flex;align-items:center;gap:6px;}
  .status-dot{width:6px;height:6px;border-radius:50%;background:var(--accent2);box-shadow:0 0 6px var(--accent2);animation:blink 1.4s step-end infinite;}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0.15}}
  .clock-display{font-family:var(--mono);font-size:0.74rem;color:var(--text-dim);}
  .user-chip{display:flex;align-items:center;gap:9px;background:var(--panel2);border:1px solid var(--border);border-radius:20px;padding:5px 14px 5px 5px;}
  .user-av{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:#000;}
  .user-nm{font-size:0.76rem;color:var(--text);}
  .logout-btn{font-family:var(--mono);font-size:0.58rem;color:var(--text-dim);cursor:pointer;letter-spacing:1px;padding:5px 10px;border:1px solid var(--border);border-radius:4px;background:transparent;transition:all 0.2s;}
  .logout-btn:hover{color:var(--danger);border-color:var(--danger);}
  .app-layout{display:grid;grid-template-columns:230px 1fr;min-height:calc(100vh - 54px);position:relative;z-index:1;}
  .sidebar{border-right:1px solid var(--border);padding:22px 0;display:flex;flex-direction:column;gap:2px;background:var(--bg);}
  .sidebar-label{font-family:var(--mono);font-size:0.58rem;color:var(--text-dim);letter-spacing:2px;padding:10px 18px 6px;text-transform:uppercase;}
  .nav-btn{display:flex;align-items:center;gap:11px;padding:10px 18px;cursor:pointer;border-radius:0 7px 7px 0;margin-right:10px;font-size:0.85rem;color:var(--text-dim);transition:all 0.2s;border-left:2px solid transparent;border-right:none;border-top:none;border-bottom:none;background:transparent;width:calc(100% - 10px);text-align:left;font-family:var(--sans);}
  .nav-btn:hover{color:var(--text);background:rgba(0,212,255,0.04);}
  .nav-btn.active{color:var(--accent);background:rgba(0,212,255,0.08);border-left-color:var(--accent);}
  .nav-icon{font-size:1rem;width:22px;text-align:center;}
  .nav-badge{margin-left:auto;background:var(--danger);color:#fff;font-size:0.58rem;font-family:var(--mono);padding:2px 7px;border-radius:10px;}
  .page-wrap{padding:28px;overflow-y:auto;animation:pageIn 0.22s ease;}
  @keyframes pageIn{from{opacity:0;transform:translateX(6px)}to{opacity:1;transform:translateX(0)}}
  .page-header{margin-bottom:24px;display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;}
  .page-title{font-size:1.5rem;font-weight:600;color:var(--text-bright);}
  .page-sub{font-size:0.8rem;color:var(--text-dim);margin-top:4px;}
  .card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:20px;}
  .card-title{font-family:var(--mono);font-size:0.62rem;color:var(--text-dim);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;}
  .g2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
  .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;}
  .g4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;}
  .mb16{margin-bottom:16px;}.mb20{margin-bottom:20px;}
  .vital-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px 16px;position:relative;overflow:hidden;transition:border-color 0.3s;}
  .vital-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;}
  .vc-heart::before{background:linear-gradient(90deg,#ff2d55,transparent);}
  .vc-bp::before{background:linear-gradient(90deg,#00d4ff,transparent);}
  .vc-spo2::before{background:linear-gradient(90deg,#00ff9d,transparent);}
  .vc-temp::before{background:linear-gradient(90deg,#ff8c42,transparent);}
  .vc-anomaly{border-color:rgba(255,45,85,0.55)!important;animation:flashBorder 2s ease-in-out infinite;}
  @keyframes flashBorder{0%,100%{border-color:rgba(255,45,85,0.55)}50%{border-color:rgba(255,45,85,1);box-shadow:0 0 18px rgba(255,45,85,0.18)}}
  .vc-label{font-family:var(--mono);font-size:0.58rem;color:var(--text-dim);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;}
  .vc-value{font-family:var(--mono);font-size:2.1rem;font-weight:700;color:var(--text-bright);line-height:1;}
  .vc-unit{font-size:0.7rem;color:var(--text-dim);margin-left:3px;}
  .vc-trend{font-size:0.64rem;margin-top:7px;font-family:var(--mono);}
  .t-danger{color:var(--danger);}.t-warn{color:var(--warn);}.t-ok{color:var(--accent2);}
  .ecg-wrap{width:100%;height:84px;overflow:hidden;position:relative;}
  .ecg-svg{position:absolute;top:0;left:0;width:200%;height:100%;animation:ecgScroll 3s linear infinite;}
  @keyframes ecgScroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
  .risk-row{margin-bottom:12px;}
  .risk-labels{display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-dim);margin-bottom:5px;}
  .risk-track{height:5px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden;}
  .risk-fill{height:100%;border-radius:3px;transition:width 1s ease;}
  .rf-high{background:linear-gradient(90deg,var(--danger),#ff6b35);}
  .rf-med{background:linear-gradient(90deg,var(--warn),#ffd700);}
  .rf-low{background:linear-gradient(90deg,var(--accent2),var(--accent));}
  .alert-item{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:9px;margin-bottom:8px;font-size:0.78rem;line-height:1.5;}
  .ai-danger{background:rgba(255,45,85,0.07);border:1px solid rgba(255,45,85,0.28);}
  .ai-warn{background:rgba(255,140,66,0.07);border:1px solid rgba(255,140,66,0.28);}
  .ai-info{background:rgba(0,212,255,0.05);border:1px solid rgba(0,212,255,0.2);}
  .ai-ok{background:rgba(0,255,157,0.05);border:1px solid rgba(0,255,157,0.2);}
  .ai-dot{width:7px;height:7px;border-radius:50%;margin-top:5px;flex-shrink:0;}
  .dot-danger{background:var(--danger);}.dot-warn{background:var(--warn);}.dot-info{background:var(--accent);}.dot-ok{background:var(--accent2);}
  .ai-time{font-family:var(--mono);font-size:0.59rem;color:var(--text-dim);margin-top:3px;}
  .tbl{width:100%;border-collapse:collapse;}
  .tbl th{font-family:var(--mono);font-size:0.58rem;color:var(--text-dim);letter-spacing:1.5px;text-transform:uppercase;padding:10px 14px;border-bottom:1px solid var(--border);text-align:left;}
  .tbl td{padding:12px 14px;border-bottom:1px solid rgba(26,58,85,0.4);font-size:0.82rem;color:var(--text);}
  .tbl tr:hover td{background:rgba(0,212,255,0.025);}
  .tbl tr:last-child td{border-bottom:none;}
  .risk-tag{padding:3px 9px;border-radius:4px;font-size:0.6rem;font-family:var(--mono);letter-spacing:1px;}
  .rt-high{background:rgba(255,45,85,0.12);color:var(--danger);border:1px solid rgba(255,45,85,0.28);}
  .rt-med{background:rgba(255,140,66,0.12);color:var(--warn);border:1px solid rgba(255,140,66,0.28);}
  .rt-low{background:rgba(0,255,157,0.08);color:var(--accent2);border:1px solid rgba(0,255,157,0.28);}
  .btn-primary{padding:10px 20px;border:none;border-radius:9px;background:var(--accent);color:#000;font-family:var(--mono);font-size:0.7rem;letter-spacing:1px;cursor:pointer;transition:all 0.2s;font-weight:700;}
  .btn-primary:hover{background:#2de0ff;transform:translateY(-1px);}
  .btn-outline{padding:9px 18px;border:1px solid var(--border);border-radius:9px;background:transparent;color:var(--text-dim);font-family:var(--mono);font-size:0.7rem;letter-spacing:1px;cursor:pointer;transition:all 0.2s;}
  .btn-outline:hover{border-color:var(--accent);color:var(--accent);}
  .btn-danger-outline{padding:9px 18px;border:1px solid rgba(255,45,85,0.4);border-radius:9px;background:rgba(255,45,85,0.08);color:var(--danger);font-family:var(--mono);font-size:0.68rem;letter-spacing:1px;cursor:pointer;transition:all 0.2s;}
  .ring-wrap{position:relative;width:100px;height:100px;margin:0 auto 12px;}
  .ring-wrap svg{transform:rotate(-90deg);}
  .ring-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;}
  .ring-score{font-family:var(--mono);font-size:1.6rem;font-weight:700;}
  .ml-insight{background:rgba(0,212,255,0.04);border:1px solid rgba(0,212,255,0.14);border-radius:9px;padding:12px 14px;font-size:0.78rem;color:var(--text);line-height:1.55;display:flex;gap:10px;}
  .rec-blink{animation:blink 1s step-end infinite;color:var(--danger);}
  .toast-wrap{position:fixed;bottom:26px;right:26px;z-index:9998;display:flex;flex-direction:column;gap:8px;max-width:340px;}
  .toast{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:13px 18px;display:flex;align-items:flex-start;gap:10px;font-size:0.8rem;box-shadow:0 8px 28px rgba(0,0,0,0.4);animation:toastIn 0.35s cubic-bezier(0.34,1.56,0.64,1);}
  @keyframes toastIn{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
  .toast-ok{border-color:rgba(0,255,157,0.35);}.toast-warn{border-color:rgba(255,140,66,0.35);}.toast-info{border-color:rgba(0,212,255,0.28);}.toast-err{border-color:rgba(255,45,85,0.35);}
  .toast-icon{font-size:1.1rem;margin-top:1px;flex-shrink:0;}
  .toast-body{flex:1;}
  .toast-title{font-weight:600;color:var(--text-bright);margin-bottom:2px;}
  .toast-msg{font-size:0.75rem;color:var(--text-dim);}
  .vh-row{display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr 1fr 1fr;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(26,58,85,0.3);font-family:var(--mono);font-size:0.68rem;align-items:center;}
  .vh-row.header{color:var(--text-dim);font-size:0.6rem;letter-spacing:1px;background:rgba(0,0,0,0.2);border-radius:6px 6px 0 0;}
  .vh-danger{color:var(--danger);}.vh-warn{color:var(--warn);}.vh-ok{color:var(--accent2);}
  .device-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;}
  .device-item{background:var(--panel2);border:1px solid var(--border);border-radius:7px;padding:10px 12px;}
  .device-name{font-size:0.78rem;color:var(--text-bright);font-weight:500;}
  .device-status{font-family:var(--mono);font-size:0.6rem;margin-top:3px;}
  .ds-ok{color:var(--accent2);}.ds-low{color:var(--warn);}
  .pt-identity{margin:12px 10px;background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:14px 12px;}
  .pt-id-avatar{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;color:#000;margin:0 auto 10px;}
  .pt-id-name{font-size:0.88rem;font-weight:600;color:var(--text-bright);text-align:center;}
  .pt-id-meta{font-size:0.68rem;color:var(--text-dim);text-align:center;margin-top:3px;font-family:var(--mono);}
  .live-vital-mini{display:flex;justify-content:space-between;margin-top:10px;padding-top:8px;border-top:1px solid var(--border);}
  .lvm-item{text-align:center;}
  .lvm-val{font-family:var(--mono);font-size:0.85rem;font-weight:700;}
  .lvm-lbl{font-size:0.55rem;color:var(--text-dim);letter-spacing:1px;margin-top:1px;}
  .appt-card{display:flex;align-items:flex-start;gap:14px;padding:14px 16px;background:var(--panel2);border:1px solid var(--border);border-radius:10px;margin-bottom:10px;}
  .appt-date-box{background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.2);border-radius:8px;padding:8px 12px;text-align:center;min-width:56px;}
  .appt-day{font-family:var(--mono);font-size:1.25rem;color:var(--accent);font-weight:700;line-height:1;}
  .appt-mon{font-family:var(--mono);font-size:0.54rem;color:var(--text-dim);letter-spacing:1px;}
  .appt-doc{font-size:0.88rem;font-weight:500;color:var(--text-bright);}
  .appt-spec{font-size:0.72rem;color:var(--text-dim);margin-top:2px;}
  .appt-time-txt{font-family:var(--mono);font-size:0.66rem;color:var(--accent);margin-top:5px;}
  .report-row{display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--panel2);border:1px solid var(--border);border-radius:10px;margin-bottom:9px;cursor:pointer;transition:border-color 0.2s;}
  .report-row:hover{border-color:var(--accent);}
  .report-icon{font-size:1.55rem;width:42px;text-align:center;}
  .report-name{font-size:0.84rem;font-weight:500;color:var(--text-bright);}
  .report-meta{font-size:0.7rem;color:var(--text-dim);margin-top:2px;}
  .report-dl{margin-left:auto;font-family:var(--mono);font-size:0.6rem;color:var(--accent);padding:6px 12px;border:1px solid rgba(0,212,255,0.28);border-radius:6px;background:rgba(0,212,255,0.05);}
  .setting-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid rgba(26,58,85,0.35);}
  .setting-name{font-size:0.84rem;color:var(--text-bright);}
  .setting-desc{font-size:0.7rem;color:var(--text-dim);margin-top:2px;}
  .toggle-wrap{position:relative;width:44px;height:24px;cursor:pointer;}
  .toggle-wrap input{opacity:0;width:0;height:0;position:absolute;}
  .toggle-slider{position:absolute;inset:0;background:var(--panel2);border:1px solid var(--border);border-radius:12px;transition:all 0.3s;}
  .toggle-slider::after{content:'';position:absolute;width:18px;height:18px;background:var(--text-dim);border-radius:50%;top:2px;left:2px;transition:all 0.3s;}
  .toggle-wrap input:checked+.toggle-slider{background:rgba(0,212,255,0.12);border-color:var(--accent);}
  .toggle-wrap input:checked+.toggle-slider::after{transform:translateX(20px);background:var(--accent);}
`;

/* ═══════════════════════════════════════════════════════
   SMALL COMPONENTS
═══════════════════════════════════════════════════════ */
function ToastManager({ toasts, remove }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => remove(t.id)} style={{ cursor: "pointer" }}>
          <span className="toast-icon">{t.icon}</span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            <div className="toast-msg">{t.msg}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AlertItem({ type, msg, time, detail }) {
  const map = { danger: ["ai-danger", "dot-danger"], warn: ["ai-warn", "dot-warn"], info: ["ai-info", "dot-info"], ok: ["ai-ok", "dot-ok"] };
  const [ac, dc] = map[type] || map.info;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`alert-item ${ac}`} onClick={() => setExpanded(!expanded)} style={{ cursor: "pointer" }}>
      <div className={`ai-dot ${dc}`} />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>{msg}</div>
          <span style={{ fontSize: "0.65rem", color: "var(--text-dim)", marginLeft: 8 }}>{expanded ? "▲" : "▼"}</span>
        </div>
        {time && <div className="ai-time">{new Date(time).toLocaleString()}</div>}
        {expanded && (
          <div style={{ marginTop: 8, padding: "8px 10px", background: "rgba(0,0,0,0.2)", borderRadius: 6, fontSize: "0.75rem", color: "var(--text)" }}>
            <div>🕐 Time: {time ? new Date(time).toLocaleString() : "Just now"}</div>
            <div style={{ marginTop: 4 }}>⚠️ Severity: {type === "danger" ? "CRITICAL — Immediate action required" : type === "warn" ? "HIGH — Monitor closely" : "INFO — For your attention"}</div>
            <div style={{ marginTop: 4 }}>📋 {detail || msg}</div>
            <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
              <span style={{ padding: "3px 10px", borderRadius: 4, fontSize: "0.6rem", background: "rgba(0,212,255,0.1)", color: "var(--accent)", border: "1px solid rgba(0,212,255,0.2)", cursor: "pointer" }}>✓ Acknowledge</span>
              <span style={{ padding: "3px 10px", borderRadius: 4, fontSize: "0.6rem", background: "rgba(255,45,85,0.1)", color: "var(--danger)", border: "1px solid rgba(255,45,85,0.2)", cursor: "pointer" }}>🚨 Escalate</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ECG() {
  const pts = "0,42 10,42 20,42 30,40 40,36 50,22 60,6 70,56 80,72 90,62 100,42 110,42 120,42 130,42 140,40 150,36 160,22 170,6 180,56 190,72 200,62 210,42 220,42 230,42 240,42 250,40 260,36 270,22 280,6 290,56 300,72 310,62 320,42 330,42 340,42 350,42 360,40 370,36 380,22 390,6 400,56 410,72 420,62 430,42 440,42 450,42 460,42 470,40 480,36 490,22 500,6 510,56 520,72 530,62 540,42 550,42 560,42 570,42 580,40 590,42 600,42 610,42 620,56 630,72 640,62 650,42 660,42 670,40 680,36 690,22 700,6 710,56 720,72 730,62 740,42 750,42 760,42 770,42 780,40 790,42 800,42";
  return (
    <div className="ecg-wrap">
      <svg className="ecg-svg" viewBox="0 0 800 80" preserveAspectRatio="none">
        <polyline fill="none" stroke="#ff2d55" strokeWidth="1.8" points={pts} />
      </svg>
    </div>
  );
}

function VitalCard({ label, value, unit, trend, trendClass, colorClass, anomaly, sparkColor, sparkData }) {
  return (
    <div className={`vital-card ${colorClass} ${anomaly ? "vc-anomaly" : ""}`}>
      <div className="vc-label">{label}</div>
      <div className="vc-value">{value}<span className="vc-unit">{unit}</span></div>
      <div className={`vc-trend ${trendClass}`}>{trend}</div>
      <svg style={{ width: "100%", height: 28, marginTop: 8 }} viewBox="0 0 200 28" preserveAspectRatio="none">
        <polyline fill="none" stroke={sparkColor} strokeWidth="1.5"
          points={sparkData.map((d, i) => {
            const x = (i / (sparkData.length - 1)) * 200;
            const mn = Math.min(...sparkData.map(s => s.v));
            const mx = Math.max(...sparkData.map(s => s.v));
            return `${x},${26 - ((d.v - mn) / (mx - mn + 0.001)) * 24}`;
          }).join(" ")} />
      </svg>
    </div>
  );
}

function RiskBar({ label, pct, fillClass }) {
  return (
    <div className="risk-row">
      <div className="risk-labels">
        <span>{label}</span>
        <span style={{ color: pct > 60 ? "var(--danger)" : pct > 40 ? "var(--warn)" : "var(--accent2)" }}>{pct}%</span>
      </div>
      <div className="risk-track"><div className={`risk-fill ${fillClass}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Toggle({ defaultChecked = true }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <label className="toggle-wrap">
      <input type="checkbox" checked={on} onChange={() => setOn(!on)} />
      <div className="toggle-slider" />
    </label>
  );
}

function RiskRing({ score, label, color }) {
  const r = 42, circ = 2 * Math.PI * r;
  return (
    <div style={{ textAlign: "center" }}>
      <div className="ring-wrap">
        <svg viewBox="0 0 100 100" width="100" height="100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={`${(score / 100) * circ} ${circ}`} strokeLinecap="round" />
        </svg>
        <div className="ring-center">
          <div className="ring-score" style={{ color }}>{score}</div>
          <div style={{ fontSize: 9, color: "var(--text-dim)" }}>/100</div>
        </div>
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>ML Risk Score</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   LOGIN PAGE
═══════════════════════════════════════════════════════ */
function LoginPage({ onLogin, onGoRegister }) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Reset fields on mount to prevent browser autofill carrying over
  useEffect(() => { setEmail(""); setPass(""); }, []);

  const doLogin = async () => {
    if (!email || !pass) { setError("Please enter email and password"); return; }
    setLoading(true); setError("");
    try {
      const u = await loginUser(email, pass);
      onLogin(u);
    } catch (e) {
      setError("Invalid email or password");
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-medical-bg">
        <div className="auth-bg-grid" />
        <div className="auth-bg-cross" />
        <div className="ecg-bg-line">
          <svg width="100%" height="60" viewBox="0 0 3200 60" preserveAspectRatio="none">
            <polyline fill="none" stroke="#00bcd4" strokeWidth="1.5" opacity="0.25"
              points="0,30 200,30 240,30 260,8 275,52 290,3 305,57 320,30 500,30 700,30 740,30 760,8 775,52 790,3 805,57 820,30 1000,30 1200,30 1240,30 1260,8 1275,52 1290,3 1305,57 1320,30 1500,30 1700,30 1740,30 1760,8 1775,52 1790,3 1805,57 1820,30 2000,30 2200,30 2240,30 2260,8 2275,52 2290,3 2305,57 2320,30 2500,30 2700,30 2740,30 2760,8 2775,52 2790,3 2805,57 2820,30 3000,30 3200,30"/>
          </svg>
        </div>
      </div>
      <div className="auth-container">
        {/* LEFT — Info Panel */}
        <div className="auth-info-panel">
          <div style={{marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:"#00e676",boxShadow:"0 0 8px #00e676",animation:"pulseDot 2s ease-in-out infinite"}}/>
            <span style={{fontFamily:"var(--mono)",fontSize:"0.65rem",color:"#00bcd4",letterSpacing:2}}>LIVE MONITORING SYSTEM</span>
          </div>
          <div style={{fontSize:"2.8rem",fontWeight:700,color:"var(--text-bright)",lineHeight:1.15,marginBottom:16,marginTop:12}}>
            Remote Patient<br/>
            <span style={{color:"#00bcd4"}}>Monitoring</span><br/>
            Platform
          </div>
          <div style={{fontSize:"0.88rem",color:"var(--text-dim)",lineHeight:1.8,marginBottom:36,maxWidth:400}}>
            AI-powered vitals monitoring, real-time alerts, and telemedicine — all in one platform.
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:36}}>
            {[
              {icon:"🫀",title:"Live Vitals Monitoring",desc:"HR, BP, SpO₂, Temperature — real-time"},
              {icon:"🤖",title:"ML Risk Prediction",desc:"AI detects deterioration before it happens"},
              {icon:"📧",title:"Instant Alerts",desc:"Critical vitals trigger automatic email alerts"},
              {icon:"📹",title:"Telemedicine",desc:"Video, audio & chat consultations"},
            ].map((f,i) => (
              <div key={i} style={{display:"flex",gap:14,alignItems:"center",padding:"12px 16px",borderRadius:10,background:"rgba(0,188,212,0.05)",border:"1px solid rgba(0,188,212,0.12)",backdropFilter:"blur(8px)"}}>
                <span style={{fontSize:"1.3rem",width:32,textAlign:"center"}}>{f.icon}</span>
                <div>
                  <div style={{fontSize:"0.82rem",fontWeight:600,color:"var(--text-bright)"}}>{f.title}</div>
                  <div style={{fontSize:"0.7rem",color:"var(--text-dim)",marginTop:1}}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{display:"flex",gap:32}}>
            {[["16+","Patients"],["5","Doctors"],["24/7","Monitoring"]].map(([v,l],i)=>(
              <div key={i}>
                <div style={{fontFamily:"var(--mono)",fontSize:"1.8rem",fontWeight:700,color:"#00bcd4"}}>{v}</div>
                <div style={{fontSize:"0.65rem",color:"var(--text-dim)",letterSpacing:1,marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT — Login Form */}
        <div className="auth-form-panel">
          <div className="auth-card">
            <div className="auth-logo"><div className="logo-dot" /><span className="logo-text">MEDIPULSE</span></div>
            <div className="auth-title">Welcome Back</div>
            <div className="auth-sub">Remote Patient Monitoring Platform</div>
        {error && <AlertItem type="danger" msg={error} />}
        <div className="f-group">
          <label className="f-label">Email</label>
          <input className={`f-input ${error ? "err" : ""}`} type="email" placeholder="email@hospital.com" autoComplete="off"
            value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && doLogin()} />
        </div>
        <div className="f-group">
          <label className="f-label">Password</label>
          <input className={`f-input ${error ? "err" : ""}`} type="password" placeholder="••••••••" autoComplete="new-password"
            value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && doLogin()} />
        </div>
        <button className="btn-auth" onClick={doLogin} disabled={loading}>
          {loading ? "SIGNING IN..." : "SIGN IN →"}
        </button>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: "0.78rem", color: "var(--text-dim)" }}>
          New user?{" "}
          <span onClick={onGoRegister} style={{ color: "var(--accent)", cursor: "pointer", fontFamily: "var(--mono)" }}>
            REGISTER →
          </span>
        </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   REGISTER PAGE
═══════════════════════════════════════════════════════ */
function RegisterPage({ onLogin, onGoLogin }) {
  const [role, setRole] = useState("patient");
  const [fname, setFname] = useState("");
  const [lname, setLname] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("Male");
  const [condition, setCondition] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const doRegister = async () => {
    if (!fname || !lname || !email || !pass) { setError("All fields are required"); return; }
    if (pass.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true); setError("");
    try {
      await registerUser({ fname, lname, email, password: pass, role, age: parseInt(age) || 0, gender, condition, specialization });
      onGoLogin();
    } catch (e) {
      setError(e.message || "Registration failed");
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-medical-bg">
        <div className="auth-medical-bg-img" />
        <div className="auth-medical-bg-overlay" />
        <div className="auth-medical-bg-grid" />
      </div>
      <div className="auth-card" style={{ maxWidth: 520, position:"relative", zIndex:1 }}>
        <div className="auth-logo"><div className="logo-dot" /><span className="logo-text">MEDIPULSE</span></div>
        <div className="auth-title">Create Account</div>
        <div className="auth-sub">Join the Remote Patient Monitoring Platform</div>

        {/* Role Toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          {["patient", "doctor"].map(r => (
            <button key={r} onClick={() => setRole(r)} style={{
              flex: 1, padding: "10px", borderRadius: 8, cursor: "pointer",
              fontFamily: "var(--mono)", fontSize: "0.7rem", letterSpacing: 1,
              background: role === r ? "rgba(0,212,255,0.12)" : "transparent",
              border: role === r ? "1px solid var(--accent)" : "1px solid var(--border)",
              color: role === r ? "var(--accent)" : "var(--text-dim)",
            }}>{r === "patient" ? "🏥 PATIENT" : "👨‍⚕️ DOCTOR"}</button>
          ))}
        </div>

        {error && <AlertItem type="danger" msg={error} />}

        <div className="g2">
          <div className="f-group">
            <label className="f-label">First Name</label>
            <input className="f-input" placeholder="Arun" value={fname} onChange={e => setFname(e.target.value)} />
          </div>
          <div className="f-group">
            <label className="f-label">Last Name</label>
            <input className="f-input" placeholder="Kumar" value={lname} onChange={e => setLname(e.target.value)} />
          </div>
        </div>

        <div className="f-group">
          <label className="f-label">Email</label>
          <input className="f-input" type="email" placeholder="email@example.com" value={email} onChange={e => setEmail(e.target.value)} />
        </div>

        <div className="f-group">
          <label className="f-label">Password</label>
          <input className="f-input" type="password" placeholder="Min 6 characters" value={pass} onChange={e => setPass(e.target.value)} />
        </div>

        {role === "patient" && (
          <>
            <div className="g2">
              <div className="f-group">
                <label className="f-label">Age</label>
                <input className="f-input" type="number" placeholder="25" value={age} onChange={e => setAge(e.target.value)} />
              </div>
              <div className="f-group">
                <label className="f-label">Gender</label>
                <select className="f-input" value={gender} onChange={e => setGender(e.target.value)} style={{ cursor: "pointer" }}>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
              </div>
            </div>
            <div className="f-group">
              <label className="f-label">Medical Condition</label>
              <select className="f-input" value={condition} onChange={e => setCondition(e.target.value)}
                style={{ cursor: "pointer" }}>
                <option value="">— Select your condition —</option>

                <optgroup label="❤️ Cardiovascular">
                  <option value="Hypertension">Hypertension (High Blood Pressure)</option>
                  <option value="Heart Failure">Heart Failure</option>
                  <option value="Coronary Artery Disease">Coronary Artery Disease (CAD)</option>
                  <option value="Arrhythmia">Arrhythmia (Irregular Heartbeat)</option>
                  <option value="Heart Attack (Post)">Heart Attack (Post Recovery)</option>
                  <option value="Cardiomyopathy">Cardiomyopathy</option>
                  <option value="Atrial Fibrillation">Atrial Fibrillation (AFib)</option>
                  <option value="Deep Vein Thrombosis">Deep Vein Thrombosis (DVT)</option>
                </optgroup>

                <optgroup label="🫁 Respiratory">
                  <option value="Asthma">Asthma</option>
                  <option value="COPD">COPD (Chronic Obstructive Pulmonary Disease)</option>
                  <option value="Pneumonia (Post)">Pneumonia (Post Recovery)</option>
                  <option value="Sleep Apnea">Sleep Apnea</option>
                  <option value="Pulmonary Hypertension">Pulmonary Hypertension</option>
                  <option value="Bronchitis">Chronic Bronchitis</option>
                  <option value="Tuberculosis (Post)">Tuberculosis (Post Recovery)</option>
                </optgroup>

                <optgroup label="🩸 Metabolic / Endocrine">
                  <option value="Diabetes Type 1">Diabetes Type 1</option>
                  <option value="Diabetes Type 2">Diabetes Type 2</option>
                  <option value="Thyroid Disorder">Thyroid Disorder (Hypo/Hyper)</option>
                  <option value="Obesity">Obesity</option>
                  <option value="Metabolic Syndrome">Metabolic Syndrome</option>
                  <option value="Hyperlipidemia">Hyperlipidemia (High Cholesterol)</option>
                  <option value="Adrenal Disorder">Adrenal Disorder</option>
                </optgroup>

                <optgroup label="🧠 Neurological">
                  <option value="Stroke (Post)">Stroke (Post Recovery)</option>
                  <option value="Epilepsy">Epilepsy</option>
                  <option value="Parkinson's Disease">Parkinson's Disease</option>
                  <option value="Alzheimer's Disease">Alzheimer's Disease</option>
                  <option value="Multiple Sclerosis">Multiple Sclerosis</option>
                  <option value="Migraine">Chronic Migraine</option>
                  <option value="Neuropathy">Peripheral Neuropathy</option>
                </optgroup>

                <optgroup label="🦴 Musculoskeletal">
                  <option value="Arthritis">Arthritis (Osteo / Rheumatoid)</option>
                  <option value="Osteoporosis">Osteoporosis</option>
                  <option value="Chronic Back Pain">Chronic Back Pain</option>
                  <option value="Fibromyalgia">Fibromyalgia</option>
                  <option value="Gout">Gout</option>
                </optgroup>

                <optgroup label="🫘 Kidney / Urinary">
                  <option value="Chronic Kidney Disease">Chronic Kidney Disease (CKD)</option>
                  <option value="Kidney Stones">Kidney Stones</option>
                  <option value="Urinary Tract Infection">Recurrent UTI</option>
                  <option value="Dialysis">Dialysis Patient</option>
                </optgroup>

                <optgroup label="🧬 Gastrointestinal">
                  <option value="Irritable Bowel Syndrome">IBS (Irritable Bowel Syndrome)</option>
                  <option value="Crohn's Disease">Crohn's Disease</option>
                  <option value="Liver Disease">Liver Disease / Cirrhosis</option>
                  <option value="Acid Reflux (GERD)">Acid Reflux (GERD)</option>
                  <option value="Pancreatitis">Chronic Pancreatitis</option>
                </optgroup>

                <optgroup label="🧪 Blood Disorders">
                  <option value="Anemia">Anemia</option>
                  <option value="Sickle Cell Disease">Sickle Cell Disease</option>
                  <option value="Hemophilia">Hemophilia</option>
                  <option value="Leukemia (Post)">Leukemia (Post Treatment)</option>
                </optgroup>

                <optgroup label="🧘 Mental Health">
                  <option value="Depression">Depression</option>
                  <option value="Anxiety Disorder">Anxiety Disorder</option>
                  <option value="Bipolar Disorder">Bipolar Disorder</option>
                  <option value="PTSD">PTSD</option>
                  <option value="Schizophrenia">Schizophrenia</option>
                </optgroup>

                <optgroup label="🌿 Other / General">
                  <option value="Post-COVID Syndrome">Post-COVID Syndrome (Long COVID)</option>
                  <option value="Cancer (Monitoring)">Cancer (Under Monitoring)</option>
                  <option value="Autoimmune Disease">Autoimmune Disease</option>
                  <option value="Pregnancy Monitoring">Pregnancy Monitoring</option>
                  <option value="Post Surgery Recovery">Post Surgery Recovery</option>
                  <option value="General Checkup">General Checkup / Wellness</option>
                  <option value="Other">Other</option>
                </optgroup>
              </select>
            </div>
          </>
        )}

        {role === "doctor" && (
          <div className="f-group">
            <label className="f-label">Specialization</label>
            <input className="f-input" placeholder="e.g. Cardiology, Neurology" value={specialization} onChange={e => setSpecialization(e.target.value)} />
          </div>
        )}

        <button className="btn-auth" onClick={doRegister} disabled={loading}>
          {loading ? "REGISTERING..." : "CREATE ACCOUNT →"}
        </button>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: "0.78rem", color: "var(--text-dim)" }}>
          Already have an account?{" "}
          <span onClick={onGoLogin} style={{ color: "var(--accent)", cursor: "pointer", fontFamily: "var(--mono)" }}>
            LOGIN →
          </span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PATIENT DASHBOARD
═══════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   CAMERA VITALS — rPPG Heart Rate Detection
═══════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════
   REPORTS TAB — View + Download
═══════════════════════════════════════════════════════ */
function ReportsTab({ patient, history, alerts, risk, addToast }) {
  const [viewing, setViewing] = useState(null); // null | "vitals" | "ml" | "alerts"

  function downloadVitalsCSV() {
    const rows = ["Time,Heart Rate,BP Systolic,BP Diastolic,SpO2,Temperature"];
    history.forEach(v => rows.push(`${v.ts},${v.hr},${v.bp_sys},${v.bp_dia},${v.spo2},${v.temp}`));
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${patient.name}_vitals.csv`; a.click();
    addToast("success", "Vitals CSV downloaded!");
  }

  function downloadMLReport() {
    const rows = [
      "MediPulse ML Risk Report",
      `Patient: ${patient.name}`,
      `Condition: ${patient.condition}`,
      `Generated: ${new Date().toLocaleString()}`,
      "",
      `Overall Risk Score: ${risk.score}/100`,
      `Risk Label: ${risk.label}`,
      `Cardiac Risk: ${risk.cardiac}%`,
      `Respiratory Risk: ${risk.respiratory}%`,
      `Deterioration Risk: ${risk.deterioration}%`,
      "",
      "AI Clinical Insights:",
      ...(risk.insights || []).map(i => `- ${i}`),
    ];
    const blob = new Blob([rows.join("\n")], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${patient.name}_ml_report.txt`; a.click();
    addToast("success", "ML Report downloaded!");
  }

  function downloadAlertsCSV() {
    const rows = ["Time,Type,Message"];
    alerts.forEach(a => rows.push(`${a.created_at},${a.alert_type},${a.message}`));
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${patient.name}_alerts.csv`; a.click();
    addToast("success", "Alerts CSV downloaded!");
  }

  const vitalsPreview = history.slice(-10).reverse();
  const mlInsights = risk.insights || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Report Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>

        {/* Vitals Report */}
        <div className="card" style={{ cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>📊</div>
              <div style={{ fontWeight: 600, color: "var(--text-bright)", fontSize: "0.9rem" }}>Daily Vitals Report</div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: 3 }}>{history.length} readings · Today</div>
            </div>
            <span style={{ fontSize: "0.6rem", padding: "3px 8px", borderRadius: 4, background: "rgba(0,212,255,0.1)", color: "var(--accent)", border: "1px solid rgba(0,212,255,0.2)" }}>CSV</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={() => setViewing(viewing === "vitals" ? null : "vitals")}
              style={{ flex: 1, padding: "7px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--panel2)", color: "var(--text)", cursor: "pointer", fontSize: "0.75rem" }}>
              {viewing === "vitals" ? "▲ Hide" : "👁 View"}
            </button>
            <button onClick={downloadVitalsCSV}
              style={{ flex: 1, padding: "7px", borderRadius: 7, border: "1px solid rgba(0,212,255,0.3)", background: "rgba(0,212,255,0.08)", color: "var(--accent)", cursor: "pointer", fontSize: "0.75rem" }}>
              ↓ Download
            </button>
          </div>
        </div>

        {/* ML Report */}
        <div className="card" style={{ cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>🤖</div>
              <div style={{ fontWeight: 600, color: "var(--text-bright)", fontSize: "0.9rem" }}>ML Risk Report</div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: 3 }}>Risk Score: <span style={{ color: risk.color }}>{risk.score} — {risk.label}</span></div>
            </div>
            <span style={{ fontSize: "0.6rem", padding: "3px 8px", borderRadius: 4, background: "rgba(255,140,66,0.1)", color: "#ff8c42", border: "1px solid rgba(255,140,66,0.2)" }}>TXT</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={() => setViewing(viewing === "ml" ? null : "ml")}
              style={{ flex: 1, padding: "7px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--panel2)", color: "var(--text)", cursor: "pointer", fontSize: "0.75rem" }}>
              {viewing === "ml" ? "▲ Hide" : "👁 View"}
            </button>
            <button onClick={downloadMLReport}
              style={{ flex: 1, padding: "7px", borderRadius: 7, border: "1px solid rgba(255,140,66,0.3)", background: "rgba(255,140,66,0.08)", color: "#ff8c42", cursor: "pointer", fontSize: "0.75rem" }}>
              ↓ Download
            </button>
          </div>
        </div>

        {/* Alerts Report */}
        <div className="card" style={{ cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "1.5rem", marginBottom: 6 }}>🔔</div>
              <div style={{ fontWeight: 600, color: "var(--text-bright)", fontSize: "0.9rem" }}>Alert History</div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: 3 }}>{alerts.length} alerts recorded</div>
            </div>
            <span style={{ fontSize: "0.6rem", padding: "3px 8px", borderRadius: 4, background: "rgba(255,45,85,0.1)", color: "#ff2d55", border: "1px solid rgba(255,45,85,0.2)" }}>CSV</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={() => setViewing(viewing === "alerts" ? null : "alerts")}
              style={{ flex: 1, padding: "7px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--panel2)", color: "var(--text)", cursor: "pointer", fontSize: "0.75rem" }}>
              {viewing === "alerts" ? "▲ Hide" : "👁 View"}
            </button>
            <button onClick={downloadAlertsCSV}
              style={{ flex: 1, padding: "7px", borderRadius: 7, border: "1px solid rgba(255,45,85,0.3)", background: "rgba(255,45,85,0.08)", color: "#ff2d55", cursor: "pointer", fontSize: "0.75rem" }}>
              ↓ Download
            </button>
          </div>
        </div>
      </div>

      {/* Preview Panel */}
      {viewing === "vitals" && (
        <div className="card">
          <div className="card-title">📊 Vitals Preview — Last 10 readings</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr><th>Time</th><th>HR (bpm)</th><th>BP (mmHg)</th><th>SpO₂ (%)</th><th>Temp (°C)</th></tr></thead>
              <tbody>
                {vitalsPreview.length === 0
                  ? <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-dim)" }}>No readings yet</td></tr>
                  : vitalsPreview.map((v, i) => (
                    <tr key={v.ts + i}>
                      <td style={{ fontFamily: "var(--mono)", fontSize: "0.75rem" }}>{v.ts}</td>
                      <td style={{ color: v.hr > 100 ? "#ff2d55" : "var(--accent2)", fontFamily: "var(--mono)" }}>{typeof v.hr === "number" ? v.hr.toFixed(1) : v.hr}</td>
                      <td style={{ color: v.bp_sys > 140 ? "#ff8c42" : "var(--text)", fontFamily: "var(--mono)" }}>{typeof v.bp_sys === "number" ? v.bp_sys.toFixed(1) : v.bp_sys}/{typeof v.bp_dia === "number" ? v.bp_dia.toFixed(1) : v.bp_dia}</td>
                      <td style={{ color: v.spo2 < 95 ? "#ff2d55" : "#00ff9d", fontFamily: "var(--mono)" }}>{typeof v.spo2 === "number" ? v.spo2.toFixed(1) : v.spo2}</td>
                      <td style={{ color: v.temp > 38 ? "#ff8c42" : "var(--text)", fontFamily: "var(--mono)" }}>{typeof v.temp === "number" ? v.temp.toFixed(1) : v.temp}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewing === "ml" && (
        <div className="card">
          <div className="card-title">🤖 ML Risk Report Preview</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div style={{ padding: 14, borderRadius: 10, background: "var(--panel2)", textAlign: "center" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: "2.5rem", fontWeight: 700, color: risk.color }}>{risk.score}</div>
              <div style={{ fontSize: "0.7rem", color: risk.color }}>{risk.label}</div>
              <div style={{ fontSize: "0.6rem", color: "var(--text-dim)" }}>OVERALL RISK</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
              <RiskBar label="Cardiac Risk" pct={risk.cardiac} fillClass={risk.cardiac > 60 ? "rf-high" : "rf-low"} />
              <RiskBar label="Respiratory" pct={risk.respiratory} fillClass={risk.respiratory > 60 ? "rf-high" : "rf-low"} />
              <RiskBar label="Deterioration" pct={risk.deterioration} fillClass={risk.deterioration > 60 ? "rf-high" : "rf-low"} />
            </div>
          </div>
          <div className="card-title" style={{ marginTop: 8 }}>AI Insights:</div>
          {mlInsights.map((insight, i) => (
            <div key={i} style={{ padding: "8px 12px", marginBottom: 5, borderRadius: 7, fontSize: "0.78rem",
              background: insight.startsWith("🔴") ? "rgba(255,45,85,0.07)" : "rgba(0,255,157,0.04)",
              border: insight.startsWith("🔴") ? "1px solid rgba(255,45,85,0.2)" : "1px solid rgba(0,255,157,0.15)",
              color: "var(--text)" }}>{insight}</div>
          ))}
        </div>
      )}

      {viewing === "alerts" && (
        <div className="card">
          <div className="card-title">🔔 Alert History Preview</div>
          {alerts.length === 0
            ? <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-dim)" }}>✅ No alerts recorded</div>
            : alerts.slice(0, 15).map((a, i) => (
              <div key={i} style={{ padding: "10px 12px", marginBottom: 6, borderRadius: 8, display: "flex", gap: 12, alignItems: "center",
                background: a.alert_type === "CRITICAL" ? "rgba(255,45,85,0.07)" : "rgba(255,140,66,0.06)",
                border: `1px solid ${a.alert_type === "CRITICAL" ? "rgba(255,45,85,0.25)" : "rgba(255,140,66,0.2)"}` }}>
                <span style={{ fontSize: "1rem" }}>{a.alert_type === "CRITICAL" ? "🔴" : "🟡"}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.78rem", color: "var(--text)" }}>{a.message}</div>
                  <div style={{ fontSize: "0.62rem", color: "var(--text-dim)", marginTop: 2 }}>{a.created_at}</div>
                </div>
                <span style={{ fontSize: "0.6rem", padding: "2px 7px", borderRadius: 4,
                  background: a.alert_type === "CRITICAL" ? "rgba(255,45,85,0.15)" : "rgba(255,140,66,0.15)",
                  color: a.alert_type === "CRITICAL" ? "#ff2d55" : "#ff8c42" }}>{a.alert_type}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function CameraVitals({ onResult, addToast }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | requesting | scanning | done | error
  const [progress, setProgress] = useState(0);
  const [detectedHR, setDetectedHR] = useState(null);
  const [detectedBR, setDetectedBR] = useState(null);
  const [redValues, setRedValues] = useState([]);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const samplesRef = useRef([]);
  const startTimeRef = useRef(null);
  const SCAN_DURATION = 30000; // 30 seconds

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }

  async function startScan() {
    setStatus("requesting");
    samplesRef.current = [];
    setRedValues([]);
    setDetectedHR(null);
    setDetectedBR(null);
    setProgress(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 } });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStatus("scanning");
      startTimeRef.current = Date.now();
      captureFrame();
    } catch (e) {
      setStatus("error");
      addToast("warn", "Camera access denied!");
    }
  }

  function captureFrame() {
    const elapsed = Date.now() - startTimeRef.current;
    const pct = Math.min(100, Math.round((elapsed / SCAN_DURATION) * 100));
    setProgress(pct);

    if (elapsed >= SCAN_DURATION) {
      processResults();
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = frame.data;

    // Extract average RED channel from center face region
    let rSum = 0, gSum = 0, count = 0;
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    const rx = 60, ry = 80;
    for (let y = cy - ry; y < cy + ry; y++) {
      for (let x = cx - rx; x < cx + rx; x++) {
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
        const idx = (y * canvas.width + x) * 4;
        rSum += data[idx];
        gSum += data[idx + 1];
        count++;
      }
    }
    const avgR = rSum / count;
    const avgG = gSum / count;
    samplesRef.current.push({ r: avgR, g: avgG, t: elapsed });
    setRedValues(prev => [...prev.slice(-50), avgR]);

    rafRef.current = requestAnimationFrame(captureFrame);
  }

  function processResults() {
    stopCamera();
    const samples = samplesRef.current;
    if (samples.length < 20) { setStatus("error"); return; }

    // Normalize red channel
    const rVals = samples.map(s => s.r);
    const mean = rVals.reduce((a, b) => a + b, 0) / rVals.length;
    const normalized = rVals.map(v => v - mean);

    // Count peaks for BPM
    let peaks = 0;
    for (let i = 1; i < normalized.length - 1; i++) {
      if (normalized[i] > normalized[i-1] && normalized[i] > normalized[i+1] && normalized[i] > 2) peaks++;
    }
    const durationSec = (samples[samples.length-1].t - samples[0].t) / 1000;
    const bpm = Math.round((peaks / durationSec) * 60);

    // Breathing rate (slower variation in green channel)
    const gVals = samples.map(s => s.g);
    const gMean = gVals.reduce((a, b) => a + b, 0) / gVals.length;
    const gNorm = gVals.map(v => v - gMean);
    let breathPeaks = 0;
    const smoothed = gNorm.map((v, i) => {
      const w = gNorm.slice(Math.max(0, i-5), i+6);
      return w.reduce((a, b) => a + b, 0) / w.length;
    });
    for (let i = 1; i < smoothed.length - 1; i++) {
      if (smoothed[i] > smoothed[i-1] && smoothed[i] > smoothed[i+1] && smoothed[i] > 0.3) breathPeaks++;
    }
    const br = Math.round((breathPeaks / durationSec) * 60);

    // Clamp to realistic ranges
    const finalHR = Math.min(150, Math.max(45, bpm));
    const finalBR = Math.min(30, Math.max(8, br));

    setDetectedHR(finalHR);
    setDetectedBR(finalBR);
    setStatus("done");
    if (onResult) onResult({ hr: finalHR, br: finalBR });
    addToast("success", `Camera HR: ${finalHR} bpm detected!`);
  }

  useEffect(() => () => stopCamera(), []);

  const chartData = redValues.map((v, i) => ({ i, v }));

  return (
    <div style={{ padding: 20, borderRadius: 14, background: "var(--panel)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "0.7rem", color: "var(--accent)", letterSpacing: 2 }}>📷 CAMERA VITALS — rPPG</div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 3 }}>Point camera at your face · 30 second scan</div>
        </div>
        {status === "idle" && <button className="btn-accent" onClick={startScan} style={{ fontSize: "0.75rem" }}>▶ Start Scan</button>}
        {status === "scanning" && <button className="btn-danger-outline" onClick={() => { stopCamera(); setStatus("idle"); }} style={{ fontSize: "0.75rem" }}>⏹ Stop</button>}
        {status === "done" && <button className="btn-accent" onClick={startScan} style={{ fontSize: "0.75rem" }}>🔄 Scan Again</button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Camera Feed */}
        <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", background: "#000", aspectRatio: "4/3" }}>
          <video ref={videoRef} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} muted playsInline />
          <canvas ref={canvasRef} width={320} height={240} style={{ display: "none" }} />
          {status === "idle" && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)" }}>
              <div style={{ fontSize: "2.5rem" }}>📷</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: 8 }}>Camera ready</div>
            </div>
          )}
          {status === "scanning" && (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 12px", background: "rgba(0,0,0,0.6)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: "0.65rem", color: "#00ff9d" }}>
                <span>● SCANNING</span><span>{progress}%</span>
              </div>
              <div style={{ height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${progress}%`, background: "#00ff9d", borderRadius: 2, transition: "width 0.3s" }} />
              </div>
            </div>
          )}
          {/* Face guide overlay */}
          {status === "scanning" && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ width: 120, height: 160, border: "2px solid rgba(0,212,255,0.6)", borderRadius: "50%", boxShadow: "0 0 20px rgba(0,212,255,0.2)" }} />
            </div>
          )}
          {status === "error" && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.8)" }}>
              <div style={{ fontSize: "1.5rem" }}>⚠️</div>
              <div style={{ fontSize: "0.72rem", color: "#ff2d55", marginTop: 6 }}>Camera error</div>
            </div>
          )}
        </div>

        {/* Results */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* rPPG Signal */}
          {redValues.length > 5 && (
            <div style={{ background: "var(--panel2)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: "0.6rem", color: "var(--text-dim)", marginBottom: 4, fontFamily: "var(--mono)" }}>rPPG SIGNAL</div>
              <ResponsiveContainer width="100%" height={60}>
                <LineChart data={chartData}>
                  <Line type="monotone" dataKey="v" stroke="#ff2d55" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Result Cards */}
          {status === "done" && (
            <>
              <div style={{ padding: "14px", borderRadius: 10, background: "rgba(255,45,85,0.08)", border: "1px solid rgba(255,45,85,0.3)", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: "2rem", fontWeight: 700, color: "#ff2d55" }}>{detectedHR}</div>
                <div style={{ fontSize: "0.65rem", color: "var(--text-dim)" }}>bpm · HEART RATE</div>
                <div style={{ fontSize: "0.62rem", color: detectedHR > 100 ? "#ff8c42" : "#00ff9d", marginTop: 4 }}>
                  {detectedHR > 100 ? "⚠ Elevated" : detectedHR < 60 ? "⚠ Low" : "✅ Normal range"}
                </div>
              </div>
              <div style={{ padding: "14px", borderRadius: 10, background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.3)", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--mono)", fontSize: "2rem", fontWeight: 700, color: "#00d4ff" }}>{detectedBR}</div>
                <div style={{ fontSize: "0.65rem", color: "var(--text-dim)" }}>breaths/min · BREATHING</div>
                <div style={{ fontSize: "0.62rem", color: detectedBR > 20 ? "#ff8c42" : "#00ff9d", marginTop: 4 }}>
                  {detectedBR > 20 ? "⚠ Rapid breathing" : "✅ Normal range"}
                </div>
              </div>
              <div style={{ fontSize: "0.6rem", color: "var(--text-dim)", textAlign: "center", padding: "6px", background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
                ⚠ Research grade only — not medical diagnosis
              </div>
            </>
          )}

          {status === "scanning" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <div style={{ fontSize: "2rem" }}>🫀</div>
              <div style={{ fontSize: "0.75rem", color: "var(--accent)" }}>Analyzing blood flow...</div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-dim)", textAlign: "center" }}>Keep face steady in camera · Good lighting needed</div>
            </div>
          )}

          {status === "idle" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, opacity: 0.6 }}>
              <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", textAlign: "center", lineHeight: 1.6 }}>
                Uses rPPG technology to detect heart rate from subtle skin color changes visible to camera
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PatientAppointmentsTab({ patient, addToast, currentUser, doctors }) {
  const [appointments, setAppointments] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  const [activeAppt, setActiveAppt] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState("");
  const [form, setForm] = useState({ doctor_id: "", title: "", scheduled_at: "", duration_mins: 30, notes: "" });
  const msgEndRef = useRef(null);

  useEffect(() => { loadAppointments(); }, [currentUser]);

  useEffect(() => {
    if (!activeAppt || activeModal !== "chat") return;
    loadMessages();
    const t = setInterval(loadMessages, 3000);
    return () => clearInterval(t);
  }, [activeAppt, activeModal]);

  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const loadAppointments = async () => {
    try {
      const data = await getPatientAppointments(currentUser.patientDbId);
      setAppointments(data);
    } catch (e) {}
  };

  const loadMessages = async () => {
    if (!activeAppt) return;
    try { setMessages(await getMessages(activeAppt.id)); } catch (e) {}
  };

  const handleRequest = async () => {
    if (!form.doctor_id || !form.title || !form.scheduled_at) {
      addToast("⚠️", "Error", "All fields required", "warn"); return;
    }
    // Past date validation — timezone safe
    const selectedDate = new Date(form.scheduled_at); // datetime-local is local time
    const now = new Date();
    // Compare using local time timestamps
    if (selectedDate.getTime() <= now.getTime()) {
      addToast("❌", "Invalid Date", `Cannot book for past date! Today is ${now.toLocaleDateString('en-IN')}. Please select a future date.`, "danger");
      setForm({ ...form, scheduled_at: "" });
      return;
    }
    try {
      await createAppointment({
        ...form,
        doctor_id: parseInt(form.doctor_id),
        patient_id: currentUser.patientDbId,
      });
      addToast("✅", "Appointment Requested!", "Doctor will review and accept", "ok");
      setShowForm(false);
      setForm({ doctor_id: "", title: "", scheduled_at: "", duration_mins: 30, notes: "" });
      loadAppointments();
    } catch (e) { addToast("❌", "Error", "Failed to request", "err"); }
  };

  const handleSendMsg = async () => {
    if (!newMsg.trim()) return;
    await sendMessage({ appointment_id: activeAppt.id, sender_id: currentUser.id, sender_role: "patient", message: newMsg });
    setNewMsg("");
    loadMessages();
  };

  const openModal = (appt, mode) => { setActiveAppt(appt); setActiveModal(mode); };
  const closeModal = () => { setActiveAppt(null); setActiveModal(null); setMessages([]); };
  const statusColor = (s) => s === "accepted" ? "var(--accent2)" : s === "rejected" ? "var(--danger)" : s === "completed" ? "var(--accent)" : "var(--warn)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-bright)" }}>📅 My Appointments</div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 3 }}>{appointments.length} appointments</div>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? "✕ Cancel" : "+ Request Appointment"}
        </button>
      </div>

      {/* Request Form */}
      {showForm && (
        <div className="card">
          <div className="card-title">📋 Request New Appointment</div>
          <div className="g2">
            <div className="f-group">
              <label className="f-label">Select Doctor</label>
              <select className="f-input" value={form.doctor_id} onChange={e => setForm({ ...form, doctor_id: e.target.value })}>
                <option value="">Choose Doctor</option>
                {doctors.length > 0
                  ? doctors.map(d => <option key={d.id} value={d.id}>Dr. {d.fname} {d.lname} — {d.specialization || "General"}</option>)
                  : <option value="1">Dr. Assigned (Default)</option>
                }
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">Appointment Type</label>
              <select className="f-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}>
                <option value="">Select Type</option>
                <option>Initial Consultation</option>
                <option>Follow-up Checkup</option>
                <option>ECG Review</option>
                <option>Medication Review</option>
                <option>Lab Results Discussion</option>
                <option>Emergency Consultation</option>
                <option>General Checkup</option>
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">Preferred Date & Time</label>
              <input className="f-input" type="datetime-local"
                value={form.scheduled_at}
                min={(() => { const n = new Date(); n.setMinutes(n.getMinutes() - n.getTimezoneOffset()); return n.toISOString().slice(0,16); })()}
                onChange={e => setForm({ ...form, scheduled_at: e.target.value })} />
            </div>
            <div className="f-group">
              <label className="f-label">Duration (mins)</label>
              <input className="f-input" type="number" value={form.duration_mins}
                onChange={e => setForm({ ...form, duration_mins: parseInt(e.target.value) })} />
            </div>
          </div>
          <div className="f-group">
            <label className="f-label">Symptoms / Notes</label>
            <textarea className="f-input" rows={3}
              placeholder="Describe your symptoms or reason for visit..."
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              style={{ resize: "vertical", lineHeight: 1.5 }} />
          </div>
          <button className="btn-primary" onClick={handleRequest}>Send Request →</button>
        </div>
      )}

      {/* Video/Chat Modal */}
      {activeAppt && activeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 18, width: "100%", maxWidth: activeModal !== "chat" ? "95vw" : 540, height: activeModal !== "chat" ? "92vh" : 580, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--panel2)" }}>
              <div>
                <div style={{ fontWeight: 600, color: "var(--text-bright)" }}>
                  {activeModal === "chat" ? "💬" : activeModal === "call" ? "📹" : "🎙️"} {activeAppt.title}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: 2 }}>Dr. {activeAppt.doctor_name}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {activeAppt.status === "accepted" && <>
                  <button onClick={() => setActiveModal("call")} style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${activeModal==="call"?"var(--accent2)":"var(--border)"}`, background: activeModal==="call"?"rgba(0,255,157,0.1)":"transparent", color: activeModal==="call"?"var(--accent2)":"var(--text-dim)", cursor: "pointer", fontSize: "0.68rem", fontFamily: "var(--mono)" }}>📹 VIDEO</button>
                  <button onClick={() => setActiveModal("audio")} style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${activeModal==="audio"?"var(--accent)":"var(--border)"}`, background: activeModal==="audio"?"rgba(0,212,255,0.1)":"transparent", color: activeModal==="audio"?"var(--accent)":"var(--text-dim)", cursor: "pointer", fontSize: "0.68rem", fontFamily: "var(--mono)" }}>🎙️ AUDIO</button>
                  <button onClick={() => setActiveModal("chat")} style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${activeModal==="chat"?"var(--warn)":"var(--border)"}`, background: activeModal==="chat"?"rgba(255,140,66,0.1)":"transparent", color: activeModal==="chat"?"var(--warn)":"var(--text-dim)", cursor: "pointer", fontSize: "0.68rem", fontFamily: "var(--mono)" }}>💬 CHAT</button>
                </>}
                <button onClick={closeModal} style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", cursor: "pointer" }}>✕</button>
              </div>
            </div>

            {activeModal === "call" && (
              <iframe src={`${activeAppt.meet_link}#userInfo.displayName="${encodeURIComponent(currentUser.fname + " " + (currentUser.lname||""))}"&config.startWithVideoMuted=false&config.startWithAudioMuted=false`}
                allow="camera; microphone; fullscreen; autoplay; speaker-selection"
                style={{ flex: 1, border: "none", width: "100%", height: "100%" }} title="Video Call" allowFullScreen />
            )}
            {activeModal === "audio" && (
              <iframe src={`${activeAppt.meet_link}#userInfo.displayName="${encodeURIComponent(currentUser.fname + " " + (currentUser.lname||""))}"&config.startWithVideoMuted=true&config.startWithAudioMuted=false`}
                allow="camera; microphone; fullscreen; autoplay; speaker-selection"
                style={{ flex: 1, border: "none", width: "100%", height: "100%" }} title="Audio Call" allowFullScreen />
            )}
            {activeModal === "chat" && (
              <>
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {messages.length === 0
                    ? <div style={{ textAlign: "center", color: "var(--text-dim)", marginTop: 60 }}>No messages yet. Say hello! 👋</div>
                    : messages.map((m, i) => {
                      const isMine = m.sender_id === currentUser.id;
                      return (
                        <div key={i} style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start" }}>
                          <div style={{ maxWidth: "72%", padding: "10px 14px", borderRadius: isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: isMine ? "rgba(0,212,255,0.14)" : "var(--panel2)", border: `1px solid ${isMine ? "rgba(0,212,255,0.3)" : "var(--border)"}` }}>
                            <div style={{ fontSize: "0.65rem", color: "var(--text-dim)", marginBottom: 4 }}>{m.sender_name}</div>
                            <div style={{ fontSize: "0.85rem", color: "var(--text-bright)", lineHeight: 1.45 }}>{m.message}</div>
                            <div style={{ fontSize: "0.58rem", color: "var(--text-dim)", marginTop: 5, textAlign: "right" }}>{new Date(m.sent_at).toLocaleTimeString()}</div>
                          </div>
                        </div>
                      );
                    })}
                  <div ref={msgEndRef} />
                </div>
                <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 10 }}>
                  <input className="f-input" placeholder="Type a message..." value={newMsg}
                    onChange={e => setNewMsg(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSendMsg()}
                    style={{ flex: 1 }} />
                  <button className="btn-primary" style={{ padding: "10px 18px" }} onClick={handleSendMsg}>➤</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Appointments List */}
      {appointments.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "50px 0", color: "var(--text-dim)" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📅</div>
          <div>No appointments yet</div>
          <div style={{ fontSize: "0.75rem", marginTop: 6 }}>Click "+ Request Appointment" to schedule with a doctor</div>
        </div>
      ) : appointments.map((a, i) => (
        <div key={i} className="card" style={{ borderLeft: `3px solid ${statusColor(a.status)}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-bright)", marginBottom: 5 }}>{a.title}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>👨‍⚕️ Dr. {a.doctor_name}</div>
              <div style={{ fontFamily: "var(--mono)", fontSize: "0.68rem", color: "var(--accent)", marginTop: 6 }}>
                🕐 {new Date(a.scheduled_at).toLocaleString()} · {a.duration_mins} mins
              </div>
              {a.notes && <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 4 }}>📝 {a.notes}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
              <span style={{ padding: "3px 10px", borderRadius: 4, fontSize: "0.6rem", fontFamily: "var(--mono)", background: `${statusColor(a.status)}22`, color: statusColor(a.status), border: `1px solid ${statusColor(a.status)}55` }}>
                {a.status?.toUpperCase()}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                {a.status === "accepted" && <>
                  <button style={{ fontSize: "0.62rem", padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(0,255,157,0.4)", background: "rgba(0,255,157,0.1)", color: "var(--accent2)", cursor: "pointer", fontFamily: "var(--mono)" }}
                    onClick={() => openModal(a, "call")}>📹 Video</button>
                  <button style={{ fontSize: "0.62rem", padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(0,212,255,0.4)", background: "rgba(0,212,255,0.1)", color: "var(--accent)", cursor: "pointer", fontFamily: "var(--mono)" }}
                    onClick={() => openModal(a, "audio")}>🎙️ Audio</button>
                </>}
                <button className="btn-outline" style={{ fontSize: "0.62rem", padding: "6px 12px" }}
                  onClick={() => openModal(a, "chat")}>💬 Chat</button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════
   VOICE ASSISTANT — Patient speaks → Doctor gets alert
═══════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════
   VOICE ASSISTANT COMPONENT
═══════════════════════════════════════════════════════ */
function VoiceAssistant({ currentUser, addToast }) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("idle"); // idle | listening | processing | sent
  const [lastAlert, setLastAlert] = useState(null);
  const wsRef = useRef(null);
  const recognitionRef = useRef(null);

  // Keywords → Alert type + message
  const KEYWORDS = [
    { words: ["chest pain","chest hurts","heart pain","heart attack"], type:"CRITICAL", msg:"Patient reports chest pain — immediate attention required!" },
    { words: ["can't breathe","cannot breathe","breathing problem","shortness of breath","breathless"], type:"CRITICAL", msg:"Patient reports breathing difficulty — urgent!" },
    { words: ["unconscious","fainted","passed out","fell down","collapsed"], type:"CRITICAL", msg:"Patient reports loss of consciousness or fall!" },
    { words: ["dizzy","dizziness","feeling dizzy","spinning"], type:"HIGH", msg:"Patient reports dizziness." },
    { words: ["high bp","blood pressure high","bp high","high blood pressure"], type:"HIGH", msg:"Patient reports high blood pressure." },
    { words: ["low sugar","sugar low","feeling weak","hypoglycemia"], type:"HIGH", msg:"Patient reports low blood sugar / weakness." },
    { words: ["headache","head pain","head hurts","migraine"], type:"HIGH", msg:"Patient reports headache." },
    { words: ["fever","temperature high","feeling hot","chills"], type:"HIGH", msg:"Patient reports fever or chills." },
    { words: ["call doctor","need doctor","help me","emergency","help"], type:"HIGH", msg:"Patient is requesting doctor assistance." },
    { words: ["i am fine","feeling okay","feeling good","all good","normal"], type:"INFO", msg:"Patient reports feeling fine." },
  ];

  function detectKeywords(text) {
    const lower = text.toLowerCase();
    for (const k of KEYWORDS) {
      if (k.words.some(w => lower.includes(w))) {
        return k;
      }
    }
    return null;
  }

  // Connect WebSocket to backend with auto-reconnect
  function connectWS() {
    try {
      const ws = new WebSocket("ws://localhost:8000/ws/patient");
      ws.onopen = () => {
        console.log("✅ Patient WS connected");
        wsRef.current = ws;
      };
      ws.onerror = () => console.log("WS error — REST fallback ready");
      ws.onclose = () => {
        wsRef.current = null;
        // Auto reconnect after 3s
        setTimeout(connectWS, 3000);
      };
    } catch (e) {
      console.log("WS not available");
    }
  }

  useEffect(() => {
    connectWS();
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, []);

  function sendAlert(detected, text) {
    const payload = {
      type: "VOICE_ALERT",
      patient_name: `${currentUser?.fname || ""} ${currentUser?.lname || ""}`.trim(),
      patient_id: currentUser?.patientDbId || currentUser?.id,
      alert_type: detected.type,
      message: detected.msg,
      transcript: text,
      timestamp: new Date().toISOString(),
    };

    // ── INSTANT: WebSocket (0ms delay) ──
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      // WebSocket success — don't write localStorage (avoid duplicate on doctor side)
    } else {
      // ── FAST FALLBACK: localStorage (doctor polls every 2s) ──
      try {
        const key = "voice_alerts_doctor";
        const existing = JSON.parse(localStorage.getItem(key) || "[]");
        localStorage.setItem(key, JSON.stringify([payload, ...existing].slice(0, 20)));
      } catch {}
      // REST in background — don't await, don't block UI
      fetch("http://localhost:8000/api/voice-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }

    setLastAlert(payload);
    addToast(
      detected.type === "CRITICAL" ? "🚨" : detected.type === "HIGH" ? "⚠️" : "ℹ️",
      detected.type === "CRITICAL" ? "Alert Sent to Doctor!" : "Doctor Notified",
      detected.msg,
      detected.type === "CRITICAL" ? "danger" : "warn"
    );
    setStatus("sent");
    setTimeout(() => setStatus("idle"), 3000);
  }

  function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addToast("❌", "Not Supported", "Voice not supported in this browser. Use Chrome!", "danger");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = true;       // ← stop ஆகாது, நிறுத்தாம கேக்கும்
    recognition.interimResults = true;   // ← பேசும்போதே real-time text
    recognitionRef.current = recognition;

    let alertSentThisSession = false; // duplicate alert prevent

    recognition.onstart = () => { setListening(true); setStatus("listening"); setTranscript(""); alertSentThisSession = false; };

    recognition.onresult = (e) => {
      // Get latest transcript (interim + final combined)
      const text = Array.from(e.results).map(r => r[0].transcript).join(" ");
      setTranscript(text);

      // Check keywords on INTERIM results too — instant detection!
      if (!alertSentThisSession) {
        const detected = detectKeywords(text);
        if (detected) {
          alertSentThisSession = true; // prevent duplicate
          setStatus("processing");
          sendAlert(detected, text);
          // Auto-stop after alert sent
          setTimeout(() => {
            if (recognitionRef.current) recognitionRef.current.stop();
          }, 500);
          return;
        }
      }

      // If final result and no keyword found — show feedback
      const lastResult = e.results[e.results.length - 1];
      if (lastResult.isFinal && !alertSentThisSession) {
        addToast("🎙️", "Heard You", `"${text}" — Say a medical keyword to alert doctor`, "info");
      }
    };

    recognition.onerror = (e) => {
      if (e.error === "no-speech") {
        // No speech — restart automatically to keep listening
        try { recognition.start(); } catch {}
        return;
      }
      setListening(false);
      setStatus("idle");
      addToast("❌", "Voice Error", e.error, "danger");
    };

    recognition.onend = () => {
      // If still supposed to be listening (not manually stopped), restart
      if (recognitionRef.current && !alertSentThisSession) {
        try { recognition.start(); } catch {}
      } else {
        setListening(false);
      }
    };

    recognition.start();
  }

  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null; // prevent auto-restart
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setListening(false);
    setStatus("idle");
  }

  const btnColor = status === "listening" ? "#ff2d55" : status === "sent" ? "#00ff9d" : status === "processing" ? "#ff8c42" : "var(--accent)";
  const btnLabel = status === "listening" ? "🔴 Listening... (tap to stop)" : status === "processing" ? "⏳ Processing..." : status === "sent" ? "✅ Alert Sent!" : "🎙️ Speak to Doctor";

  return (
    <div className="card" style={{ border: `1px solid ${btnColor}40`, transition: "border 0.3s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, color: "var(--text-bright)", fontSize: "0.95rem" }}>🎙️ Voice Assistant</div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: 2 }}>Speak — Doctor gets instant alert</div>
        </div>
        {status === "listening" && (
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            {[1,2,3,4,5].map(i => (
              <div key={i} style={{ width: 3, borderRadius: 2, background: "#ff2d55",
                height: `${8 + Math.random() * 16}px`,
                animation: `blink ${0.4 + i * 0.1}s ease infinite alternate` }} />
            ))}
          </div>
        )}
      </div>

      {/* Transcript */}
      {transcript && (
        <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(0,212,255,0.06)",
          border: "1px solid rgba(0,212,255,0.15)", fontSize: "0.8rem", color: "var(--text)",
          marginBottom: 12, fontStyle: "italic", minHeight: 36 }}>
          "{transcript}"
        </div>
      )}

      {/* Main Button */}
      <button
        onClick={listening ? stopListening : startListening}
        disabled={status === "processing"}
        style={{ width: "100%", padding: "14px", borderRadius: 10, border: "none",
          background: btnColor, color: status === "listening" ? "#fff" : "#000",
          fontWeight: 700, fontSize: "0.9rem", cursor: status === "processing" ? "not-allowed" : "pointer",
          transition: "all 0.3s", boxShadow: status === "listening" ? `0 0 20px ${btnColor}60` : "none" }}>
        {btnLabel}
      </button>

      {/* Example phrases */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: "0.6rem", color: "var(--text-dim)", marginBottom: 6, fontFamily: "var(--mono)", letterSpacing: 1 }}>TRY SAYING:</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {["Chest pain", "Can't breathe", "Feeling dizzy", "Call doctor", "BP is high", "I am fine"].map(p => (
            <span key={p} style={{ fontSize: "0.62rem", padding: "3px 8px", borderRadius: 10,
              background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text-dim)" }}>
              "{p}"
            </span>
          ))}
        </div>
      </div>

      {/* Last alert sent */}
      {lastAlert && (
        <div style={{ marginTop: 12, padding: "8px 10px", borderRadius: 8, fontSize: "0.72rem",
          background: "rgba(0,255,157,0.06)", border: "1px solid rgba(0,255,157,0.2)", color: "var(--accent2)" }}>
          ✅ Last alert: {lastAlert.message}
        </div>
      )}
    </div>
  );
}

function PatientDashboard({ patient, liveVitals, history, alerts, addToast, currentUser, doctors }) {
  const [tab, setTab] = useState("overview");
  const risk = mlRisk(history);
  const hrChart = history.slice(-20).map((v, i) => ({ t: i, hr: v.hr, spo2: v.spo2 }));
  const trendHR = liveVitals.hr > patient.baseline.hr + 10 ? "▲ Elevated" : "→ Stable";
  const trendSpo2 = liveVitals.spo2 < 95 ? "▼ Below normal" : "→ Normal";
  const trendBP = liveVitals.bp_sys > 140 ? "▲ Hypertensive" : "→ Acceptable";
  const trendTemp = liveVitals.temp > 38 ? "▲ Low-grade fever" : "→ Normal";
  const TABS = ["overview", "vitals history", "alerts", "appointments", "reports"];

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <div className="page-title">My Health Dashboard</div>
          <div className="page-sub">Patient: <strong style={{ color: "var(--accent)" }}>{patient.name}</strong> · {patient.condition} · {patient.doctor}</div>
        </div>
        <div className="sys-status" style={{ padding: "6px 14px", background: "rgba(0,255,157,0.07)", border: "1px solid rgba(0,255,157,0.2)", borderRadius: 20 }}>
          <div className="status-dot" />LIVE MONITORING
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "7px 16px", borderRadius: 8, fontSize: "0.78rem", cursor: "pointer",
            fontFamily: "var(--mono)", background: tab === t ? "rgba(0,212,255,0.12)" : "transparent",
            border: tab === t ? "1px solid rgba(0,212,255,0.3)" : "1px solid transparent",
            color: tab === t ? "var(--accent)" : "var(--text-dim)",
          }}>{t.toUpperCase()}</button>
        ))}
      </div>

      {tab === "overview" && <>
        <div className="g4 mb20">
          <VitalCard label="❤️  Heart Rate" value={liveVitals.hr.toFixed(0)} unit="bpm" trend={trendHR} trendClass={liveVitals.hr > 105 ? "t-danger" : "t-ok"} colorClass="vc-heart" anomaly={liveVitals.hr > 105} sparkColor="#ff2d55" sparkData={genSparkData(patient.baseline.hr, 10)} />
          <VitalCard label="🩺  Blood Pressure" value={liveVitals.bp_sys.toFixed(0)} unit={`/${liveVitals.bp_dia.toFixed(0)} mmHg`} trend={trendBP} trendClass={liveVitals.bp_sys > 140 ? "t-warn" : "t-ok"} colorClass="vc-bp" sparkColor="#00d4ff" sparkData={genSparkData(patient.baseline.bp_sys, 8)} />
          <VitalCard label="🫧  SpO₂" value={liveVitals.spo2.toFixed(1)} unit="%" trend={trendSpo2} trendClass={liveVitals.spo2 < 95 ? "t-danger" : "t-ok"} colorClass="vc-spo2" anomaly={liveVitals.spo2 < 94} sparkColor="#00ff9d" sparkData={genSparkData(patient.baseline.spo2, 2)} />
          <VitalCard label="🌡️  Temperature" value={liveVitals.temp.toFixed(1)} unit="°C" trend={trendTemp} trendClass={liveVitals.temp > 38 ? "t-warn" : "t-ok"} colorClass="vc-temp" sparkColor="#ff8c42" sparkData={genSparkData(patient.baseline.temp, 0.3)} />
        </div>
        <div className="g2 mb20">
          <div className="card">
            <div className="card-title">ECG — Live Feed <span className="rec-blink">● REC</span></div>
            <ECG />
          </div>
          <div className="card">
            <div className="card-title">🤖 ML Risk Prediction</div>
            <div style={{ display: "flex", alignItems: "center", gap: 24, marginTop: 8 }}>
              <RiskRing score={risk.score} label={risk.label} color={risk.color} />
              <div style={{ flex: 1 }}>
                <RiskBar label="Cardiac Event Risk" pct={Math.min(99, Math.round(risk.score * 1.1))} fillClass={risk.score > 60 ? "rf-high" : "rf-low"} />
                <RiskBar label="Respiratory Decline" pct={Math.min(99, Math.round(risk.score * 0.7))} fillClass="rf-low" />
                <RiskBar label="Deterioration" pct={Math.min(99, Math.round(risk.score * 0.9))} fillClass={risk.score > 60 ? "rf-high" : "rf-low"} />
              </div>
            </div>
          </div>
        </div>
        <div className="card mb16">
          <div className="card-title">HR & SpO₂ Trend</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={hrChart} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="t" hide />
              <YAxis tick={{ fill: "var(--text-dim)", fontSize: 9 }} />
              <Tooltip contentStyle={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="hr" stroke="#ff2d55" strokeWidth={2} dot={false} name="Heart Rate" isAnimationActive={false} />
              <Line type="monotone" dataKey="spo2" stroke="#00ff9d" strokeWidth={2} dot={false} name="SpO₂" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="card mb16">
          <div className="card-title">📷 Camera Vitals Detection</div>
          <CameraVitals onResult={(r) => {
            addToast("info", `Camera detected HR: ${r.hr} bpm, Breathing: ${r.br}/min`);
            // Save camera vitals to database
            if (currentUser?.patientDbId) {
              postVital({
                patient_id: currentUser.patientDbId,
                heart_rate: r.hr,
                bp_systolic: 120, bp_diastolic: 80,
                spo2: 97, temperature: 36.8,
                glucose: 0, is_anomaly: r.hr > 105 || r.hr < 55,
              }).catch(() => {});
            }
          }} addToast={addToast} />
        </div>
        <div className="card">
          <div className="card-title">Recent Alerts ({alerts.length})</div>
          {alerts.length === 0
            ? <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-dim)" }}>✅ No active alerts</div>
            : alerts.slice(0, 5).map((a, i) => <AlertItem key={i} type={a.alert_type === "CRITICAL" ? "danger" : "warn"} msg={a.message} time={a.created_at} />)}
        </div>
      </>}

      {tab === "overview" && (
        <div style={{ marginTop: 14 }}>
          <VoiceAssistant currentUser={currentUser} addToast={addToast} />
        </div>
      )}

      {tab === "vitals history" && (
        <div className="card">
          <div className="card-title">Vitals History — Live Readings
            <button className="btn-outline" style={{ fontSize: "0.6rem", padding: "4px 10px" }}
              onClick={() => {
                const csv = "Time,HR,Systolic,Diastolic,SpO2,Temp\n" +
                  history.map(v => `${v.ts},${v.hr},${v.bp_sys},${v.bp_dia},${v.spo2},${v.temp}`).join("\n");
                downloadCSV(`${patient.id}_vitals.csv`, csv);
              }}>↓ Export CSV</button>
          </div>
          <div className="vh-row header">
            <span>TIME</span><span>HR</span><span>BP</span><span>SpO₂</span><span>TEMP</span><span>STATUS</span>
          </div>
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {[...history].reverse().map((v, i) => {
              const bad = v.hr > 105 || v.spo2 < 94;
              return (
                <div key={i} className="vh-row">
                  <span style={{ color: "var(--text-dim)" }}>{v.ts}</span>
                  <span className={v.hr > 105 ? "vh-danger" : "vh-ok"}>{v.hr.toFixed(0)}</span>
                  <span className={v.bp_sys > 140 ? "vh-danger" : "vh-ok"}>{v.bp_sys.toFixed(0)}/{v.bp_dia.toFixed(0)}</span>
                  <span className={v.spo2 < 94 ? "vh-danger" : "vh-ok"}>{v.spo2.toFixed(1)}</span>
                  <span className={v.temp > 37.8 ? "vh-danger" : "vh-ok"}>{v.temp.toFixed(1)}</span>
                  <span className={bad ? "vh-danger" : "vh-ok"}>{bad ? "⚠ ALERT" : "✓ OK"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "alerts" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Doctor Alerts — from localStorage */}
          {(() => {
            const key = `doctor_alerts_${currentUser?.patientDbId || currentUser?.id}`;
            let doctorAlerts = [];
            try { doctorAlerts = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
            return doctorAlerts.length > 0 ? (
              <div className="card" style={{ border: "1px solid rgba(0,212,255,0.3)" }}>
                <div className="card-title" style={{ color: "var(--accent)" }}>
                  📨 Messages from Your Doctor
                  <span style={{ fontSize: "0.65rem", fontFamily: "var(--mono)", marginLeft: 8,
                    background: "rgba(0,212,255,0.12)", padding: "2px 8px", borderRadius: 10,
                    color: "var(--accent)", border: "1px solid rgba(0,212,255,0.25)" }}>
                    {doctorAlerts.length} NEW
                  </span>
                </div>
                {doctorAlerts.map((a, i) => (
                  <div key={i} style={{
                    padding: "12px 14px", borderRadius: 10, marginBottom: 8,
                    background: a.alert_type === "CRITICAL" ? "rgba(255,45,85,0.08)" : a.alert_type === "HIGH" ? "rgba(255,140,66,0.08)" : "rgba(0,212,255,0.06)",
                    border: `1px solid ${a.alert_type === "CRITICAL" ? "rgba(255,45,85,0.3)" : a.alert_type === "HIGH" ? "rgba(255,140,66,0.3)" : "rgba(0,212,255,0.2)"}`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-bright)" }}>
                        {a.alert_type === "CRITICAL" ? "🚨" : a.alert_type === "HIGH" ? "⚠️" : "ℹ️"} {a.sent_by || "Your Doctor"}
                      </span>
                      <span style={{ fontSize: "0.6rem", fontFamily: "var(--mono)", color: "var(--text-dim)" }}>
                        {new Date(a.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.83rem", color: "var(--text)", lineHeight: 1.5 }}>{a.message}</div>
                  </div>
                ))}
              </div>
            ) : null;
          })()}

          {/* System Alerts */}
          <div className="card">
            <div className="card-title">⚠️ System Alerts ({alerts.length})</div>
            {alerts.length === 0
              ? <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-dim)" }}>✅ No system alerts</div>
              : alerts.map((a, i) => <AlertItem key={i} type={a.alert_type === "CRITICAL" ? "danger" : "warn"} msg={a.message} time={a.created_at} />)}
          </div>
        </div>
      )}

      {tab === "appointments" && (
        <PatientAppointmentsTab patient={patient} addToast={addToast} currentUser={currentUser} doctors={doctors} />
      )}

      {tab === "reports" && (
        <ReportsTab patient={patient} history={history} alerts={alerts} risk={risk} addToast={addToast} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   DOCTOR DASHBOARD
═══════════════════════════════════════════════════════ */
function DoctorDashboard({ addToast, liveVitals, hrData, spo2Data, bpData, patients, selectedPatient, onSelectPatient }) {
  // If a patient is selected from sidebar, show their vitals; else show general live vitals
  const base = selectedPatient
    ? (PATIENTS_DATASET.find(d => d.name.toLowerCase().includes(selectedPatient.name?.split(" ")[0]?.toLowerCase())) || PATIENTS_DATASET[0])
    : PATIENTS_DATASET[0];
  const [dashVitals, setDashVitals] = useState(() => genLiveVitals(base));
  useEffect(() => {
    setDashVitals(genLiveVitals(base)); // instant update on patient change
    const t = setInterval(() => setDashVitals(genLiveVitals(base)), 5000);
    return () => clearInterval(t);
  }, [selectedPatient]);
  const v = dashVitals;
  const hrChart = Array.from({ length: 12 }, (_, i) => ({
    t: `${i * 2}h`, hr: 70 + Math.round(Math.sin(i * 0.5) * 15 + i * 2 + Math.random() * 10)
  }));

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <div className="page-title">Doctor Dashboard</div>
          <div className="page-sub">
            {selectedPatient
              ? <span>📍 Viewing: <strong style={{color:"var(--accent)"}}>{selectedPatient.name}</strong> · {selectedPatient.condition} · <span style={{fontSize:"0.7rem",color:"var(--text-dim)",cursor:"pointer"}} onClick={() => onSelectPatient(null)}>✕ clear</span></span>
              : <span>Live monitoring · {patients.length} patients · Click patient in sidebar to focus</span>
            }
          </div>
        </div>
        <button className="btn-primary" onClick={() => addToast("📅", "Appointments", "Go to Appointments tab to schedule", "info")}>+ Schedule Call</button>
                      </div>
      <div className="g4 mb20">
        <VitalCard label="❤️  Heart Rate" value={v.hr.toFixed(0)} unit="bpm" trend={v.hr > 100 ? "▲ Elevated" : v.hr < 60 ? "▼ Low" : "→ Stable"} trendClass={v.hr > 100 ? "t-danger" : "t-ok"} colorClass="vc-heart" anomaly={v.hr > 105} sparkColor="#ff2d55" sparkData={hrData} />
        <VitalCard label="🩺  Blood Pressure" value={v.bp_sys.toFixed(0)} unit={`/${v.bp_dia.toFixed(0)} mmHg`} trend={v.bp_sys > 140 ? "▲ High" : "→ Acceptable"} trendClass={v.bp_sys > 140 ? "t-warn" : "t-ok"} colorClass="vc-bp" sparkColor="#00d4ff" sparkData={bpData} />
        <VitalCard label="🫧  SpO₂" value={v.spo2.toFixed(1)} unit="%" trend={v.spo2 < 94 ? "▼ Low" : "→ Normal"} trendClass={v.spo2 < 94 ? "t-danger" : "t-ok"} colorClass="vc-spo2" anomaly={v.spo2 < 94} sparkColor="#00ff9d" sparkData={spo2Data} />
        <VitalCard label="🌡️  Temperature" value={v.temp.toFixed(1)} unit="°C" trend={v.temp > 38 ? "▲ Fever" : "→ Normal"} trendClass={v.temp > 38 ? "t-warn" : "t-ok"} colorClass="vc-temp" sparkColor="#ff8c42" sparkData={bpData} />
      </div>
      <div className="g2 mb20">
        <div className="card">
          <div className="card-title">ECG — Live Feed <span className="rec-blink">● REC</span></div>
          <ECG />
        </div>
        <div className="card">
          <div className="card-title">24h HR Trend</div>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={hrChart} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
              <defs><linearGradient id="hrG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ff2d55" stopOpacity={0.3} /><stop offset="95%" stopColor="#ff2d55" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="t" tick={{ fill: "var(--text-dim)", fontSize: 9 }} />
              <YAxis tick={{ fill: "var(--text-dim)", fontSize: 9 }} />
              <Tooltip contentStyle={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} />
              <Area type="monotone" dataKey="hr" stroke="#ff2d55" strokeWidth={2} fill="url(#hrG)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PATIENTS PAGE
═══════════════════════════════════════════════════════ */
function PatientsPage({ addToast, patients, currentUser }) {
  const [selected, setSelected] = useState(null);
  const [vitals, setVitals] = useState({ hr: "", bp_sys: "", bp_dia: "", spo2: "", temp: "" });
  const [history, setHistory] = useState([]);
  const [monitoring, setMonitoring] = useState(false);
  const [liveVitals, setLiveVitals] = useState(null);
  const intervalRef = useRef(null);
  const [alertMsg, setAlertMsg] = useState("");
  const [alertType, setAlertType] = useState("info");
  const [sendingAlert, setSendingAlert] = useState(false);
  const [sentAlerts, setSentAlerts] = useState([]);

  async function sendDoctorAlert() {
    if (!selected || !alertMsg.trim()) return;
    setSendingAlert(true);
    try {
      // Post to backend alerts table
      const payload = {
        patient_id: selected.id,
        patient_name: selected.name,
        alert_type: alertType === "info" ? "INFO" : alertType === "warn" ? "HIGH" : "CRITICAL",
        message: alertMsg.trim(),
        sent_by: `Dr. ${currentUser?.fname || ""} ${currentUser?.lname || ""}`.trim(),
        created_at: new Date().toISOString(),
      };
      // Try backend first
      try {
        await fetch(`http://localhost:8000/alerts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {}
      // Always store in localStorage for patient to see
      const key = `doctor_alerts_${selected.id}`;
      const existing = JSON.parse(localStorage.getItem(key) || "[]");
      localStorage.setItem(key, JSON.stringify([payload, ...existing].slice(0, 20)));
      setSentAlerts(prev => [payload, ...prev]);
      addToast("📨", "Alert Sent!", `Message sent to ${selected.name}`, "ok");
      setAlertMsg("");
    } catch (e) {
      addToast("❌", "Failed", "Could not send alert", "danger");
    }
    setSendingAlert(false);
  }

  function startMonitoring(patient) {
    setSelected(patient);
    setHistory([]);
    setLiveVitals(null);
    setMonitoring(false);
    setVitals({ hr: "", bp_sys: "", bp_dia: "", spo2: "", temp: "" });
    if (intervalRef.current) clearInterval(intervalRef.current);
  }

  function handleSaveVitals() {
    const { hr, bp_sys, bp_dia, spo2, temp } = vitals;
    if (!hr || !bp_sys || !bp_dia || !spo2 || !temp) {
      addToast("warn", "All vitals required!");
      return;
    }
    const entry = Object.freeze({
      hr: parseFloat(hr), bp_sys: parseFloat(bp_sys), bp_dia: parseFloat(bp_dia),
      spo2: parseFloat(spo2), temp: parseFloat(temp), ts: new Date().toLocaleTimeString()
    });
    setHistory(h => [...h.slice(-29), entry]);
    setLiveVitals(entry);
    postVital({
      patient_id: selected.id,
      heart_rate: entry.hr, bp_systolic: entry.bp_sys, bp_diastolic: entry.bp_dia,
      spo2: entry.spo2, temperature: entry.temp, glucose: 0,
      is_anomaly: entry.hr > 105 || entry.spo2 < 94,
    }).catch(() => {});
    addToast("success", `Vitals saved for ${selected.name}`);
  }

  function startAutoMonitor() {
    if (!selected) return;
    const base = PATIENTS_DATASET.find(d => d.name.toLowerCase().includes(selected.name?.split(" ")[0]?.toLowerCase())) || PATIENTS_DATASET[0];
    setMonitoring(true);
    intervalRef.current = setInterval(() => {
      const v = Object.freeze({ ...genLiveVitals(base) });
      setLiveVitals(v);
      setHistory(h => [...h.slice(-29), v]);
      setVitals({ hr: v.hr, bp_sys: v.bp_sys, bp_dia: v.bp_dia, spo2: v.spo2, temp: v.temp });
    }, 5000);
  }

  function stopAutoMonitor() {
    setMonitoring(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const risk = liveVitals ? mlRisk(history.length > 1 ? history : [liveVitals, liveVitals]) : null;
  const chartData = history.map((v, i) => ({ t: i, hr: v.hr, spo2: v.spo2, bp: v.bp_sys, temp: v.temp }));

  const vitalFields = [
    { key: "hr", label: "Heart Rate", unit: "bpm", normal: "60-100", color: "#ff2d55" },
    { key: "bp_sys", label: "BP Systolic", unit: "mmHg", normal: "90-120", color: "#00d4ff" },
    { key: "bp_dia", label: "BP Diastolic", unit: "mmHg", normal: "60-80", color: "#7c6dfa" },
    { key: "spo2", label: "SpO₂", unit: "%", normal: "95-100", color: "#00ff9d" },
    { key: "temp", label: "Temperature", unit: "°C", normal: "36-37.5", color: "#ff8c42" },
  ];

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div><div className="page-title">Patient Monitoring</div>
          <div className="page-sub">{patients.length} patients — click to monitor</div></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: selected ? "260px 1fr" : "1fr", gap: 16 }}>
        {/* Patient List */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {patients.map(p => (
            <div key={p.id} onClick={() => startMonitoring(p)}
              style={{ padding: "12px 14px", borderRadius: 10, cursor: "pointer", transition: "all 0.2s",
                background: selected?.id === p.id ? "rgba(0,212,255,0.08)" : "var(--panel)",
                border: `1px solid ${selected?.id === p.id ? "var(--accent)" : "var(--border)"}`,
                borderLeft: selected?.id === p.id ? "3px solid var(--accent)" : "3px solid transparent" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div style={{ fontWeight: 600, color: "var(--text-bright)", fontSize: "0.88rem" }}>{p.name}</div>
                <span style={{
                  fontSize:"0.55rem", fontFamily:"var(--mono)", fontWeight:700, letterSpacing:0.5,
                  padding:"2px 7px", borderRadius:4,
                  background: p.risk==="CRITICAL" ? "rgba(255,45,85,0.15)" : p.risk==="HIGH" ? "rgba(255,140,66,0.15)" : "rgba(0,230,118,0.1)",
                  color: p.risk==="CRITICAL" ? "#ff2d55" : p.risk==="HIGH" ? "#ff8c42" : "#00e676",
                  border: `1px solid ${p.risk==="CRITICAL" ? "rgba(255,45,85,0.4)" : p.risk==="HIGH" ? "rgba(255,140,66,0.4)" : "rgba(0,230,118,0.3)"}`,
                }}>
                  {p.risk==="CRITICAL" ? "🔴 CRITICAL" : p.risk==="HIGH" ? "🟡 SERIOUS" : "🟢 NORMAL"}
                </span>
              </div>
              <div style={{ fontSize: "0.68rem", color: "var(--text-dim)", marginTop: 3 }}>{p.condition}</div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-dim)" }}>{p.age} yrs · {p.gender}</div>
            </div>
          ))}
        </div>

        {/* Monitoring Panel */}
        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Patient Info + Risk */}
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-bright)" }}>{selected.name}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: 4 }}>{selected.condition} · {selected.age} yrs · {selected.gender}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>Doctor: {selected.doctor_name}</div>
                </div>
                {risk && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: "var(--mono)", fontSize: "2rem", fontWeight: 700, color: risk.color, lineHeight: 1 }}>{risk.score}</div>
                    <div style={{ fontSize: "0.65rem", color: risk.color, marginTop: 2 }}>{risk.label}</div>
                    <div style={{ fontSize: "0.6rem", color: "var(--text-dim)" }}>RISK SCORE</div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  {!monitoring
                    ? <button className="btn-accent" onClick={startAutoMonitor} style={{ fontSize: "0.75rem" }}>▶ Auto Monitor</button>
                    : <button className="btn-danger-outline" onClick={stopAutoMonitor} style={{ fontSize: "0.75rem" }}>⏹ Stop</button>
                  }
                </div>
              </div>
            </div>

            {/* Manual Vitals Entry */}
            <div className="card">
              <div className="card-title">📋 Enter Patient Vitals {monitoring && <span style={{ fontSize: "0.65rem", color: "#00ff9d", marginLeft: 8 }}>● AUTO MONITORING</span>}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
                {vitalFields.map(f => (
                  <div key={f.key}>
                    <div style={{ fontSize: "0.65rem", color: "var(--text-dim)", marginBottom: 4 }}>{f.label} ({f.unit})</div>
                    <input type="number" value={vitals[f.key]}
                      onChange={e => setVitals(v => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={f.normal}
                      style={{ width: "100%", background: "var(--panel2)", border: `1px solid ${f.color}44`,
                        borderRadius: 6, padding: "7px 10px", color: f.color, fontFamily: "var(--mono)", fontSize: "0.9rem" }} />
                    <div style={{ fontSize: "0.6rem", color: "var(--text-dim)", marginTop: 2 }}>Normal: {f.normal}</div>
                  </div>
                ))}
              </div>
              <button className="btn-accent" onClick={handleSaveVitals} style={{ fontSize: "0.8rem" }}>💾 Save Vitals to Database</button>
            </div>

            {/* Live Values Display */}
            {liveVitals && (
              <div className="card">
                <div className="card-title">📊 Current Readings</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
                  {vitalFields.map(f => (
                    <div key={f.key} style={{ textAlign: "center", padding: "12px 8px", borderRadius: 10,
                      background: "var(--panel2)", border: `1px solid ${f.color}33` }}>
                      <div style={{ fontFamily: "var(--mono)", fontSize: "1.4rem", fontWeight: 700, color: f.color }}>{liveVitals[f.key]}</div>
                      <div style={{ fontSize: "0.6rem", color: "var(--text-dim)", marginTop: 2 }}>{f.unit}</div>
                      <div style={{ fontSize: "0.62rem", color: "var(--text-dim)" }}>{f.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Insights */}
            {risk && risk.insights && (
              <div className="card">
                <div className="card-title">🧠 AI Clinical Insights</div>
                {risk.insights.map((insight, i) => (
                  <div key={i} style={{ padding: "9px 12px", marginBottom: 6, borderRadius: 8, fontSize: "0.8rem",
                    background: insight.startsWith("🔴") ? "rgba(255,45,85,0.07)" : insight.startsWith("🟡") ? "rgba(255,140,66,0.07)" : "rgba(0,255,157,0.05)",
                    border: insight.startsWith("🔴") ? "1px solid rgba(255,45,85,0.25)" : insight.startsWith("🟡") ? "1px solid rgba(255,140,66,0.25)" : "1px solid rgba(0,255,157,0.2)",
                    color: "var(--text)" }}>{insight}</div>
                ))}
              </div>
            )}

            {/* ── DOCTOR ALERT PANEL ── */}
            {selected && (
              <div className="card" style={{ border: "1px solid rgba(0,212,255,0.25)" }}>
                <div className="card-title">📨 Send Alert to {selected.name}</div>

                {/* Alert Type */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {[
                    { val: "info", label: "ℹ️ Info", color: "rgba(0,212,255,0.15)", border: "rgba(0,212,255,0.4)", text: "var(--accent)" },
                    { val: "warn", label: "⚠️ Warning", color: "rgba(255,140,66,0.15)", border: "rgba(255,140,66,0.4)", text: "var(--warn)" },
                    { val: "critical", label: "🚨 Critical", color: "rgba(255,45,85,0.15)", border: "rgba(255,45,85,0.4)", text: "var(--danger)" },
                  ].map(t => (
                    <button key={t.val} onClick={() => setAlertType(t.val)} style={{
                      flex: 1, padding: "7px 4px", borderRadius: 8, fontSize: "0.7rem", cursor: "pointer",
                      background: alertType === t.val ? t.color : "transparent",
                      border: `1px solid ${alertType === t.val ? t.border : "var(--border)"}`,
                      color: alertType === t.val ? t.text : "var(--text-dim)",
                      fontWeight: alertType === t.val ? 600 : 400,
                      transition: "all 0.2s",
                    }}>{t.label}</button>
                  ))}
                </div>

                {/* Quick Templates */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {[
                    "Please take your medication now",
                    "Your vitals are abnormal — rest immediately",
                    "Drink water and rest",
                    "Visit hospital today",
                    "Your BP is high — avoid stress",
                    "Appointment reminder for tomorrow",
                  ].map(t => (
                    <span key={t} onClick={() => setAlertMsg(t)} style={{
                      fontSize: "0.62rem", padding: "3px 9px", borderRadius: 12, cursor: "pointer",
                      background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.18)",
                      color: "var(--text-dim)", transition: "all 0.15s",
                    }}>{t}</span>
                  ))}
                </div>

                {/* Message Input */}
                <textarea
                  placeholder={`Write alert message for ${selected.name}...`}
                  value={alertMsg}
                  onChange={e => setAlertMsg(e.target.value)}
                  rows={3}
                  style={{ width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 9,
                    color: "var(--text)", padding: "10px 12px", fontSize: "0.82rem", resize: "vertical",
                    lineHeight: 1.5, boxSizing: "border-box", outline: "none", marginBottom: 10 }}
                />

                <button onClick={sendDoctorAlert} disabled={!alertMsg.trim() || sendingAlert}
                  style={{ width: "100%", padding: "10px", borderRadius: 9, border: "none", cursor: alertMsg.trim() ? "pointer" : "not-allowed",
                    background: alertMsg.trim() ? "var(--accent)" : "var(--panel2)",
                    color: alertMsg.trim() ? "#000" : "var(--text-dim)", fontWeight: 700, fontSize: "0.85rem",
                    transition: "all 0.2s", opacity: sendingAlert ? 0.7 : 1 }}>
                  {sendingAlert ? "⏳ Sending..." : "📨 Send Alert to Patient"}
                </button>

                {/* Sent history */}
                {sentAlerts.filter(a => a.patient_id === selected.id).length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: "0.62rem", fontFamily: "var(--mono)", color: "var(--text-dim)", marginBottom: 8, letterSpacing: 1 }}>SENT ALERTS</div>
                    {sentAlerts.filter(a => a.patient_id === selected.id).slice(0, 3).map((a, i) => (
                      <div key={i} style={{ padding: "8px 10px", borderRadius: 7, marginBottom: 5, fontSize: "0.75rem",
                        background: a.alert_type === "CRITICAL" ? "rgba(255,45,85,0.07)" : a.alert_type === "HIGH" ? "rgba(255,140,66,0.07)" : "rgba(0,212,255,0.06)",
                        border: `1px solid ${a.alert_type === "CRITICAL" ? "rgba(255,45,85,0.2)" : a.alert_type === "HIGH" ? "rgba(255,140,66,0.2)" : "rgba(0,212,255,0.15)"}`,
                        color: "var(--text)" }}>
                        <span style={{ fontSize: "0.6rem", color: "var(--text-dim)", fontFamily: "var(--mono)" }}>
                          {new Date(a.created_at).toLocaleTimeString()} · {a.alert_type}
                        </span>
                        <div style={{ marginTop: 3 }}>{a.message}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Trend Chart */}
            {chartData.length > 1 && (
              <div className="card">
                <div className="card-title">📈 Vitals Trend — {selected.name}</div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="t" hide />
                    <YAxis tick={{ fill: "var(--text-dim)", fontSize: 9 }} />
                    <Tooltip contentStyle={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="hr" stroke="#ff2d55" strokeWidth={2} dot={false} name="HR" isAnimationActive={false} />
                    <Line type="monotone" dataKey="spo2" stroke="#00ff9d" strokeWidth={2} dot={false} name="SpO2" isAnimationActive={false} />
                    <Line type="monotone" dataKey="bp" stroke="#00d4ff" strokeWidth={2} dot={false} name="BP Sys" isAnimationActive={false} />
                    <Line type="monotone" dataKey="temp" stroke="#ff8c42" strokeWidth={2} dot={false} name="Temp" isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ALERTS PAGE
═══════════════════════════════════════════════════════ */
function AlertsPage({ addToast, patients }) {
  const [dbAlerts, setDbAlerts] = useState([]);
  const [liveAlerts, setLiveAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL"); // ALL | CRITICAL | HIGH | INFO
  const [cleared, setCleared] = useState(false);

  // Load from backend
  const loadAlerts = async () => {
    try {
      const data = await getAllAlerts();
      setDbAlerts(Array.isArray(data) ? data : []);
    } catch (e) {
      setDbAlerts([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAlerts();
    const t = setInterval(loadAlerts, 15000); // refresh every 15s
    return () => clearInterval(t);
  }, []);

  // Generate live alerts from patients vitals
  useEffect(() => {
    if (!patients || patients.length === 0) return;
    const t = setInterval(() => {
      const newAlerts = [];
      patients.forEach(p => {
        const base = PATIENTS_DATASET.find(d =>
          d.name.toLowerCase().includes(p.name?.split(" ")[0]?.toLowerCase())
        ) || PATIENTS_DATASET[0];
        const v = genLiveVitals(base);
        if (v.hr > 105 || v.hr < 50) newAlerts.push({
          id: `live-${p.id}-hr-${Date.now()}`,
          patient_name: p.name,
          alert_type: "CRITICAL",
          message: `Heart Rate ${v.hr.toFixed(0)} bpm — ABNORMAL`,
          created_at: new Date().toISOString(),
          is_live: true,
        });
        if (v.bp_sys > 140) newAlerts.push({
          id: `live-${p.id}-bp-${Date.now()}`,
          patient_name: p.name,
          alert_type: "HIGH",
          message: `Systolic BP ${v.bp_sys.toFixed(0)} mmHg — ELEVATED`,
          created_at: new Date().toISOString(),
          is_live: true,
        });
        if (v.spo2 < 94) newAlerts.push({
          id: `live-${p.id}-spo2-${Date.now()}`,
          patient_name: p.name,
          alert_type: "CRITICAL",
          message: `SpO₂ ${v.spo2.toFixed(1)}% — CRITICALLY LOW`,
          created_at: new Date().toISOString(),
          is_live: true,
        });
        if (v.temp > 37.8) newAlerts.push({
          id: `live-${p.id}-temp-${Date.now()}`,
          patient_name: p.name,
          alert_type: "HIGH",
          message: `Temperature ${v.temp.toFixed(1)}°C — Fever`,
          created_at: new Date().toISOString(),
          is_live: true,
        });
      });
      if (newAlerts.length > 0) {
        setLiveAlerts(prev => [...newAlerts, ...prev].slice(0, 50));
      }
    }, 5000);
    return () => clearInterval(t);
  }, [patients]);

  // Merge db + live alerts
  const allAlerts = cleared ? [] : [
    ...liveAlerts,
    ...dbAlerts.map(a => ({ ...a, is_live: false }))
  ];

  const filtered = filter === "ALL" ? allAlerts
    : allAlerts.filter(a => a.alert_type === filter);

  const critCount = allAlerts.filter(a => a.alert_type === "CRITICAL").length;
  const highCount = allAlerts.filter(a => a.alert_type === "HIGH").length;

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <div className="page-title">🔔 Alert Center</div>
          <div className="page-sub">
            {loading ? "Loading..." : `${allAlerts.length} total alerts`}
            {critCount > 0 && <span style={{ color: "var(--danger)", marginLeft: 8, fontFamily: "var(--mono)", fontSize: "0.72rem" }}>● {critCount} CRITICAL</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn-outline" style={{ fontSize: "0.65rem", padding: "6px 14px" }} onClick={loadAlerts}>🔄 Refresh</button>
          <button className="btn-danger-outline" onClick={() => { setCleared(true); setLiveAlerts([]); setDbAlerts([]); }}>Clear All</button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="g4 mb20">
        {[
          { label: "Total Alerts", value: allAlerts.length, color: "var(--accent)", bg: "rgba(0,212,255,0.08)", border: "rgba(0,212,255,0.2)" },
          { label: "Critical", value: critCount, color: "var(--danger)", bg: "rgba(255,45,85,0.08)", border: "rgba(255,45,85,0.2)" },
          { label: "High", value: highCount, color: "var(--warn)", bg: "rgba(255,140,66,0.08)", border: "rgba(255,140,66,0.2)" },
          { label: "Live Monitoring", value: patients?.length || 0, color: "var(--accent2)", bg: "rgba(0,255,157,0.08)", border: "rgba(0,255,157,0.2)" },
        ].map((s, i) => (
          <div key={i} style={{ padding: "16px 18px", borderRadius: 12, background: s.bg, border: `1px solid ${s.border}`, textAlign: "center" }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: "2rem", fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {["ALL", "CRITICAL", "HIGH"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "6px 16px", borderRadius: 7, fontSize: "0.68rem", fontFamily: "var(--mono)",
            cursor: "pointer", transition: "all 0.2s",
            background: filter === f
              ? f === "CRITICAL" ? "rgba(255,45,85,0.15)" : f === "HIGH" ? "rgba(255,140,66,0.15)" : "rgba(0,212,255,0.12)"
              : "transparent",
            color: filter === f
              ? f === "CRITICAL" ? "var(--danger)" : f === "HIGH" ? "var(--warn)" : "var(--accent)"
              : "var(--text-dim)",
            border: filter === f
              ? f === "CRITICAL" ? "1px solid rgba(255,45,85,0.4)" : f === "HIGH" ? "1px solid rgba(255,140,66,0.4)" : "1px solid rgba(0,212,255,0.3)"
              : "1px solid var(--border)",
          }}>
            {f === "ALL" ? `ALL (${allAlerts.length})` : f === "CRITICAL" ? `🔴 CRITICAL (${critCount})` : `🟡 HIGH (${highCount})`}
          </button>
        ))}
        {liveAlerts.length > 0 && (
          <span style={{ marginLeft: "auto", fontSize: "0.62rem", fontFamily: "var(--mono)", color: "var(--accent2)", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent2)", display: "inline-block", animation: "blink 1.4s step-end infinite" }} />
            LIVE MONITORING ACTIVE
          </span>
        )}
      </div>

      {/* Alert List */}
      <div className="card">
        {loading ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-dim)" }}>
            <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>⏳</div>
            Loading alerts...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "50px 0", color: "var(--text-dim)" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: "0.9rem" }}>NO ACTIVE ALERTS</div>
            <div style={{ fontSize: "0.72rem", marginTop: 6, color: "var(--text-dim)" }}>
              {patients?.length > 0 ? `Monitoring ${patients.length} patients — all vitals normal` : "All clear"}
            </div>
          </div>
        ) : (
          <div style={{ maxHeight: 520, overflowY: "auto" }}>
            {filtered.map((a, i) => (
              <div key={a.id || i} style={{
                display: "flex", gap: 12, alignItems: "flex-start",
                padding: "12px 14px", marginBottom: 6, borderRadius: 9,
                background: a.alert_type === "CRITICAL" ? "rgba(255,45,85,0.07)" : "rgba(255,140,66,0.06)",
                border: `1px solid ${a.alert_type === "CRITICAL" ? "rgba(255,45,85,0.28)" : "rgba(255,140,66,0.22)"}`,
                animation: a.is_live && i === 0 ? "toastIn 0.3s ease" : "none",
              }}>
                <div style={{ marginTop: 3, fontSize: "0.9rem" }}>{a.alert_type === "CRITICAL" ? "🔴" : "🟡"}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                    <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text-bright)" }}>
                      {a.patient_name}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {a.is_live && <span style={{ fontSize: "0.55rem", fontFamily: "var(--mono)", padding: "1px 6px", borderRadius: 3, background: "rgba(0,255,157,0.1)", color: "var(--accent2)", border: "1px solid rgba(0,255,157,0.25)" }}>● LIVE</span>}
                      <span style={{ fontSize: "0.6rem", fontFamily: "var(--mono)", padding: "2px 8px", borderRadius: 4,
                        background: a.alert_type === "CRITICAL" ? "rgba(255,45,85,0.15)" : "rgba(255,140,66,0.15)",
                        color: a.alert_type === "CRITICAL" ? "var(--danger)" : "var(--warn)",
                        border: `1px solid ${a.alert_type === "CRITICAL" ? "rgba(255,45,85,0.3)" : "rgba(255,140,66,0.3)"}`,
                      }}>{a.alert_type}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text)", marginTop: 4 }}>{a.message}</div>
                  <div style={{ fontSize: "0.62rem", color: "var(--text-dim)", marginTop: 4, fontFamily: "var(--mono)" }}>
                    🕐 {new Date(a.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   DEVICES PAGE
═══════════════════════════════════════════════════════ */
// Outside component — stable, no re-create on render
const SIM_DEVICES = [
  { id: 101, device_name: "MediWatch X3", device_type: "Smartwatch", status: "active", battery_level: 78, signal_strength: -52, firmware_version: "v4.2.1", mac_address: "A4:C3:F0:12:88:01", last_sync: new Date().toISOString(), last_ping: new Date().toISOString() },
  { id: 102, device_name: "PulseOx Pro", device_type: "SpO₂ Monitor", status: "active", battery_level: 54, signal_strength: -68, firmware_version: "v2.1.0", mac_address: "B2:E1:9D:34:77:02", last_sync: new Date().toISOString(), last_ping: new Date(Date.now()-120000).toISOString() },
  { id: 103, device_name: "SmartBP Cuff", device_type: "Blood Pressure", status: "inactive", battery_level: 22, signal_strength: -84, firmware_version: "v3.0.5", mac_address: "C8:FF:28:A1:55:03", last_sync: new Date(Date.now()-7200000).toISOString(), last_ping: new Date(Date.now()-3600000).toISOString() },
];

function DevicesPage({ currentUser, addToast }) {
  const [devices, setDevices] = useState(SIM_DEVICES);
  const [netLogs, setNetLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [liveBattery, setLiveBattery] = useState(() => {
    const b = {}; SIM_DEVICES.forEach(d => { b[d.id] = d.battery_level; }); return b;
  });
  const [liveSignal, setLiveSignal] = useState(() => {
    const s = {}; SIM_DEVICES.forEach(d => { s[d.id] = d.signal_strength; }); return s;
  });
  const [liveLog, setLiveLog] = useState([]);

  useEffect(() => {
    const pid = currentUser?.patientDbId || 1;
    getNetworkLogs(pid)
      .then(n => setNetLogs(n || []))
      .catch(() => {});
    // devices, liveBattery, liveSignal already initialized with SIM_DEVICES
  }, [currentUser]);

  // Live battery drain + signal fluctuation
  useEffect(() => {
    const t = setInterval(() => {
      setLiveBattery(prev => {
        const next = {...prev};
        Object.keys(next).forEach(id => { next[id] = Math.max(1, next[id] - (Math.random() < 0.1 ? 1 : 0)); });
        return next;
      });
      setLiveSignal(prev => {
        const next = {...prev};
        Object.keys(next).forEach(id => { next[id] = Math.round(next[id] + (Math.random()-0.5)*4); });
        return next;
      });
      // Add live log entry
      const types = ["WiFi", "BLE", "4G", "WiFi"];
      const actions = ["Vitals synced", "Heartbeat ping", "Data upload", "Alert sent", "Battery check"];
      setLiveLog(prev => [{
        network_type: types[Math.floor(Math.random()*types.length)],
        signal_strength: Math.round(-60 + (Math.random()-0.5)*30),
        latency_ms: Math.round(50 + Math.random()*150),
        packet_loss: Math.round(Math.random()*8*10)/10,
        is_connected: Math.random() > 0.1,
        action: actions[Math.floor(Math.random()*actions.length)],
        timestamp: new Date().toISOString()
      }, ...prev.slice(0, 19)]);
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const handleScan = () => {
    setScanning(true);
    addToast("📡", "Scanning...", "Looking for nearby BLE/WiFi devices", "info");
    setTimeout(() => {
      addToast("📡", "Searching...", "Checking 2.4GHz & 5GHz bands", "info");
    }, 1000);
    setTimeout(() => {
      // Refresh battery & signal on scan
      setLiveBattery(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(id => {
          next[id] = Math.min(100, Math.max(5, next[id] + Math.round((Math.random() - 0.3) * 3)));
        });
        return next;
      });
      setLiveSignal(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(id => {
          next[id] = Math.round(next[id] + (Math.random() - 0.5) * 6);
        });
        return next;
      });
      setScanning(false);
      addToast("✅", "Scan Complete", `${devices.length} device(s) found & synced`, "ok");
    }, 3500);
  };

  const getBatteryColor = (lvl) => lvl > 60 ? "var(--accent2)" : lvl > 30 ? "var(--warn)" : "var(--danger)";
  const getSignalColor = (sig) => sig > -60 ? "var(--accent2)" : sig > -80 ? "var(--warn)" : "var(--danger)";
  const getSignalBars = (sig) => sig > -60 ? "▂▄▆█" : sig > -75 ? "▂▄▆" : sig > -85 ? "▂▄" : "▂";
  const allLogs = [...liveLog, ...netLogs].slice(0, 20);

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <div className="page-title">📡 Wearable Devices</div>
          <div className="page-sub">
            {currentUser?.role === "doctor"
              ? `${devices.length} connected devices across all patients`
              : "Your connected wearable devices"}
          </div>
        </div>
        <button className="btn-primary" onClick={handleScan} disabled={scanning}
          style={{ opacity: scanning ? 0.7 : 1 }}>
          {scanning ? "🔄 Scanning..." : "+ Scan Devices"}
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-dim)" }}>Loading devices...</div>
      ) : devices.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-dim)" }}>No devices found</div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="g4 mb20">
            {[
              { label: "Total Devices", value: devices.length, icon: "📡", color: "var(--accent)" },
              { label: "Active", value: devices.filter(d => d.status?.toLowerCase() === "active").length, icon: "✅", color: "var(--accent2)" },
              { label: "Low Battery", value: devices.filter(d => (liveBattery[d.id] ?? d.battery_level) < 30).length, icon: "🔋", color: "var(--warn)" },
              { label: "Weak Signal", value: devices.filter(d => (liveSignal[d.id] ?? d.signal_strength) < -80).length, icon: "📶", color: "var(--danger)" },
            ].map((s, i) => (
              <div className="card" key={i} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.8rem", marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: "1.8rem", fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Device Cards */}
          <div className="g2 mb20">
            {devices.map((d, i) => (
              <div className="card" key={i} style={{ borderLeft: `3px solid ${d.status?.toLowerCase() === "active" ? "var(--accent2)" : "var(--danger)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text-bright)" }}>{d.device_name}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "var(--text-dim)", marginTop: 3 }}>{d.device_type}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", color: "var(--text-dim)", marginTop: 2 }}>MAC: {d.mac_address}</div>
                  </div>
                  <span style={{
                    padding: "3px 10px", borderRadius: 4, fontSize: "0.6rem",
                    fontFamily: "var(--mono)", letterSpacing: 1,
                    background: d.status?.toLowerCase() === "active" ? "rgba(0,255,157,0.1)" : "rgba(255,45,85,0.1)",
                    color: d.status?.toLowerCase() === "active" ? "var(--accent2)" : "var(--danger)",
                    border: `1px solid ${d.status?.toLowerCase() === "active" ? "rgba(0,255,157,0.3)" : "rgba(255,45,85,0.3)"}`,
                  }}>{d.status?.toUpperCase()}</span>
                </div>

                {/* Battery Bar */}
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginBottom: 5 }}>
                    <span style={{ color: "var(--text-dim)" }}>🔋 Battery</span>
                    <span style={{ fontFamily: "var(--mono)", color: getBatteryColor(d.battery_level) }}>{d.battery_level}%</span>
                  </div>
                  <div style={{ height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${d.battery_level}%`, borderRadius: 3, background: getBatteryColor(d.battery_level), transition: "width 1s" }} />
                  </div>
                </div>

                {/* Signal */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>📶 Signal</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "0.85rem", color: getSignalColor(d.signal_strength) }}>{getSignalBars(d.signal_strength)}</span>
                  <span style={{ fontFamily: "var(--mono)", fontSize: "0.65rem", color: getSignalColor(d.signal_strength) }}>{d.signal_strength} dBm</span>
                </div>

                {d.last_ping && (
                  <div style={{ fontSize: "0.65rem", color: "var(--text-dim)", marginTop: 8, fontFamily: "var(--mono)" }}>
                    Last ping: {new Date(d.last_ping).toLocaleTimeString()}
                  </div>
                )}

                <button className="btn-outline" style={{ width: "100%", marginTop: 12, fontSize: "0.62rem" }}
                  onClick={() => setSelectedDevice(d)}>
                  VIEW DETAILS
                </button>
              </div>
            ))}
          </div>

          {/* Network Logs */}
          <div className="card">
            <div className="card-title">📶 Network Activity Log</div>
            <div className="vh-row header">
              <span>TYPE</span><span>SIGNAL</span><span>LATENCY</span><span>PACKET LOSS</span><span>STATUS</span><span>TIME</span>
            </div>
            <div style={{ maxHeight: 300, overflowY: "auto" }}>
              {allLogs.length === 0 ? (
                <div style={{ textAlign: "center", padding: "20px", color: "var(--text-dim)", fontSize: "0.8rem" }}>Waiting for activity...</div>
              ) : allLogs.map((n, i) => (
                <div key={i} className="vh-row" style={{ opacity: i === 0 ? 1 : 0.85 }}>
                  <span style={{ color: "var(--accent)" }}>{n.network_type}</span>
                  <span className={n.signal_strength > -70 ? "vh-ok" : "vh-warn"}>{n.signal_strength} dBm</span>
                  <span className={n.latency_ms > 150 ? "vh-warn" : "vh-ok"}>{n.latency_ms?.toFixed(0)} ms</span>
                  <span className={n.packet_loss > 5 ? "vh-danger" : "vh-ok"}>{n.packet_loss?.toFixed(1)}%</span>
                  <span className={n.is_connected ? "vh-ok" : "vh-danger"}>{n.is_connected ? "✓ Connected" : "✗ Offline"}</span>
                  <span style={{ color: "var(--text-dim)", fontSize: "0.6rem" }}>{new Date(n.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── View Details Modal ── */}
      {selectedDevice && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 16, padding: 28, width: 440, maxWidth: "95vw" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-bright)" }}>📡 {selectedDevice.device_name}</div>
              <button onClick={() => setSelectedDevice(null)} style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {[
                { label: "Device Type", value: selectedDevice.device_type },
                { label: "Status", value: selectedDevice.status?.toUpperCase() },
                { label: "MAC Address", value: selectedDevice.mac_address },
                { label: "Battery", value: `${liveBattery[selectedDevice.id] ?? selectedDevice.battery_level}%` },
                { label: "Signal", value: `${liveSignal[selectedDevice.id] ?? selectedDevice.signal_strength} dBm` },
                { label: "Last Ping", value: selectedDevice.last_ping ? new Date(selectedDevice.last_ping).toLocaleTimeString() : "N/A" },
              ].map((item, i) => (
                <div key={i} style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "0.62rem", color: "var(--text-dim)", marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: "0.85rem", fontFamily: "var(--mono)", color: "var(--text-bright)" }}>{item.value}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: "12px", background: "rgba(0,212,255,0.05)", borderRadius: 8, border: "1px solid rgba(0,212,255,0.15)", fontSize: "0.75rem", color: "var(--text)" }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--accent)" }}>📊 Device Info</div>
              <div>• Type: {selectedDevice.device_type}</div>
              <div>• Monitors: HR, SpO₂, BP, Temperature</div>
              <div>• Syncs every 30 seconds via BLE/WiFi</div>
              <div>• Firmware: {selectedDevice.firmware_version || "Latest"}</div>
              <div style={{ marginTop: 8, color: selectedDevice.status?.toLowerCase() === "active" ? "var(--accent2)" : "var(--warn)" }}>
                ● {selectedDevice.status?.toLowerCase() === "active" ? "Device actively transmitting data" : "Device offline — check connection"}
              </div>
            </div>
            <button className="btn-primary" style={{ width: "100%", marginTop: 16 }} onClick={() => setSelectedDevice(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   APPOINTMENTS PAGE
═══════════════════════════════════════════════════════ */
function AppointmentsPage({ currentUser, addToast, patients }) {
  const [appointments, setAppointments] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [activeModal, setActiveModal] = useState(null); // "chat" | "call"
  const [activeAppt, setActiveAppt] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState("");
  const [form, setForm] = useState({ patient_id: "", title: "", scheduled_at: "", duration_mins: 30, notes: "" });
  const msgEndRef = useRef(null);
  const isDoctor = currentUser?.role === "doctor";

  useEffect(() => { loadAppointments(); }, [currentUser]);

  useEffect(() => {
    if (!activeAppt || activeModal !== "chat") return;
    loadMessages();
    const t = setInterval(loadMessages, 3000);
    return () => clearInterval(t);
  }, [activeAppt, activeModal]);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadAppointments = async () => {
    try {
      const data = isDoctor
        ? await getDoctorAppointments(currentUser.id)
        : await getPatientAppointments(currentUser.patientDbId);
      setAppointments(data);
    } catch (e) {}
  };

  const loadMessages = async () => {
    if (!activeAppt) return;
    try { setMessages(await getMessages(activeAppt.id)); } catch (e) {}
  };

  const handleCreate = async () => {
    if (!form.patient_id || !form.title || !form.scheduled_at) {
      addToast("⚠️", "Error", "All fields required", "warn"); return;
    }
    // Past date validation — timezone safe
    const selectedDate = new Date(form.scheduled_at);
    const now = new Date();
    if (selectedDate.getTime() <= now.getTime()) {
      addToast("❌", "Invalid Date", `Cannot book for past date! Today is ${now.toLocaleDateString('en-IN')}. Please select a future date.`, "danger");
      setForm({ ...form, scheduled_at: "" });
      return;
    }
    try {
      await createAppointment({ ...form, doctor_id: currentUser.id, patient_id: parseInt(form.patient_id) });
      addToast("✅", "Appointment Created!", "Patient will be notified", "ok");
      setShowForm(false);
      setForm({ patient_id: "", title: "", scheduled_at: "", duration_mins: 30, notes: "" });
      loadAppointments();
    } catch (e) { addToast("❌", "Error", "Failed to create", "err"); }
  };

  const handleStatus = async (id, status) => {
    await updateAppointmentStatus(id, status);
    addToast("✅", `Appointment ${status}`, "", "ok");
    loadAppointments();
  };

  const handleSendMsg = async () => {
    if (!newMsg.trim()) return;
    await sendMessage({ appointment_id: activeAppt.id, sender_id: currentUser.id, sender_role: currentUser.role, message: newMsg });
    setNewMsg("");
    loadMessages();
  };

  const openModal = (appt, mode) => { setActiveAppt(appt); setActiveModal(mode); };
  const closeModal = () => { setActiveAppt(null); setActiveModal(null); setMessages([]); };
  const statusColor = (s) => s === "accepted" ? "var(--accent2)" : s === "rejected" ? "var(--danger)" : s === "completed" ? "var(--accent)" : "var(--warn)";

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <div className="page-title">📅 Telemedicine</div>
          <div className="page-sub">{appointments.length} appointments</div>
        </div>
        {isDoctor && (
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? "✕ Cancel" : "+ New Appointment"}
          </button>
        )}
      </div>

      {/* Create Form */}
      {showForm && isDoctor && (
        <div className="card mb20">
          <div className="card-title">📋 Create New Appointment</div>
          <div className="g2">
            <div className="f-group">
              <label className="f-label">Patient</label>
              <select className="f-input" value={form.patient_id} onChange={e => setForm({ ...form, patient_id: e.target.value })}>
                <option value="">Select Patient</option>
                {patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">Title</label>
              <select className="f-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}>
                <option value="">Select Appointment Type</option>
                <option>Initial Consultation</option>
                <option>Follow-up Checkup</option>
                <option>ECG Review</option>
                <option>Medication Review</option>
                <option>Lab Results Discussion</option>
                <option>Emergency Consultation</option>
                <option>General Checkup</option>
              </select>
            </div>
            <div className="f-group">
              <label className="f-label">Date & Time</label>
              <input className="f-input" type="datetime-local" value={form.scheduled_at} min={(() => { const n = new Date(); n.setMinutes(n.getMinutes() - n.getTimezoneOffset()); return n.toISOString().slice(0,16); })()} onChange={e => setForm({ ...form, scheduled_at: e.target.value })} />
            </div>
            <div className="f-group">
              <label className="f-label">Duration (mins)</label>
              <input className="f-input" type="number" value={form.duration_mins} onChange={e => setForm({ ...form, duration_mins: parseInt(e.target.value) })} />
            </div>
          </div>
          <div className="f-group">
            <label className="f-label">Notes</label>
            <textarea className="f-input" placeholder="Patient symptoms, special instructions, medicine details..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} style={{ resize: "vertical", lineHeight: 1.5 }} />
          </div>
          <button className="btn-primary" onClick={handleCreate}>Create Appointment →</button>
        </div>
      )}

      {/* ── MODAL OVERLAY ── */}
      {activeAppt && activeModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 18, width: "100%", maxWidth: (activeModal === "call" || activeModal === "audio") ? "95vw" : 540, height: (activeModal === "call" || activeModal === "audio") ? "92vh" : 580, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>

            {/* Modal Header */}
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--panel2)" }}>
              <div>
                <div style={{ fontWeight: 600, color: "var(--text-bright)", fontSize: "0.95rem" }}>
                  {activeModal === "chat" ? "💬" : activeModal === "call" ? "📹" : "🎙️"} {activeAppt.title}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: 2 }}>
                  {isDoctor ? activeAppt.patient_name : `Dr. ${activeAppt.doctor_name}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {/* Switch tabs */}
                {activeAppt.status === "accepted" && <>
                  <button onClick={() => setActiveModal("call")} style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${activeModal === "call" ? "var(--accent2)" : "var(--border)"}`, background: activeModal === "call" ? "rgba(0,255,157,0.1)" : "transparent", color: activeModal === "call" ? "var(--accent2)" : "var(--text-dim)", cursor: "pointer", fontSize: "0.68rem", fontFamily: "var(--mono)" }}>📹 VIDEO</button>
                  <button onClick={() => setActiveModal("audio")} style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${activeModal === "audio" ? "var(--accent)" : "var(--border)"}`, background: activeModal === "audio" ? "rgba(0,212,255,0.1)" : "transparent", color: activeModal === "audio" ? "var(--accent)" : "var(--text-dim)", cursor: "pointer", fontSize: "0.68rem", fontFamily: "var(--mono)" }}>🎙️ AUDIO</button>
                  <button onClick={() => setActiveModal("chat")} style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${activeModal === "chat" ? "var(--warn)" : "var(--border)"}`, background: activeModal === "chat" ? "rgba(255,140,66,0.1)" : "transparent", color: activeModal === "chat" ? "var(--warn)" : "var(--text-dim)", cursor: "pointer", fontSize: "0.68rem", fontFamily: "var(--mono)" }}>💬 CHAT</button>
                </>}
                <button onClick={closeModal} style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", cursor: "pointer", fontSize: "0.8rem" }}>✕</button>
              </div>
            </div>

            {/* ── VIDEO CALL ── */}
            {activeModal === "call" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <iframe
                  src={(() => {
                    const name = encodeURIComponent((isDoctor ? "Dr. " : "") + currentUser.fname + " " + (currentUser.lname || ""));
                    return `${activeAppt.meet_link}#userInfo.displayName="${name}"&config.startWithVideoMuted=false&config.startWithAudioMuted=false&config.enableNoisyMicDetection=false&config.disableAudioLevels=false&interfaceConfig.SHOW_JITSI_WATERMARK=false`;
                  })()}
                  allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write; speaker-selection"
                  style={{ flex: 1, border: "none", width: "100%", height: "100%" }}
                  title="Video Call"
                  allowFullScreen
                />
              </div>
            )}

            {/* ── AUDIO CALL ── */}
            {activeModal === "audio" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <iframe
                  src={(() => {
                    const name = encodeURIComponent((isDoctor ? "Dr. " : "") + currentUser.fname + " " + (currentUser.lname || ""));
                    return `${activeAppt.meet_link}#userInfo.displayName="${name}"&config.startWithVideoMuted=true&config.startWithAudioMuted=false&config.enableNoisyMicDetection=false&config.disableAudioLevels=false&interfaceConfig.SHOW_JITSI_WATERMARK=false`;
                  })()}
                  allow="camera; microphone; fullscreen; autoplay; clipboard-write; speaker-selection"
                  style={{ flex: 1, border: "none", width: "100%", height: "100%" }}
                  title="Audio Call"
                  allowFullScreen
                />
              </div>
            )}

            {/* ── CHAT ── */}
            {activeModal === "chat" && (
              <>
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {messages.length === 0
                    ? <div style={{ textAlign: "center", color: "var(--text-dim)", marginTop: 60, fontSize: "0.85rem" }}>No messages yet. Say hello! 👋</div>
                    : messages.map((m, i) => {
                      const isMine = m.sender_id === currentUser.id;
                      return (
                        <div key={i} style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start" }}>
                          <div style={{ maxWidth: "72%", padding: "10px 14px", borderRadius: isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px", background: isMine ? "rgba(0,212,255,0.14)" : "var(--panel2)", border: `1px solid ${isMine ? "rgba(0,212,255,0.3)" : "var(--border)"}` }}>
                            <div style={{ fontSize: "0.65rem", color: "var(--text-dim)", marginBottom: 4 }}>{m.sender_name}</div>
                            <div style={{ fontSize: "0.85rem", color: "var(--text-bright)", lineHeight: 1.45 }}>{m.message}</div>
                            <div style={{ fontSize: "0.58rem", color: "var(--text-dim)", marginTop: 5, textAlign: "right" }}>{new Date(m.sent_at).toLocaleTimeString()}</div>
                          </div>
                        </div>
                      );
                    })}
                  <div ref={msgEndRef} />
                </div>
                <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 10 }}>
                  <input className="f-input" placeholder="Type a message..." value={newMsg}
                    onChange={e => setNewMsg(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSendMsg()}
                    style={{ flex: 1 }} />
                  <button className="btn-primary" style={{ padding: "10px 18px" }} onClick={handleSendMsg}>➤</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Appointments List */}
      {appointments.length === 0
        ? <div className="card" style={{ textAlign: "center", padding: "60px 0", color: "var(--text-dim)" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: 12 }}>📅</div>
            No appointments yet
          </div>
        : appointments.map((a, i) => (
          <div key={i} className="card mb16" style={{ borderLeft: `3px solid ${statusColor(a.status)}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-bright)", marginBottom: 5 }}>{a.title}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>👤 {isDoctor ? a.patient_name : `Dr. ${a.doctor_name}`}</div>
                {a.patient_condition && <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 2 }}>🏥 {a.patient_condition}</div>}
                <div style={{ fontFamily: "var(--mono)", fontSize: "0.68rem", color: "var(--accent)", marginTop: 6 }}>
                  🕐 {new Date(a.scheduled_at).toLocaleString()} · {a.duration_mins} mins
                </div>
                {a.notes && <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 4 }}>📝 {a.notes}</div>}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                <span style={{ padding: "3px 10px", borderRadius: 4, fontSize: "0.6rem", fontFamily: "var(--mono)", background: `${statusColor(a.status)}22`, color: statusColor(a.status), border: `1px solid ${statusColor(a.status)}55` }}>
                  {a.status?.toUpperCase()}
                </span>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {isDoctor && a.status === "pending" && <>
                    <button className="btn-primary" style={{ fontSize: "0.62rem", padding: "6px 12px" }} onClick={() => handleStatus(a.id, "accepted")}>✅ Accept</button>
                    <button className="btn-danger-outline" style={{ fontSize: "0.62rem", padding: "6px 12px" }} onClick={() => handleStatus(a.id, "rejected")}>❌ Reject</button>
                  </>}

                  {a.status === "accepted" && <>
                    <button style={{ fontSize: "0.62rem", padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(0,255,157,0.4)", background: "rgba(0,255,157,0.1)", color: "var(--accent2)", cursor: "pointer", fontFamily: "var(--mono)" }}
                      onClick={() => openModal(a, "call")}>📹 Video</button>
                    <button style={{ fontSize: "0.62rem", padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(0,212,255,0.4)", background: "rgba(0,212,255,0.1)", color: "var(--accent)", cursor: "pointer", fontFamily: "var(--mono)" }}
                      onClick={() => openModal(a, "audio")}>🎙️ Audio</button>
                  </>}

                  <button className="btn-outline" style={{ fontSize: "0.62rem", padding: "6px 12px" }}
                    onClick={() => openModal(a, "chat")}>💬 Chat</button>

                  {isDoctor && a.status === "accepted" && (
                    <button className="btn-outline" style={{ fontSize: "0.62rem", padding: "6px 12px" }} onClick={() => handleStatus(a.id, "completed")}>✔ Done</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════
   ML RISK PAGE — DOCTOR
═══════════════════════════════════════════════════════ */
function MLRiskPage({ patients, addToast }) {
  const [patientRisks, setPatientRisks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [filterLabel, setFilterLabel] = useState(null);

  useEffect(() => {
    const risks = patients.map(p => {
      const base = PATIENTS_DATASET.find(d => d.name.toLowerCase().includes(p.name?.split(" ")[0]?.toLowerCase())) || PATIENTS_DATASET[0];
      const hist = Array.from({ length: 10 }, () => genLiveVitals(base));
      const risk = mlRisk(hist);
      return { ...p, risk, hist };
    });
    setPatientRisks(risks);
    if (risks.length > 0) { setSelected(risks[0]); setHistory(risks[0].hist); }
  }, [patients]);

  useEffect(() => {
    const t = setInterval(() => {
      setPatientRisks(prev => prev.map(p => {
        const base = PATIENTS_DATASET.find(d => d.name.toLowerCase().includes(p.name?.split(" ")[0]?.toLowerCase())) || PATIENTS_DATASET[0];
        const newVital = genLiveVitals(base);
        const newHist = [...p.hist.slice(-19), newVital];
        const risk = mlRisk(newHist);
        const updated = { ...p, risk, hist: newHist };
        if (selected?.id === p.id) { setSelected(updated); setHistory(newHist); }
        return updated;
      }));
    }, 2500);
    return () => clearInterval(t);
  }, [selected]);

  const riskOrder = { CRITICAL: 0, "HIGH RISK": 1, MODERATE: 2, STABLE: 3, "Loading...": 4 };
  const sorted = [...patientRisks]
    .filter(p => !filterLabel || p.risk?.label === filterLabel)
    .sort((a, b) => (riskOrder[a.risk?.label] ?? 4) - (riskOrder[b.risk?.label] ?? 4));
  const chartData = history.map((v, i) => ({ t: i, hr: v.hr, spo2: v.spo2, bp: v.bp_sys }));

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <div className="page-title">🤖 ML Risk Prediction</div>
          <div className="page-sub">Real-time AI risk analysis — {patients.length} patients</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["CRITICAL","HIGH RISK","MODERATE","STABLE"].map(l => (
            <div key={l} onClick={() => setFilterLabel(filterLabel === l ? null : l)}
              style={{ padding: "5px 12px", borderRadius: 6, fontSize: "0.62rem", fontFamily: "var(--mono)",
              cursor: "pointer", transition: "all 0.2s",
              opacity: filterLabel && filterLabel !== l ? 0.4 : 1,
              transform: filterLabel === l ? "scale(1.06)" : "scale(1)",
              background: l==="CRITICAL"?"rgba(255,45,85,0.1)":l==="HIGH RISK"?"rgba(255,107,53,0.1)":l==="MODERATE"?"rgba(255,140,66,0.1)":"rgba(0,255,157,0.1)",
              color: l==="CRITICAL"?"#ff2d55":l==="HIGH RISK"?"#ff6b35":l==="MODERATE"?"#ff8c42":"#00ff9d",
              border: filterLabel === l
                ? `2px solid ${l==="CRITICAL"?"#ff2d55":l==="HIGH RISK"?"#ff6b35":l==="MODERATE"?"#ff8c42":"#00ff9d"}`
                : `1px solid ${l==="CRITICAL"?"rgba(255,45,85,0.3)":l==="HIGH RISK"?"rgba(255,107,53,0.3)":l==="MODERATE"?"rgba(255,140,66,0.3)":"rgba(0,255,157,0.3)"}` }}>
              {patientRisks.filter(p => p.risk?.label === l).length} {l}{filterLabel === l ? " ✕" : ""}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((p, i) => (
            <div key={i} onClick={() => { setSelected(p); setHistory(p.hist); }}
              style={{ padding: "12px 14px", borderRadius: 10, cursor: "pointer", transition: "all 0.2s",
                background: selected?.id === p.id ? "rgba(0,212,255,0.08)" : "var(--panel)",
                border: `1px solid ${selected?.id === p.id ? "var(--accent)" : p.risk?.color+"44"}`,
                borderLeft: `3px solid ${p.risk?.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-bright)" }}>{p.name}</div>
                <span style={{ fontFamily: "var(--mono)", fontSize: "0.58rem", padding: "2px 8px", borderRadius: 4,
                  background: p.risk?.color+"22", color: p.risk?.color, border: `1px solid ${p.risk?.color}55` }}>
                  {p.risk?.label}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${p.risk?.score}%`, background: p.risk?.color, borderRadius: 2, transition: "width 1s" }} />
                </div>
                <span style={{ fontFamily: "var(--mono)", fontSize: "0.7rem", color: p.risk?.color, minWidth: 28 }}>{p.risk?.score}</span>
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-dim)", marginTop: 4 }}>{p.condition}</div>
            </div>
          ))}
        </div>

        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card">
              <div style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
                <RiskRing score={selected.risk?.score} label={selected.risk?.label} color={selected.risk?.color} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-bright)", marginBottom: 4 }}>{selected.name}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: 14 }}>{selected.condition} · {selected.age} yrs · {selected.gender}</div>
                  <RiskBar label="Cardiac Risk" pct={selected.risk?.cardiac} fillClass={selected.risk?.cardiac > 60 ? "rf-high" : selected.risk?.cardiac > 30 ? "rf-med" : "rf-low"} />
                  <RiskBar label="Respiratory Risk" pct={selected.risk?.respiratory} fillClass={selected.risk?.respiratory > 60 ? "rf-high" : selected.risk?.respiratory > 30 ? "rf-med" : "rf-low"} />
                  <RiskBar label="Deterioration Risk" pct={selected.risk?.deterioration} fillClass={selected.risk?.deterioration > 60 ? "rf-high" : selected.risk?.deterioration > 30 ? "rf-med" : "rf-low"} />
                </div>
              </div>
            </div>
            <div className="card">
              <div className="card-title">🧠 AI Clinical Insights</div>
              {selected.risk?.insights?.map((insight, i) => (
                <div key={i} style={{ padding: "9px 12px", marginBottom: 6, borderRadius: 8, fontSize: "0.8rem",
                  background: insight.startsWith("🔴") ? "rgba(255,45,85,0.07)" : insight.startsWith("🟡") ? "rgba(255,140,66,0.07)" : "rgba(0,255,157,0.05)",
                  border: insight.startsWith("🔴") ? "1px solid rgba(255,45,85,0.25)" : insight.startsWith("🟡") ? "1px solid rgba(255,140,66,0.25)" : "1px solid rgba(0,255,157,0.2)",
                  color: "var(--text)" }}>{insight}</div>
              ))}
            </div>
            <div className="card">
              <div className="card-title">📈 Live Vitals Trend — {selected.name}</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="t" hide />
                  <YAxis tick={{ fill: "var(--text-dim)", fontSize: 9 }} />
                  <Tooltip contentStyle={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="hr" stroke="#ff2d55" strokeWidth={2} dot={false} name="HR" isAnimationActive={false} />
                  <Line type="monotone" dataKey="spo2" stroke="#00ff9d" strokeWidth={2} dot={false} name="SpO2" isAnimationActive={false} />
                  <Line type="monotone" dataKey="bp" stroke="#00d4ff" strokeWidth={2} dot={false} name="BP" isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsPage({ addToast, currentUser }) {
  const storageKey = `medipulse_settings_${currentUser?.id || "guest"}`;
  const profileKey = `medipulse_profile_${currentUser?.id || "guest"}`;

  // Load notif settings from localStorage
  const [notifSettings, setNotifSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : { criticalAlerts: true, mlRiskAlerts: true, appointmentReminders: true };
    } catch { return { criticalAlerts: true, mlRiskAlerts: true, appointmentReminders: true }; }
  });

  // Load profile from localStorage (fallback to currentUser)
  const [profile, setProfile] = useState(() => {
    try {
      const saved = localStorage.getItem(profileKey);
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      name: `${currentUser?.fname || ""} ${currentUser?.lname || ""}`.trim(),
      email: currentUser?.email || "",
    };
  });
  const [saved, setSaved] = useState(false);

  // Persist notif settings whenever they change
  function handleToggle(key) {
    setNotifSettings(prev => {
      const updated = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(storageKey, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }

  function handleSaveProfile() {
    try { localStorage.setItem(profileKey, JSON.stringify(profile)); } catch {}
    setSaved(true);
    addToast("✅", "Profile Saved!", "Changes saved successfully", "ok");
    setTimeout(() => setSaved(false), 2500);
  }

  const notifList = [
    { key: "criticalAlerts", name: "Critical Alert Notifications", desc: "SMS + email for danger vitals" },
    { key: "mlRiskAlerts", name: "ML Risk Alerts", desc: "Notify when risk exceeds 60%" },
    { key: "appointmentReminders", name: "Appointment Reminders", desc: "30 min before scheduled call" },
  ];

  return (
    <div className="page-wrap">
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">Manage your preferences and profile</div>
        </div>
      </div>
      <div className="g2">
        {/* Notifications */}
        <div className="card mb16">
          <div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "var(--text-dim)", letterSpacing: 2, marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>NOTIFICATIONS</div>
          {notifList.map(s => (
            <div className="setting-row" key={s.key}>
              <div>
                <div className="setting-name">{s.name}</div>
                <div className="setting-desc">{s.desc}</div>
              </div>
              <label className="toggle-wrap" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={notifSettings[s.key]} onChange={() => handleToggle(s.key)} />
                <div className="toggle-slider" />
              </label>
            </div>
          ))}
          <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 8, background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.15)", fontSize: "0.72rem" }}>
            <div style={{ color: "var(--accent)", fontFamily: "var(--mono)", fontSize: "0.6rem", marginBottom: 6 }}>● ACTIVE STATUS</div>
            {notifList.filter(s => notifSettings[s.key]).map(s => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, color: "var(--text-dim)" }}>
                <span style={{ color: "var(--accent2)" }}>✓</span> {s.name}
              </div>
            ))}
            {notifList.every(s => !notifSettings[s.key]) && (
              <div style={{ color: "var(--danger)" }}>⚠ All notifications disabled</div>
            )}
          </div>
        </div>

        {/* Profile - Read Only */}
        <div className="card">
          <div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "var(--text-dim)", letterSpacing: 2, marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>ACCOUNT INFO</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { label: "NAME", value: `${currentUser?.fname || ""} ${currentUser?.lname || ""}`.trim() || "—", icon: "👤" },
              { label: "EMAIL", value: currentUser?.email || "—", icon: "📧" },
              { label: "ROLE", value: currentUser?.role === "doctor" ? "🩺 Doctor" : "🫀 Patient", icon: "" },
              { label: "USER ID", value: currentUser?.id ? `#${currentUser.id}` : "—", icon: "🔖" },
            ].map(f => (
              <div key={f.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 14px", borderRadius: 9, background: "var(--panel2)", border: "1px solid var(--border)" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", color: "var(--text-dim)", letterSpacing: 1 }}>{f.icon} {f.label}</span>
                <span style={{ fontSize: "0.83rem", color: "var(--text-bright)", fontWeight: 500 }}>{f.value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, padding: "9px 13px", borderRadius: 8, background: "rgba(0,212,255,0.05)", border: "1px solid rgba(0,212,255,0.15)", fontSize: "0.7rem", color: "var(--text-dim)", lineHeight: 1.5 }}>
            ℹ️ Account details are managed by your hospital. Contact admin to update your profile.
          </div>
        </div>
      </div>

      {/* System Info */}
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ fontFamily: "var(--mono)", fontSize: "0.62rem", color: "var(--text-dim)", letterSpacing: 2, marginBottom: 14 }}>SYSTEM INFO</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
          {[
            { label: "Platform", value: "MediPulse RPM v2.0" },
            { label: "Database", value: "PostgreSQL ● Connected" },
            { label: "ML Model", value: "Risk Score v1.3" },
            { label: "Last Sync", value: new Date().toLocaleTimeString() },
          ].map((item, i) => (
            <div key={i} style={{ padding: "10px 12px", borderRadius: 8, background: "var(--panel2)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "0.6rem", color: "var(--text-dim)", marginBottom: 3, fontFamily: "var(--mono)" }}>{item.label}</div>
              <div style={{ fontSize: "0.78rem", color: "var(--accent2)" }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════ */
export default function App() {
  const [screen, setScreen] = useState("login");
  const [currentUser, setUser] = useState(null);
  const [activePage, setPage] = useState("dashboard");
  const [toasts, setToasts] = useState([]);
  const [clock, setClock] = useState("");
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const toastId = useRef(0);
  const lastEmailAlert = useRef({}); // rate limit emails
  const doctorWsRef = useRef(null); // doctor WebSocket for voice alerts
  const [voiceAlerts, setVoiceAlerts] = useState([]); // real-time voice alerts from patients // { patientId: timestamp } - rate limit emails

  const [liveVitals, setLive] = useState(() => genLiveVitals(PATIENTS_DATASET[0]));
  const [hrData, setHrData] = useState(() => genSparkData(112, 12));
  const [spo2Data, setSpo2] = useState(() => genSparkData(93, 3));
  const [bpData, setBp] = useState(() => genSparkData(135, 8));

  const [patientVitals, setPatientVitals] = useState(null);
  const [patientHistory, setPatientHistory] = useState([]);
  const [patientAlerts, setPatientAlerts] = useState([]);
  const [myPatientData, setMyPatientData] = useState(null);
  const [selectedDashPatient, setSelectedDashPatient] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString("en-IN", { hour12: false })), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (screen !== "app") return;
    const t = setInterval(() => {
      const v = genLiveVitals(PATIENTS_DATASET[0]);
      setLive(v);
      setHrData(d => [...d.slice(1), { v: v.hr }]);
      setSpo2(d => [...d.slice(1), { v: v.spo2 }]);
      setBp(d => [...d.slice(1), { v: v.bp_sys }]);
    }, 6000);
    return () => clearInterval(t);
  }, [screen]);

  useEffect(() => {
    if (screen !== "app" || currentUser?.role !== "doctor") return;
    getPatients().then(setPatients).catch(() => {});
  }, [screen, currentUser]);

  useEffect(() => {
    if (screen !== "app" || currentUser?.role !== "patient") return;
    fetch("http://localhost:8000/api/doctors")
      .then(r => r.json())
      .then(setDoctors)
      .catch(() => {});
  }, [screen, currentUser]);

  useEffect(() => {
    if (screen !== "app" || currentUser?.role !== "patient") return;
    // Load doctors list for patient to request appointments
    fetch("http://localhost:8000/api/doctors")
      .then(r => r.json())
      .then(setDoctors)
      .catch(() => {});
  }, [screen, currentUser]);

  useEffect(() => {
    if (screen !== "app" || !currentUser || currentUser.role !== "patient") return;

    // Build patient data from registered user info
    const registeredPatient = {
      id: currentUser.patientDbId || "P-0000",
      name: `${currentUser.fname} ${currentUser.lname}`,
      age: currentUser.age || 25,
      gender: currentUser.gender || "Unknown",
      condition: currentUser.condition || "General",
      doctor: currentUser.doctor_name || "Dr. Assigned",
      baseline: { hr: 80, bp_sys: 120, bp_dia: 80, spo2: 97, temp: 36.8 }
    };

    // Use PATIENTS_DATASET baseline if name matches, else use registered defaults
    const matched = PATIENTS_DATASET.find(p =>
      p.name.toLowerCase().includes(currentUser.fname?.toLowerCase())
    );
    const staticPatient = matched
      ? { ...matched, name: `${currentUser.fname} ${currentUser.lname}` }
      : registeredPatient;

    setMyPatientData(staticPatient);

    if (currentUser.patientDbId) {
      getAlerts(currentUser.patientDbId).then(setPatientAlerts).catch(() => {});
    }

    const init = Object.freeze({ ...genLiveVitals(staticPatient) });
    setPatientVitals(init);
    setPatientHistory([init]);

    const t = setInterval(() => {
      const v = Object.freeze({ ...genLiveVitals(staticPatient) }); // freeze snapshot — every 8s
      setPatientVitals(v);
      setPatientHistory(h => [...h.slice(-49), v]);

      if (currentUser.patientDbId) {
        const pid = currentUser.patientDbId;
        const isAnomaly = v.hr > 105 || v.spo2 < 94;
        // Rate-limit email alerts: only send once every 5 minutes per patient
        const now = Date.now();
        const lastSent = lastEmailAlert.current[pid] || 0;
        const shouldSendEmail = isAnomaly && (now - lastSent > 5 * 60 * 1000);
        if (shouldSendEmail) lastEmailAlert.current[pid] = now;

        postVital({
          patient_id: pid,
          heart_rate: v.hr,
          bp_systolic: v.bp_sys,
          bp_diastolic: v.bp_dia,
          spo2: v.spo2,
          temperature: v.temp,
          glucose: 0,
          is_anomaly: shouldSendEmail, // only true once per 5 min
        }).catch(() => {});
      }

      const newAlerts = checkVitalAlert(v);
      if (newAlerts.length > 0) {
        setPatientAlerts(a => [
          ...newAlerts.map(al => ({ ...al, message: al.msg, alert_type: al.type === "danger" ? "CRITICAL" : "HIGH", created_at: new Date().toLocaleTimeString() })),
          ...a,
        ].slice(0, 20));
      }
    }, 8000);
    return () => clearInterval(t);
  }, [screen, currentUser]);

  // Doctor WebSocket — listen for patient voice alerts
  useEffect(() => {
    if (!currentUser || currentUser.role !== "doctor") return;
    let ws;
    try {
      ws = new WebSocket("ws://localhost:8000/ws/doctor");
      ws.onopen = () => console.log("✅ Doctor WS connected");
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "VOICE_ALERT") {
            setVoiceAlerts(prev => [data, ...prev].slice(0, 10));
            // Auto-dismiss after 15s
            setTimeout(() => setVoiceAlerts(prev => prev.filter(a => a.timestamp !== data.timestamp)), 15000);
          }
        } catch {}
      };
      ws.onerror = () => console.log("Doctor WS error");
      doctorWsRef.current = ws;
    } catch (e) { console.log("WS not available"); }
    return () => { if (ws) ws.close(); };
  }, [currentUser]);

  const addToast = useCallback((icon, title, msg, type = "info") => {
    const id = ++toastId.current;
    setToasts(t => [...t, { id, icon, title, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, []);

  const removeToast = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);

  const handleLogin = (u) => {
    setUser(u);
    setPage("dashboard");
    setScreen("app");
    addToast("✅", `Welcome, ${u.fname}!`, u.role === "patient" ? "Your dashboard is ready" : "Doctor dashboard loaded", "ok");
  };

  // Doctor WebSocket — receive real-time voice alerts from patients
  useEffect(() => {
    if (screen !== "app" || currentUser?.role !== "doctor") return;

    let ws;
    let reconnectTimer;

    function connectDoctorWS() {
      try {
        ws = new WebSocket("ws://localhost:8000/ws/doctor");
        ws.onopen = () => {
          console.log("✅ Doctor WS connected");
          // keep-alive ping every 25s
          const ping = setInterval(() => { try { if (ws.readyState === WebSocket.OPEN) ws.send("ping"); } catch {} }, 25000);
          ws._ping = ping;
          doctorWsRef.current = ws;
        };
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            // Accept both VOICE_ALERT and voice_alert (case-insensitive)
            const isVoice = msg.type === "VOICE_ALERT" || msg.type === "voice_alert";
            if (isVoice) {
              const alertWithId = { ...msg, _id: Date.now() };
              setVoiceAlerts(prev => [alertWithId, ...prev].slice(0, 10));
              // Auto-dismiss after 30 seconds
              setTimeout(() => setVoiceAlerts(prev => prev.filter(a => a._id !== alertWithId._id)), 30000);
              addToast(
                msg.alert_type === "CRITICAL" ? "🚨" : "⚠️",
                `🎙️ Voice Alert: ${msg.patient_name}`,
                msg.message || msg.transcript,
                msg.alert_type === "CRITICAL" ? "danger" : "warn"
              );
            }
          } catch {}
        };
        ws.onerror = () => console.log("Doctor WS error");
        ws.onclose = () => {
          if (ws._ping) clearInterval(ws._ping);
          doctorWsRef.current = null;
          // Auto-reconnect after 3s
          reconnectTimer = setTimeout(connectDoctorWS, 3000);
        };
      } catch (e) {
        reconnectTimer = setTimeout(connectDoctorWS, 3000);
      }
    }

    connectDoctorWS();

    // Also poll localStorage every 2s as fallback (when WebSocket not available)
    const localPoll = setInterval(() => {
      try {
        const key = "voice_alerts_doctor";
        const stored = JSON.parse(localStorage.getItem(key) || "[]");
        if (stored.length > 0) {
          localStorage.removeItem(key); // clear FIRST before setState (prevent re-read)
          setVoiceAlerts(prev => {
            let updated = [...prev];
            stored.forEach(msg => {
              // strict duplicate check by timestamp
              if (updated.some(a => a.timestamp === msg.timestamp)) return;
              const alertWithId = { ...msg, _id: msg.timestamp, type: "VOICE_ALERT" };
              setTimeout(() => setVoiceAlerts(p => p.filter(a => a._id !== alertWithId._id)), 30000);
              updated = [alertWithId, ...updated];
            });
            return updated.slice(0, 10);
          });
        }
      } catch {}
    }, 2000);

    return () => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(localPoll);
    };
  }, [screen, currentUser]);

  const DOCTOR_NAV = [
    { id: "dashboard", icon: "📊", label: "Dashboard" },
    { id: "patients", icon: "👤", label: "Patients", badge: patients.length || null },
    { id: "alerts", icon: "🔔", label: "Alerts", badge: voiceAlerts.length > 0 ? voiceAlerts.length : null },
    { id: "appointments", icon: "📅", label: "Appointments" },
    { id: "mlrisk", icon: "🤖", label: "ML Risk" },
    { id: "devices", icon: "📡", label: "Devices" },
    { id: "settings", icon: "⚙️", label: "Settings" },
  ];
  const PATIENT_NAV = [
    { id: "dashboard", icon: "💓", label: "My Dashboard" },
    { id: "appointments", icon: "📅", label: "Appointments" },
    { id: "devices", icon: "📡", label: "My Device" },
    { id: "settings", icon: "⚙️", label: "Settings" },
  ];
  const NAV = currentUser?.role === "doctor" ? DOCTOR_NAV : PATIENT_NAV;

  return (
    <>
      <style>{STYLES}</style>
      <div className="grid-bg" />
      {/* Voice Alert Popup — Doctor receives patient voice alerts in real-time */}
      {currentUser?.role === "doctor" && voiceAlerts.length > 0 && (
        <div style={{ position: "fixed", top: 80, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
          {voiceAlerts.map((a, i) => (
            <div key={i} style={{
              padding: "14px 16px", borderRadius: 12,
              background: a.alert_type === "CRITICAL" ? "rgba(20,5,5,0.97)" : "rgba(10,10,20,0.97)",
              border: `2px solid ${a.alert_type === "CRITICAL" ? "#ff2d55" : "#ff8c42"}`,
              boxShadow: `0 0 24px ${a.alert_type === "CRITICAL" ? "rgba(255,45,85,0.5)" : "rgba(255,140,66,0.4)"}`,
              animation: "toastIn 0.3s ease",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: a.alert_type === "CRITICAL" ? "#ff2d55" : "#ff8c42", marginBottom: 6 }}>
                  {a.alert_type === "CRITICAL" ? "🚨 CRITICAL" : "⚠️ HIGH"} — VOICE ALERT
                </div>
                <button onClick={() => setVoiceAlerts(prev => prev.filter((_, j) => j !== i))}
                  style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "1rem" }}>✕</button>
              </div>
              <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-bright)", marginBottom: 4 }}>
                🧑‍⚕️ {a.patient_name}
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--text)", marginBottom: 6 }}>{a.message}</div>
              {a.transcript && (
                <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", fontStyle: "italic", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6 }}>
                  🎙️ "{a.transcript}"
                </div>
              )}
              <div style={{ fontSize: "0.6rem", color: "var(--text-dim)", marginTop: 6, fontFamily: "var(--mono)" }}>
                {new Date(a.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      )}

      <ToastManager toasts={toasts} remove={removeToast} />

      {screen === "login" && <LoginPage onLogin={handleLogin} onGoRegister={() => setScreen("register")} />}
      {screen === "register" && <RegisterPage onLogin={handleLogin} onGoLogin={() => setScreen("login")} />}

      {screen === "app" && (
        <>
          <div className="topbar">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div className="logo-dot" />
              <span className="logo-text">MEDIPULSE</span>
            </div>
            <div className="top-right">
              <div className="sys-status"><div className="status-dot" />LIVE</div>
              <div className="clock-display">{clock}</div>
              <div className="user-chip">
                <div className="user-av">{currentUser?.fname?.[0]}{currentUser?.lname?.[0]}</div>
                <span className="user-nm">{currentUser?.role === "doctor" ? "Dr. " : ""}{currentUser?.fname}</span>
              </div>
              <button className="logout-btn" onClick={() => { setUser(null); setScreen("login"); setPage("dashboard"); setPatientVitals(null); setPatientHistory([]); setPatientAlerts([]); }}>LOGOUT</button>
            </div>
          </div>

          <div className="app-layout">
            <aside className="sidebar">
              <div className="sidebar-label">Navigation</div>
              {NAV.map(n => (
                <button key={n.id} className={`nav-btn ${activePage === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
                  <span className="nav-icon">{n.icon}</span>{n.label}
                  {n.badge && <span className="nav-badge">{n.badge}</span>}
                </button>
              ))}

              {currentUser?.role === "doctor" && patients.length > 0 && (
                <>
                  <div className="sidebar-label" style={{ marginTop: 16 }}>Active Patients</div>
                  <div style={{ padding: "0 10px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {patients.slice(0, 5).map(p => (
                      <div key={p.id} style={{ padding: "10px 12px", borderRadius: 8, background: selectedDashPatient?.id === p.id ? "rgba(0,212,255,0.1)" : "var(--panel2)", border: selectedDashPatient?.id === p.id ? "1px solid rgba(0,212,255,0.4)" : "1px solid var(--border)", cursor: "pointer" }}
                        onClick={() => { 
                          setSelectedDashPatient(p); 
                          setPage("dashboard");
                        }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <div style={{ fontSize: "0.8rem", fontWeight: 500, color: selectedDashPatient?.id === p.id ? "var(--accent)" : "var(--text-bright)" }}>{p.name}</div>
                          <span style={{
                            fontSize:"0.5rem", fontFamily:"var(--mono)", fontWeight:700,
                            padding:"1px 5px", borderRadius:3,
                            background: p.risk==="CRITICAL" ? "rgba(255,45,85,0.15)" : p.risk==="HIGH" ? "rgba(255,140,66,0.15)" : "rgba(0,230,118,0.1)",
                            color: p.risk==="CRITICAL" ? "#ff2d55" : p.risk==="HIGH" ? "#ff8c42" : "#00e676",
                          }}>
                            {p.risk==="CRITICAL" ? "🔴" : p.risk==="HIGH" ? "🟡" : "🟢"} {p.risk==="HIGH" ? "SERIOUS" : p.risk || "NORMAL"}
                          </span>
                        </div>
                        <div style={{ fontSize: "0.67rem", color: "var(--text-dim)", fontFamily: "var(--mono)", marginTop: 2 }}>{p.patient_id}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {currentUser?.role === "patient" && patientVitals && myPatientData && (
                <>
                  <div className="sidebar-label" style={{ marginTop: 16 }}>My Vitals</div>
                  <div className="pt-identity">
                    <div className="pt-id-avatar">{myPatientData.name.split(" ").map(w => w[0]).join("").slice(0, 2)}</div>
                    <div className="pt-id-name">{myPatientData.name}</div>
                    <div className="pt-id-meta">{myPatientData.condition}</div>
                    <div className="live-vital-mini">
                      <div className="lvm-item">
                        <div className="lvm-val" style={{ color: patientVitals.hr > 100 ? "var(--danger)" : "var(--accent2)" }}>{patientVitals.hr.toFixed(0)}</div>
                        <div className="lvm-lbl">HR</div>
                      </div>
                      <div className="lvm-item">
                        <div className="lvm-val" style={{ color: patientVitals.spo2 < 95 ? "var(--danger)" : "var(--accent2)" }}>{patientVitals.spo2.toFixed(1)}</div>
                        <div className="lvm-lbl">SpO₂</div>
                      </div>
                      <div className="lvm-item">
                        <div className="lvm-val" style={{ color: patientVitals.bp_sys > 140 ? "var(--warn)" : "var(--accent2)" }}>{patientVitals.bp_sys.toFixed(0)}</div>
                        <div className="lvm-lbl">BP</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </aside>

            <div key={activePage + (selectedDashPatient?.id || "")}>
              {/* ── PATIENT PAGES ── */}
              {currentUser?.role === "patient" && activePage === "dashboard" && myPatientData && patientVitals && (
                <PatientDashboard patient={myPatientData} liveVitals={patientVitals} history={patientHistory} alerts={patientAlerts} addToast={addToast} currentUser={currentUser} doctors={doctors} />
              )}
              {currentUser?.role === "patient" && activePage === "appointments" && (
                <AppointmentsPage currentUser={currentUser} addToast={addToast} patients={patients} />
              )}
              {currentUser?.role === "patient" && activePage === "devices" && (
                <DevicesPage currentUser={currentUser} addToast={addToast} />
              )}
              {currentUser?.role === "patient" && activePage === "settings" && (
                <SettingsPage addToast={addToast} currentUser={currentUser} />
              )}
              {/* ── DOCTOR PAGES ── */}
              {currentUser?.role === "doctor" && activePage === "dashboard" && (
                <DoctorDashboard addToast={addToast} liveVitals={liveVitals} hrData={hrData} spo2Data={spo2Data} bpData={bpData} patients={patients} selectedPatient={selectedDashPatient} onSelectPatient={setSelectedDashPatient} />
              )}
              {currentUser?.role === "doctor" && activePage === "patients" && (
                <PatientsPage addToast={addToast} patients={patients} currentUser={currentUser} />
              )}
              {currentUser?.role === "doctor" && activePage === "alerts" && (
                <AlertsPage addToast={addToast} patients={patients} />
              )}
              {currentUser?.role === "doctor" && activePage === "appointments" && (
                <AppointmentsPage currentUser={currentUser} addToast={addToast} patients={patients} />
              )}
              {currentUser?.role === "doctor" && activePage === "mlrisk" && (
                <MLRiskPage patients={patients} addToast={addToast} />
              )}
              {currentUser?.role === "doctor" && activePage === "devices" && (
                <DevicesPage currentUser={currentUser} addToast={addToast} />
              )}
              {currentUser?.role === "doctor" && activePage === "settings" && (
                <SettingsPage addToast={addToast} currentUser={currentUser} />
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
