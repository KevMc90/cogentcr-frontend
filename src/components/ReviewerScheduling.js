import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://rapidnote-backend.onrender.com";
const FONT = "'Public Sans', sans-serif";
const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginBottom: 16 };
const btn = { padding: "7px 14px", borderRadius: 7, border: "none", background: "#1a3a5c", color: "#fff", fontWeight: 600, fontSize: 12, cursor: "pointer" };

/** Reviewer-side P2P availability, specialty/licensure profile, and call-back tasks from assistant handoffs. */
export default function ReviewerScheduling({ token }) {
  const auth = { headers: { Authorization: `Bearer ${token}` } };
  const [profile, setProfile] = useState({ specialty: "PT", licensedStates: "" });
  const [slots, setSlots] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [newSlot, setNewSlot] = useState("");
  const [msg, setMsg] = useState("");
  const [openTask, setOpenTask] = useState(null);

  const load = useCallback(async () => {
    try {
      const [p, s, t] = await Promise.all([
        axios.get(`${API_BASE}/v1/reviewer-profile`, auth),
        axios.get(`${API_BASE}/v1/availability-slots`, auth),
        axios.get(`${API_BASE}/v1/callback-tasks`, auth),
      ]);
      if (p.data.profile) setProfile({ specialty: p.data.profile.specialty, licensedStates: (p.data.profile.licensed_states || []).join(", ") });
      setSlots(s.data.slots || []);
      setTasks(t.data.tasks || []);
    } catch (e) { setMsg(e.response?.data?.error || "Failed to load."); }
  }, [token]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => {
    setMsg("");
    try { await fn(); setMsg(ok); await load(); } catch (e) { setMsg(e.response?.data?.error || "Request failed."); }
  };

  const saveProfile = () => run(() => axios.put(`${API_BASE}/v1/reviewer-profile`, {
    specialty: profile.specialty,
    licensedStates: profile.licensedStates.split(/[ ,]+/).filter(Boolean),
  }, auth), "Profile saved.");

  const addSlot = () => run(() => axios.post(`${API_BASE}/v1/availability-slots`,
    { startsAt: [new Date(newSlot).toISOString()] }, auth), "Slot added.");

  return (
    <div style={{ maxWidth: 860, margin: "24px auto", padding: "0 20px", fontFamily: FONT }}>
      <h2 style={{ fontSize: 18, color: "#1a3a5c", margin: "0 0 12px" }}>Peer-to-peer availability &amp; call-backs</h2>
      {msg && <div style={{ marginBottom: 12, fontSize: 12, color: "#1a3a5c" }}>{msg}</div>}

      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Your specialty and licensed states</div>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>Providers are only offered your slots when the case's discipline and member state match this.</div>
        <select value={profile.specialty} onChange={e => setProfile(p => ({ ...p, specialty: e.target.value }))} style={{ padding: 6, marginRight: 8 }}>
          {["PT", "OT", "ST"].map(s => <option key={s}>{s}</option>)}
        </select>
        <input value={profile.licensedStates} onChange={e => setProfile(p => ({ ...p, licensedStates: e.target.value }))}
          placeholder="e.g. TX, FL, CA" style={{ padding: 6, width: 220, marginRight: 8 }} />
        <button style={btn} onClick={saveProfile}>Save</button>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Open and booked slots (30 min)</div>
        <input type="datetime-local" value={newSlot} onChange={e => setNewSlot(e.target.value)} style={{ padding: 6, marginRight: 8 }} />
        <button style={{ ...btn, background: newSlot ? "#1a3a5c" : "#94a3b8" }} disabled={!newSlot} onClick={addSlot}>Add slot</button>
        <div style={{ marginTop: 10 }}>
          {slots.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>No upcoming slots.</div>}
          {slots.map(s => (
            <div key={s.slot_id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, padding: "4px 0", borderTop: "1px solid #f1f5f9" }}>
              <span style={{ width: 190 }}>{new Date(s.starts_at).toLocaleString()}</span>
              <span style={{ color: s.status === "booked" ? "#166534" : "#6b7280", width: 60 }}>{s.status}</span>
              {s.status === "open" && (
                <button style={{ ...btn, background: "#fff", color: "#991b1b", border: "1px solid #fecaca" }}
                  onClick={() => run(() => axios.delete(`${API_BASE}/v1/availability-slots/${s.slot_id}`, auth), "Slot removed.")}>Remove</button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Call-back requests from the assistant ({tasks.length} open)</div>
        {tasks.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>Nothing waiting.</div>}
        {tasks.map(t => (
          <div key={t.task_id} style={{ borderTop: "1px solid #f1f5f9", padding: "8px 0", fontSize: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ flex: 1 }}>{new Date(t.created_at).toLocaleString()} — {t.reason || "Requested a person"}</span>
              <button style={{ ...btn, background: "#fff", color: "#1a3a5c", border: "1px solid #1a3a5c" }}
                onClick={() => setOpenTask(openTask === t.task_id ? null : t.task_id)}>{openTask === t.task_id ? "Hide transcript" : "Transcript"}</button>
              <button style={btn} onClick={() => run(() => axios.patch(`${API_BASE}/v1/callback-tasks/${t.task_id}`, { note: "Called back" }, auth), "Marked done.")}>Mark done</button>
            </div>
            {openTask === t.task_id && (
              <div style={{ marginTop: 6, background: "#f8fafc", borderRadius: 6, padding: 8 }}>
                {(Array.isArray(t.transcript) ? t.transcript : []).map((m, i) => (
                  <div key={i} style={{ marginBottom: 4 }}><b>{m.role === "user" ? "Provider" : "Assistant"}:</b> {typeof m.content === "string" ? m.content : m.text || ""}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
