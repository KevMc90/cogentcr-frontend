import React, { useState, useEffect, useRef } from "react";
import axios from "axios";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://rapidnote-backend.onrender.com";

const FONT = "'Public Sans', sans-serif";

/**
 * Advisory checklist shown above the submit button. It never blocks submission.
 * `input` is the form state; `documents` is a list of file names or doc-type strings.
 */
export function ReadinessChecklist({ token, input }) {
  const [result, setResult] = useState(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(input);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      axios.post(`${API_BASE}/v1/submissions/check`, input, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => { if (!cancelled) { setResult(r.data); setFailed(false); } })
        .catch(() => { if (!cancelled) setFailed(true); });
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [key, token]); // eslint-disable-line

  if (failed || !result) return null;
  const ok = result.ready;
  return (
    <div style={{
      marginBottom: 12, padding: "12px 14px", borderRadius: 8, fontFamily: FONT, fontSize: 12,
      background: ok ? "#f0fdf4" : "#fffbeb", border: `1px solid ${ok ? "#bbf7d0" : "#fde68a"}`,
      color: ok ? "#166534" : "#92400e",
    }}>
      <div style={{ fontWeight: 700, marginBottom: ok ? 0 : 6 }}>
        {ok ? "Everything we look for is here." : "Before you submit, these look like they are missing:"}
      </div>
      {!ok && (
        <ul style={{ margin: "0 0 6px 18px", padding: 0 }}>
          {result.missing.map(m => <li key={m.key} style={{ marginBottom: 2 }}>{m.message}</li>)}
        </ul>
      )}
      {result.note && <div style={{ fontStyle: "italic", marginBottom: 4 }}>{result.note}</div>}
      {!ok && <div style={{ color: "#6b7280" }}>You can still submit. Requests missing items may be returned for more information.</div>}
    </div>
  );
}

/** Scheduling / status assistant. The backend enforces every rule; this is only the surface. */
export function AssistantChat({ token }) {
  const [messages, setMessages] = useState([
    { role: "assistant", text: "Hi. I can help schedule a peer-to-peer call, check a case's status, or get you to a person. I cannot discuss the clinical merits of a case or predict an outcome. A person is always available. Just ask." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [transcriptId, setTranscriptId] = useState(null);
  const [handedOff, setHandedOff] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { if (endRef.current) endRef.current.scrollIntoView({ block: "end" }); }, [messages]);

  const send = async (text) => {
    const message = (text || input).trim();
    if (!message || busy) return;
    setInput("");
    setMessages(m => [...m, { role: "user", text: message }]);
    setBusy(true);
    try {
      const r = await axios.post(`${API_BASE}/v1/assistant/chat`, { message, transcriptId }, { headers: { Authorization: `Bearer ${token}` } });
      setTranscriptId(r.data.transcriptId);
      if (r.data.handedOff) setHandedOff(true);
      setMessages(m => [...m, { role: "assistant", text: r.data.reply }]);
    } catch (e) {
      const msg = e.response?.data?.error || "The assistant is unavailable right now. Please ask for a call back.";
      setMessages(m => [...m, { role: "assistant", text: msg }]);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 720, margin: "24px auto", padding: "0 20px", fontFamily: FONT }}>
      <h2 style={{ fontSize: 18, color: "#1a3a5c", margin: "0 0 4px" }}>Scheduling assistant</h2>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
        Peer-to-peer scheduling and case status. For your protection it will ask for your NPI and the member's date of birth before sharing anything.
      </div>
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 14, minHeight: 280, maxHeight: 460, overflowY: "auto" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 8 }}>
            <div style={{
              maxWidth: "80%", padding: "8px 12px", borderRadius: 10, fontSize: 13, whiteSpace: "pre-wrap",
              background: m.role === "user" ? "#1a3a5c" : "#f1f5f9", color: m.role === "user" ? "#fff" : "#1e293b",
            }}>{m.text}</div>
          </div>
        ))}
        {busy && <div style={{ fontSize: 12, color: "#94a3b8" }}>Working…</div>}
        <div ref={endRef} />
      </div>
      {handedOff && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#166534", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 7, padding: "8px 12px" }}>
          A call-back request with this conversation has been sent to our team.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }}
          placeholder="Type a message…" disabled={busy}
          style={{ flex: 1, padding: "10px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, fontFamily: FONT }} />
        <button onClick={() => send()} disabled={busy || !input.trim()}
          style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: busy || !input.trim() ? "#94a3b8" : "#1a3a5c", color: "#fff", fontWeight: 700, fontSize: 13, cursor: busy ? "not-allowed" : "pointer" }}>Send</button>
        <button onClick={() => send("I would like to speak with a person.")} disabled={busy}
          style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #1a3a5c", background: "#fff", color: "#1a3a5c", fontWeight: 600, fontSize: 13, cursor: busy ? "not-allowed" : "pointer" }}>Talk to a person</button>
      </div>
    </div>
  );
}
