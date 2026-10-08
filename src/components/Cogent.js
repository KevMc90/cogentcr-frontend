import React, { useState, useEffect, useRef } from "react";
import axios from "axios";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://rapidnote-backend.onrender.com";

const FONT = "'Public Sans', sans-serif";

// What Cogent says and suggests for each signed-in role. The backend decides what it can actually do;
// this is only wording. The "master" and "admin" roles share one persona.
export const COGENT_ROLES = {
  provider: {
    accent: "#1a3a5c",
    subtitle: "Scheduling, case status and new requests",
    greeting: "Hi, I'm Cogent. I can schedule a peer-to-peer call, show where your cases stand, or help you get a new authorization request ready. I can't discuss the clinical merits of a case or predict an outcome. A person is always available, just ask.",
    privacy: "To protect patients, I'll ask for your NPI and the member's date of birth before sharing case details.",
    suggestions: ["Show my recent cases", "Schedule a peer-to-peer call", "Help me submit a new authorization", "I'd like to speak with a person"],
    person: true,
  },
  reviewer: {
    accent: "#1a3a5c",
    subtitle: "Your calls, calendar and workload",
    greeting: "Hi, I'm Cogent. I can show your upcoming peer-to-peer calls, your open slots and your assigned cases, add availability to your calendar, look up a case by id, or open a screen for you. I don't summarize clinical evidence or suggest determinations; that's yours to make in the case review.",
    suggestions: ["What P2P calls do I have coming up?", "How many cases are assigned to me?", "Any open call-back requests?", "Open P2P availability"],
  },
  medical_director: {
    accent: "#1a3a5c",
    subtitle: "Co-sign queue, calls and calendar",
    greeting: "Hi, I'm Cogent. I can tell you how big your co-sign queue is, show your upcoming peer-to-peer calls and calendar, check open call-backs, look up a case by id, or open a screen for you. Determinations stay with you in the review screen.",
    suggestions: ["How big is my co-sign queue?", "What P2P calls do I have coming up?", "Any open call-back requests?", "Open Adverse Review"],
  },
  master: {
    accent: "#0d1b2a",
    subtitle: "Ask for anything on the platform (read-only)",
    greeting: "Hi, I'm Cogent. Ask me for what you want to see and I'll pull it up: counts and trends, lists of cases by status, discipline, state, plan or reviewer, reviewer workload, recent determinations, or one case by id. I can open the right screen for you. I'm read-only: I can't change users, plans, settings or cases.",
    suggestions: ["Give me a platform overview", "Which cases are waiting the longest?", "How is reviewer workload looking?", "What decisions were recorded this week?"],
  },
};
COGENT_ROLES.admin = COGENT_ROLES.master;

export function cogentAvailable(role) {
  return Object.prototype.hasOwnProperty.call(COGENT_ROLES, role);
}

/**
 * Core chat. `onNavigate(view, label)` is called when the user presses a button Cogent offered; the shell
 * maps the view name to its own screen. The backend only ever offers views that role may open.
 */
export function CogentChat({ token, role, onNavigate, inline = false, onClose }) {
  const cfg = COGENT_ROLES[role] || COGENT_ROLES.provider;
  const [messages, setMessages] = useState([{ role: "assistant", text: cfg.greeting, note: cfg.privacy }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [transcriptId, setTranscriptId] = useState(null);
  const [handedOff, setHandedOff] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { if (endRef.current) endRef.current.scrollIntoView({ block: "end" }); }, [messages, busy]);

  const send = async (text) => {
    const message = (text || input).trim();
    if (!message || busy) return;
    setInput("");
    setMessages(m => [...m, { role: "user", text: message }]);
    setBusy(true);
    try {
      const r = await axios.post(`${API_BASE}/v1/cogent/chat`, { message, transcriptId }, { headers: { Authorization: `Bearer ${token}` } });
      setTranscriptId(r.data.transcriptId);
      if (r.data.handedOff) setHandedOff(true);
      setMessages(m => [...m, { role: "assistant", text: r.data.reply, actions: Array.isArray(r.data.actions) ? r.data.actions : [] }]);
    } catch (e) {
      const msg = e.response?.data?.error || "Cogent is unavailable right now." + (cfg.person ? " Please ask for a call back." : "");
      setMessages(m => [...m, { role: "assistant", text: msg }]);
    } finally { setBusy(false); }
  };

  const fresh = () => { setMessages([{ role: "assistant", text: cfg.greeting, note: cfg.privacy }]); setTranscriptId(null); setHandedOff(false); setInput(""); };
  const showSuggestions = messages.length === 1 && !busy;

  const body = (
    <>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14, background: "#fff" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 10 }}>
            <div style={{
              maxWidth: "88%", padding: "8px 12px", borderRadius: 10, fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap",
              background: m.role === "user" ? cfg.accent : "#f1f5f9", color: m.role === "user" ? "#fff" : "#1e293b",
            }}>{m.text}</div>
            {m.note && <div style={{ maxWidth: "88%", marginTop: 4, fontSize: 11, color: "#64748b" }}>{m.note}</div>}
            {m.actions && m.actions.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {m.actions.filter(a => a && a.type === "navigate").map((a, j) => (
                  <button key={j} onClick={() => { if (onNavigate) onNavigate(a.view, a.label); if (!inline && onClose) onClose(); }}
                    style={{ padding: "6px 12px", borderRadius: 16, border: `1px solid ${cfg.accent}`, background: "#fff", color: cfg.accent, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT }}>
                    Open {a.label} →
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {showSuggestions && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {cfg.suggestions.map(s => (
              <button key={s} onClick={() => send(s)}
                style={{ padding: "6px 11px", borderRadius: 16, border: "1px solid #cbd5e1", background: "#f8fafc", color: "#334155", fontSize: 12, cursor: "pointer", fontFamily: FONT }}>{s}</button>
            ))}
          </div>
        )}
        {busy && <div style={{ fontSize: 12, color: "#94a3b8" }}>Cogent is working…</div>}
        <div ref={endRef} />
      </div>
      {handedOff && (
        <div style={{ margin: "0 12px 8px", fontSize: 12, color: "#166534", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 7, padding: "8px 12px" }}>
          A call-back request with this conversation has been sent to our team.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #e2e8f0", background: "#fff", flexWrap: "wrap" }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") send(); }}
          placeholder="Ask Cogent…" disabled={busy} aria-label="Message Cogent"
          style={{ flex: "1 1 160px", minWidth: 0, padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, fontFamily: FONT }} />
        <button onClick={() => send()} disabled={busy || !input.trim()}
          style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: busy || !input.trim() ? "#94a3b8" : cfg.accent, color: "#fff", fontWeight: 700, fontSize: 13, cursor: busy ? "not-allowed" : "pointer" }}>Send</button>
        {cfg.person && (
          <button onClick={() => send("I would like to speak with a person.")} disabled={busy}
            style={{ padding: "9px 12px", borderRadius: 8, border: `1px solid ${cfg.accent}`, background: "#fff", color: cfg.accent, fontWeight: 600, fontSize: 12, cursor: busy ? "not-allowed" : "pointer" }}>Talk to a person</button>
        )}
      </div>
    </>
  );

  const header = (
    <div style={{ background: cfg.accent, color: "#fff", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'Fraunces', Georgia, serif" }}>Cogent</div>
        <div style={{ fontSize: 11, opacity: 0.75 }}>{cfg.subtitle}</div>
      </div>
      <button onClick={fresh} title="Start a new conversation"
        style={{ fontSize: 11, background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 6, padding: "3px 9px", cursor: "pointer" }}>New chat</button>
      {!inline && onClose && (
        <button onClick={onClose} aria-label="Close Cogent"
          style={{ fontSize: 16, lineHeight: 1, background: "none", color: "#fff", border: "none", cursor: "pointer", padding: "2px 4px" }}>×</button>
      )}
    </div>
  );

  if (inline) {
    return (
      <div style={{ maxWidth: 720, margin: "24px auto", padding: "0 16px", fontFamily: FONT }}>
        <div style={{ display: "flex", flexDirection: "column", height: "min(620px, calc(100vh - 190px))", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
          {header}{body}
        </div>
      </div>
    );
  }
  return (
    <div style={{
      position: "fixed", right: 16, bottom: 16, zIndex: 3000, width: "min(400px, calc(100vw - 32px))", height: "min(560px, calc(100vh - 32px))",
      display: "flex", flexDirection: "column", borderRadius: 12, overflow: "hidden", boxShadow: "0 12px 40px rgba(15,23,42,0.28)", border: "1px solid #cbd5e1", background: "#fff", fontFamily: FONT,
    }}>
      {header}{body}
    </div>
  );
}

/** Floating launcher + panel. Mount once per shell; the conversation survives screen changes while it is mounted. */
export function CogentWidget({ token, role, onNavigate, hidden = false }) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  if (!cogentAvailable(role) || hidden) return null;
  const cfg = COGENT_ROLES[role];
  return (
    <>
      {/* The panel stays mounted once opened so closing it does not lose the conversation. */}
      {everOpened && (
        <div style={{ display: open ? "block" : "none" }}>
          <CogentChat token={token} role={role} onNavigate={onNavigate} onClose={() => setOpen(false)} />
        </div>
      )}
      {!open && (
        <button onClick={() => { setOpen(true); setEverOpened(true); }} aria-label="Open Cogent assistant"
          style={{
            position: "fixed", right: 20, bottom: 20, zIndex: 3000, display: "flex", alignItems: "center", gap: 8,
            padding: "11px 18px", borderRadius: 28, border: "none", background: cfg.accent, color: "#fff", cursor: "pointer",
            boxShadow: "0 6px 20px rgba(15,23,42,0.3)", fontFamily: FONT, fontSize: 13, fontWeight: 700,
          }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: "#4ade80" }} />
          Cogent
        </button>
      )}
    </>
  );
}
