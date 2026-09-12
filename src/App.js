import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import axios from "axios";
import Cockpit from "./components/Cockpit";
import { parseRequestedFreqWeeks, formatVisitLine } from "./utils/visitComparison";
import { buildUNFNote } from "./utils/unfNote";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "https://rapidnote-backend.onrender.com";

// ── TAT helpers (mirrors backend computeTatStatus) ───────────────────────────
function computeTat(sub) {
  if (!sub) return null;
  const priority     = sub.review_priority || sub.reviewPriority || "standard";
  const hoursAllowed = priority === "urgent" ? 24 : priority === "expedited" ? 8 : 72;
  const receivedAt   = new Date(sub.received_at || sub.receivedAt || sub.submitted_at || sub.submittedAt || Date.now());
  const now          = new Date();
  let   elapsedMs    = now - receivedAt;
  if (sub.rmi_sent_at || sub.rmiSentAt) {
    const sentAt    = new Date(sub.rmi_sent_at || sub.rmiSentAt);
    const pauseEnd  = (sub.rmi_responded_at || sub.rmiRespondedAt) ? new Date(sub.rmi_responded_at || sub.rmiRespondedAt) : now;
    elapsedMs      -= Math.max(0, pauseEnd - sentAt);
  }
  const elapsedHours = Math.max(0, elapsedMs / 3600000);
  const pct          = Math.min(100, (elapsedHours / hoursAllowed) * 100);
  const hoursLeft    = Math.max(0, hoursAllowed - elapsedHours);
  return {
    status:       pct >= 100 ? "breached" : pct >= 70 ? "at_risk" : "on_track",
    elapsedHours: Math.round(elapsedHours * 10) / 10,
    hoursLeft:    Math.round(hoursLeft * 10) / 10,
    pct:          Math.round(pct),
    hoursAllowed,
    priority,
  };
}

function TatBadge({ sub, style = {} }) {
  const tat = computeTat(sub);
  if (!tat) return null;
  const isBreached = tat.status === "breached";
  const isAtRisk   = tat.status === "at_risk";
  const colors = isBreached
    ? { bg: "#fef2f2", text: "#dc2626", border: "#fca5a5" }
    : isAtRisk
    ? { bg: "#fffbeb", text: "#d97706", border: "#fcd34d" }
    : { bg: "#f0fdf4", text: "#16a34a", border: "#bbf7d0" };
  const label = isBreached
    ? `⚠ SLA BREACHED`
    : `${tat.priority === "urgent" ? "⚡" : "⏱"} ${tat.hoursLeft.toFixed(0)}h left`;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 8px", borderRadius: 20,
      background: colors.bg, border: `1px solid ${colors.border}`,
      fontSize: 10, fontWeight: 700, color: colors.text,
      fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap",
      ...style,
    }}>
      {label}
    </span>
  );
}

// Section definitions -- order matters for display
const SECTION_KEYS = [
  { key: "hpiCareHistory",         label: "HPI/Care History" },
  { key: "clinicalSummary",        label: "Clinical Summary" },
  { key: "poc",                    label: "POC" },
  { key: "requestedVisits",        label: "Requested Visits" },
  { key: "determinationRationale", label: "Determination and Rationale" },
  { key: "approvedVisits",         label: "Approved Visits" },
];

// Per-section highlight colours
const SECTION_STYLES = {
  "Determination and Rationale": {
    background: "#fffbeb",
    borderLeft: "4px solid #f59e0b",
  },
  "Approved Visits": {
    background: "#f0fdf4",
    borderLeft: "4px solid #22c55e",
  },
};

// Determination badge colours
function detColor(label) {
  if (!label) return { bg: "#f3f4f6", text: "#374151", border: "#d1d5db" };
  const l = label.toLowerCase();
  if (l.startsWith("approved"))        return { bg: "#dcfce7", text: "#15803d", border: "#86efac" };
  if (l.startsWith("partial denial"))  return { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" };
  if (l.startsWith("full denial"))     return { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" };
  if (l.startsWith("pend"))            return { bg: "#eff6ff", text: "#1d4ed8", border: "#93c5fd" };
  return { bg: "#f3f4f6", text: "#374151", border: "#d1d5db" };
}

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const mm  = String(d.getMonth() + 1).padStart(2, "0");
  const dd  = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh  = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd}/${yyyy} ${hh}:${min}`;
}


// --- Spinner ----------------------------------------------------------------
function Spinner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "24px 0",
        padding: "16px 20px",
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        boxShadow: "0 2px 12px rgba(0,0,0,0.07)",
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          border: "2.5px solid #e2e8f0",
          borderTop: "2.5px solid #1a3a5c",
          borderRadius: "50%",
          animation: "rn-spin 0.8s linear infinite",
          flexShrink: 0,
        }}
      />
      <span style={{ color: "#1a3a5c", fontSize: 14, fontWeight: 600, fontFamily: '"DM Sans", sans-serif' }}>
        Generating review — this may take up to 30 seconds...
      </span>
    </div>
  );
}

// --- ReviewSection ----------------------------------------------------------
function ReviewSection({ label, content, isLast }) {
  const extra = SECTION_STYLES[label] || {};
  const isDetermination = label === "Determination and Rationale";
  const detBadge = isDetermination && content ? detColor(content.split(":")[0].trim()) : null;
  return (
    <div
      style={{
        padding: "18px 28px",
        borderBottom: isLast ? "none" : "1px solid #f1f5f9",
        background: extra.background || "#fff",
        borderLeft: extra.borderLeft || "none",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#64748b",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
          paddingBottom: 6,
          borderBottom: "1px solid #f1f5f9",
          fontFamily: '"DM Sans", sans-serif',
        }}
      >
        {label}
      </div>
      {isDetermination && detBadge && content ? (
        <div>
          <span
            style={{
              display: "inline-block",
              padding: "3px 10px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 700,
              background: detBadge.bg,
              color: detBadge.text,
              border: `1px solid ${detBadge.border}`,
              marginBottom: 8,
              fontFamily: '"DM Sans", sans-serif',
            }}
          >
            {content.split(":")[0].trim()}
          </span>
          <div style={{ fontSize: 15, lineHeight: 1.8, color: "#1e293b", whiteSpace: "pre-wrap" }}>
            {content.includes(":") ? content.slice(content.indexOf(":") + 1).trim() : ""}
          </div>
        </div>
      ) : (
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.8,
            color: "#1e293b",
            whiteSpace: "pre-wrap",
          }}
        >
          {content || (
            <span style={{ color: "#94a3b8", fontStyle: "italic" }}>—</span>
          )}
        </div>
      )}
    </div>
  );
}

// --- HistoryRow -------------------------------------------------------------
function HistoryRow({ row, isExpanded, onToggle }) {
  const [rowCopied, setRowCopied] = useState(false);
  const badge = detColor(row.determination_label);

  const copyRowReview = () => {
    const text = [
      `HPI/Care History:\n${row.hpi || "—"}`,
      `Clinical Summary:\n${row.clinical_summary || "—"}`,
      `POC: ${row.poc || "Not specified"}`,
      `Requested Visits: ${row.requested_visits ?? "—"}`,
      `Determination and Rationale:\n${row.determination_line || "—"}`,
      `Approved Visits: ${row.approved_visits ?? "—"}`,
    ].join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      setRowCopied(true);
      setTimeout(() => setRowCopied(false), 2500);
    });
  };

  const [rowHover, setRowHover] = useState(false);
  return (
    <div
      style={{
        borderBottom: "1px solid #f1f5f9",
        background: isExpanded ? "#f8fafc" : rowHover ? "#fafbfc" : "#fff",
        transition: "background 0.12s",
      }}
    >
      <div
        onClick={onToggle}
        onMouseEnter={() => setRowHover(true)}
        onMouseLeave={() => setRowHover(false)}
        style={{
          display: "grid",
          gridTemplateColumns: "140px 80px 90px 1fr 80px",
          gap: 12,
          padding: "11px 20px",
          alignItems: "center",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 13, color: "#4b5563" }}>
          {formatDateTime(row.created_at)}
        </span>
        <span style={{ fontSize: 13, color: "#374151", textTransform: "capitalize" }}>
          {row.review_type === "subsequent" ? "SUB" : "IE"}
        </span>
        <span style={{ fontSize: 13, fontFamily: "monospace", color: "#1e3a5f", fontWeight: 600 }}>
          {row.primary_diagnosis || "—"}
        </span>
        <span
          style={{
            display: "inline-block",
            padding: "2px 9px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            background: badge.bg,
            color: badge.text,
            border: `1px solid ${badge.border}`,
            width: "fit-content",
            fontFamily: '"DM Sans", sans-serif',
            letterSpacing: "0.02em",
          }}
        >
          {row.determination_label || "—"}
        </span>
        <span style={{ fontSize: 13, color: "#374151", textAlign: "right" }}>
          {row.approved_visits ?? "—"} visits
        </span>
      </div>


      {isExpanded && (
        <div
          style={{
            borderTop: "1px solid #e5e7eb",
            padding: "16px 20px",
            background: "#fff",
          }}
        >
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
            <button
              onClick={copyRowReview}
              style={{
                background: rowCopied ? "#22c55e" : "#1e3a5f",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.2s",
              }}
            >
              {rowCopied ? "Copied!" : "Copy to Clipboard"}
            </button>
          </div>

          {[
            { heading: "HPI/Care History",           value: row.hpi },
            { heading: "Clinical Summary",            value: row.clinical_summary },
            { heading: "POC",                         value: row.poc },
            { heading: "Determination and Rationale", value: row.determination_line },
          ].map(({ heading, value }) => (
            <div key={heading} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#1e3a5f",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 4,
                }}
              >
                {heading}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.7, color: "#1f2937", whiteSpace: "pre-wrap" }}>
                {value || <span style={{ color: "#9ca3af", fontStyle: "italic" }}>—</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// --- AuthPage ---------------------------------------------------------------
function AuthPage({ onAuthSuccess }) {
  const [view, setView]           = useState("login"); // "login" | "register"
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [fullName, setFullName]   = useState("");
  const [error, setError]         = useState("");
  const [loading, setLoading]         = useState(false);
  const [slowConnection, setSlowConnection] = useState(false);

  const inputBase = {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 7,
    padding: "10px 12px",
    fontSize: 14,
    color: "#111827",
    background: "#f9fafb",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    setSlowConnection(false);
    const slowTimer = setTimeout(() => setSlowConnection(true), 5000);
    try {
      const res = await axios.post(`${API_BASE}/api/auth/login`, { email, password });
      onAuthSuccess(res.data.token, res.data.user);
    } catch (err) {
      if (err?.response?.status === 401) {
        setError("Invalid email or password.");
      } else if (!err?.response) {
        setError("Connection error. Please try again.");
      } else {
        setError(err?.response?.data?.error || "Login failed. Please try again.");
      }
    } finally {
      clearTimeout(slowTimer);
      setSlowConnection(false);
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPw) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setSlowConnection(false);
    const slowTimer = setTimeout(() => setSlowConnection(true), 5000);
    try {
      const res = await axios.post(`${API_BASE}/api/auth/register`, {
        email,
        password,
        full_name: fullName,
      });
      onAuthSuccess(res.data.token, res.data.user);
    } catch (err) {
      if (err?.response?.status === 409) {
        setError("An account with this email already exists.");
      } else if (!err?.response) {
        setError("Connection error. Please try again.");
      } else {
        setError(err?.response?.data?.error || "Registration failed. Please try again.");
      }
    } finally {
      clearTimeout(slowTimer);
      setSlowConnection(false);
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f0f4f8 0%, #e2eaf4 50%, #edf1f8 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 16px",
        fontFamily: "'Public Sans', 'DM Sans', system-ui, sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400, animation: "rn-fadein 0.4s ease-out" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              width: 52,
              height: 52,
              background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)",
              borderRadius: 14,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
              boxShadow: "0 4px 16px rgba(26,58,92,0.25)",
            }}
          >
            <span style={{ color: "#fff", fontSize: 26, fontWeight: 700, fontFamily: '"DM Sans", sans-serif' }}>C</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, color: "#1a3a5c", letterSpacing: "-0.02em", fontFamily: '"DM Sans", sans-serif' }}>
            CogentCR
          </h1>
          {view === "login" && (
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b", letterSpacing: "0.01em" }}>
              AI-powered clinical prior authorization review
            </p>
          )}
        </div>

        {/* Card */}
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 16,
            padding: "36px 32px",
            boxShadow: "0 4px 24px rgba(0,0,0,0.09)",
          }}
        >
          <h2 style={{ margin: "0 0 24px", fontSize: 17, fontWeight: 600, color: "#0f172a", fontFamily: '"DM Sans", sans-serif' }}>
            {view === "login" ? "Sign in to your account" : "Create your account"}
          </h2>

          <form onSubmit={view === "login" ? handleLogin : handleRegister}>
            {view === "register" && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                  Full Name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Jane Smith"
                  style={inputBase}
                  autoComplete="name"
                />
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                style={inputBase}
                autoComplete="email"
              />
            </div>

            <div style={{ marginBottom: view === "register" ? 16 : 24 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={view === "register" ? "At least 8 characters" : "••••••••"}
                required
                style={inputBase}
                autoComplete={view === "login" ? "current-password" : "new-password"}
              />
            </div>

            {view === "register" && (
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="••••••••"
                  required
                  style={inputBase}
                  autoComplete="new-password"
                />
              </div>
            )}

            {error && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fca5a5",
                  borderRadius: 7,
                  padding: "10px 14px",
                  color: "#991b1b",
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                background: loading ? "#94a3b8" : "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "12px",
                fontSize: 15,
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                transition: "opacity 0.2s",
                fontFamily: '"DM Sans", sans-serif',
                letterSpacing: "0.01em",
                boxShadow: loading ? "none" : "0 2px 10px rgba(26,58,92,0.25)",
              }}
            >
              {loading
                ? (slowConnection ? "Waking up server… (up to 60 s)" : "Please wait…")
                : view === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div style={{ marginTop: 20, textAlign: "center", fontSize: 13, color: "#6b7280" }}>
            {view === "login" ? (
              <>
                Don't have an account?{" "}
                <button
                  onClick={() => { setView("register"); setError(""); }}
                  style={{ background: "none", border: "none", color: "#1e3a5f", fontWeight: 600, cursor: "pointer", padding: 0, fontSize: 13 }}
                >
                  Register
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => { setView("login"); setError(""); }}
                  style={{ background: "none", border: "none", color: "#1e3a5f", fontWeight: 600, cursor: "pointer", padding: 0, fontSize: 13 }}
                >
                  Sign In
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- DocumentSummary --------------------------------------------------------
function DocumentSummary({ summary }) {
  const [open, setOpen] = useState(false);
  if (!summary) return null;

  const hasWarnings = summary.warnings && summary.warnings.length > 0;

  return (
    <div
      style={{
        borderBottom: "1px solid #e5e7eb",
        background: "#f8fafc",
      }}
    >
      {/* Header / toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 24px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {/* Info icon */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#6b7280",
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          i
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151", flex: 1 }}>
          Document Summary — {summary.totalSelected} of {summary.totalSubmitted} submitted{" "}
          {summary.totalSubmitted === 1 ? "document" : "documents"} used
          {hasWarnings && (
            <span
              style={{
                marginLeft: 10,
                padding: "1px 8px",
                borderRadius: 99,
                background: "#fef3c7",
                color: "#92400e",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {summary.warnings.length} {summary.warnings.length === 1 ? "warning" : "warnings"}
            </span>
          )}
        </span>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 24px 16px" }}>
          {/* Warnings */}
          {hasWarnings && (
            <div
              style={{
                background: "#fffbeb",
                border: "1px solid #f59e0b",
                borderRadius: 6,
                padding: "10px 14px",
                marginBottom: 14,
              }}
            >
              {summary.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 13, color: "#92400e", lineHeight: 1.5 }}>
                  {i > 0 && <br />}⚠ {w}
                </div>
              ))}
            </div>
          )}

          {/* Documents used */}
          {summary.selectedDocuments.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6,
                }}
              >
                Used in this determination
              </div>
              {summary.selectedDocuments.map((d, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "6px 0",
                    borderBottom: i < summary.selectedDocuments.length - 1 ? "1px solid #e5e7eb" : "none",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#22c55e",
                      flexShrink: 0,
                      marginTop: 5,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
                      {d.filename}
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      {d.documentType}{d.documentDate ? ` — ${d.documentDate}` : ""}
                      {d.notes ? ` · ${d.notes}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Documents skipped */}
          {summary.skippedDocuments.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 6,
                }}
              >
                Not used
              </div>
              {summary.skippedDocuments.map((d, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "6px 0",
                    borderBottom: i < summary.skippedDocuments.length - 1 ? "1px solid #e5e7eb" : "none",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "#d1d5db",
                      flexShrink: 0,
                      marginTop: 5,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#374151" }}>{d.filename}</div>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>
                      {d.documentType}{d.notes ? ` · ${d.notes}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Dashboard --------------------------------------------------------------
function Dashboard({ user, token, onAuthError, onBack }) {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");

  useEffect(() => {
    axios
      .get(`${API_BASE}/api/analytics`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setAnalytics(res.data))
      .catch((err) => {
        if (err?.response?.status === 401) onAuthError();
        else setError("Could not load analytics.");
      })
      .finally(() => setLoading(false));
  }, [token, onAuthError]);

  const card = {
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    boxShadow: "0 2px 12px rgba(0,0,0,0.07)",
    overflow: "hidden",
  };
  const cardHeader = {
    padding: "12px 20px",
    background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)",
  };
  const cardTitle = {
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontFamily: '"DM Sans", sans-serif',
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0f4f8 0%, #e8eef5 50%, #f0f4f8 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#64748b", fontSize: 14 }}>Loading analytics...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0f4f8 0%, #e8eef5 50%, #f0f4f8 100%)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#991b1b", fontSize: 14 }}>{error}</span>
      </div>
    );
  }
  if (!analytics) return null;

  const a = analytics;
  const total = a.totalReviews || 1;

  const detItems = [
    { label: "Approved",       count: a.determinationBreakdown.approved,      color: "#22c55e", bg: "#f0fdf4" },
    { label: "Partial Denial", count: a.determinationBreakdown.partialDenial, color: "#f59e0b", bg: "#fffbeb" },
    { label: "Full Denial",    count: a.determinationBreakdown.fullDenial,    color: "#ef4444", bg: "#fef2f2" },
    { label: "Pend",           count: a.determinationBreakdown.pend,          color: "#9ca3af", bg: "#f9fafb" },
  ];

  // Fill last 14 days including zeros
  const last14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const isoDate = d.toISOString().split("T")[0];
    const found   = a.reviewsByDay.find((r) => {
      const rd = new Date(r.date).toISOString().split("T")[0];
      return rd === isoDate;
    });
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    last14.push({ label: `${mm}/${dd}`, count: found ? found.count : 0 });
  }
  const maxDay = Math.max(...last14.map((d) => d.count), 1);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #f0f4f8 0%, #e8eef5 50%, #f0f4f8 100%)",
        padding: "32px 16px 60px",
        fontFamily: "'Public Sans', 'DM Sans', system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 740, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 28, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 2px 8px rgba(26,58,92,0.2)" }}>
              <span style={{ color: "#fff", fontSize: 20, fontWeight: 700, fontFamily: '"DM Sans", sans-serif' }}>C</span>
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "#1a3a5c", letterSpacing: "-0.02em", fontFamily: '"DM Sans", sans-serif' }}>
                My Dashboard
              </h1>
              <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>{user?.name || user?.email}</p>
            </div>
          </div>
          <button
            onClick={onBack}
            style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 12px", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer" }}
          >
            ← Back to Reviews
          </button>
        </div>

        {/* Row 1 — 4 metric cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
          {[
            { label: "Total Reviews",    value: a.totalReviews,  color: "#1e3a5f" },
            { label: "Reviews Today",    value: a.reviewsToday,  color: "#1e3a5f" },
            { label: "Approval Rate",    value: `${a.approvalRate}%`, color: "#15803d" },
            {
              label: "Avg Review Time",
              value: a.avgProcessingTimeSeconds != null ? `${a.avgProcessingTimeSeconds}s` : "—",
              color: "#1e3a5f",
            },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ ...card, padding: "20px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1, fontFamily: '"DM Sans", sans-serif' }}>{value}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 7, fontFamily: '"DM Sans", sans-serif' }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* Row 2 — Determination breakdown */}
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={cardHeader}><span style={cardTitle}>Determination Breakdown</span></div>
          <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {detItems.map(({ label, count, color, bg }) => {
              const pct = Math.round((count / total) * 100);
              return (
                <div key={label} style={{ background: bg, borderRadius: 8, padding: "14px 12px", border: `1px solid ${color}33` }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1, fontFamily: '"DM Sans", sans-serif' }}>{count}</div>
                  <div style={{ fontSize: 11, color: "#374151", fontWeight: 600, marginTop: 4, fontFamily: '"DM Sans", sans-serif' }}>{label}</div>
                  <div style={{ marginTop: 10, height: 4, background: "#e5e7eb", borderRadius: 2 }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Row 3 — Top 5 diagnoses */}
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={cardHeader}><span style={cardTitle}>Top Diagnoses</span></div>
          <div style={{ padding: "8px 20px 14px" }}>
            {a.topDiagnoses.length === 0 ? (
              <div style={{ padding: "16px 0", color: "#9ca3af", fontSize: 14, fontStyle: "italic" }}>No data yet</div>
            ) : (
              a.topDiagnoses.map(({ code, count }, i) => {
                const maxCount = a.topDiagnoses[0]?.count || 1;
                return (
                  <div
                    key={code}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: i < a.topDiagnoses.length - 1 ? "1px solid #f3f4f6" : "none" }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", width: 18 }}>#{i + 1}</span>
                    <span style={{ fontSize: 14, fontFamily: "monospace", fontWeight: 700, color: "#1e3a5f", width: 88, flexShrink: 0 }}>{code}</span>
                    <div style={{ flex: 1, height: 6, background: "#f3f4f6", borderRadius: 3 }}>
                      <div style={{ height: "100%", width: `${Math.round((count / maxCount) * 100)}%`, background: "#1e3a5f", borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: 13, color: "#374151", fontWeight: 600, width: 28, textAlign: "right", flexShrink: 0 }}>{count}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Row 4 — Reviews per day bar chart */}
        <div style={card}>
          <div style={cardHeader}><span style={cardTitle}>Reviews — Last 14 Days</span></div>
          <div style={{ padding: "16px 20px 8px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90 }}>
              {last14.map(({ label, count }) => (
                <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", height: 72 }}>
                    <div
                      style={{
                        width: "80%",
                        height: count === 0 ? 2 : `${Math.max(4, Math.round((count / maxDay) * 68))}px`,
                        background: count === 0 ? "#e5e7eb" : "#1e3a5f",
                        borderRadius: "2px 2px 0 0",
                      }}
                    />
                  </div>
                  {count > 0 && (
                    <span style={{ fontSize: 9, color: "#6b7280", marginTop: 2 }}>{count}</span>
                  )}
                </div>
              ))}
            </div>
            {/* Date labels every 7 days */}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, padding: "0 1%" }}>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>{last14[0]?.label}</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>{last14[6]?.label}</span>
              <span style={{ fontSize: 10, color: "#9ca3af" }}>{last14[13]?.label}</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// --- SubmitCaseView ---------------------------------------------------------
function SubmitCaseView({ user, token, plans, onBack }) {
  const [providerName, setProviderName]   = useState("");
  const [providerNpi, setProviderNpi]     = useState("");
  const [memberName, setMemberName]       = useState("");
  const [memberId, setMemberId]           = useState("");
  const [dob, setDob]                     = useState("");
  const [memberState, setMemberState]     = useState("");
  const [discipline, setDiscipline]       = useState("PT");
  const [diagCodes, setDiagCodes]         = useState("");
  const [requestedVisits, setRequestedVisits] = useState("");
  const [planId, setPlanId]               = useState("");
  const [docList, setDocList]             = useState("");
  const [providerNotes, setProviderNotes] = useState("");
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState("");
  const [submitted, setSubmitted]         = useState(null);

  const parsedDiags = diagCodes.split(",").map(s => s.trim()).filter(Boolean);
  const parsedDocs  = docList.split("\n").map(s => s.trim()).filter(Boolean);
  const completeness = Math.round([
    !!providerName.trim(), !!memberName.trim(), !!memberId.trim(), !!dob.trim(),
    !!discipline, parsedDiags.length > 0, parseInt(requestedVisits, 10) > 0, parsedDocs.length > 0,
  ].filter(Boolean).length / 8 * 100);

  const meterColor = completeness >= 80 ? "#22c55e" : completeness >= 50 ? "#f59e0b" : "#ef4444";

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/v1/submit`, {
        providerName: providerName.trim() || null, providerNpi: providerNpi.trim() || null,
        memberName: memberName.trim() || null, memberId: memberId.trim() || null,
        dob: dob.trim() || null, memberState: memberState.trim() || null, discipline,
        diagnosisCodes: parsedDiags, requestedVisits: parseInt(requestedVisits, 10) || null,
        planId: planId || null, documentList: parsedDocs,
        providerNotes: providerNotes.trim() || null,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setSubmitted(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || "Submission failed. Please try again.");
    } finally { setLoading(false); }
  };

  const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.07)", overflow: "hidden" };
  const fieldWrapS = { marginBottom: 16 };
  const labelS = (t) => (<label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.03em", fontFamily: '"DM Sans", sans-serif' }}>{t}</label>);
  const inputS = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 8, padding: "9px 13px", fontSize: 14, color: "#0f172a", background: "#f8fafc", outline: "none", boxSizing: "border-box", fontFamily: '"Inter", sans-serif' };

  if (submitted) {
    return (
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0f4f8 0%, #e8eef5 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 480, width: "100%", background: "#fff", borderRadius: 16, padding: "40px 36px", boxShadow: "0 4px 24px rgba(0,0,0,0.09)", textAlign: "center" }}>
          <div style={{ width: 52, height: 52, background: "#dcfce7", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 24 }}>✓</div>
          <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 700, color: "#166534", fontFamily: '"DM Sans", sans-serif' }}>Submission Received</h2>
          <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: 14 }}>Your prior auth request has been submitted for review.</p>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 20px", marginBottom: 24, textAlign: "left" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, fontFamily: '"DM Sans", sans-serif' }}>Submission ID</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a5c", fontFamily: "monospace" }}>{submitted.submissionId}</div>
            <div style={{ marginTop: 10, fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Completeness</div>
            <div style={{ height: 6, background: "#e2e8f0", borderRadius: 3 }}>
              <div style={{ height: "100%", width: `${submitted.completenessScore}%`, background: meterColor, borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>{submitted.completenessScore}% complete</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onBack} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer" }}>Back to Reviews</button>
            <button onClick={() => setSubmitted(null)} style={{ flex: 1, padding: "10px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer" }}>Submit Another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0f4f8 0%, #e8eef5 100%)", padding: "0 0 60px", fontFamily: '"Inter", sans-serif' }}>
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#fff", borderBottom: "1px solid #e2e8f0", boxShadow: "0 1px 8px rgba(0,0,0,0.06)", padding: "0 16px" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, background: "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontSize: 17, fontWeight: 700, fontFamily: '"DM Sans", sans-serif' }}>C</span>
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#1a3a5c", fontFamily: '"DM Sans", sans-serif' }}>Submit Prior Auth Request</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 120, height: 6, background: "#e2e8f0", borderRadius: 3 }}>
              <div style={{ height: "100%", width: `${completeness}%`, background: meterColor, borderRadius: 3, transition: "width 0.2s, background 0.2s" }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: meterColor, width: 36, fontFamily: '"DM Sans", sans-serif' }}>{completeness}%</span>
            <button onClick={onBack} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 6, padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#374151", cursor: "pointer" }}>← Back</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "28px 16px 0" }}>
        <div style={{ ...card, padding: "24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 18, paddingBottom: 12, borderBottom: "1px solid #f1f5f9", fontFamily: '"DM Sans", sans-serif' }}>Provider Information</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={fieldWrapS}>{labelS("Provider Name *")}<input value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="e.g. Springfield PT Associates" style={inputS} /></div>
            <div style={fieldWrapS}>
              {labelS("Provider NPI")}
              <input value={providerNpi} onChange={e => setProviderNpi(e.target.value)} placeholder="10-digit NPI" style={inputS} />
              <NpiLookupWidget npi={providerNpi} token={token} onVerified={name => { if (!providerName) setProviderName(name); }} />
            </div>
          </div>
        </div>

        <div style={{ ...card, padding: "24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 18, paddingBottom: 12, borderBottom: "1px solid #f1f5f9", fontFamily: '"DM Sans", sans-serif' }}>Member Information</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div style={fieldWrapS}>{labelS("Member Name *")}<input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="First Last" style={inputS} /></div>
            <div style={fieldWrapS}>{labelS("Member ID *")}<input value={memberId} onChange={e => setMemberId(e.target.value)} placeholder="MBR-XXXXX" style={inputS} /></div>
            <div style={fieldWrapS}>{labelS("Date of Birth *")}<input type="date" value={dob} onChange={e => setDob(e.target.value)} style={inputS} /></div>
            <div style={fieldWrapS}>{labelS("Member State")}<input value={memberState} onChange={e => setMemberState(e.target.value.toUpperCase().slice(0,2))} placeholder="e.g. CA" maxLength={2} style={{ ...inputS, textTransform: "uppercase" }} /></div>
          </div>
        </div>

        <div style={{ ...card, padding: "24px 28px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 18, paddingBottom: 12, borderBottom: "1px solid #f1f5f9", fontFamily: '"DM Sans", sans-serif' }}>Clinical Details</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div style={fieldWrapS}>{labelS("Discipline *")}<select value={discipline} onChange={e => setDiscipline(e.target.value)} style={{ ...inputS, cursor: "pointer" }}><option value="PT">PT</option><option value="OT">OT</option><option value="ST">ST</option></select></div>
            <div style={fieldWrapS}>{labelS("Requested Visits *")}<input type="number" min="0" value={requestedVisits} onChange={e => setRequestedVisits(e.target.value)} placeholder="e.g. 16" style={inputS} /></div>
            <div style={fieldWrapS}>{labelS("Insurance Plan")}<select value={planId} onChange={e => setPlanId(e.target.value)} style={{ ...inputS, cursor: "pointer" }}><option value="">— Select Plan —</option>{plans.map(p => <option key={p.plan_id} value={p.plan_id}>{p.plan_name}</option>)}</select></div>
          </div>
          <div style={fieldWrapS}>{labelS("Diagnosis Codes * (comma-separated)")}<input value={diagCodes} onChange={e => setDiagCodes(e.target.value)} placeholder="e.g. M25.561, M75.1" style={inputS} /></div>
          <div style={fieldWrapS}>{labelS("Document List * (one filename per line)")}<textarea value={docList} onChange={e => setDocList(e.target.value)} placeholder={"IE_Patient_05202026.pdf\nScript_Patient_05182026.pdf"} rows={3} style={{ ...inputS, resize: "vertical", lineHeight: 1.6 }} /></div>
          <div style={fieldWrapS}>{labelS("Provider Notes")}<textarea value={providerNotes} onChange={e => setProviderNotes(e.target.value)} placeholder="Clinical context, urgency, history — anything that helps the reviewer." rows={3} style={{ ...inputS, resize: "vertical", lineHeight: 1.6 }} /></div>
        </div>

        {error && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 7, padding: "10px 14px", color: "#991b1b", fontSize: 13, marginBottom: 16 }}>{error}</div>}

        <button onClick={handleSubmit} disabled={loading} style={{ background: loading ? "#94a3b8" : "linear-gradient(135deg, #1a3a5c 0%, #2d5a8e 100%)", color: "#fff", border: "none", borderRadius: 8, padding: "12px 32px", fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: '"DM Sans", sans-serif', boxShadow: loading ? "none" : "0 2px 10px rgba(26,58,92,0.25)" }}>
          {loading ? "Submitting..." : `Submit Request (${completeness}% complete)`}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINT DECISION LETTER (client-side, no auth header needed)
// ─────────────────────────────────────────────────────────────────────────────
function printDecisionLetter(submission, decision) {
  const isApproved = submission.status === "approved";
  const isDenied   = submission.status === "denied";
  const decLabel   = isApproved ? "APPROVED" : isDenied ? "DENIED" : "PENDED";
  const decColor   = isApproved ? "#15803d"  : isDenied ? "#991b1b" : "#1d4ed8";
  const decBg      = isApproved ? "#f0fdf4"  : isDenied ? "#fef2f2" : "#eff6ff";
  const approvedVisits = decision?.approved_visits ?? null;
  const rationale      = decision?.rationale       ?? "";
  const decidedAt      = decision?.recorded_at ?? submission.updated_at ?? new Date().toISOString();
  const decidedStr     = new Date(decidedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const diags = Array.isArray(submission.diagnosis_codes) ? submission.diagnosis_codes : [];

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CogentCR Decision Letter — ${submission.submission_id}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@700;800&family=Public+Sans:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Public Sans', Arial, sans-serif; background: #f8fafc; padding: 32px; color: #1e293b; }
  .page { max-width: 680px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 16px rgba(0,0,0,0.1); }
  .header { background: #1a3a5c; padding: 20px 28px; display: flex; align-items: center; justify-content: space-between; }
  .header-brand { font-family: 'Fraunces', Georgia, serif; font-size: 22px; font-weight: 800; color: #fff; letter-spacing: -0.02em; }
  .header-sub { font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 2px; }
  .body { padding: 28px 32px; }
  .det-badge { display: inline-block; padding: 8px 18px; border-radius: 8px; background: ${decBg}; border: 1.5px solid ${decColor}; color: ${decColor}; font-size: 14px; font-weight: 800; letter-spacing: 0.05em; margin-bottom: 22px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin-bottom: 22px; }
  .field-label { font-size: 9px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.1em; }
  .field-value { font-size: 13px; color: #1e293b; font-weight: 600; margin-top: 1px; }
  .visits-box { background: ${decBg}; border: 1px solid ${decColor}; border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; }
  .visits-label { font-size: 9px; font-weight: 700; color: ${decColor}; text-transform: uppercase; letter-spacing: 0.1em; }
  .visits-num { font-family: 'Fraunces', Georgia, serif; font-size: 36px; font-weight: 800; color: ${decColor}; line-height: 1; margin-top: 2px; }
  .rationale { margin-bottom: 18px; }
  .rationale-label { font-size: 9px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 6px; }
  .rationale-text { font-size: 13px; line-height: 1.7; color: #374151; }
  .footer-rule { border: none; border-top: 1px solid #e2e8f0; margin: 20px 0 14px; }
  .footer-text { font-size: 10px; color: #9ca3af; line-height: 1.6; }
  .diag-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
  .diag-chip { padding: 2px 8px; background: #eff6ff; color: #1a3a5c; font-size: 11px; font-family: monospace; font-weight: 600; border-radius: 4px; }
  @media print { body { background: #fff; padding: 0; } .page { box-shadow: none; border-radius: 0; } }
</style>
</head><body>
<div class="page">
  <div class="header">
    <div>
      <div class="header-brand">CogentCR</div>
      <div class="header-sub">Utilization Management Decision Letter</div>
    </div>
    <div style="font-size:11px;color:rgba(255,255,255,0.5);text-align:right;">Generated ${new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}</div>
  </div>
  <div class="body">
    <div class="det-badge">${decLabel}</div>
    <div class="grid">
      <div><div class="field-label">Member Name</div><div class="field-value">${submission.member_name || "—"}</div></div>
      <div><div class="field-label">Member ID</div><div class="field-value">${submission.member_id || "—"}</div></div>
      <div><div class="field-label">Date of Birth</div><div class="field-value">${submission.dob || "—"}</div></div>
      <div><div class="field-label">Discipline</div><div class="field-value">${submission.discipline || "PT"}</div></div>
      <div><div class="field-label">Case ID</div><div class="field-value" style="font-family:monospace">${submission.submission_id}</div></div>
      <div><div class="field-label">Decision Date</div><div class="field-value">${decidedStr}</div></div>
    </div>
    ${diags.length > 0 ? `<div style="margin-bottom:18px"><div class="field-label">Diagnosis Codes</div><div class="diag-chips">${diags.map(c => `<span class="diag-chip">${c}</span>`).join("")}</div></div>` : ""}
    ${isApproved && approvedVisits != null ? `<div class="visits-box"><div class="visits-label">Authorized Visits</div><div class="visits-num">${approvedVisits} <span style="font-size:16px;font-weight:600">visits</span></div></div>` : ""}
    ${rationale ? `<div class="rationale"><div class="rationale-label">Clinical Rationale</div><div class="rationale-text">${rationale}</div></div>` : ""}
    <hr class="footer-rule">
    <div class="footer-text">
      ${isApproved
        ? "This authorization is valid for the services and dates specified above. Contact CogentCR if clinical circumstances change materially prior to initiation of services."
        : isDenied
        ? "This determination is subject to appeal within 60 calendar days of receipt. To initiate an appeal, contact your CogentCR case coordinator. This determination was made in accordance with established clinical criteria and the member's benefit plan."
        : "Additional clinical documentation has been requested. Please respond within 5 business days to avoid automatic case closure. Contact your case coordinator with questions."}
    </div>
  </div>
</div>
<script>setTimeout(() => window.print(), 400);<\/script>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION BELL
// ─────────────────────────────────────────────────────────────────────────────
function NotificationBell({ token, onNavigateToCase }) {
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread]               = useState(0);
  const [open, setOpen]                   = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const r = await axios.get(`${API_BASE}/v1/notifications`, { headers: { Authorization: `Bearer ${token}` } });
      setNotifications(r.data.notifications || []);
      setUnread(r.data.unread || 0);
    } catch {}
  }, [token]);

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 60000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  const markAllRead = async () => {
    try {
      await axios.post(`${API_BASE}/v1/notifications/read-all`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnread(0);
    } catch {}
  };

  const toggleOpen = () => {
    if (!open && unread > 0) markAllRead();
    setOpen(o => !o);
  };

  const typeColor = (type) => {
    if (type === "info_requested") return "#b45309";
    if (type === "determination")  return "#1a3a5c";
    return "#6b7280";
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={toggleOpen}
        style={{
          position: "relative", background: open ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.2)", borderRadius: 7, padding: "5px 10px",
          cursor: "pointer", color: "#fff", fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", gap: 6,
        }}
        title="Notifications"
      >
        <span>🔔</span>
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -5, right: -5, background: "#dc2626", color: "#fff",
            fontSize: 9, fontWeight: 800, borderRadius: "50%", width: 16, height: 16,
            display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif",
          }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 8px)", width: 300, zIndex: 200,
          background: "#fff", borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>Notifications</span>
            {notifications.some(n => !n.is_read) && (
              <button onClick={markAllRead} style={{ fontSize: 11, color: "#6b7280", background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Mark all read</button>
            )}
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {notifications.length === 0 ? (
              <div style={{ padding: "20px 14px", fontSize: 12, color: "#9ca3af", textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>No notifications yet.</div>
            ) : notifications.map(n => (
              <div key={n.id} style={{
                padding: "10px 14px", borderBottom: "1px solid #f8fafc",
                background: n.type === "info_requested" && !n.is_read ? "#fffbeb" : n.is_read ? "#fff" : "#eff6ff",
                display: "flex", gap: 8, alignItems: "flex-start",
                borderLeft: n.type === "info_requested" ? "3px solid #f59e0b" : "none",
              }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: n.is_read ? "#d1d5db" : typeColor(n.type), marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  {n.type === "info_requested" && (
                    <div style={{ fontSize: 9, fontWeight: 800, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2, fontFamily: "'DM Sans', sans-serif" }}>⚠ Action Required</div>
                  )}
                  <div style={{ fontSize: 12, color: "#1e293b", fontFamily: "'Public Sans', sans-serif", lineHeight: 1.4 }}>{n.message}</div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2, fontFamily: "'DM Sans', sans-serif" }}>
                    {n.created_at ? new Date(n.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                  </div>
                  {n.type === "info_requested" && n.case_id && onNavigateToCase && (
                    <button
                      onClick={() => { setOpen(false); onNavigateToCase(n.case_id); }}
                      style={{ marginTop: 6, padding: "4px 10px", background: "#b45309", color: "#fff", border: "none", borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}
                    >
                      View Case →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NPI LOOKUP WIDGET (Phase 22)
// ─────────────────────────────────────────────────────────────────────────────
function NpiLookupWidget({ npi, token, onVerified }) {
  const [state, setState] = React.useState(null); // null | "loading" | {provider} | "error" | "notfound"

  React.useEffect(() => {
    if (!npi || npi.length !== 10 || !/^\d{10}$/.test(npi)) { setState(null); return; }
    setState("loading");
    const tid = setTimeout(() => {
      axios.get(`${API_BASE}/v1/npi-lookup`, {
        params: { npi },
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => {
          setState({ provider: r.data.provider });
          if (onVerified && r.data.provider?.displayName) onVerified(r.data.provider.displayName);
        })
        .catch(e => {
          setState(e.response?.status === 404 ? "notfound" : "error");
        });
    }, 400);
    return () => clearTimeout(tid);
  }, [npi, token]); // eslint-disable-line

  if (!state) return null;
  if (state === "loading") return (
    <div style={{ marginTop: 6, fontSize: 11, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>Verifying NPI…</div>
  );
  if (state === "notfound") return (
    <div style={{ marginTop: 6, fontSize: 11, color: "#dc2626", fontFamily: "'Public Sans', sans-serif" }}>NPI not found in NPPES registry.</div>
  );
  if (state === "error") return (
    <div style={{ marginTop: 6, fontSize: 11, color: "#d97706", fontFamily: "'Public Sans', sans-serif" }}>NPI registry unavailable — continuing without verification.</div>
  );
  const p = state.provider;
  return (
    <div style={{ marginTop: 6, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 7, padding: "8px 12px", display: "flex", alignItems: "flex-start", gap: 10 }}>
      <span style={{ fontSize: 14, marginTop: 1 }}>✓</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#15803d", fontFamily: "'Public Sans', sans-serif" }}>{p.displayName || "—"}{p.credential ? `, ${p.credential}` : ""}</div>
        <div style={{ fontSize: 11, color: "#166534", fontFamily: "'DM Sans', sans-serif", marginTop: 1 }}>
          {[p.specialty, p.city && p.state ? `${p.city}, ${p.state}` : (p.state || null)].filter(Boolean).join(" · ")}
          {p.status === "I" && <span style={{ marginLeft: 8, fontWeight: 700, color: "#dc2626" }}>INACTIVE</span>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER DIRECTORY VIEW (Phase 22)
// ─────────────────────────────────────────────────────────────────────────────
function ProviderDirectoryView({ token }) {
  const [providers, setProviders] = React.useState([]);
  const [q, setQ]                 = React.useState("");
  const [loading, setLoading]     = React.useState(true);
  const [npiInput, setNpiInput]   = React.useState("");
  const [lookupResult, setLookupResult] = React.useState(null);
  const [looking, setLooking]     = React.useState(false);

  const fetchProviders = (search) => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/providers`, {
      params: search ? { q: search } : {},
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => { setProviders(r.data.providers || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  React.useEffect(() => { fetchProviders(); }, [token]); // eslint-disable-line

  const handleSearch = (e) => { e.preventDefault(); fetchProviders(q); };

  const handleLookup = async () => {
    if (!/^\d{10}$/.test(npiInput)) return;
    setLooking(true); setLookupResult(null);
    try {
      const r = await axios.get(`${API_BASE}/v1/npi-lookup`, {
        params: { npi: npiInput },
        headers: { Authorization: `Bearer ${token}` },
      });
      setLookupResult(r.data.provider);
      fetchProviders(q);
    } catch (e) {
      setLookupResult({ error: e.response?.data?.error || "Lookup failed." });
    } finally {
      setLooking(false);
    }
  };

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 24, marginBottom: 28, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1e293b", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>Provider Directory</div>
          <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>NPPES-verified providers cached from NPI lookups</div>
        </div>
        {/* Quick NPI lookup */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>Look up NPI</div>
            <input value={npiInput} onChange={e => setNpiInput(e.target.value)} placeholder="10-digit NPI"
              style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "monospace", width: 150 }} />
          </div>
          <button onClick={handleLookup} disabled={looking || npiInput.length !== 10}
            style={{ padding: "7px 14px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Public Sans', sans-serif", opacity: npiInput.length !== 10 ? 0.5 : 1 }}>
            {looking ? "…" : "Verify"}
          </button>
        </div>
      </div>

      {lookupResult && (
        <div style={{ marginBottom: 18, padding: "12px 16px", borderRadius: 8, background: lookupResult.error ? "#fef2f2" : "#f0fdf4", border: `1px solid ${lookupResult.error ? "#fca5a5" : "#86efac"}`, fontFamily: "'Public Sans', sans-serif", fontSize: 13 }}>
          {lookupResult.error
            ? <span style={{ color: "#dc2626" }}>{lookupResult.error}</span>
            : <><strong>{lookupResult.displayName}{lookupResult.credential ? `, ${lookupResult.credential}` : ""}</strong> · {lookupResult.specialty} · {lookupResult.city}, {lookupResult.state} · NPI {lookupResult.npi}</>
          }
        </div>
      )}

      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, NPI, or specialty…"
          style={{ flex: 1, padding: "9px 14px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }} />
        <button type="submit" style={{ padding: "9px 18px", background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>Search</button>
      </form>

      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 80px 140px 80px 80px", padding: "10px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>
          <span>NPI</span><span>Provider</span><span>Cred.</span><span>Specialty</span><span>Location</span><span>Status</span>
        </div>
        {loading ? (
          <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, textAlign: "center" }}>Loading…</div>
        ) : providers.length === 0 ? (
          <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>No providers found. Look up an NPI above to add one.</div>
        ) : providers.map(p => (
          <div key={p.npi} style={{ display: "grid", gridTemplateColumns: "120px 1fr 80px 140px 80px 80px", padding: "11px 16px", borderBottom: "1px solid #f1f5f9", alignItems: "center", fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>
            <span style={{ fontFamily: "monospace", color: "#374151", fontSize: 11 }}>{p.npi}</span>
            <span style={{ fontWeight: 600, color: "#1e293b" }}>{p.display_name || "—"}</span>
            <span style={{ color: "#6b7280" }}>{p.credential || "—"}</span>
            <span style={{ color: "#4b5563" }}>{p.specialty ? p.specialty.substring(0, 22) : "—"}</span>
            <span style={{ color: "#6b7280" }}>{p.city && p.state ? `${p.city}, ${p.state}` : (p.state || "—")}</span>
            <span style={{ fontWeight: 700, color: p.status === "I" ? "#dc2626" : "#16a34a" }}>{p.status === "A" ? "Active" : p.status === "I" ? "Inactive" : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EPISODE CONTEXT BAR (Phase 21)
// ─────────────────────────────────────────────────────────────────────────────
function EpisodeContextBar({ memberId, discipline, token }) {
  const [ctx, setCtx]         = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(() => {
    if (!memberId || !discipline || memberId === "—") { setLoading(false); return; }
    axios.get(`${API_BASE}/v1/episode-context`, {
      params: { memberId, discipline },
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => { setCtx(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [memberId, discipline, token]); // eslint-disable-line

  if (loading || !ctx || !ctx.episode) return null;

  const ep       = ctx.episode;
  const subs     = ctx.submissions || [];
  const cumVisits = ctx.cumulativeVisits || 0;
  const isSubseq  = subs.length > 1;
  const isConcurrent = subs.length > 1 && subs.some(s => s.status === "under_review" || s.status === "submitted");

  const detBg = (d) => {
    if (!d) return { bg: "#f3f4f6", text: "#6b7280" };
    const l = d.toLowerCase();
    if (l.startsWith("approved"))    return { bg: "#dcfce7", text: "#15803d" };
    if (l.includes("partial"))       return { bg: "#fef3c7", text: "#92400e" };
    if (l.includes("denial") || l.includes("denied")) return { bg: "#fee2e2", text: "#991b1b" };
    if (l.startsWith("pend"))        return { bg: "#eff6ff", text: "#1d4ed8" };
    return { bg: "#f3f4f6", text: "#6b7280" };
  };

  // Prior auths = all submissions except the current one (last in list)
  const priorSubs = isSubseq ? subs.slice(0, -1) : [];

  const bannerBg    = isConcurrent ? "#fef3c7" : isSubseq ? "#fdf4ff" : "#f0f9ff";
  const bannerBdr   = isConcurrent ? "#fde68a" : isSubseq ? "#e9d5ff" : "#bae6fd";
  const bannerLabel = isConcurrent ? "CONCURRENT REVIEW" : isSubseq ? "SUBSEQUENT REVIEW" : null;
  const labelColor  = isConcurrent ? { bg: "#fef3c7", text: "#92400e" } : { bg: "#f5f3ff", text: "#7c3aed" };

  return (
    <div style={{ background: bannerBg, borderBottom: `1px solid ${bannerBdr}`, fontFamily: "'Public Sans', sans-serif", flexShrink: 0 }}>
      {/* Summary row */}
      <div style={{ padding: "8px 20px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {bannerLabel && (
          <span style={{ fontSize: 10, fontWeight: 800, background: labelColor.bg, color: labelColor.text, borderRadius: 4, padding: "2px 8px", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            {bannerLabel}
          </span>
        )}
        <span style={{ fontSize: 12, color: "#374151" }}>
          <strong>Episode #{ep.episode_number}</strong> · {discipline} · Started {ep.started_at ? new Date(ep.started_at).toLocaleDateString() : "—"}
        </span>
        <span style={{ fontSize: 12, color: "#6b7280" }}>·</span>
        <span style={{ fontSize: 12, color: "#374151" }}>{subs.length} auth request{subs.length !== 1 ? "s" : ""} this episode</span>
        <span style={{ fontSize: 12, color: "#6b7280" }}>·</span>
        <span style={{ fontSize: 12 }}>
          <strong style={{ color: cumVisits > 0 ? "#1a3a5c" : "#9ca3af" }}>{cumVisits}</strong>
          <span style={{ color: "#6b7280" }}> visits authorized to date</span>
        </span>
        {isSubseq && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: labelColor.text, background: "none", border: `1px solid ${bannerBdr}`, borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}
          >
            {expanded ? "Hide History ▲" : `View Prior Auth History (${priorSubs.length}) ▼`}
          </button>
        )}
      </div>

      {/* Expanded prior auth history */}
      {isSubseq && expanded && (
        <div style={{ borderTop: `1px solid ${bannerBdr}`, padding: "12px 20px 16px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10, fontFamily: "'Public Sans', sans-serif" }}>
            Prior Authorization History
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {priorSubs.map((s, i) => {
              const dc  = detBg(s.determination);
              const diags = Array.isArray(s.diagnosis_codes) ? s.diagnosis_codes : [];
              const approvedV = s.ae_approved_visits != null ? parseInt(s.ae_approved_visits, 10) : null;
              const requestedV = s.requested_visits || 0;
              const isPartial = approvedV != null && approvedV < requestedV;
              return (
                <div key={s.submission_id} style={{ background: "#fff", border: `1px solid ${bannerBdr}`, borderRadius: 8, padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    {/* Auth # + date */}
                    <div style={{ minWidth: 80 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em" }}>Auth #{i + 1}</div>
                      <div style={{ fontSize: 11, color: "#374151", marginTop: 2 }}>{s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : "—"}</div>
                    </div>
                    {/* Determination */}
                    <div style={{ minWidth: 140 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Determination</div>
                      {s.determination ? (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 5, background: dc.bg, color: dc.text }}>
                          {s.determination}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>{s.status?.replace(/_/g, " ") || "Pending"}</span>
                      )}
                    </div>
                    {/* Visits */}
                    <div style={{ minWidth: 120 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Visits</div>
                      <div style={{ fontSize: 12, color: "#374151" }}>
                        <span style={{ fontWeight: 700, color: approvedV != null ? (isPartial ? "#92400e" : "#15803d") : "#9ca3af" }}>
                          {approvedV != null ? approvedV : "—"}
                        </span>
                        <span style={{ color: "#9ca3af" }}> of {requestedV} requested</span>
                      </div>
                      {isPartial && <div style={{ fontSize: 10, color: "#92400e", marginTop: 1 }}>{requestedV - approvedV} visits not authorized</div>}
                    </div>
                    {/* Decided date */}
                    {s.decided_at && (
                      <div style={{ minWidth: 90 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Decided</div>
                        <div style={{ fontSize: 11, color: "#374151" }}>{new Date(s.decided_at).toLocaleDateString()}</div>
                      </div>
                    )}
                    {/* Diagnoses */}
                    {diags.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Dx</div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {diags.slice(0, 3).map(d => (
                            <span key={d} style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4, background: "#eff6ff", color: "#1a3a5c", fontFamily: "monospace" }}>{d}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Rationale */}
                  {(s.reviewer_rationale || s.reviewer_notes) && (
                    <div style={{ marginTop: 10, padding: "8px 12px", background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Prior Determination Rationale</div>
                      <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>
                        {s.reviewer_rationale || s.reviewer_notes}
                      </div>
                      {s.reviewer_email && (
                        <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 6 }}>Reviewer: {s.reviewer_email}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATIONS VIEW (Phase 24)
// ─────────────────────────────────────────────────────────────────────────────
const WEBHOOK_EVENTS = ['case.submitted', 'determination.made', 'appeal.filed', 'md.cosigned'];

function IntegrationsView({ token }) {
  const [endpoints,  setEndpoints]  = React.useState([]);
  const [deliveries, setDeliveries] = React.useState([]);
  const [apiKeys,    setApiKeys]    = React.useState([]);
  const [newKey,     setNewKey]     = React.useState(null);
  const [copied,     setCopied]     = React.useState(false);
  const [loading,    setLoading]    = React.useState(true);
  const [whForm,     setWhForm]     = React.useState({ name: '', url: '', secret: '', events: [] });
  const [keyName,    setKeyName]    = React.useState('');
  const [toast,      setToast]      = React.useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const fetchAll = () => {
    setLoading(true);
    Promise.all([
      axios.get(`${API_BASE}/v1/webhooks`,           { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API_BASE}/v1/webhook-deliveries`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API_BASE}/v1/api-keys`,           { headers: { Authorization: `Bearer ${token}` } }),
    ]).then(([w, d, k]) => {
      setEndpoints(w.data.endpoints || []);
      setDeliveries(d.data.deliveries || []);
      setApiKeys(k.data.keys || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  React.useEffect(() => { fetchAll(); }, [token]); // eslint-disable-line

  const handleAddWebhook = async (e) => {
    e.preventDefault();
    if (!whForm.events.length) return showToast('Select at least one event.');
    try {
      await axios.post(`${API_BASE}/v1/webhooks`, whForm, { headers: { Authorization: `Bearer ${token}` } });
      setWhForm({ name: '', url: '', secret: '', events: [] });
      fetchAll(); showToast('Webhook endpoint registered.');
    } catch (err) { showToast(err.response?.data?.error || 'Failed to add webhook.'); }
  };

  const handleDeleteWebhook = async (id) => {
    await axios.delete(`${API_BASE}/v1/webhooks/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    fetchAll(); showToast('Endpoint removed.');
  };

  const handleGenerateKey = async (e) => {
    e.preventDefault();
    if (!keyName.trim()) return;
    try {
      const r = await axios.post(`${API_BASE}/v1/api-keys`, { name: keyName }, { headers: { Authorization: `Bearer ${token}` } });
      setNewKey(r.data.key); setKeyName(''); fetchAll();
    } catch (err) { showToast(err.response?.data?.error || 'Failed to generate key.'); }
  };

  const handleRevokeKey = async (id) => {
    await axios.delete(`${API_BASE}/v1/api-keys/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    fetchAll(); showToast('API key revoked.');
  };

  const copyKey = () => {
    navigator.clipboard.writeText(newKey).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  const inputS = { width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, fontFamily: "'DM Sans', sans-serif", boxSizing: 'border-box' };
  const secHead = (t) => <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', fontFamily: "'Fraunces', Georgia, serif", marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #f1f5f9' }}>{t}</div>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px' }}>
      {toast && <div style={{ position: 'fixed', top: 20, right: 24, background: '#1e293b', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, zIndex: 9999, fontFamily: "'Public Sans', sans-serif" }}>{toast}</div>}

      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>Integrations</div>
        <div style={{ fontSize: 12, color: '#6b7280', fontFamily: "'Public Sans', sans-serif" }}>Outbound webhooks and inbound API gateway for external system integration</div>
      </div>

      {/* Webhook Endpoints */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '20px 24px', marginBottom: 24 }}>
        {secHead('Webhook Endpoints')}
        {loading ? <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading…</div> : endpoints.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 16, fontFamily: "'Public Sans', sans-serif" }}>No endpoints registered yet.</div>
        ) : endpoints.map(ep => (
          <div key={ep.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', fontFamily: "'Public Sans', sans-serif" }}>{ep.name}</div>
              <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace', marginTop: 2 }}>{ep.url}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                {(ep.events || []).map(ev => <span key={ev} style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: '#eff6ff', color: '#1d4ed8', fontFamily: "'DM Sans', sans-serif" }}>{ev}</span>)}
              </div>
            </div>
            <button onClick={() => handleDeleteWebhook(ep.id)} style={{ padding: '5px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
          </div>
        ))}

        <form onSubmit={handleAddWebhook} style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Name</div><input value={whForm.name} onChange={e => setWhForm(f => ({...f, name: e.target.value}))} placeholder="e.g. EHR Webhook" style={inputS} required /></div>
          <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>URL</div><input value={whForm.url} onChange={e => setWhForm(f => ({...f, url: e.target.value}))} placeholder="https://your-system.com/webhook" style={inputS} required /></div>
          <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Secret</div><input value={whForm.secret} onChange={e => setWhForm(f => ({...f, secret: e.target.value}))} placeholder="Signing secret" style={inputS} required /></div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, fontFamily: "'DM Sans', sans-serif" }}>Events</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {WEBHOOK_EVENTS.map(ev => (
                <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif" }}>
                  <input type="checkbox" checked={whForm.events.includes(ev)} onChange={e => setWhForm(f => ({ ...f, events: e.target.checked ? [...f.events, ev] : f.events.filter(x => x !== ev) }))} />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          <div style={{ gridColumn: '1 / 3', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" style={{ padding: '8px 18px', background: '#1a3a5c', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Public Sans', sans-serif" }}>Register Endpoint</button>
          </div>
        </form>

        {/* Recent deliveries */}
        {deliveries.length > 0 && (
          <div style={{ marginTop: 18, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8, fontFamily: "'DM Sans', sans-serif" }}>Recent Deliveries</div>
            {deliveries.slice(0, 5).map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#6b7280', fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>
                <span style={{ fontWeight: 700, color: d.status === 'delivered' ? '#16a34a' : '#dc2626' }}>{d.status === 'delivered' ? '✓' : '✗'}</span>
                <span style={{ fontFamily: 'monospace', color: '#374151' }}>{d.event_type}</span>
                <span>{d.endpoint_name}</span>
                <span style={{ marginLeft: 'auto' }}>{d.response_code || '—'} · {d.delivered_at ? new Date(d.delivered_at).toLocaleTimeString() : '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* API Keys */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '20px 24px' }}>
        {secHead('API Keys')}
        <div style={{ marginBottom: 12, padding: '12px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Gateway Endpoint</div>
          <code style={{ fontSize: 11, color: '#1e293b' }}>POST https://rapidnote-backend.onrender.com/v1/gateway/submit</code>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3, fontFamily: 'monospace' }}>Header: X-API-Key: {'<your-key>'}</div>
        </div>

        {newKey && (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', marginBottom: 6, fontFamily: "'Public Sans', sans-serif" }}>New API Key — copy now, it won't be shown again</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ fontSize: 11, color: '#166534', wordBreak: 'break-all', flex: 1 }}>{newKey}</code>
              <button onClick={copyKey} style={{ flexShrink: 0, padding: '4px 10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>{copied ? 'Copied!' : 'Copy'}</button>
              <button onClick={() => setNewKey(null)} style={{ flexShrink: 0, padding: '4px 10px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>Dismiss</button>
            </div>
          </div>
        )}

        {apiKeys.map(k => (
          <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', fontFamily: "'Public Sans', sans-serif" }}>{k.name}</div>
              <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: "'DM Sans', sans-serif" }}>Created {new Date(k.created_at).toLocaleDateString()} · Last used: {k.last_used ? new Date(k.last_used).toLocaleDateString() : 'never'}</div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: k.is_active ? '#f0fdf4' : '#f1f5f9', color: k.is_active ? '#16a34a' : '#9ca3af' }}>{k.is_active ? 'Active' : 'Revoked'}</span>
            {k.is_active && <button onClick={() => handleRevokeKey(k.id)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Revoke</button>}
          </div>
        ))}

        <form onSubmit={handleGenerateKey} style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <input value={keyName} onChange={e => setKeyName(e.target.value)} placeholder="Key name (e.g. EHR System)" style={{ ...inputS, flex: 1 }} required />
          <button type="submit" style={{ flexShrink: 0, padding: '8px 16px', background: '#1a3a5c', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Public Sans', sans-serif" }}>Generate Key</button>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK IMPORT VIEW (Phase 25)
// ─────────────────────────────────────────────────────────────────────────────
const BULK_TEMPLATE = `provider_name,provider_npi,member_name,member_id,dob,member_state,discipline,diagnosis_codes,requested_visits,plan_id,provider_notes
Springfield PT Clinic,1234567890,Jane Smith,MBR-001,1978-04-12,CA,PT,M54.5;M47.816,12,BCBS-STD,Lower back pain with radiculopathy
Lakeside OT Associates,0987654321,Marcus Lee,MBR-002,1990-07-22,NY,OT,F84.0,16,,Sensory processing and ADL goals`;

function BulkImportView({ token }) {
  const [csv,     setCsv]     = React.useState('');
  const [result,  setResult]  = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error,   setError]   = React.useState('');

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsv(ev.target.result);
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (!csv.trim()) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await axios.post(`${API_BASE}/v1/bulk-import`, { csv }, { headers: { Authorization: `Bearer ${token}` } });
      setResult(r.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed.');
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([BULK_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'cogentcr-bulk-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const inputS = { padding: '8px 12px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, fontFamily: "'DM Sans', sans-serif" };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>Bulk Case Import</div>
        <div style={{ fontSize: 12, color: '#6b7280', fontFamily: "'Public Sans', sans-serif" }}>Upload a CSV to batch-submit multiple cases at once</div>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={downloadTemplate} style={{ ...inputS, background: '#f8fafc', color: '#1a3a5c', border: '1px solid #cbd5e1', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>Download Template CSV</button>
          <label style={{ ...inputS, background: '#f8fafc', color: '#1a3a5c', border: '1px solid #cbd5e1', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
            Upload CSV <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} style={{ display: 'none' }} />
          </label>
        </div>

        <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, fontFamily: "'DM Sans', sans-serif" }}>CSV Content</div>
        <textarea
          value={csv} onChange={e => setCsv(e.target.value)}
          placeholder="Paste CSV here or upload a file above…"
          style={{ width: '100%', minHeight: 160, padding: '10px 12px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box', resize: 'vertical' }}
        />
        <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af', fontFamily: "'DM Sans', sans-serif" }}>
          Columns: provider_name, provider_npi, member_name, member_id, dob, member_state, discipline, diagnosis_codes (semicolon-separated), requested_visits, plan_id, provider_notes
        </div>

        {error && <div style={{ marginTop: 10, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, fontSize: 12, color: '#dc2626', fontFamily: "'Public Sans', sans-serif" }}>{error}</div>}

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleSubmit} disabled={loading || !csv.trim()}
            style={{ padding: '9px 20px', background: loading ? '#94a3b8' : '#1a3a5c', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: "'Public Sans', sans-serif" }}>
            {loading ? 'Importing…' : 'Run Import'}
          </button>
        </div>
      </div>

      {result && (
        <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '20px 24px' }}>
          <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
            {[['Imported', result.imported, '#16a34a', '#f0fdf4'], ['Skipped', result.skipped, '#d97706', '#fffbeb'], ['Errors', result.errors, '#dc2626', '#fef2f2']].map(([label, val, color, bg]) => (
              <div key={label} style={{ padding: '12px 20px', background: bg, borderRadius: 8, textAlign: 'center', minWidth: 80 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'Fraunces', Georgia, serif" }}>{val}</div>
                <div style={{ fontSize: 11, color, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {result.results.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12, fontFamily: "'DM Sans', sans-serif", alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: r.status === 'imported' ? '#16a34a' : r.status === 'skipped' ? '#d97706' : '#dc2626' }}>{r.status === 'imported' ? '✓' : '!'}</span>
                <span style={{ color: '#374151' }}>Row {r.row} — {r.memberName || '(no name)'}</span>
                {r.submissionId && <span style={{ fontFamily: 'monospace', color: '#9ca3af', fontSize: 11 }}>{r.submissionId}</span>}
                {r.reason && <span style={{ color: '#dc2626' }}>{r.reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT VIEW (Phase 27)
// ─────────────────────────────────────────────────────────────────────────────
const ROLES = ['reviewer', 'provider', 'master', 'medical_director'];
const DISCS = ['PT', 'OT', 'ST'];

function UserManagementView({ token }) {
  const [users,   setUsers]   = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [form,    setForm]    = React.useState({ email: '', password: '', fullName: '', role: 'reviewer', discipline: 'PT', allowedDisciplines: ['PT'] });
  const [editing, setEditing] = React.useState(null);
  const [toast,   setToast]   = React.useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const fetchUsers = () => {
    axios.get(`${API_BASE}/v1/admin/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setUsers(r.data.users || []); setLoading(false); })
      .catch(() => setLoading(false));
  };
  React.useEffect(() => { fetchUsers(); }, [token]); // eslint-disable-line

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/v1/admin/users`, form, { headers: { Authorization: `Bearer ${token}` } });
      setForm({ email: '', password: '', fullName: '', role: 'reviewer', discipline: 'PT', allowedDisciplines: ['PT'] });
      fetchUsers(); showToast('User created.');
    } catch (err) { showToast(err.response?.data?.error || 'Failed to create user.'); }
  };

  const handleToggleActive = async (u) => {
    await axios.patch(`${API_BASE}/v1/admin/users/${u.id}`, { isActive: !u.is_active }, { headers: { Authorization: `Bearer ${token}` } });
    fetchUsers(); showToast(u.is_active ? 'User deactivated.' : 'User reactivated.');
  };

  const handleSaveEdit = async () => {
    try {
      await axios.patch(`${API_BASE}/v1/admin/users/${editing.id}`, { role: editing.role, discipline: editing.discipline, allowedDisciplines: editing.allowed_disciplines, fullName: editing.full_name }, { headers: { Authorization: `Bearer ${token}` } });
      setEditing(null); fetchUsers(); showToast('User updated.');
    } catch (err) { showToast(err.response?.data?.error || 'Failed to update.'); }
  };

  const roleColor = (r) => ({ reviewer: '#1d4ed8', provider: '#15803d', master: '#0d1b2a', medical_director: '#7c3aed' }[r] || '#374151');
  const inputS = { padding: '7px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, fontFamily: "'DM Sans', sans-serif", width: '100%', boxSizing: 'border-box' };

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '28px 24px' }}>
      {toast && <div style={{ position: 'fixed', top: 20, right: 24, background: '#1e293b', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 13, zIndex: 9999, fontFamily: "'Public Sans', sans-serif" }}>{toast}</div>}

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>User Management</div>
        <div style={{ fontSize: 12, color: '#6b7280', fontFamily: "'Public Sans', sans-serif" }}>Create accounts, assign roles and disciplines, activate/deactivate users</div>
      </div>

      {/* User list */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 24, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 70px 140px 80px', padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', fontFamily: "'DM Sans', sans-serif" }}>
          <span>User</span><span>Role</span><span>Disc.</span><span>Disciplines</span><span>Status</span>
        </div>
        {loading ? <div style={{ padding: 20, color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>Loading…</div> :
          users.map(u => (
            <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 70px 140px 80px', padding: '11px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 12, fontFamily: "'DM Sans', sans-serif', opacity: u.is_active ? 1 : 0.5" }}>
              <div>
                <div style={{ fontWeight: 600, color: '#1e293b', fontFamily: "'Public Sans', sans-serif" }}>{u.full_name || '—'}</div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>{u.email}</div>
              </div>
              {editing?.id === u.id ? (
                <>
                  <select value={editing.role} onChange={e => setEditing(x => ({...x, role: e.target.value}))} style={{ ...inputS, width: 'auto' }}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <select value={editing.discipline || ''} onChange={e => setEditing(x => ({...x, discipline: e.target.value || null}))} style={{ ...inputS, width: 'auto' }}>
                    <option value="">—</option>{DISCS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {DISCS.map(d => <label key={d} style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 2 }}><input type="checkbox" checked={(editing.allowed_disciplines||[]).includes(d)} onChange={e => setEditing(x => ({ ...x, allowed_disciplines: e.target.checked ? [...(x.allowed_disciplines||[]), d] : (x.allowed_disciplines||[]).filter(v => v !== d) }))} />{d}</label>)}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={handleSaveEdit} style={{ padding: '3px 8px', background: '#1a3a5c', color: '#fff', border: 'none', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>Save</button>
                    <button onClick={() => setEditing(null)} style={{ padding: '3px 8px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>Cancel</button>
                  </div>
                </>
              ) : (
                <>
                  <span style={{ padding: '2px 8px', borderRadius: 10, background: '#f0f4ff', color: roleColor(u.role), fontWeight: 700, fontSize: 10, width: 'fit-content' }}>{u.role}</span>
                  <span>{u.discipline || '—'}</span>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>{(u.allowed_disciplines||[]).map(d => <span key={d} style={{ padding: '1px 5px', background: '#eff6ff', color: '#1a3a5c', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>{d}</span>)}</div>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, color: u.is_active ? '#16a34a' : '#9ca3af', fontSize: 10 }}>{u.is_active ? 'Active' : 'Inactive'}</span>
                    <button onClick={() => setEditing({...u})} style={{ padding: '2px 7px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>Edit</button>
                    <button onClick={() => handleToggleActive(u)} style={{ padding: '2px 7px', background: u.is_active ? '#fef2f2' : '#f0fdf4', color: u.is_active ? '#dc2626' : '#16a34a', border: `1px solid ${u.is_active ? '#fca5a5' : '#86efac'}`, borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>{u.is_active ? 'Deactivate' : 'Activate'}</button>
                  </div>
                </>
              )}
            </div>
          ))}
      </div>

      {/* Create user form */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '20px 24px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', fontFamily: "'Fraunces', Georgia, serif", marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid #f1f5f9' }}>Create New User</div>
        <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 14px' }}>
          {[['Email', 'email', 'email', 'reviewer@example.com'], ['Password', 'password', 'password', 'Min 8 chars'], ['Full Name', 'fullName', 'text', 'Dr. Jane Doe']].map(([label, key, type, ph]) => (
            <div key={key}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
              <input type={type} value={form[key]} onChange={e => setForm(f => ({...f, [key]: e.target.value}))} placeholder={ph} style={inputS} required={key !== 'fullName'} />
            </div>
          ))}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Role</div>
            <select value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))} style={inputS}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Primary Discipline</div>
            <select value={form.discipline} onChange={e => setForm(f => ({...f, discipline: e.target.value}))} style={inputS}>
              <option value="">None</option>{DISCS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, fontFamily: "'DM Sans', sans-serif" }}>Allowed Disciplines</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {DISCS.map(d => <label key={d} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={form.allowedDisciplines.includes(d)} onChange={e => setForm(f => ({ ...f, allowedDisciplines: e.target.checked ? [...f.allowedDisciplines, d] : f.allowedDisciplines.filter(v => v !== d) }))} />{d}</label>)}
            </div>
          </div>
          <div style={{ gridColumn: '1 / 4', display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="submit" style={{ padding: '9px 20px', background: '#1a3a5c', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Public Sans', sans-serif" }}>Create User</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT EXPORT & COMPLIANCE VIEW (Phase 28)
// ─────────────────────────────────────────────────────────────────────────────
function AuditExportView({ token }) {
  const [summary, setSummary] = React.useState(null);
  const [startDate, setStartDate] = React.useState('');
  const [endDate,   setEndDate]   = React.useState('');
  const [loading,   setLoading]   = React.useState(true);

  const fetchSummary = (s, e) => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/compliance-summary`, {
      params: { ...(s ? { startDate: s } : {}), ...(e ? { endDate: e } : {}) },
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => { setSummary(r.data); setLoading(false); }).catch(() => setLoading(false));
  };

  React.useEffect(() => { fetchSummary('', ''); }, [token]); // eslint-disable-line

  const handleExport = async () => {
    const params = new URLSearchParams({ ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) });
    const r = await axios.get(`${API_BASE}/v1/audit-export?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'blob',
    });
    const blob = new Blob([r.data], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cogentcr-audit-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const inputS = { padding: '7px 12px', borderRadius: 7, border: '1px solid #d1d5db', fontSize: 13, fontFamily: "'DM Sans', sans-serif" };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '28px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>Audit Export & Compliance</div>
        <div style={{ fontSize: 12, color: '#6b7280', fontFamily: "'Public Sans', sans-serif" }}>HIPAA-ready audit trail export and compliance metrics</div>
      </div>

      {/* Date filter + export */}
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0', padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>From</div><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputS} /></div>
        <div><div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>To</div><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputS} /></div>
        <button onClick={() => fetchSummary(startDate, endDate)} style={{ ...inputS, background: '#f8fafc', color: '#1a3a5c', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}>Update</button>
        <button onClick={handleExport} style={{ ...inputS, background: '#1a3a5c', color: '#fff', fontWeight: 600, cursor: 'pointer', border: 'none', fontSize: 12 }}>Download Audit CSV</button>
      </div>

      {/* Compliance summary cards */}
      {loading ? <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 24 }}>Loading…</div> : summary && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
            {[
              ['Total Cases',     summary.totalCases,    '#1a3a5c', '#eff6ff'],
              ['Approved',        summary.totalApproved, '#16a34a', '#f0fdf4'],
              ['Adverse',         summary.totalAdverse,  '#dc2626', '#fef2f2'],
              ['Avg TAT (hrs)',   summary.avgTatHours,   '#d97706', '#fffbeb'],
            ].map(([label, val, color, bg]) => (
              <div key={label} style={{ background: bg, borderRadius: 10, padding: '16px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: "'Fraunces', Georgia, serif" }}>{val}</div>
                <div style={{ fontSize: 11, color, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {[
              ['Adverse Rate',    `${summary.adverseRate}%`,  '#dc2626', '#fef2f2'],
              ['Appeals Filed',   summary.totalAppeals,       '#6d28d9', '#f5f3ff'],
              ['Overturned',      summary.overturned,         '#d97706', '#fffbeb'],
              ['Audit Entries',   summary.auditEntries,       '#374151', '#f8fafc'],
            ].map(([label, val, color, bg]) => (
              <div key={label} style={{ background: bg, borderRadius: 10, padding: '16px 18px', textAlign: 'center' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: "'Fraunces', Georgia, serif" }}>{val}</div>
                <div style={{ fontSize: 11, color, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE RULES BAR + VIEW (Phase 23)
// ─────────────────────────────────────────────────────────────────────────────
const RULE_TYPE_META = {
  direct_access:       { label: "Direct Access",    color: "#15803d", bg: "#f0fdf4", border: "#86efac" },
  appeal_std_days:     { label: "Std Appeal",       color: "#1d4ed8", bg: "#eff6ff", border: "#93c5fd" },
  urgent_appeal_hours: { label: "Urgent Appeal",    color: "#6d28d9", bg: "#f5f3ff", border: "#c4b5fd" },
  autism_mandate:      { label: "Autism Mandate",   color: "#c2410c", bg: "#fff7ed", border: "#fdba74" },
  telehealth_parity:   { label: "Telehealth",       color: "#0e7490", bg: "#ecfeff", border: "#67e8f9" },
  visit_limit:         { label: "Visit Limit",      color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
};

function StateRulesBar({ state, discipline, token }) {
  const [rules, setRules] = React.useState([]);

  React.useEffect(() => {
    if (!state || state === "—") return;
    axios.get(`${API_BASE}/v1/state-rules`, {
      params: { state, discipline },
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => setRules(r.data.rules || []))
      .catch(() => {});
  }, [state, discipline, token]); // eslint-disable-line

  if (!rules.length) return null;

  // Show up to 3 most relevant rules
  const priority = ["direct_access","appeal_std_days","urgent_appeal_hours","autism_mandate","telehealth_parity"];
  const sorted = [...rules].sort((a, b) => {
    const ai = priority.indexOf(a.rule_type); const bi = priority.indexOf(b.rule_type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  }).slice(0, 3);

  return (
    <div style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", padding: "7px 20px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>{state} Rules</span>
      {sorted.map(r => {
        const m = RULE_TYPE_META[r.rule_type] || { label: r.rule_type, color: "#374151", bg: "#f1f5f9", border: "#cbd5e1" };
        const detail = r.rule_type === "appeal_std_days" ? ` · ${r.value_days}d` : r.rule_type === "urgent_appeal_hours" ? ` · ${r.value_hours}h` : "";
        return (
          <span key={r.id} title={r.summary} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: m.bg, color: m.color, border: `1px solid ${m.border}`, fontFamily: "'DM Sans', sans-serif", cursor: "default" }}>
            {m.label}{detail}
          </span>
        );
      })}
    </div>
  );
}

function StateRulesView({ token }) {
  const [stateFilter, setStateFilter] = React.useState("");
  const [discFilter,  setDiscFilter]  = React.useState("");
  const [rules,       setRules]       = React.useState([]);
  const [loading,     setLoading]     = React.useState(false);

  const STATES = ["AZ","CA","CO","FL","GA","IL","MA","MI","NC","NJ","NY","OH","PA","TX","WA"];

  const fetchRules = (s, d) => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/state-rules`, {
      params: { ...(s ? { state: s } : {}), ...(d ? { discipline: d } : {}) },
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => { setRules(r.data.rules || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  React.useEffect(() => { fetchRules("", ""); }, [token]); // eslint-disable-line

  const handleState = (v) => { setStateFilter(v); fetchRules(v, discFilter); };
  const handleDisc  = (v) => { setDiscFilter(v);  fetchRules(stateFilter, v); };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1e293b", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>State-Specific Rules</div>
        <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>Direct access laws, appeal timeframes, and coverage mandates by state</div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <select value={stateFilter} onChange={e => handleState(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'Public Sans', sans-serif", cursor: "pointer" }}>
          <option value="">All States</option>
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={discFilter} onChange={e => handleDisc(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'Public Sans', sans-serif", cursor: "pointer" }}>
          <option value="">All Disciplines</option>
          <option value="PT">PT</option>
          <option value="OT">OT</option>
          <option value="ST">ST</option>
        </select>
      </div>

      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "50px 60px 140px 1fr 200px", padding: "10px 16px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>
          <span>State</span><span>Disc.</span><span>Rule Type</span><span>Summary</span><span>Citation</span>
        </div>
        {loading ? (
          <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, textAlign: "center" }}>Loading…</div>
        ) : rules.length === 0 ? (
          <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>No rules found — run POST /v1/_migrate-state-rules to seed data.</div>
        ) : rules.map(r => {
          const m = RULE_TYPE_META[r.rule_type] || { label: r.rule_type, color: "#374151", bg: "#f1f5f9", border: "#cbd5e1" };
          return (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "50px 60px 140px 1fr 200px", padding: "11px 16px", borderBottom: "1px solid #f1f5f9", alignItems: "start", fontSize: 12, fontFamily: "'DM Sans', sans-serif" }}>
              <span style={{ fontWeight: 700, color: "#1e293b" }}>{r.state}</span>
              <span style={{ padding: "2px 7px", borderRadius: 5, background: "#eff6ff", color: "#1a3a5c", fontSize: 10, fontWeight: 700, width: "fit-content" }}>{r.discipline}</span>
              <span style={{ padding: "2px 8px", borderRadius: 10, background: m.bg, color: m.color, border: `1px solid ${m.border}`, fontSize: 10, fontWeight: 700, width: "fit-content" }}>{m.label}</span>
              <span style={{ color: "#374151", lineHeight: 1.5 }}>{r.summary}</span>
              <span style={{ color: "#9ca3af", fontSize: 11 }}>{r.citation || "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CRITERIA LIBRARY (Phase 20)
// ─────────────────────────────────────────────────────────────────────────────
function CriteriaLibraryView({ token }) {
  const [query,      setQuery]      = useState("");
  const [discipline, setDisc]       = useState("");
  const [results,    setResults]    = useState(null);
  const [selected,   setSelected]   = useState(null);
  const [detail,     setDetail]     = useState(null);
  const [loading,    setLoading]    = useState(false);

  const search = async () => {
    setLoading(true);
    setSelected(null);
    setDetail(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (discipline) params.set("discipline", discipline);
      const res = await axios.get(`${API_BASE}/v1/criteria?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      setResults(res.data);
    } catch { setResults([]); }
    finally { setLoading(false); }
  };

  const loadDetail = async (row) => {
    setSelected(row);
    setDetail(null);
    try {
      const res = await axios.get(`${API_BASE}/v1/criteria/${row.id}`, { headers: { Authorization: `Bearer ${token}` } });
      setDetail(res.data);
    } catch { setDetail(row); }
  };

  useEffect(() => { search(); }, []); // eslint-disable-line

  const DISC_TABS = [["","All"], ["PT","PT"], ["OT","OT"], ["ST","ST"]];

  const ex = detail?.criteria_json || {};
  const vb = ex.visit_benchmarks || {};
  const cpg = ex.cpg || {};
  const freqBySev = ex.frequency_by_severity || {};
  const severityRows = Object.entries(freqBySev);

  return (
    <div style={{ display: "flex", height: "calc(100vh - 49px)", overflow: "hidden" }}>

      {/* ── Left: search + list ── */}
      <div style={{ width: 360, borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", background: "#fff", flexShrink: 0 }}>
        {/* Search bar */}
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && search()}
              placeholder="ICD-10 code or keyword…"
              style={{ flex: 1, border: "1px solid #d1d5db", borderRadius: 7, padding: "7px 11px", fontSize: 13, fontFamily: "'Public Sans', sans-serif", outline: "none" }}
            />
            <button onClick={search} disabled={loading}
              style={{ padding: "7px 14px", borderRadius: 7, background: "#1a3a5c", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
              {loading ? "…" : "Search"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            {DISC_TABS.map(([v, label]) => (
              <button key={v} onClick={() => { setDisc(v); }}
                style={{ padding: "4px 11px", borderRadius: 20, fontSize: 11, fontWeight: 600, border: "1.5px solid", fontFamily: "'DM Sans', sans-serif", cursor: "pointer",
                  background: discipline === v ? "#1a3a5c" : "transparent",
                  color: discipline === v ? "#fff" : "#64748b",
                  borderColor: discipline === v ? "#1a3a5c" : "#d1d5db" }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Results list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {results === null && <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>Loading…</div>}
          {results?.length === 0 && <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>No results. Try a different search.</div>}
          {results?.map(row => {
            const discColor = row.discipline === "OT" ? "#c2410c" : row.discipline === "ST" ? "#15803d" : "#1a3a5c";
            const isActive = selected?.id === row.id;
            return (
              <div key={row.id} onClick={() => loadDetail(row)}
                style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", cursor: "pointer",
                  background: isActive ? "#eff6ff" : "transparent",
                  borderLeft: isActive ? "3px solid #1a3a5c" : "3px solid transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{ background: discColor, color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, fontFamily: "'DM Sans', sans-serif" }}>{row.discipline}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#1a3a5c", fontFamily: "'DM Sans', sans-serif" }}>{row.code}</span>
                  {row.is_custom && <span style={{ fontSize: 9, fontWeight: 700, color: "#7c3aed", background: "#ede9fe", padding: "1px 5px", borderRadius: 4, fontFamily: "'DM Sans', sans-serif" }}>CUSTOM</span>}
                </div>
                <div style={{ fontSize: 12, color: "#374151", fontFamily: "'Public Sans', sans-serif", lineHeight: 1.4 }}>{row.condition_label || row.description}</div>
                {(row.typical_visits_min || row.typical_visits_max) && (
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, fontFamily: "'Public Sans', sans-serif" }}>
                    Typical: {row.typical_visits_min}–{row.typical_visits_max} visits
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {results !== null && <div style={{ padding: "8px 16px", fontSize: 11, color: "#9ca3af", borderTop: "1px solid #f1f5f9", fontFamily: "'Public Sans', sans-serif" }}>{results.length} result{results.length !== 1 ? "s" : ""}</div>}
      </div>

      {/* ── Right: detail panel ── */}
      <div style={{ flex: 1, overflowY: "auto", background: "#f8fafc", padding: selected ? "24px 28px" : 0 }}>
        {!selected && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
            <div style={{ fontSize: 36 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8", fontFamily: "'Fraunces', Georgia, serif" }}>Select a criteria entry</div>
            <div style={{ fontSize: 13, color: "#cbd5e1", fontFamily: "'Public Sans', sans-serif" }}>Search for a diagnosis code or condition</div>
          </div>
        )}
        {selected && !detail && <div style={{ padding: 32, color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>Loading…</div>}
        {selected && detail && (() => {
          const discColor = selected.discipline === "OT" ? "#c2410c" : selected.discipline === "ST" ? "#15803d" : "#1a3a5c";
          const SectionHead = ({ children }) => (
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#6b7280", fontFamily: "'DM Sans', sans-serif", marginBottom: 8, marginTop: 20 }}>{children}</div>
          );
          const Card = ({ children, style }) => (
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "14px 18px", ...style }}>{children}</div>
          );
          return (
            <div style={{ maxWidth: 760 }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ background: discColor, color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5, fontFamily: "'DM Sans', sans-serif" }}>{selected.discipline}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", fontFamily: "'DM Sans', sans-serif" }}>{selected.code}</span>
                    <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>{selected.source}</span>
                    {selected.is_custom && <span style={{ fontSize: 10, color: "#7c3aed", background: "#ede9fe", padding: "1px 6px", borderRadius: 4, fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>CUSTOM</span>}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.2 }}>{selected.condition_label || selected.description}</div>
                  {ex.description && ex.description !== selected.condition_label && (
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4, fontFamily: "'Public Sans', sans-serif" }}>{ex.description}</div>
                  )}
                </div>
              </div>

              {/* Visit benchmarks */}
              {(vb.typical_visits || vb.median_visits) && (
                <>
                  <SectionHead>Visit Benchmarks</SectionHead>
                  <Card>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px 0" }}>
                      {[
                        ["Typical", vb.typical_visits],
                        ["Median",  vb.median_visits],
                        ["P75",     vb.p75_visits],
                        ["Episode Max", vb.max_visits_episode],
                      ].filter(([,v]) => v).map(([label, val]) => (
                        <div key={label} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 24, fontWeight: 800, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>{val}</div>
                          <div style={{ fontSize: 10, color: "#6b7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
                        </div>
                      ))}
                    </div>
                    {vb.notes && <div style={{ marginTop: 12, fontSize: 12, color: "#4b5563", fontFamily: "'Public Sans', sans-serif", lineHeight: 1.6, borderTop: "1px solid #f1f5f9", paddingTop: 10 }}>{vb.notes}</div>}
                    {vb.provenance_note && <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif", lineHeight: 1.5, fontStyle: "italic" }}>Provenance{vb.provenance ? ` (${vb.provenance})` : ""}: {vb.provenance_note}</div>}
                  </Card>
                </>
              )}

              {/* Frequency by severity */}
              {severityRows.length > 0 && (
                <>
                  <SectionHead>Frequency by Severity</SectionHead>
                  <Card style={{ padding: 0, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "'Public Sans', sans-serif" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          {["Severity","Frequency","Duration","Total Visits"].map(h => (
                            <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif", borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {severityRows.map(([sev, data], i) => (
                          <tr key={sev} style={{ borderBottom: i < severityRows.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                            <td style={{ padding: "8px 14px", fontWeight: 600, color: "#374151", textTransform: "capitalize" }}>{sev.replace(/_/g, " ")}</td>
                            <td style={{ padding: "8px 14px", color: "#1a3a5c", fontWeight: 600 }}>{data.max_freq} {data.unit}</td>
                            <td style={{ padding: "8px 14px", color: "#374151" }}>{data.duration_weeks} wks</td>
                            <td style={{ padding: "8px 14px", color: "#374151" }}>{data.total_visits}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                </>
              )}

              {/* CPG info */}
              {(cpg.primary || cpg.key_recommendations) && (
                <>
                  <SectionHead>Clinical Practice Guideline</SectionHead>
                  <Card>
                    {cpg.primary && <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", fontFamily: "'Public Sans', sans-serif", marginBottom: 6 }}>{cpg.primary}</div>}
                    {cpg.evidence_level && <span style={{ fontSize: 11, background: "#dcfce7", color: "#15803d", borderRadius: 5, padding: "2px 8px", fontWeight: 700, fontFamily: "'DM Sans', sans-serif" }}>{cpg.evidence_level}</span>}
                    {cpg.key_recommendations?.length > 0 && (
                      <ul style={{ margin: "10px 0 0", padding: "0 0 0 18px" }}>
                        {cpg.key_recommendations.map((r, i) => <li key={i} style={{ fontSize: 12, color: "#374151", fontFamily: "'Public Sans', sans-serif", marginBottom: 4, lineHeight: 1.5 }}>{r}</li>)}
                      </ul>
                    )}
                    {cpg.citation && <div style={{ marginTop: 10, fontSize: 11, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif", fontStyle: "italic" }}>{cpg.citation}</div>}
                  </Card>
                </>
              )}

              {/* Red flags */}
              {ex.red_flags?.length > 0 && (
                <>
                  <SectionHead>Red Flags</SectionHead>
                  <Card style={{ background: "#fff7ed", borderColor: "#fed7aa" }}>
                    <ul style={{ margin: 0, padding: "0 0 0 18px" }}>
                      {ex.red_flags.map((f, i) => <li key={i} style={{ fontSize: 12, color: "#c2410c", fontFamily: "'Public Sans', sans-serif", marginBottom: 4, lineHeight: 1.5, fontWeight: 500 }}>{f}</li>)}
                    </ul>
                  </Card>
                </>
              )}

              {/* Skilled care indicators */}
              {ex.skilled_care_indicators?.length > 0 && (
                <>
                  <SectionHead>Skilled Care Indicators</SectionHead>
                  <Card>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {ex.skilled_care_indicators.map((s, i) => (
                        <span key={i} style={{ background: "#eff6ff", color: "#1a3a5c", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{s}</span>
                      ))}
                    </div>
                  </Card>
                </>
              )}

              {/* LOS triggers */}
              {ex.los_triggers?.length > 0 && (
                <>
                  <SectionHead>Discharge / LOS Triggers</SectionHead>
                  <Card>
                    <ul style={{ margin: 0, padding: "0 0 0 18px" }}>
                      {ex.los_triggers.map((t, i) => <li key={i} style={{ fontSize: 12, color: "#374151", fontFamily: "'Public Sans', sans-serif", marginBottom: 4, lineHeight: 1.5 }}>{t}</li>)}
                    </ul>
                  </Card>
                </>
              )}

              {/* Special considerations */}
              {ex.special_considerations?.length > 0 && (
                <>
                  <SectionHead>Special Considerations</SectionHead>
                  <Card>
                    <ul style={{ margin: 0, padding: "0 0 0 18px" }}>
                      {ex.special_considerations.map((s, i) => <li key={i} style={{ fontSize: 12, color: "#374151", fontFamily: "'Public Sans', sans-serif", marginBottom: 4, lineHeight: 1.5 }}>{s}</li>)}
                    </ul>
                  </Card>
                </>
              )}

              <div style={{ height: 40 }} />
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWER SHELL
// ─────────────────────────────────────────────────────────────────────────────
function ReviewerShell({ user, token, onLogout }) {
  const [revView, setRevView]               = useState("home");
  const [assignedCase, setAssignedCase]     = useState(null);
  const [queueStats, setQueueStats]         = useState(null);
  const [getCaseLoading, setGetCaseLoading] = useState(false);
  const [getCaseError, setGetCaseError]     = useState("");
  const [toolsOpen, setToolsOpen]           = useState(false);
  const [exitModal, setExitModal]           = useState(false); // "hold"|"release"|false
  const [exitReason, setExitReason]         = useState("");
  const [exitLoading, setExitLoading]       = useState(false);
  const [exitError, setExitError]           = useState("");
  const [isAvailable, setIsAvailable]       = useState(true);
  const DISC_COLOR = user.discipline === "OT" ? "#c2410c" : user.discipline === "ST" ? "#15803d" : "#1a3a5c";

  useEffect(() => {
    const h = { Authorization: `Bearer ${token}` };
    axios.get(`${API_BASE}/v1/queue-stats`, { headers: h }).then(r => setQueueStats(r.data)).catch(() => {});
    axios.get(`${API_BASE}/v1/my-availability`, { headers: h })
      .then(r => setIsAvailable(r.data.availability?.is_available !== false))
      .catch(() => {});
  }, [token, revView]); // eslint-disable-line

  const toggleAvailability = async () => {
    const next = !isAvailable;
    setIsAvailable(next);
    try {
      await axios.patch(`${API_BASE}/v1/my-availability`, { isAvailable: next }, { headers: { Authorization: `Bearer ${token}` } });
    } catch { setIsAvailable(!next); } // revert on error
  };

  const handleGetCase = async () => {
    setGetCaseLoading(true);
    setGetCaseError("");
    try {
      const res = await axios.get(`${API_BASE}/v1/get-case`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.data.case) {
        const sub = res.data.case;
        const diags = Array.isArray(sub.diagnosis_codes) ? sub.diagnosis_codes : [];
        const storedMetrics = sub.extracted_metrics || {};
        setAssignedCase({
          caseId:         sub.submission_id,
          submissionId:   sub.submission_id,
          memberName:     sub.member_name || "Unknown Member",
          memberId:       sub.member_id   || "—",
          memberState:    sub.member_state || null,
          dob:            sub.dob         || "—",
          discipline:     sub.discipline  || user.discipline || "PT",
          reviewType:     sub.review_type || "initial",
          submittedAt:    sub.submitted_at,
          receivedAt:     sub.received_at || sub.submitted_at,
          reviewPriority: sub.review_priority || "standard",
          rmiSentAt:      sub.rmi_sent_at     || null,
          rmiRespondedAt: sub.rmi_responded_at || null,
          documents:      sub.document_list || [],
          requestedVisits: sub.requested_visits || null,
          metrics: {
            // Base fields always from submission form
            diagnosisCodes:       diags,
            requestedVisits:      sub.requested_visits || 0,
            therapyType:          sub.discipline || user.discipline || "PT",
            functionalLimitations: [],
            sopIndicators: [],
            documentationQuality: {},
            // Spread stored Claude extraction on top — populates ROM, MMT, pain, goals etc.
            ...storedMetrics,
            // Keep form-submitted values as authoritative — they're what actually got
            // persisted to submissions.* after /v1/submit-with-docs's own merge (explicit
            // provider input wins there too), so re-assert them here or the raw Claude
            // extraction spread above silently overwrites them. requestedVisits doing this
            // wrong is what showed a stale/extracted visit count (and a wrong determination
            // computed from it) instead of what the provider actually requested.
            diagnosisCodes: (storedMetrics.diagnosisCodes?.length ? storedMetrics.diagnosisCodes : diags),
            primaryDiagnosisCode: storedMetrics.primaryDiagnosisCode || diags[0] || null,
            requestedVisits: sub.requested_visits || 0,
            // The note's age is computed from dateOfBirth. When extraction did
            // not find one, the submitted DOB still has it — the header shows
            // that date while the note quietly lost the age. submissions.dob is
            // already the provider-input-wins merge of form and document, so it
            // is a safe fallback rather than a competing value.
            dateOfBirth: storedMetrics.dateOfBirth || sub.dob || null,
          },
          planRuleSet: sub.plan_id ? { planId: sub.plan_id } : null,
        });
        setRevView("cockpit");
      } else {
        setGetCaseError(res.data.message || "No cases available.");
      }
    } catch (err) {
      const serverMsg = err.response?.data?.error;
      const status    = err.response?.status;
      if (serverMsg) {
        setGetCaseError(`Server error (${status}): ${serverMsg}`);
      } else if (err.request) {
        setGetCaseError("Could not reach server — check your connection or try again.");
      } else {
        setGetCaseError(`Unexpected error: ${err.message}`);
      }
    } finally {
      setGetCaseLoading(false);
    }
  };

  const handleCaseDone = () => {
    setAssignedCase(null);
    setRevView("home");
    setExitModal(false);
    setExitReason("");
    setExitError("");
  };

  // ISSUE 4 FIX — a case opened from Search was never claimed server-side, so
  // assigned_reviewer_id in the DB never matched this reviewer and Hold/Release
  // always failed with "Case not found or not assigned to you." This claims the
  // case (self-assigns) before opening it, refusing to steal one actively assigned
  // to someone else. Throws on failure so CaseSearchView's button can show why.
  const handleOpenSearchCase = async (sub) => {
    if (sub.assigned_reviewer_id != null && sub.assigned_reviewer_id !== user.id) {
      throw new Error("This case is currently assigned to another reviewer.");
    }
    if (sub.assigned_reviewer_id !== user.id) {
      await axios.patch(
        `${API_BASE}/v1/submissions/${sub.submission_id}/assign`,
        { reviewerId: user.id },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    }
    const diags = Array.isArray(sub.diagnosis_codes) ? sub.diagnosis_codes : [];
    const storedMetrics = sub.extracted_metrics || {};
    setAssignedCase({
      caseId:         sub.submission_id,
      submissionId:   sub.submission_id,
      memberName:     sub.member_name    || "Unknown Member",
      memberId:       sub.member_id      || "—",
      memberState:    sub.member_state   || null,
      dob:            sub.dob            || "—",
      discipline:     sub.discipline     || user.discipline || "PT",
      reviewType:     sub.review_type    || "initial",
      submittedAt:    sub.submitted_at,
      receivedAt:     sub.received_at    || sub.submitted_at,
      reviewPriority: sub.review_priority || "standard",
      rmiSentAt:      sub.rmi_sent_at    || null,
      rmiRespondedAt: sub.rmi_responded_at || null,
      documents:      sub.document_list  || [],
      requestedVisits: sub.requested_visits || null,
      metrics: {
        diagnosisCodes:       diags,
        requestedVisits:      sub.requested_visits || 0,
        therapyType:          sub.discipline || user.discipline || "PT",
        functionalLimitations: [],
        sopIndicators: [],
        documentationQuality: {},
        ...storedMetrics,
        // Re-assert form-submitted values over the raw extraction spread above — same
        // fix as handleGetCase; see the comment there.
        diagnosisCodes: (storedMetrics.diagnosisCodes?.length ? storedMetrics.diagnosisCodes : diags),
        primaryDiagnosisCode: storedMetrics.primaryDiagnosisCode || diags[0] || null,
        requestedVisits: sub.requested_visits || 0,
        // Same DOB fallback as handleGetCase; see the comment there.
        dateOfBirth: storedMetrics.dateOfBirth || sub.dob || null,
      },
      planRuleSet: sub.plan_id ? { planId: sub.plan_id } : null,
    });
    setRevView("cockpit");
  };

  const handleHoldCase = async () => {
    if (!exitReason.trim()) { setExitError("Please enter a hold reason."); return; }
    setExitLoading(true); setExitError("");
    try {
      await axios.patch(
        `${API_BASE}/v1/submissions/${assignedCase.caseId}/hold`,
        { reason: exitReason.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      handleCaseDone();
    } catch (err) {
      setExitError(err.response?.data?.error || "Failed to hold case.");
      setExitLoading(false);
    }
  };

  const handleReleaseCase = async () => {
    if (!exitReason.trim()) { setExitError("Please enter a reason."); return; }
    setExitLoading(true); setExitError("");
    try {
      await axios.patch(
        `${API_BASE}/v1/submissions/${assignedCase.caseId}/release`,
        { reason: exitReason.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      handleCaseDone();
    } catch (err) {
      setExitError(err.response?.data?.error || "Failed to release case.");
      setExitLoading(false);
    }
  };

  const discLabel = user.discipline || "PT";
  const pendingCount = queueStats
    ? (queueStats.byDiscipline || []).filter(d => d.discipline === discLabel).reduce((s, r) => s + parseInt(r.count), 0)
    : null;

  // ── shared nav items ──
  const PRIMARY_TABS = [
    assignedCase ? ["cockpit", "★ Case Review"] : ["home", "Get Case"],
    ["search", "Search"],
    ["my_stats", "My Stats"],
    ["p2p", "P2P"],
    ["appeals", "Appeals"],
  ];

  const NavBar = () => (
    <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 28px", display: "flex", alignItems: "center", gap: 0, flexShrink: 0, position: "relative" }}>
      {PRIMARY_TABS.map(([v, label]) => {
        const active = revView === v;
        const isCockpit = v === "cockpit";
        return (
          <button key={v} onClick={() => setRevView(v)} style={{
            padding: "12px 18px", fontSize: 13,
            fontWeight: active ? 700 : 500,
            color: isCockpit ? (active ? "#1a3a5c" : "#c2410c") : (active ? "#1a3a5c" : "#6b7280"),
            background: active ? "transparent" : "transparent",
            border: "none",
            borderBottom: active ? "2.5px solid #1a3a5c" : "2.5px solid transparent",
            cursor: "pointer", fontFamily: "'Public Sans', sans-serif", transition: "all 0.1s",
            whiteSpace: "nowrap",
            borderRadius: "4px 4px 0 0",
          }}
          onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#f8fafc"; }}
          onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
          >{label}</button>
        );
      })}
      <div style={{ flex: 1 }} />
      {/* Tools dropdown */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setToolsOpen(o => !o)}
          style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "#6b7280", background: toolsOpen ? "#f1f5f9" : "none", border: "1px solid " + (toolsOpen ? "#e2e8f0" : "transparent"), borderRadius: 7, cursor: "pointer", fontFamily: "'Public Sans', sans-serif", display: "flex", alignItems: "center", gap: 5 }}
        >
          Tools <span style={{ fontSize: 10 }}>▾</span>
        </button>
        {toolsOpen && (
          <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 200, minWidth: 180, overflow: "hidden" }}
            onMouseLeave={() => setToolsOpen(false)}>
            {[["ur_form", "UR Review Form"], ["criteria", "Criteria Library"], ["state_rules", "State Rules"]].map(([v, label]) => (
              <button key={v} onClick={() => { setRevView(v); setToolsOpen(false); }} style={{
                display: "block", width: "100%", textAlign: "left", padding: "11px 18px",
                fontSize: 13, color: "#374151", background: revView === v ? "#f1f5f9" : "#fff",
                border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif",
                fontWeight: revView === v ? 700 : 400,
                borderBottom: "1px solid #f1f5f9",
              }}>{label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const Header = () => (
    <div style={{ background: "#1a3a5c", padding: "12px 28px", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
      <span style={{ fontSize: 17, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif", letterSpacing: "-0.02em" }}>CogentCR</span>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>|</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.75)", fontFamily: "'Public Sans', sans-serif" }}>Reviewer Portal</span>
      <div style={{ flex: 1 }} />
      {assignedCase && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px", borderRadius: 8, background: "rgba(251,191,36,0.18)", border: "1px solid rgba(251,191,36,0.4)" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fbbf24", display: "inline-block", animation: "rsPulse 1.5s ease-in-out infinite" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24", fontFamily: "'Public Sans', sans-serif" }}>Case in review</span>
          <span style={{ fontSize: 11, color: "rgba(251,191,36,0.7)", fontFamily: "'Public Sans', sans-serif" }}>{assignedCase.memberName}</span>
        </div>
      )}
      <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 12, background: DISC_COLOR, color: "#fff", border: "1.5px solid rgba(255,255,255,0.3)" }}>{discLabel}</span>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "'Public Sans', sans-serif" }}>{user.name || user.email}</span>
      {/* Availability toggle */}
      <button
        onClick={toggleAvailability}
        title={isAvailable ? "Click to mark yourself unavailable" : "Click to mark yourself available"}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "4px 12px", borderRadius: 20,
          background: isAvailable ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)",
          border: `1px solid ${isAvailable ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)"}`,
          cursor: "pointer", transition: "all 0.15s",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: isAvailable ? "#22c55e" : "#ef4444", display: "inline-block", flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: isAvailable ? "#86efac" : "#fca5a5", fontFamily: "'Public Sans', sans-serif" }}>
          {isAvailable ? "Available" : "Unavailable"}
        </span>
      </button>
      <NotificationBell token={token} />
      <button onClick={onLogout}
  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.2)"; }}
  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
  style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", transition: "background 0.1s" }}>Logout</button>
    </div>
  );

  // ── Exit-case modal (Hold / Release) ──
  const ExitModal = () => exitModal && (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9000 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "28px 32px", width: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#0d1b2a", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 6 }}>
          {exitModal === "hold" ? "Place Case on Hold" : "Return Case to Queue"}
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 18, fontFamily: "'Public Sans', sans-serif", lineHeight: 1.5 }}>
          {exitModal === "hold"
            ? "Case will be held for 1 business day then automatically returned to the queue."
            : "Case will be returned to the queue immediately and available for any reviewer."}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'Public Sans', sans-serif" }}>
          {exitModal === "hold" ? "Reason for hold" : "Reason for return"}
          <span style={{ color: "#dc2626" }}> *</span>
        </div>
        <textarea
          autoFocus
          value={exitReason}
          onChange={e => { setExitReason(e.target.value); setExitError(""); }}
          placeholder={exitModal === "hold"
            ? "e.g. Awaiting additional documentation from provider before completing review..."
            : "e.g. Outside scope of reviewer's discipline — returning to general queue..."}
          rows={3}
          style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #d1d5db", fontSize: 13, fontFamily: "'Public Sans', sans-serif", resize: "vertical", outline: "none", boxSizing: "border-box", lineHeight: 1.5 }}
        />
        {exitError && <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626", fontFamily: "'Public Sans', sans-serif" }}>{exitError}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button
            onClick={exitModal === "hold" ? handleHoldCase : handleReleaseCase}
            disabled={exitLoading}
            style={{
              flex: 1, padding: "11px 0", borderRadius: 8, border: "none",
              background: exitModal === "hold" ? "#1d4ed8" : "#dc2626",
              color: "#fff", fontSize: 13, fontWeight: 700, cursor: exitLoading ? "not-allowed" : "pointer",
              fontFamily: "'Public Sans', sans-serif", opacity: exitLoading ? 0.6 : 1,
            }}
          >{exitLoading ? "Saving..." : exitModal === "hold" ? "Confirm Hold" : "Return to Queue"}</button>
          <button
            onClick={() => { setExitModal(false); setExitReason(""); setExitError(""); }}
            style={{ padding: "11px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#374151", fontSize: 13, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );

  // ── Cockpit view (kept mounted while case active to preserve state) ──
  const cockpitVisible = revView === "cockpit" && !!assignedCase;

  // ── single unified return ──
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", fontFamily: "'Public Sans', system-ui, sans-serif", background: "#f1f5f9" }}>
      <style>{`
        @keyframes rsPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
      <Header />
      <NavBar />
      <ExitModal />

      {/* Cockpit — kept mounted while case is active; hidden when on another tab */}
      {assignedCase && (
        <div style={{ display: cockpitVisible ? "flex" : "none", flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <EpisodeContextBar memberId={assignedCase.memberId} discipline={assignedCase.discipline} token={token} />
          {/* Demo cleanup — plan-rules strip (StateRulesBar) removed from the cockpit
              route. Not shared with any other view (this was its only render call),
              so the component definition itself is left intact rather than deleted —
              see StateRulesView below for the standalone settings-page use of the
              same /v1/state-rules data. */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <Cockpit
              user={user}
              liveCase={assignedCase}
              hideQueueNav={true}
              onCaseDone={handleCaseDone}
              onHoldCase={() => { setExitReason(""); setExitError(""); setExitModal("hold"); }}
              onReleaseCase={() => { setExitReason(""); setExitError(""); setExitModal("release"); }}
            />
          </div>
        </div>
      )}

      {/* All other views */}
      <div style={{ display: cockpitVisible ? "none" : "flex", flex: 1, flexDirection: "column", overflow: "auto" }}>

        {/* Home / Get Case */}
        {revView === "home" && (
          <div style={{ maxWidth: 520, margin: "60px auto", padding: "0 24px", width: "100%" }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: "52px 40px 44px", boxShadow: "0 4px 24px rgba(26,58,92,0.13)", border: "1px solid #dde4ef", textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7280", marginBottom: 12 }}>{discLabel} Reviewer</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.1, marginBottom: 10 }}>Ready to review?</div>
              <div style={{ fontSize: 14, color: "#9ca3af", marginBottom: 36, lineHeight: 1.5 }}>Cases are assigned by priority and submission age.<br />Click below to get your next case.</div>
              <button onClick={handleGetCase} disabled={getCaseLoading} style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "16px 56px", borderRadius: 12, background: getCaseLoading ? "#94a3b8" : "#1a3a5c", color: "#fff", fontSize: 18, fontWeight: 700, border: "none", cursor: getCaseLoading ? "not-allowed" : "pointer", boxShadow: getCaseLoading ? "none" : "0 6px 20px rgba(26,58,92,0.38)", transition: "all 0.15s", letterSpacing: "-0.01em" }}>
                {getCaseLoading ? "Finding case…" : "Get Case"}
              </button>
              {getCaseError && <div style={{ marginTop: 18, fontSize: 13, color: "#dc2626" }}>{getCaseError}</div>}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              {[
                { label: "Pending in your queue", value: pendingCount !== null ? pendingCount : "—", color: pendingCount > 0 ? "#1a3a5c" : "#9ca3af" },
                { label: "Completed today", value: queueStats?.casesToday ?? "—", color: "#15803d" },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, background: "#fff", borderRadius: 12, padding: "16px 18px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 26, fontWeight: 800, color: s.color, fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 5 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {revView === "search"      && <CaseSearchView token={token} onOpenCase={handleOpenSearchCase} />}
        {revView === "my_stats"    && <ReviewerDashboard token={token} user={user} />}
        {revView === "p2p"         && <><div style={{ padding: "18px 24px 0" }}><ReviewerScheduleSettings token={token} /></div><P2PQueueView token={token} /></>}
        {revView === "appeals"     && <AppealsQueueView token={token} />}
        {revView === "criteria"    && <CriteriaLibraryView token={token} />}
        {revView === "state_rules" && <StateRulesView token={token} />}
        {revView === "ur_form"     && <URFormEmbed user={user} token={token} />}

      </div>
    </div>
  );
}

// Thin wrapper: lets ReviewerShell embed the existing form logic without full App state
function URFormEmbed({ user, token }) {
  const [reviewType, setReviewType]   = useState("initial");
  const [therapyType, setTherapyType] = useState(user.discipline || "PT");
  const [hpi, setHpi]                 = useState("");
  const [requestedVisits, setRequestedVisits] = useState("");
  const [files, setFiles]             = useState([]);
  const [review, setReview]           = useState("");
  const [clinicalSummary, setClinicalSummary] = useState("");
  const [hpiData, setHpiData]         = useState(null);
  const [ruling, setRuling]           = useState(null);
  const [metrics, setMetrics]         = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const authHeaders = { Authorization: `Bearer ${token}` };

  const handleSubmit = async () => {
    setError(""); setReview(""); setClinicalSummary(""); setHpiData(null); setRuling(null); setMetrics(null);
    if (files.length === 0) { setError("Please attach at least one PDF."); return; }
    if (!requestedVisits)   { setError("Requested Visits is required."); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append("pdfs", f));
      fd.append("reviewType", reviewType);
      fd.append("therapyType", therapyType);
      fd.append("hpi", hpi.trim());
      fd.append("requestedVisits", String(parseInt(requestedVisits || "0", 10)));
      const res = await axios.post(`${API_BASE}/api/generate-review`, fd, { headers: { "Content-Type": "multipart/form-data", ...authHeaders } });
      setReview(res.data.review || "");
      setClinicalSummary(res.data.clinicalSummary || "");
      setHpiData(res.data.hpiData || null);
      setRuling(res.data.ruling || null);
      setMetrics(res.data.metrics || null);
    } catch (err) {
      setError(err.response?.data?.error || "Review generation failed.");
    } finally {
      setLoading(false);
    }
  };

  const inputS = { width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box" };
  const labelS = (t) => <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>{t}</div>;

  return (
    <div style={{ maxWidth: 640, margin: "32px auto", padding: "0 24px" }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: "28px 28px", boxShadow: "0 1px 6px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1a3a5c", marginBottom: 20, fontFamily: "'Fraunces', Georgia, serif" }}>UR Review Form</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>{labelS("Review Type")}<select value={reviewType} onChange={e => setReviewType(e.target.value)} style={{ ...inputS, cursor: "pointer" }}><option value="initial">Initial</option><option value="subsequent">Subsequent</option></select></div>
          <div>{labelS("Discipline")}<select value={therapyType} onChange={e => setTherapyType(e.target.value)} style={{ ...inputS, cursor: "pointer" }}><option value="PT">PT</option><option value="OT">OT</option><option value="ST">ST</option></select></div>
          <div>{labelS("Requested Visits")}<input type="number" min="0" value={requestedVisits} onChange={e => setRequestedVisits(e.target.value)} placeholder="e.g. 16" style={inputS} /></div>
        </div>
        <div style={{ marginBottom: 12 }}>
          {labelS("HPI / Clinical Context")}
          <textarea value={hpi} onChange={e => setHpi(e.target.value)} rows={3} placeholder="Brief clinical context..." style={{ ...inputS, resize: "vertical", lineHeight: 1.6 }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          {labelS("Clinical PDFs")}
          <input type="file" accept=".pdf" multiple onChange={e => setFiles(Array.from(e.target.files))} style={{ fontSize: 13, fontFamily: "'DM Sans', sans-serif" }} />
          {files.length > 0 && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{files.length} file(s) selected</div>}
        </div>
        <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", padding: "11px 0", borderRadius: 8, background: loading ? "#94a3b8" : "#1a3a5c", color: "#fff", fontSize: 14, fontWeight: 700, border: "none", cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Public Sans', sans-serif" }}>
          {loading ? "Processing..." : "Generate Review"}
        </button>
        {error && <div style={{ marginTop: 12, color: "#dc2626", fontSize: 13 }}>{error}</div>}
        {/* ISSUE 3 — Requested (provider) vs. Recommended (ruling) side-by-side, same
            values/formatting as the main cockpit's comparison (rapidnote1/src/components/Cockpit.js).
            Requested frequency/duration is parsed from whatever POC text the extraction
            found; falls back to the visit count alone when nothing could be parsed. */}
        {ruling && metrics && (() => {
          const reqText = [metrics.requestedFrequency, metrics.poc].filter(Boolean).join(" ");
          const { freqPerWeek: reqFreq, durationWeeks: reqWeeks } = parseRequestedFreqWeeks(reqText);
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 20 }}>
              <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Requested (provider)</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", fontFamily: "'DM Sans', sans-serif" }}>
                  {formatVisitLine(metrics.requestedVisits, reqFreq, reqWeeks)}
                </div>
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Recommended</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", fontFamily: "'DM Sans', sans-serif" }}>
                  {formatVisitLine(ruling.visitsApproved, ruling.approvedFrequency, ruling.approvedDurationWeeks)}
                </div>
              </div>
            </div>
          );
        })()}
        {/* UNF panel — same note-builder as the main cockpit (src/utils/unfNote.js).
            review (the old pre-formatted string) is no longer rendered directly;
            the note is built from the same resolved values ruling/metrics carry.
            Auto-HPI: hpiData (age/sex/diagnosis/ieDate) comes from the backend's
            shared utils/hpiData.js, same as the cockpit. There's no episode/DB
            here to look up a true prior-visits total, so totalApprovedVisits uses
            metrics.previouslyApprovedVisits -- what the document itself states,
            the best available signal for a standalone demo submission. */}
        {ruling && metrics && (
          <UNFNoteBox
            hpi={hpi}
            autoHpiData={{
              ...(hpiData || {}),
              totalApprovedVisits: reviewType === "subsequent" ? (metrics.previouslyApprovedVisits ?? null) : null,
              isSubsequent: reviewType === "subsequent",
            }}
            clinicalSummary={clinicalSummary}
            poc={metrics.poc}
            requestedVisits={metrics.requestedVisits}
            determinationLine={ruling.determinationLine}
            approvedVisits={ruling.visitsApproved}
            exportFileName={`UNF_${metrics.primaryDiagnosisCode || "note"}.txt`}
          />
        )}
      </div>
    </div>
  );
}

// ── UNF NOTE BOX ─────────────────────────────────────────────────────────────
// Shared within App.js by URFormEmbed and the legacy single-page form (the
// form demo-ur-only's App() actually renders) -- both call buildUNFNote()
// from src/utils/unfNote.js so the two surfaces can never show different note
// text for the same underlying values. Edits are local UI state only and
// never write back to ruling/metrics.
function UNFNoteBox({ hpi, autoHpiData, clinicalSummary, poc, requestedVisits, determinationLine, approvedVisits, exportFileName }) {
  const builtNote = useMemo(() => buildUNFNote({
    hpi, autoHpiData, clinicalSummary, poc, requestedVisits, determinationLine, approvedVisits,
  }), [hpi, autoHpiData, clinicalSummary, poc, requestedVisits, determinationLine, approvedVisits]);

  const [noteText, setNoteText] = useState(builtNote);
  const [copied, setCopied]     = useState(false);

  useEffect(() => { setNoteText(builtNote); setCopied(false); }, [builtNote]);

  const handleCopy = () => {
    navigator.clipboard.writeText(noteText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const handleExport = () => {
    const blob = new Blob([noteText], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = exportFileName || "UNF_note.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button onClick={handleCopy} style={{
          flex: 1, padding: "10px 0", borderRadius: 7, border: "none",
          background: copied ? "#166534" : "#1a3a5c", color: "#fff",
          fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Public Sans', sans-serif",
          transition: "background 0.15s",
        }}>
          {copied ? "✓ Copied" : "Copy Note"}
        </button>
        <button onClick={handleExport} style={{
          padding: "10px 16px", borderRadius: 7, border: "1px solid #e2e8f0",
          background: "#fff", color: "#374151", fontSize: 13, fontWeight: 600,
          cursor: "pointer", fontFamily: "'Public Sans', sans-serif", whiteSpace: "nowrap",
        }}>
          Export .txt
        </button>
      </div>
      <textarea
        value={noteText}
        onChange={e => setNoteText(e.target.value)}
        spellCheck={false}
        style={{
          width: "100%", minHeight: 280, maxHeight: 480, boxSizing: "border-box",
          resize: "vertical", overflowY: "auto",
          fontFamily: "'SF Mono', 'Consolas', 'Menlo', monospace", fontSize: 12.5, lineHeight: 1.6,
          padding: "14px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0",
          background: "#f8fafc", color: "#1e293b", outline: "none",
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE SEARCH VIEW (Phase 9)
// ─────────────────────────────────────────────────────────────────────────────
function CaseSearchView({ token, onOpenCase }) {
  const [q, setQ]               = useState("");
  const [status, setStatus]     = useState("all");
  const [discipline, setDisc]   = useState("all");
  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError]       = useState("");

  const statusColor = (s) => {
    if (s === "approved")        return { bg: "#dcfce7", text: "#15803d" };
    if (s === "denied" || s === "partial_denial") return { bg: "#fee2e2", text: "#991b1b" };
    if (s === "info_requested")  return { bg: "#fef3c7", text: "#92400e" };
    if (s === "under_review" || s === "pending_md_review") return { bg: "#fef3c7", text: "#92400e" };
    if (s === "pending_review" || s === "submitted") return { bg: "#eff6ff", text: "#1d4ed8" };
    return { bg: "#f3f4f6", text: "#374151" };
  };

  const discColor = (d) => {
    if (d === "OT") return { bg: "#fff7ed", text: "#c2410c" };
    if (d === "ST") return { bg: "#f0fdf4", text: "#15803d" };
    return { bg: "#eff6ff", text: "#1a3a5c" };
  };

  const runSearch = async () => {
    setLoading(true); setError(""); setSearched(true);
    try {
      const params = new URLSearchParams();
      if (q.trim())           params.set("q", q.trim());
      if (status !== "all")   params.set("status", status);
      if (discipline !== "all") params.set("discipline", discipline);
      const res = await axios.get(`${API_BASE}/v1/search-cases?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setResults(res.data.cases || []);
    } catch {
      setError("Search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputS = { padding: "8px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none", background: "#fff" };

  return (
    <div style={{ maxWidth: 900, margin: "32px auto", padding: "0 24px" }}>
      {/* Search bar */}
      <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Search</div>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === "Enter" && runSearch()}
              placeholder="Member name, case ID, member ID, or diagnosis code..."
              style={{ ...inputS, width: "100%", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Status</div>
            <select value={status} onChange={e => setStatus(e.target.value)} style={{ ...inputS, cursor: "pointer" }}>
              <option value="all">All Statuses</option>
              <option value="submitted">Submitted</option>
              <option value="pending_review">Pending Review</option>
              <option value="under_review">Under Review</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>Discipline</div>
            <select value={discipline} onChange={e => setDisc(e.target.value)} style={{ ...inputS, cursor: "pointer" }}>
              <option value="all">All Disciplines</option>
              <option value="PT">PT</option>
              <option value="OT">OT</option>
              <option value="ST">ST</option>
            </select>
          </div>
          <button
            onClick={runSearch}
            disabled={loading}
            style={{ padding: "9px 22px", borderRadius: 8, background: "#1a3a5c", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif", flexShrink: 0 }}
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, fontSize: 13, color: "#dc2626" }}>{error}</div>}
      </div>

      {/* Results */}
      {searched && (
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>Results</span>
            <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif" }}>{results.length} case{results.length !== 1 ? "s" : ""} found</span>
          </div>
          {results.length === 0 ? (
            <div style={{ padding: "32px 20px", color: "#9ca3af", fontSize: 13, textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>
              No cases match your search.
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 70px 130px 110px 60px 90px", gap: 0, padding: "8px 20px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" }}>
                {["Member", "Case ID", "Disc.", "Status", "Submitted", "Score", ""].map(h => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Sans', sans-serif" }}>{h}</span>
                ))}
              </div>
              {results.map(r => {
                const sc = statusColor(r.status);
                const dc = discColor(r.discipline);
                return (
                  <div key={r.submission_id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 70px 130px 110px 60px 90px", gap: 0, padding: "10px 20px", borderBottom: "1px solid #f1f5f9", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", fontFamily: "'Public Sans', sans-serif" }}>{r.member_name || "—"}</div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1, fontFamily: "'DM Sans', monospace" }}>{r.member_id || "—"}</div>
                    </div>
                    <span style={{ fontSize: 11, color: "#374151", fontFamily: "monospace" }}>{r.submission_id?.slice(0,12)}…</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 6, background: dc.bg, color: dc.text, width: "fit-content", fontFamily: "'DM Sans', sans-serif" }}>{r.discipline || "—"}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: sc.bg, color: sc.text, width: "fit-content", textTransform: "capitalize", fontFamily: "'DM Sans', sans-serif" }}>
                      {(r.status || "submitted").replace(/_/g, " ")}
                    </span>
                    <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "—"}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: r.completeness_score >= 80 ? "#15803d" : r.completeness_score >= 50 ? "#92400e" : "#6b7280" }}>
                      {r.completeness_score != null ? r.completeness_score + "%" : "—"}
                    </span>
                    {onOpenCase ? (
                      <button
                        onClick={async () => {
                          setError("");
                          try { await onOpenCase(r); }
                          catch (e) { setError(e.response?.data?.error || e.message || "Failed to open case for review."); }
                        }}
                        style={{ padding: "5px 12px", borderRadius: 6, background: "#1a3a5c", color: "#fff", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif", whiteSpace: "nowrap" }}
                      >
                        Review
                      </button>
                    ) : <span />}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {!searched && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>
          Enter a search term above and press Search or Enter.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWER DASHBOARD (Phase 9)
// ─────────────────────────────────────────────────────────────────────────────
function ReviewerDashboard({ token, user }) {
  const [stats, setStats]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [period, setPeriod]     = useState("today");

  useEffect(() => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/reviewer-stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setStats(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  const PERIODS = [
    { key: "today",      label: "Today" },
    { key: "this_week",  label: "This Week" },
    { key: "this_month", label: "Month" },
    { key: "all_time",   label: "All Time" },
  ];

  const DET_COLORS = {
    "Approved":      "#15803d",
    "Partial Denial":"#92400e",
    "Full Denial":   "#991b1b",
    "Pended":        "#1d4ed8",
  };

  const totals = stats?.totals || {};
  const totalForPeriod = parseInt(totals[period] || 0);

  const byDet = stats?.byDetermination || [];
  const detRows = byDet.map(r => ({
    det: r.determination,
    count: parseInt(r[period] || 0),
    color: DET_COLORS[r.determination] || "#6b7280",
  })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);

  const recent = stats?.recent || [];

  const detColor2 = (det) => {
    if (!det) return { bg: "#f3f4f6", text: "#374151" };
    const l = det.toLowerCase();
    if (l.startsWith("approved"))        return { bg: "#dcfce7", text: "#15803d" };
    if (l.startsWith("partial denial"))  return { bg: "#fef3c7", text: "#92400e" };
    if (l.startsWith("full denial"))     return { bg: "#fee2e2", text: "#991b1b" };
    if (l.startsWith("pend"))            return { bg: "#eff6ff", text: "#1d4ed8" };
    return { bg: "#f3f4f6", text: "#374151" };
  };

  if (loading) {
    return <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>Loading your stats...</div>;
  }

  return (
    <div style={{ maxWidth: 820, margin: "32px auto", padding: "0 24px" }}>
      {/* Period stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
        {PERIODS.map(p => {
          const val = parseInt(totals[p.key] || 0);
          const active = period === p.key;
          return (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              style={{
                background: active ? "#1a3a5c" : "#fff",
                border: active ? "2px solid #1a3a5c" : "1px solid #e2e8f0",
                borderRadius: 12, padding: "18px 16px", cursor: "pointer", textAlign: "left",
                boxShadow: active ? "0 4px 16px rgba(26,58,92,0.18)" : "0 1px 4px rgba(0,0,0,0.06)",
                transition: "all 0.14s",
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 800, color: active ? "#fff" : "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: active ? "rgba(255,255,255,0.75)" : "#6b7280", marginTop: 6, fontFamily: "'Public Sans', sans-serif" }}>{p.label}</div>
            </button>
          );
        })}
      </div>

      {/* Determination breakdown */}
      <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 16, fontFamily: "'Fraunces', Georgia, serif" }}>
          Breakdown — {PERIODS.find(p => p.key === period)?.label}
        </div>
        {detRows.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif" }}>No cases recorded for this period.</div>
        ) : detRows.map(r => {
          const pct = totalForPeriod > 0 ? Math.round((r.count / totalForPeriod) * 100) : 0;
          return (
            <div key={r.det} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", fontFamily: "'Public Sans', sans-serif" }}>{r.det}</span>
                <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{r.count} ({pct}%)</span>
              </div>
              <div style={{ background: "#f1f5f9", borderRadius: 4, height: 8, overflow: "hidden" }}>
                <div style={{ width: pct + "%", height: "100%", background: r.color, borderRadius: 4, transition: "width 0.4s ease" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Recent activity */}
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", fontSize: 13, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>
          Recent Activity
        </div>
        {recent.length === 0 ? (
          <div style={{ padding: "24px 20px", color: "#9ca3af", fontSize: 13, textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>No recent activity.</div>
        ) : recent.map((r, i) => {
          const dc = detColor2(r.determination);
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 130px 60px 70px 120px", gap: 0, padding: "11px 20px", borderBottom: "1px solid #f1f5f9", alignItems: "center" }}>
              <span style={{ fontSize: 11, fontFamily: "monospace", color: "#374151" }}>{r.case_id || "—"}</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: dc.bg, color: dc.text, width: "fit-content", fontFamily: "'DM Sans', sans-serif" }}>
                {r.determination || "—"}
              </span>
              <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{r.discipline || "—"}</span>
              <span style={{ fontSize: 11, color: "#374151", fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>{r.approved_visits != null ? r.approved_visits + " v" : "—"}</span>
              <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "'DM Sans', sans-serif" }}>
                {r.recorded_at ? new Date(r.recorded_at).toLocaleDateString() : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER PORTAL (Phase 10)
// ─────────────────────────────────────────────────────────────────────────────

// 5-step progress: Submitted → In Queue → Under Review → Info Requested → Decision
function statusStep(s) {
  if (s === "approved" || s === "denied" || s === "partial_denial" || s === "pending_md_review") return 4;
  if (s === "info_requested") return 3;
  if (s === "under_review")   return 2;
  if (s === "pending_review") return 1;
  return 0;
}
function StatusProgressBar({ status }) {
  const step = statusStep(status);
  const isInfoReq  = status === "info_requested";
  const isDecision = step === 4;
  const decisionColor = status === "approved" ? "#15803d" : status === "denied" || status === "partial_denial" ? "#991b1b" : "#1a3a5c";
  const LABELS = ["Submitted", "In Queue", "Under Review", "Info Requested",
    status === "approved" ? "Approved" : (status === "denied" || status === "partial_denial") ? "Denied" : "Decision"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, width: "100%", marginTop: 8 }}>
      {LABELS.map((label, i) => {
        const done    = i < step;
        const current = i === step;
        const isAmber = current && isInfoReq;
        const dotColor = isAmber ? "#b45309"
          : current && isDecision ? decisionColor
          : (done || current) ? "#1a3a5c" : "#d1d5db";
        return (
          <React.Fragment key={i}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 48 }}>
              <div style={{
                width: 12, height: 12, borderRadius: "50%",
                background: dotColor,
                border: isAmber ? "2px solid #b45309" : current && !isDecision ? "2px solid #1a3a5c" : "none",
                boxShadow: current ? `0 0 0 3px ${isAmber ? "rgba(180,83,9,0.15)" : "rgba(26,58,92,0.15)"}` : "none",
                transition: "all 0.2s",
              }} />
              <span style={{ fontSize: 9, color: current ? dotColor : done ? "#1a3a5c" : "#9ca3af", fontWeight: current ? 700 : 500, marginTop: 3, fontFamily: "'DM Sans', sans-serif", textAlign: "center", lineHeight: 1.2 }}>{label}</span>
            </div>
            {i < LABELS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: i < step ? "#1a3a5c" : "#e2e8f0", marginBottom: 12, transition: "background 0.3s" }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function DecisionLetter({ submission, decision }) {
  const isApproved   = submission.status === "approved";
  const isPartial    = submission.status === "partial_denial";
  const isFullDenied = submission.status === "denied";
  const isDenied     = isPartial || isFullDenied;
  const isInfoReq    = submission.status === "info_requested";
  if (!isApproved && !isDenied && !isInfoReq) return null;

  const decColor = isApproved ? "#15803d" : isDenied ? "#991b1b" : "#b45309";
  const decBg    = isApproved ? "#f0fdf4" : isDenied ? "#fef2f2" : "#fffbeb";
  const decLabel = isApproved ? "APPROVED" : isPartial ? "PARTIALLY APPROVED" : isDenied ? "DENIED" : "ADDITIONAL INFORMATION REQUESTED";

  const approvedVisits  = decision?.approved_visits ?? (isFullDenied ? 0 : null);
  const requestedVisits = submission.requested_visits ?? null;
  const rationale        = decision?.rationale       ?? null;
  const decidedAt        = decision?.recorded_at     ?? submission.updated_at;

  const summarySentence = (() => {
    if (!isApproved && !isDenied) return null;
    if (requestedVisits == null || approvedVisits == null) return null;
    const plural = n => `${n} visit${n === 1 ? "" : "s"}`;
    if (approvedVisits <= 0) return `This request was not approved (0 of ${plural(requestedVisits)} requested).`;
    if (approvedVisits >= requestedVisits) return `Reviewer approved all ${plural(requestedVisits)} requested.`;
    return `Reviewer approved ${approvedVisits} of ${plural(requestedVisits)} requested.`;
  })();

  return (
    <div style={{ marginTop: 20, border: `1.5px solid ${decColor}`, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
      {/* Letterhead */}
      <div style={{ background: "#1a3a5c", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: "#fff", fontFamily: "'Fraunces', Georgia, serif" }}>CogentCR</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginLeft: 4 }}>|</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontFamily: "'Public Sans', sans-serif" }}>Utilization Management Decision</span>
      </div>

      <div style={{ padding: "20px 24px" }}>
        {/* Decision badge */}
        <div style={{ display: "inline-block", padding: "6px 16px", borderRadius: 8, background: decBg, border: `1px solid ${decColor}`, color: decColor, fontSize: 13, fontWeight: 800, letterSpacing: "0.05em", marginBottom: 16, fontFamily: "'Public Sans', sans-serif" }}>
          {decLabel}
        </div>

        {/* Member info */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px", marginBottom: 16 }}>
          {[
            ["Member",      submission.member_name || "—"],
            ["Member ID",   submission.member_id   || "—"],
            ["Date of Birth",submission.dob        || "—"],
            ["Discipline",  submission.discipline  || "PT"],
            ["Case ID",     submission.submission_id],
            ["Decision Date", decidedAt ? new Date(decidedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—"],
          ].map(([k, v]) => (
            <div key={k}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>{k}</span>
              <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 500, fontFamily: "'Public Sans', sans-serif" }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Requested vs Approved */}
        {(isApproved || isDenied) && requestedVisits != null && approvedVisits != null && (
          <div style={{ background: decBg, border: `1px solid ${decColor}`, borderRadius: 8, padding: "12px 16px", marginBottom: 14 }}>
            <span style={{ fontSize: 11, color: decColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif" }}>Visits Requested vs. Approved</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#6b7280", fontFamily: "'Fraunces', Georgia, serif" }}>
                {requestedVisits} <span style={{ fontSize: 12, fontWeight: 600 }}>requested</span>
              </div>
              <span style={{ fontSize: 16, color: "#9ca3af" }}>→</span>
              <div style={{ fontSize: 28, fontWeight: 800, color: decColor, fontFamily: "'Fraunces', Georgia, serif" }}>
                {approvedVisits} <span style={{ fontSize: 14, fontWeight: 600 }}>approved</span>
              </div>
            </div>
            {summarySentence && (
              <div style={{ fontSize: 12, color: "#374151", marginTop: 8, fontFamily: "'Public Sans', sans-serif" }}>{summarySentence}</div>
            )}
          </div>
        )}

        {/* Rationale — the formal, provider-facing explanation. The server no
            longer substitutes internal reviewer notes when this is absent, so
            an adverse determination with no rationale on file says so plainly
            rather than rendering an empty section the provider can't act on. */}
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>Clinical Rationale</span>
          {rationale ? (
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.65, marginTop: 4, fontFamily: "'Public Sans', sans-serif" }}>{rationale}</div>
          ) : (
            <div style={{ fontSize: 13, color: "#6b7280", fontStyle: "italic", lineHeight: 1.65, marginTop: 4, fontFamily: "'Public Sans', sans-serif" }}>
              {isDenied
                ? "A written rationale for this determination is not yet on file. Contact CogentCR to request it before filing an appeal."
                : "No additional rationale was recorded for this determination."}
            </div>
          )}
        </div>

        {/* Footer note + print */}
        <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 12, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5, flex: 1 }}>
            {isApproved
              ? "This authorization is valid for the services and dates specified. Contact CogentCR if clinical circumstances change."
              : isDenied
              ? "You may accept the authorized visits above, or request a peer-to-peer review with the reviewing clinician from the case detail below."
              : "Please upload the requested documentation and resubmit within 5 business days to avoid case closure."}
          </div>
          <button
            onClick={() => printDecisionLetter(submission, decision)}
            style={{ flexShrink: 0, padding: "6px 14px", borderRadius: 7, background: "#1a3a5c", color: "#fff", fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif", whiteSpace: "nowrap" }}
          >
            Print / PDF
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * @param {object} [prefill] — a finalized parent submission when this form was
 *   opened via "Request Additional Visits". Member, diagnosis and discipline are
 *   copied; visits and documents stay blank for the provider to supply. Review
 *   type is forced to "subsequent" and locked — the parent's existence is what
 *   makes this a continuation, so it is not the provider's to change.
 */
function NewSubmissionForm({ token, onSubmitted, clinicProfile, prefill, onCancelPrefill }) {
  const isSubsequentRequest = !!prefill;
  const [providerName,    setProviderName]    = useState(clinicProfile?.clinic_name || "");
  const [providerNpi,     setProviderNpi]     = useState(clinicProfile?.clinic_npi  || "");
  const [memberName,      setMemberName]      = useState(prefill?.member_name  || "");
  const [memberId,        setMemberId]        = useState(prefill?.member_id    || "");
  const [dob,             setDob]             = useState(prefill?.dob          || "");
  const [memberState,     setMemberState]     = useState(prefill?.member_state || "");
  const [discipline,      setDiscipline]      = useState(prefill?.discipline || clinicProfile?.clinic_specialty?.split("/")[0] || "PT");
  const [diagInput,       setDiagInput]       = useState("");
  const [diagnosisCodes,  setDiagnosisCodes]  = useState(
    Array.isArray(prefill?.diagnosis_codes) ? prefill.diagnosis_codes : []
  );
  const [requestedVisits, setRequestedVisits] = useState("");
  const [planId,          setPlanId]          = useState("");
  const [documentNames,   setDocumentNames]   = useState([""]);
  const [providerNotes,   setProviderNotes]   = useState("");
  const [urgency,         setUrgency]         = useState("standard");
  const [reviewType,      setReviewType]      = useState(prefill ? "subsequent" : "initial");
  const [uploadedFiles,   setUploadedFiles]   = useState([]);
  const [dragOver,        setDragOver]        = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState("");
  const [plans,           setPlans]           = useState([]);

  // Sync clinic profile defaults when profile loads after mount
  useEffect(() => {
    if (clinicProfile?.clinic_name && !providerName) setProviderName(clinicProfile.clinic_name);
    if (clinicProfile?.clinic_npi  && !providerNpi)  setProviderNpi(clinicProfile.clinic_npi);
  }, [clinicProfile]); // eslint-disable-line

  useEffect(() => {
    axios.get(`${API_BASE}/v1/plans`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setPlans(r.data.plans || [])).catch(() => {});
  }, [token]); // eslint-disable-line

  const docList = documentNames.filter(d => d.trim());
  const fields = [
    !!providerName.trim(), !!memberName.trim(), !!memberId.trim(), !!dob, !!discipline,
    diagnosisCodes.length > 0,
    parseInt(requestedVisits) > 0,
    docList.length > 0 || uploadedFiles.length > 0,
  ];
  const completeness = Math.round(fields.filter(Boolean).length / 8 * 100);

  // Block submit only when nothing can supply a diagnosis: no code entered AND
  // no document for extraction to read one out of. With a file attached the
  // server validates after extraction, so the provider is not forced to type a
  // code the upload already contains.
  const needsDiagnosis = diagnosisCodes.length === 0 && uploadedFiles.length === 0;

  const addDiagCode = () => {
    const code = diagInput.trim().toUpperCase();
    if (code && !diagnosisCodes.includes(code)) setDiagnosisCodes(prev => [...prev, code]);
    setDiagInput("");
  };

  const addFiles = (fileList) => {
    const pdfs = Array.from(fileList).filter(f => f.type === "application/pdf" || f.name.endsWith(".pdf"));
    setUploadedFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      const newFiles = pdfs.filter(f => !existing.has(f.name));
      return [...prev, ...newFiles].slice(0, 5);
    });
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      let res;
      if (uploadedFiles.length > 0) {
        // Multipart with file upload → AI extraction endpoint
        const fd = new FormData();
        fd.append("providerName", providerName);
        fd.append("providerNpi",  providerNpi);
        fd.append("memberName",   memberName);
        fd.append("memberId",     memberId);
        fd.append("dob",          dob);
        fd.append("memberState",  memberState);
        fd.append("discipline",   discipline);
        fd.append("diagnosisCodes", JSON.stringify(diagnosisCodes));
        fd.append("requestedVisits", requestedVisits);
        fd.append("planId",       planId || "");
        fd.append("documentList", JSON.stringify(docList));
        fd.append("providerNotes", providerNotes);
        fd.append("urgency", urgency);
        fd.append("reviewType", reviewType);
        // Parent linkage. episode_id attaches the new request to the same
        // episode; visitsToDate carries the parent's approved count forward,
        // which is what the engine's cumulative-volume check reads — without it
        // it has no episode total and falls back to per-request math.
        if (prefill) {
          fd.append("parentSubmissionId", prefill.submission_id);
          if (prefill.episode_id != null) fd.append("episodeId", String(prefill.episode_id));
          if (prefill.approved_visits != null) fd.append("visitsToDate", String(prefill.approved_visits));
        }
        uploadedFiles.forEach(f => fd.append("documents", f));
        res = await axios.post(`${API_BASE}/v1/submit-with-docs`, fd, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } else {
        // Plain JSON path
        res = await axios.post(`${API_BASE}/v1/submit`, {
          providerName, providerNpi, memberName, memberId, dob, memberState,
          discipline, diagnosisCodes,
          requestedVisits: parseInt(requestedVisits) || 0,
          planId: planId || null, documentList: docList, providerNotes, urgency, reviewType,
          ...(prefill ? {
            parentSubmissionId: prefill.submission_id,
            episodeId:    prefill.episode_id    ?? null,
            visitsToDate: prefill.approved_visits ?? null,
          } : {}),
        }, { headers: { Authorization: `Bearer ${token}` } });
      }
      onSubmitted(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Submission failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputS = { width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box", background: "#fff" };
  const labelS = (t) => <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontFamily: "'DM Sans', sans-serif" }}>{t}</div>;

  return (
    <div style={{ maxWidth: 700, margin: "28px auto", padding: "0 24px" }}>
      {/* Completeness meter */}
      <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Public Sans', sans-serif" }}>Submission Completeness</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: completeness >= 85 ? "#15803d" : completeness >= 50 ? "#92400e" : "#6b7280", fontFamily: "'Fraunces', Georgia, serif" }}>{completeness}%</span>
        </div>
        <div style={{ background: "#f1f5f9", borderRadius: 6, height: 8, overflow: "hidden" }}>
          <div style={{ width: completeness + "%", height: "100%", background: completeness >= 85 ? "#15803d" : completeness >= 50 ? "#f59e0b" : "#94a3b8", borderRadius: 6, transition: "width 0.3s ease" }} />
        </div>
        {completeness >= 85 && (
          <div style={{ fontSize: 11, color: "#15803d", marginTop: 6, fontFamily: "'DM Sans', sans-serif" }}>Complete — eligible for auto-review on submission</div>
        )}
      </div>

      <div style={{ background: "#fff", borderRadius: 12, padding: "24px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0" }}>

        {/* ── AI Document Upload ── */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
          Clinical Documents
          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac" }}>AI EXTRACTION</span>
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{ border: `2px dashed ${dragOver ? "#1a3a5c" : "#93c5fd"}`, borderRadius: 10, padding: "24px 20px", textAlign: "center", background: dragOver ? "#eff6ff" : "#f8fafc", marginBottom: 12, transition: "all 0.15s", cursor: "pointer" }}
          onClick={() => document.getElementById("doc-upload-input").click()}
        >
          <input id="doc-upload-input" type="file" accept=".pdf,application/pdf" multiple style={{ display: "none" }}
            onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
          <div style={{ fontSize: 22, marginBottom: 6 }}>📄</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1a3a5c", fontFamily: "'Public Sans', sans-serif" }}>
            Drop PDF files here or click to upload
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            Clinical notes, evaluations, progress notes — Claude AI extracts diagnosis codes, ROM, goals, and more
          </div>
        </div>
        {uploadedFiles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {uploadedFiles.map((f, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, background: "#eff6ff", border: "1px solid #93c5fd", fontSize: 12, color: "#1a3a5c" }}>
                📄 {f.name}
                <button onClick={() => setUploadedFiles(prev => prev.filter((_, j) => j !== i))}
                  style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
              </span>
            ))}
          </div>
        )}
        {uploadedFiles.length > 0 && (
          <div style={{ padding: "8px 12px", background: "#f0fdf4", borderRadius: 7, border: "1px solid #86efac", fontSize: 11, color: "#15803d", marginBottom: 16, fontFamily: "'DM Sans', sans-serif" }}>
            ✦ AI will extract diagnosis codes, visit count, clinical findings, and documentation quality on submit. You can still fill fields manually below.
          </div>
        )}

        {/* Provider info */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Provider Information</span>
          {clinicProfile?.clinic_name && (
            <span style={{ fontSize: 10, fontWeight: 600, color: "#15803d", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "2px 8px", fontFamily: "'Public Sans', sans-serif" }}>Pre-filled from clinic profile</span>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 20 }}>
          <div>{labelS("Practice / Provider Name")}<input value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="e.g. Springfield PT Clinic" style={inputS} /></div>
          <div>
            {labelS("NPI (optional)")}
            <input value={providerNpi} onChange={e => setProviderNpi(e.target.value)} placeholder="1234567890" style={inputS} />
            <NpiLookupWidget npi={providerNpi} token={token} onVerified={name => { if (!providerName) setProviderName(name); }} />
          </div>
        </div>

        {/* Review type selector — shown before member info for prominence */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 10, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
            Authorization Type
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {[
              { v: "initial",    label: "Initial Auth",     sub: "First request for this patient/episode",            border: "#bfdbfe", bg: "#eff6ff",  color: "#1d4ed8" },
              { v: "subsequent", label: "Subsequent Auth",  sub: "Continuing care — prior auth exists for this member", border: "#c4b5fd", bg: "#f5f3ff",  color: "#7c3aed" },
              { v: "concurrent", label: "Concurrent Review",sub: "Two or more active auths running simultaneously",    border: "#fde68a", bg: "#fffbeb",  color: "#92400e" },
            ]
              // Locked to Subsequent when continuing a finalized case: the
              // parent's existence is what makes this a continuation, so the
              // other options are removed rather than merely disabled.
              .filter(opt => !isSubsequentRequest || opt.v === "subsequent")
              .map(opt => (
              <button key={opt.v} onClick={() => { if (!isSubsequentRequest) setReviewType(opt.v); }}
                disabled={isSubsequentRequest}
                style={{
                flex: 1, padding: "11px 10px", borderRadius: 8, textAlign: "left",
                border: `2px solid ${reviewType === opt.v ? opt.color : "#e2e8f0"}`,
                background: reviewType === opt.v ? opt.bg : "#fff",
                cursor: isSubsequentRequest ? "default" : "pointer", transition: "all 0.1s",
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: reviewType === opt.v ? opt.color : "#374151", fontFamily: "'Public Sans', sans-serif" }}>
                  {opt.label}{isSubsequentRequest ? " · locked" : ""}
                </div>
                <div style={{ fontSize: 10, color: reviewType === opt.v ? opt.color : "#9ca3af", marginTop: 3, fontFamily: "'Public Sans', sans-serif", lineHeight: 1.3, opacity: reviewType === opt.v ? 0.8 : 1 }}>{opt.sub}</div>
              </button>
            ))}
          </div>

          {isSubsequentRequest && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "#f5f3ff", border: "1px solid #c4b5fd", borderRadius: 8, fontFamily: "'Public Sans', sans-serif" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#5b21b6" }}>
                Continuing case {String(prefill.submission_id).slice(0, 12)}…
              </div>
              <div style={{ fontSize: 11, color: "#6d28d9", marginTop: 3, lineHeight: 1.5 }}>
                {prefill.member_name || "Member"} · {(prefill.diagnosis_codes || []).join(", ") || "no diagnosis on file"}
                {prefill.approved_visits != null && <> · {prefill.approved_visits} visits approved to date</>}
                . Member and diagnosis are copied from that authorization; enter the visits you are requesting now and attach the current progress note.
              </div>
              {onCancelPrefill && (
                <button onClick={onCancelPrefill}
                  style={{ marginTop: 8, padding: "4px 12px", borderRadius: 6, border: "1px solid #c4b5fd", background: "#fff", color: "#6d28d9", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
                  Start a blank request instead
                </button>
              )}
            </div>
          )}
          {reviewType === "subsequent" && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "#f5f3ff", border: "1px solid #c4b5fd", borderRadius: 7, fontSize: 11, color: "#6d28d9", fontFamily: "'Public Sans', sans-serif" }}>
              Please attach updated progress notes, daily notes, or clinical documentation reflecting the member's current status.
            </div>
          )}
        </div>

        {/* Member info */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>Member Information</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 16px", marginBottom: 20 }}>
          <div style={{ gridColumn: "1 / 3" }}>{labelS("Member Name")}<input value={memberName} onChange={e => setMemberName(e.target.value)} placeholder="First Last (or let AI fill from document)" style={inputS} /></div>
          <div>{labelS("Date of Birth")}<input type="date" value={dob} onChange={e => setDob(e.target.value)} style={inputS} /></div>
          <div>{labelS("Member ID")}<input value={memberId} onChange={e => setMemberId(e.target.value)} placeholder="e.g. XYZ123456" style={inputS} /></div>
          <div>{labelS("Member State")}<input value={memberState} onChange={e => setMemberState(e.target.value.toUpperCase().slice(0,2))} placeholder="e.g. CA" maxLength={2} style={{ ...inputS, textTransform: "uppercase" }} /></div>
          <div>{labelS("Plan / Payer")}<select value={planId} onChange={e => setPlanId(e.target.value)} style={{ ...inputS, cursor: "pointer" }}>
            <option value="">Select plan...</option>
            {plans.map(p => <option key={p.plan_id} value={p.plan_id}>{p.plan_name}</option>)}
          </select></div>
          <div style={{ gridColumn: "3 / 4" }}>{labelS("Discipline")}<select value={discipline} onChange={e => setDiscipline(e.target.value)} style={{ ...inputS, cursor: "pointer" }}>
            <option value="PT">PT — Physical Therapy</option>
            <option value="OT">OT — Occupational Therapy</option>
            <option value="ST">ST — Speech Therapy</option>
          </select></div>
        </div>

        {/* Clinical info */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>Clinical Request</div>
        <div style={{ marginBottom: 14 }}>
          {labelS("Diagnosis Codes (ICD-10) *")}
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <input value={diagInput} onChange={e => setDiagInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addDiagCode()}
              placeholder={uploadedFiles.length ? "Leave blank — AI will extract" : "e.g. M54.5 then Enter"} style={{ ...inputS, flex: 1 }} />
            <button onClick={addDiagCode} style={{ padding: "8px 14px", borderRadius: 7, background: "#1a3a5c", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", flexShrink: 0 }}>Add</button>
          </div>
          {diagnosisCodes.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {diagnosisCodes.map(c => (
                <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 6, background: "#eff6ff", color: "#1a3a5c", fontSize: 12, fontWeight: 600, fontFamily: "monospace" }}>
                  {c}
                  <button onClick={() => setDiagnosisCodes(prev => prev.filter(x => x !== c))} style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", padding: 0, lineHeight: 1, fontSize: 13 }}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 14 }}>
          <div>{labelS("Requested Visits")}<input type="number" min="1" value={requestedVisits} onChange={e => setRequestedVisits(e.target.value)} placeholder={uploadedFiles.length ? "Leave blank — AI will extract" : "e.g. 16"} style={inputS} /></div>
        </div>
        <div style={{ marginBottom: 20 }}>
          {labelS("Clinical Notes (optional)")}
          <textarea value={providerNotes} onChange={e => setProviderNotes(e.target.value)} rows={3} placeholder="Brief clinical context or special circumstances..." style={{ ...inputS, resize: "vertical", lineHeight: 1.6 }} />
        </div>

        {/* Additional document names */}
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>Additional Document References</div>
        <div style={{ marginBottom: 20 }}>
          {documentNames.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input value={d} onChange={e => { const next = [...documentNames]; next[i] = e.target.value; setDocumentNames(next); }}
                placeholder={`e.g. X-ray report, lab results`} style={{ ...inputS, flex: 1 }} />
              {documentNames.length > 1 && (
                <button onClick={() => setDocumentNames(prev => prev.filter((_, j) => j !== i))}
                  style={{ padding: "8px 10px", borderRadius: 7, background: "#fee2e2", color: "#991b1b", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer" }}>×</button>
              )}
            </div>
          ))}
          <button onClick={() => setDocumentNames(prev => [...prev, ""])}
            style={{ fontSize: 12, color: "#1a3a5c", background: "none", border: "1px dashed #93c5fd", borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontFamily: "'Public Sans', sans-serif", marginTop: 2 }}>
            + Add reference
          </button>
        </div>

        {/* Urgency */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 10, fontFamily: "'Fraunces', Georgia, serif", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>Request Priority</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              { v: "standard",  label: "Standard",  sub: "72 hr review",  color: "#1a3a5c", bg: "#eff6ff",  border: "#bfdbfe" },
              { v: "urgent",    label: "Urgent",     sub: "24 hr review",  color: "#92400e", bg: "#fffbeb",  border: "#fde68a" },
              { v: "expedited", label: "Expedited",  sub: "8 hr review",   color: "#991b1b", bg: "#fef2f2",  border: "#fca5a5" },
            ].map(opt => (
              <button key={opt.v} onClick={() => setUrgency(opt.v)} style={{
                flex: 1, padding: "10px 8px", borderRadius: 8, textAlign: "center",
                border: `2px solid ${urgency === opt.v ? opt.color : "#e2e8f0"}`,
                background: urgency === opt.v ? opt.bg : "#fff",
                cursor: "pointer", transition: "all 0.1s",
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: urgency === opt.v ? opt.color : "#374151", fontFamily: "'Public Sans', sans-serif" }}>{opt.label}</div>
                <div style={{ fontSize: 10, color: urgency === opt.v ? opt.color : "#9ca3af", marginTop: 2, fontFamily: "'Public Sans', sans-serif", opacity: 0.8 }}>{opt.sub}</div>
              </button>
            ))}
          </div>
          {urgency !== "standard" && (
            <div style={{ marginTop: 8, padding: "8px 12px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, fontSize: 11, color: "#92400e", fontFamily: "'Public Sans', sans-serif" }}>
              Urgent/Expedited requests must have clinical justification in the documents or provider notes above.
            </div>
          )}
        </div>

        {error && <div style={{ marginBottom: 12, padding: "10px 14px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: 7, fontSize: 13, color: "#991b1b" }}>{error}</div>}

        {/* Diagnosis is required server-side. Blocking here too gives immediate
            feedback instead of a round-trip error — except when documents are
            attached, where extraction can supply the code and the server
            validates after extracting. Mirrors the backend's own split. */}
        {needsDiagnosis && (
          <div style={{ marginBottom: 12, padding: "10px 14px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 7, fontSize: 12, color: "#92400e", fontFamily: "'Public Sans', sans-serif" }}>
            At least one ICD-10 diagnosis code is required — add one above, or attach clinical documentation that states one.
          </div>
        )}

        <button onClick={handleSubmit} disabled={loading || needsDiagnosis} style={{
          width: "100%", padding: "13px 0", borderRadius: 9,
          background: (loading || needsDiagnosis) ? "#94a3b8" : urgency === "expedited" ? "#991b1b" : urgency === "urgent" ? "#92400e" : "#1a3a5c",
          color: "#fff", fontSize: 14, fontWeight: 700, border: "none",
          cursor: (loading || needsDiagnosis) ? "not-allowed" : "pointer",
          fontFamily: "'Public Sans', sans-serif",
          boxShadow: (loading || needsDiagnosis) ? "none" : "0 4px 14px rgba(26,58,92,0.25)",
        }}>
          {loading
            ? (uploadedFiles.length ? "Uploading & extracting with AI…" : "Submitting…")
            : `Submit ${urgency !== "standard" ? urgency.toUpperCase() + " " : ""}Authorization Request (${completeness}% complete)`}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P2P REQUEST MODAL (provider)
// ─────────────────────────────────────────────────────────────────────────────
function P2PRequestModal({ submissionId, memberName, token, onClose, onSuccess }) {
  const [slots, setSlots]       = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [noSchedule, setNoSchedule] = useState(false);
  const [primarySlot, setPrimary]   = useState(null);
  const [secondarySlot, setSecondary] = useState(null);
  const [notes, setNotes]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState(null);

  const NAVY = "#1a2e4a";

  useEffect(() => {
    fetch(`${API_BASE}/v1/p2p-slots/${submissionId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        setLoadingSlots(false);
        if (!d.hasSchedule || !d.slots?.length) { setNoSchedule(true); return; }
        setSlots(d.slots);
      })
      .catch(() => { setLoadingSlots(false); setNoSchedule(true); });
  }, [submissionId, token]); // eslint-disable-line

  // Group ISO slots by local date label
  const grouped = slots.reduce((acc, iso) => {
    const d = new Date(iso);
    const key = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    if (!acc[key]) acc[key] = [];
    acc[key].push(iso);
    return acc;
  }, {});

  const handleSlotClick = (iso) => {
    if (iso === primarySlot) { setPrimary(null); setSecondary(null); return; }
    if (iso === secondarySlot) { setSecondary(null); return; }
    if (!primarySlot) { setPrimary(iso); return; }
    setSecondary(iso);
  };

  const slotLabel = (iso) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const submit = () => {
    if (!primarySlot) { setErr("Please select a primary time slot."); return; }
    setSaving(true); setErr(null);
    fetch(`${API_BASE}/v1/p2p-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ submissionId, primarySlot, secondarySlot: secondarySlot || undefined, clinicalNotes: notes }),
    })
      .then(r => r.json())
      .then(d => {
        setSaving(false);
        if (d.p2pId) onSuccess();
        else setErr(d.error || "Request failed.");
      })
      .catch(() => { setSaving(false); setErr("Network error."); });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 14, width: 560, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        {/* Header */}
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 700, color: NAVY }}>Request Peer-to-Peer Review</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{memberName}</div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", padding: 0, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ fontSize: 12, color: "#475569", background: "#eff6ff", borderRadius: 8, padding: "10px 14px", marginTop: 14 }}>
            You will speak directly with the reviewing clinician. Select a time from their available schedule — their identity remains confidential.
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", padding: "18px 24px", flex: 1 }}>
          {loadingSlots ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#94a3b8", fontSize: 13 }}>Loading available times...</div>
          ) : noSchedule ? (
            <div style={{ textAlign: "center", padding: "32px 16px" }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📅</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6 }}>No schedule available</div>
              <div style={{ fontSize: 13, color: "#64748b" }}>The reviewing clinician has not posted their availability yet. Contact your clinical coordinator to request a peer-to-peer review.</div>
            </div>
          ) : (
            <>
              {/* Selected summary */}
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <div style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: `2px solid ${primarySlot ? "#1a2e4a" : "#e2e8f0"}`, background: primarySlot ? "#eff6ff" : "#fafafa" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 3 }}>Primary (required)</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: primarySlot ? NAVY : "#94a3b8" }}>
                    {primarySlot ? new Date(primarySlot).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not selected"}
                  </div>
                </div>
                <div style={{ flex: 1, padding: "10px 14px", borderRadius: 8, border: `2px solid ${secondarySlot ? "#059669" : "#e2e8f0"}`, background: secondarySlot ? "#f0fdf4" : "#fafafa" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 3 }}>Secondary (optional)</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: secondarySlot ? "#059669" : "#94a3b8" }}>
                    {secondarySlot ? new Date(secondarySlot).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not selected"}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
                Click a time to set as primary · Click a second time to set as secondary fallback · Click again to deselect
              </div>
              {/* Slot grid by day */}
              {Object.entries(grouped).map(([date, daySlots]) => (
                <div key={date} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 7 }}>{date}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {daySlots.map(iso => {
                      const isPrimary   = iso === primarySlot;
                      const isSecondary = iso === secondarySlot;
                      return (
                        <button key={iso} onClick={() => handleSlotClick(iso)} style={{
                          padding: "5px 13px", borderRadius: 20, fontSize: 12, fontWeight: isPrimary || isSecondary ? 700 : 400,
                          border: `1.5px solid ${isPrimary ? NAVY : isSecondary ? "#059669" : "#d1d5db"}`,
                          background: isPrimary ? NAVY : isSecondary ? "#059669" : "#fff",
                          color: isPrimary || isSecondary ? "#fff" : "#374151",
                          cursor: "pointer",
                        }}>
                          {slotLabel(iso)}{isPrimary ? " ★" : isSecondary ? " ✓" : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {/* Clinical notes */}
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>Clinical Argument (optional but recommended)</div>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                  placeholder="Summarize the clinical evidence supporting medical necessity..."
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
              </div>
            </>
          )}
          {err && <div style={{ marginTop: 10, fontSize: 12, color: "#dc2626" }}>{err}</div>}
        </div>

        {/* Footer */}
        {!noSchedule && !loadingSlots && (
          <div style={{ padding: "14px 24px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, justifyContent: "flex-end", flexShrink: 0 }}>
            <button onClick={onClose} style={{ padding: "9px 20px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", color: "#374151", cursor: "pointer", fontSize: 13 }}>Cancel</button>
            <button onClick={submit} disabled={saving || !primarySlot}
              style={{ padding: "9px 20px", borderRadius: 7, border: "none", background: NAVY, color: "#fff", cursor: saving || !primarySlot ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, opacity: saving || !primarySlot ? 0.6 : 1 }}>
              {saving ? "Submitting..." : "Submit P2P Request"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPT VISITS MODAL (provider)
// ─────────────────────────────────────────────────────────────────────────────
function AcceptVisitsModal({ submission, token, onClose, onSuccess }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState("");

  const handleConfirm = () => {
    setSubmitting(true); setError("");
    axios.post(`${API_BASE}/v1/submissions/${submission.submission_id}/accept`, {}, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(() => onSuccess())
      .catch(err => { setError(err.response?.data?.error || "Failed to accept visits."); setSubmitting(false); });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9000, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 460, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>Accept Authorized Visits</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16, fontFamily: "'Public Sans', sans-serif" }}>{submission.member_name} · {submission.discipline}</div>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 20, fontFamily: "'Public Sans', sans-serif", lineHeight: 1.6 }}>
          This confirms you are accepting the visits authorized on this case as final, in lieu of requesting a peer-to-peer review. This action is recorded on the case's audit trail.
        </div>
        {error && <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 13, color: "#dc2626", fontFamily: "'Public Sans', sans-serif" }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>Cancel</button>
          <button onClick={handleConfirm} disabled={submitting}
            style={{ padding: "10px 20px", borderRadius: 8, background: "#15803d", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1, fontFamily: "'Public Sans', sans-serif" }}>
            {submitting ? "Accepting…" : "Accept Visits"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEWER SCHEDULE SETTINGS
// ─────────────────────────────────────────────────────────────────────────────
const TZ_OPTIONS = [
  { value: "America/New_York",    label: "Eastern (ET)" },
  { value: "America/Chicago",     label: "Central (CT)" },
  { value: "America/Denver",      label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Phoenix",     label: "Arizona (no DST)" },
  { value: "America/Anchorage",   label: "Alaska (AKT)" },
  { value: "Pacific/Honolulu",    label: "Hawaii (HST)" },
];
const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 7 AM–7 PM
const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function ReviewerScheduleSettings({ token }) {
  const [avail, setAvail]     = useState([]);
  const [tz, setTz]           = useState("America/New_York");
  const [saved, setSaved]     = useState(false);
  const [saving, setSaving]   = useState(false);
  const [open, setOpen]       = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/v1/reviewer-schedule`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setAvail(d.availability || []); setTz(d.timezone || "America/New_York"); })
      .catch(() => {});
  }, [token]); // eslint-disable-line

  const toggleDay = (day) => {
    setAvail(prev => {
      const has = prev.find(a => a.day === day);
      return has ? prev.filter(a => a.day !== day) : [...prev, { day, startHour: 9, endHour: 17 }];
    });
  };
  const updateHour = (day, field, val) => {
    setAvail(prev => prev.map(a => a.day === day ? { ...a, [field]: parseInt(val) } : a));
  };

  const save = () => {
    setSaving(true);
    fetch(`${API_BASE}/v1/reviewer-schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ availability: avail, timezone: tz }),
    })
      .then(() => { setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 3000); })
      .catch(() => setSaving(false));
  };

  const NAVY = "#1a2e4a";

  return (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", marginBottom: 18, overflow: "hidden" }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "14px 20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>My Availability Schedule</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {avail.length === 0 ? "No schedule set — providers cannot book P2P calls until you add availability" : `${avail.length} day${avail.length !== 1 ? "s" : ""} set · ${TZ_OPTIONS.find(t => t.value === tz)?.label || tz}`}
          </div>
        </div>
        <span style={{ fontSize: 14, color: "#94a3b8" }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "0 20px 20px", borderTop: "1px solid #f1f5f9" }}>
          <div style={{ marginTop: 14, marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Your Timezone
              <select value={tz} onChange={e => setTz(e.target.value)}
                style={{ display: "block", marginTop: 4, padding: "7px 10px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13, background: "#fff" }}>
                {TZ_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Available Days + Hours</div>
          {[1,2,3,4,5,6,0].map(day => {
            const entry = avail.find(a => a.day === day);
            return (
              <div key={day} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, width: 90, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!entry} onChange={() => toggleDay(day)} />
                  {DAY_NAMES[day].slice(0, 3)}
                </label>
                {entry && (
                  <>
                    <select value={entry.startHour} onChange={e => updateHour(day, "startHour", e.target.value)}
                      style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }}>
                      {HOURS.map(h => <option key={h} value={h}>{h % 12 || 12} {h < 12 ? "AM" : "PM"}</option>)}
                    </select>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>to</span>
                    <select value={entry.endHour} onChange={e => updateHour(day, "endHour", e.target.value)}
                      style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12 }}>
                      {HOURS.filter(h => h > entry.startHour).map(h => <option key={h} value={h}>{h % 12 || 12} {h < 12 ? "AM" : "PM"}</option>)}
                    </select>
                  </>
                )}
              </div>
            );
          })}
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={save} disabled={saving}
              style={{ padding: "9px 22px", borderRadius: 8, background: NAVY, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving..." : "Save Schedule"}
            </button>
            {saved && <span style={{ fontSize: 12, color: "#059669", fontWeight: 600 }}>✓ Saved — available slots will update immediately</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// P2P QUEUE VIEW (reviewer / master)
// ─────────────────────────────────────────────────────────────────────────────
function P2PQueueView({ token }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [panel, setPanel]       = useState(null); // "complete"
  const [outcome, setOutcome]   = useState("upheld");
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [newDet, setNewDet]     = useState("Approved");
  const [newVisits, setNewVisits] = useState("");
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState(null);

  const NAVY = "#1a2e4a";

  const fetchQueue = () => {
    setLoading(true);
    fetch(`${API_BASE}/v1/p2p-queue`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setRequests(d.requests || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchQueue(); }, []); // eslint-disable-line

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const handleAccept = (slotType) => {
    setSaving(true);
    fetch(`${API_BASE}/v1/p2p-requests/${selected.p2p_id}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slot: slotType }),
    })
      .then(r => r.json())
      .then(d => {
        setSaving(false);
        if (d.ok) { showToast("Call confirmed — provider notified."); setSelected(null); fetchQueue(); }
        else showToast("Error: " + d.error);
      })
      .catch(() => { setSaving(false); showToast("Network error."); });
  };

  const handleComplete = () => {
    if (outcome !== "upheld" && !newDet) return;
    setSaving(true);
    fetch(`${API_BASE}/v1/p2p-requests/${selected.p2p_id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        outcome, outcomeNotes,
        newDetermination:  outcome !== "upheld" ? newDet    : undefined,
        newApprovedVisits: outcome !== "upheld" ? parseInt(newVisits, 10) || undefined : undefined,
      }),
    })
      .then(r => r.json())
      .then(d => {
        setSaving(false);
        if (d.ok) { showToast("P2P outcome recorded — provider notified."); setSelected(null); setPanel(null); fetchQueue(); }
        else showToast("Error: " + d.error);
      })
      .catch(() => { setSaving(false); showToast("Network error."); });
  };

  const fmtSlot = (iso) => iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

  const pending   = requests.filter(r => r.status === "pending");
  const confirmed = requests.filter(r => r.status === "confirmed");

  return (
    <div style={{ display: "flex", height: "calc(100vh - 110px)" }}>
      {toast && (
        <div style={{ position: "fixed", top: 16, right: 16, background: NAVY, color: "#fff", borderRadius: 8, padding: "12px 20px", fontSize: 13, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>{toast}</div>
      )}

      {/* Sidebar list */}
      <div style={{ width: 340, borderRight: "1px solid #e2e8f0", overflowY: "auto", background: "#fff" }}>
        {loading ? (
          <div style={{ padding: 24, color: "#94a3b8", fontSize: 13 }}>Loading...</div>
        ) : (
          <>
            {pending.length > 0 && (
              <>
                <div style={{ padding: "12px 20px 6px", fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, background: "#fafafa", borderBottom: "1px solid #f1f5f9" }}>
                  Awaiting Your Response · {pending.length}
                </div>
                {pending.map((r, i) => {
                  const isSel = selected?.p2p_id === r.p2p_id;
                  return (
                    <div key={r.p2p_id} onClick={() => { setSelected(r); setPanel(null); setOutcomeNotes(""); setNewVisits(""); }}
                      style={{ padding: "13px 20px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: isSel ? "#eff6ff" : i % 2 === 0 ? "#fff" : "#fafafa", borderLeft: isSel ? "3px solid #3b82f6" : "3px solid transparent" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: NAVY }}>{r.member_name || "Unknown"}</div>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: "#fee2e2", color: "#991b1b" }}>PENDING</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{r.discipline} · {r.plan_id}</div>
                      <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 600, marginTop: 3 }}>Det: {r.last_determination || "—"}</div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>Primary: {fmtSlot(r.primary_slot)}</div>
                      {r.secondary_slot && <div style={{ fontSize: 10, color: "#94a3b8" }}>Secondary: {fmtSlot(r.secondary_slot)}</div>}
                    </div>
                  );
                })}
              </>
            )}
            {confirmed.length > 0 && (
              <>
                <div style={{ padding: "12px 20px 6px", fontSize: 10, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: 1, background: "#f0fdf4", borderBottom: "1px solid #d1fae5" }}>
                  Upcoming Calls · {confirmed.length}
                </div>
                {confirmed.map((r, i) => {
                  const isSel = selected?.p2p_id === r.p2p_id;
                  return (
                    <div key={r.p2p_id} onClick={() => { setSelected(r); setPanel(null); setOutcomeNotes(""); setNewVisits(""); }}
                      style={{ padding: "13px 20px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: isSel ? "#f0fdf4" : "#fff", borderLeft: isSel ? "3px solid #059669" : "3px solid transparent" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: NAVY }}>{r.member_name || "Unknown"}</div>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: "#d1fae5", color: "#065f46" }}>CONFIRMED</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#059669", marginTop: 4 }}>{fmtSlot(r.confirmed_slot)}</div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{r.discipline} · {r.plan_id}</div>
                    </div>
                  );
                })}
              </>
            )}
            {requests.length === 0 && (
              <div style={{ padding: 32, textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📞</div>
                <div style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>No P2P requests</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Set your schedule above so providers can book times</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail Panel */}
      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        {!selected ? (
          <div style={{ maxWidth: 440, margin: "40px auto", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📞</div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Peer-to-Peer Reviews</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Select a request from the list to accept a time or record the call outcome.</div>
          </div>
        ) : (
          <div style={{ maxWidth: 680, margin: "0 auto" }}>
            {/* Confirmed call banner */}
            {selected.status === "confirmed" && (
              <div style={{ background: "#d1fae5", borderRadius: 12, border: "1px solid #6ee7b7", padding: "18px 22px", marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#065f46", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Confirmed Call</div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 700, color: "#065f46" }}>{fmtSlot(selected.confirmed_slot)}</div>
                <div style={{ fontSize: 12, color: "#065f46", marginTop: 4, opacity: 0.8 }}>Provider has been notified of this time</div>
              </div>
            )}

            {/* Case info */}
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 22, marginBottom: 16 }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 700, color: NAVY, marginBottom: 4 }}>{selected.member_name}</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>
                {selected.discipline} · {selected.plan_id} · Requested {selected.requested_visits} visits
              </div>
              {Array.isArray(selected.diagnosis_codes) && selected.diagnosis_codes.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                  {selected.diagnosis_codes.map(c => (
                    <span key={c} style={{ padding: "2px 8px", borderRadius: 5, background: "#eff6ff", color: NAVY, fontSize: 11, fontFamily: "monospace", fontWeight: 600 }}>{c}</span>
                  ))}
                </div>
              )}
              {/* Prior determination summary */}
              <div style={{ marginTop: 14, background: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa", padding: "12px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9a3412", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>Your Determination</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#c2410c" }}>{selected.last_determination || "—"}</div>
                {selected.last_approved_visits != null && <div style={{ fontSize: 12, color: "#92400e", marginTop: 2 }}>{selected.last_approved_visits} visits approved</div>}
                {selected.last_reviewer_notes && <div style={{ fontSize: 12, color: "#7c2d12", marginTop: 6, fontStyle: "italic" }}>"{selected.last_reviewer_notes}"</div>}
              </div>
              {selected.clinical_notes && (
                <div style={{ marginTop: 12, background: "#f8fafc", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#374151" }}>
                  <div style={{ fontWeight: 700, fontSize: 11, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.7 }}>Provider Clinical Argument</div>
                  {selected.clinical_notes}
                </div>
              )}
            </div>

            {/* Accept slot (pending only) */}
            {selected.status === "pending" && !panel && (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 22, marginBottom: 16 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 14 }}>Provider's Requested Times</div>
                <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1, padding: "14px 16px", background: "#eff6ff", borderRadius: 10, border: "1.5px solid #bfdbfe" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#1e40af", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Primary</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{fmtSlot(selected.primary_slot)}</div>
                    <button onClick={() => handleAccept("primary")} disabled={saving}
                      style={{ marginTop: 10, width: "100%", padding: "8px 0", background: NAVY, color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
                      Accept Primary
                    </button>
                  </div>
                  {selected.secondary_slot && (
                    <div style={{ flex: 1, padding: "14px 16px", background: "#f0fdf4", borderRadius: 10, border: "1.5px solid #bbf7d0" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#065f46", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Secondary</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{fmtSlot(selected.secondary_slot)}</div>
                      <button onClick={() => handleAccept("secondary")} disabled={saving}
                        style={{ marginTop: 10, width: "100%", padding: "8px 0", background: "#059669", color: "#fff", border: "none", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
                        Accept Secondary
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Record Outcome */}
            {!panel && (
              <button onClick={() => setPanel("complete")}
                style={{ width: "100%", padding: "12px 0", borderRadius: 8, background: "#059669", color: "#fff", border: "none", fontWeight: 700, fontSize: 14, cursor: "pointer", marginBottom: 16 }}>
                Record Call Outcome
              </button>
            )}

            {panel === "complete" && (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 22 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 14 }}>Record P2P Outcome</div>
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                  {[
                    { key: "upheld",         label: "Upheld",        color: "#dc2626" },
                    { key: "reversed",       label: "Reversed",      color: "#059669" },
                    { key: "partial_change", label: "Partial Change", color: "#d97706" },
                  ].map(opt => (
                    <button key={opt.key} onClick={() => setOutcome(opt.key)}
                      style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: `2px solid ${outcome === opt.key ? opt.color : "#e2e8f0"}`, background: outcome === opt.key ? opt.color : "#fff", color: outcome === opt.key ? "#fff" : "#374151", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {outcome !== "upheld" && (
                  <div style={{ background: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa", padding: 14, marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 8 }}>Updated Determination</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {["Approved", "Partial Denial", "Full Denial", "Pend"].map(d => (
                        <button key={d} onClick={() => setNewDet(d)}
                          style={{ padding: "6px 12px", borderRadius: 6, border: `1.5px solid ${newDet === d ? "#d97706" : "#e2e8f0"}`, background: newDet === d ? "#fef3c7" : "#fff", fontSize: 12, cursor: "pointer", fontWeight: newDet === d ? 700 : 400 }}>
                          {d}
                        </button>
                      ))}
                    </div>
                    <label style={{ fontSize: 12, color: "#7c2d12" }}>Approved visits
                      <input type="number" min={0} value={newVisits} onChange={e => setNewVisits(e.target.value)}
                        style={{ display: "block", marginTop: 4, width: 100, padding: "6px 10px", borderRadius: 6, border: "1px solid #fed7aa", fontSize: 13 }} />
                    </label>
                  </div>
                )}
                <label style={{ fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 14 }}>Call notes (audit trail)
                  <textarea value={outcomeNotes} onChange={e => setOutcomeNotes(e.target.value)} rows={3}
                    placeholder="Summarize clinical points discussed and rationale..."
                    style={{ display: "block", marginTop: 4, width: "100%", padding: "9px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
                </label>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setPanel(null)} style={{ padding: "9px 18px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
                  <button onClick={handleComplete} disabled={saving}
                    style={{ padding: "9px 18px", borderRadius: 7, background: "#059669", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
                    {saving ? "Recording..." : "Record Outcome & Notify Provider"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── AppealModal: provider files an appeal ────────────────────────────────────
function AppealModal({ submission, token, onClose, onSuccess }) {
  const GROUNDS_OPTIONS = [
    "Determination not supported by clinical evidence",
    "Documentation was complete; re-review requested",
    "Incorrect application of clinical criteria",
    "Benefit coverage dispute",
    "Other",
  ];
  const [grounds, setGrounds]         = useState("");
  const [notes, setNotes]             = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState("");

  const handleSubmit = async () => {
    if (!grounds) { setError("Please select grounds for the appeal."); return; }
    setSubmitting(true);
    setError("");
    try {
      await axios.post(`${API_BASE}/v1/appeals`, {
        submissionId: submission.submission_id,
        grounds,
        supportingNotes: notes,
        level: 1,
      }, { headers: { Authorization: `Bearer ${token}` } });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to file appeal.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9000, padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 520, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>File Level 1 Appeal</div>
          <div style={{ fontSize: 12, color: "#64748b", fontFamily: "'Public Sans', sans-serif" }}>{submission.member_name} · {submission.discipline}</div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6, fontFamily: "'Public Sans', sans-serif" }}>Grounds for Appeal *</div>
          {GROUNDS_OPTIONS.map(g => (
            <label key={g} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
              <input type="radio" name="grounds" value={g} checked={grounds === g} onChange={() => setGrounds(g)} />
              <span style={{ fontSize: 13, color: "#374151", fontFamily: "'Public Sans', sans-serif" }}>{g}</span>
            </label>
          ))}
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6, fontFamily: "'Public Sans', sans-serif" }}>Supporting Clinical Notes (optional)</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
            placeholder="Provide additional clinical context, citations, or documentation references..."
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
        </div>
        {error && <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 13, color: "#dc2626" }}>{error}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting}
            style={{ padding: "10px 20px", borderRadius: 8, background: "#1a3a5c", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1, fontFamily: "'Public Sans', sans-serif" }}>
            {submitting ? "Filing…" : "Submit Appeal"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AppealsQueueView: reviewer sees L1 appeals assigned to them ───────────────
function AppealsQueueView({ token }) {
  const [appeals, setAppeals]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState("");
  const [decNotes, setDecNotes] = useState("");
  const [newDet, setNewDet]     = useState("Approved");
  const [newVisits, setNewVisits] = useState("");
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState(null);

  const fetchAppeals = () => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/appeals`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setAppeals(r.data.appeals || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchAppeals(); }, [token]); // eslint-disable-line

  const handleDecide = async () => {
    if (!selected || !decision) return;
    setSaving(true);
    try {
      await axios.post(`${API_BASE}/v1/appeals/${selected.appeal_id}/decide`, {
        decision,
        decisionNotes:      decNotes,
        newDetermination:   decision !== "upheld" ? newDet : undefined,
        newApprovedVisits:  decision !== "upheld" ? (parseInt(newVisits, 10) || undefined) : undefined,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setToast("Decision recorded and provider notified.");
      setSelected(null); setDecision(""); setDecNotes(""); setNewVisits("");
      fetchAppeals();
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setToast(err.response?.data?.error || "Failed to record decision.");
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const statusChip = (s) => {
    const map = { filed: ["#eff6ff","#1d4ed8"], under_review: ["#fef3c7","#b45309"], decided: ["#f0fdf4","#15803d"], withdrawn: ["#f1f5f9","#64748b"] };
    const [bg, text] = map[s] || ["#f1f5f9","#374151"];
    return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: bg, color: text }}>{s.replace("_"," ").toUpperCase()}</span>;
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 110px)", overflow: "hidden" }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, background: "#1a3a5c", color: "#fff", borderRadius: 8, padding: "12px 20px", fontSize: 13, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>{toast}</div>}
      {/* Left: appeal list */}
      <div style={{ width: 320, borderRight: "1px solid #e2e8f0", overflowY: "auto", background: "#fff" }}>
        <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>Appeals Queue</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Level 1 appeals assigned to you</div>
        </div>
        {loading ? <div style={{ padding: 24, color: "#94a3b8", fontSize: 13 }}>Loading…</div>
        : appeals.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>No active appeals</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Appeals assigned to you will appear here.</div>
          </div>
        ) : appeals.map((a, i) => {
          const isSel = selected?.appeal_id === a.appeal_id;
          const deadline = a.deadline_at ? new Date(a.deadline_at) : null;
          const daysLeft = deadline ? Math.ceil((deadline - Date.now()) / 86400000) : null;
          return (
            <div key={a.appeal_id} onClick={() => { setSelected(a); setDecision(""); setDecNotes(""); setNewVisits(""); }}
              style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: isSel ? "#eff6ff" : i % 2 === 0 ? "#fff" : "#fafafa", borderLeft: isSel ? "3px solid #1a3a5c" : "3px solid transparent" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}>{a.member_name || "Unknown Member"}</span>
                {statusChip(a.status)}
              </div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>{a.discipline} · Level {a.level}</div>
              <div style={{ fontSize: 11, color: "#374151", marginTop: 3 }}>Grounds: {a.grounds?.slice(0, 45)}{a.grounds?.length > 45 ? "…" : ""}</div>
              {daysLeft !== null && <div style={{ fontSize: 10, color: daysLeft <= 5 ? "#dc2626" : "#94a3b8", marginTop: 3, fontWeight: daysLeft <= 5 ? 700 : 400 }}>{daysLeft > 0 ? `${daysLeft}d until deadline` : "PAST DEADLINE"}</div>}
            </div>
          );
        })}
      </div>

      {/* Right: decision panel */}
      <div style={{ flex: 1, overflowY: "auto", padding: 28, background: "#f8fafc" }}>
        {!selected ? (
          <div style={{ maxWidth: 420, margin: "80px auto", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 14 }}>⚖️</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 8 }}>Level 1 Appeal Review</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Select an appeal from the queue to review and issue a decision. The provider will be notified of the outcome.</div>
          </div>
        ) : (
          <div style={{ maxWidth: 640, margin: "0 auto" }}>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24, marginBottom: 20 }}>
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 17, fontWeight: 700, color: "#1a3a5c", marginBottom: 4 }}>{selected.member_name}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>{selected.discipline} · {selected.plan_id} · Level {selected.level} Appeal</div>
              <div style={{ background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", padding: 16, marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Original Determination</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#dc2626" }}>{selected.original_determination || "—"}</div>
              </div>
              <div style={{ background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a", padding: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 6 }}>Provider Grounds</div>
                <div style={{ fontSize: 13, color: "#78350f" }}>{selected.grounds}</div>
                {selected.supporting_notes && <div style={{ fontSize: 12, color: "#78350f", marginTop: 8, borderTop: "1px solid #fde68a", paddingTop: 8 }}>{selected.supporting_notes}</div>}
              </div>
            </div>

            {selected.status === "decided" ? (
              <div style={{ background: "#f0fdf4", borderRadius: 12, border: "1px solid #86efac", padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#15803d", marginBottom: 4 }}>Decision: {selected.decision?.toUpperCase()}</div>
                {selected.decision_notes && <div style={{ fontSize: 13, color: "#166534" }}>{selected.decision_notes}</div>}
                {selected.new_determination && <div style={{ fontSize: 12, color: "#166534", marginTop: 6 }}>New determination: {selected.new_determination} {selected.new_approved_visits ? `(${selected.new_approved_visits} visits)` : ""}</div>}
              </div>
            ) : (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24 }}>
                <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, fontWeight: 700, color: "#1a3a5c", marginBottom: 16 }}>Issue Decision</div>
                <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
                  {[
                    { key: "upheld",     label: "Uphold",     color: "#dc2626", desc: "Maintain original denial" },
                    { key: "overturned", label: "Overturn",   color: "#16a34a", desc: "Reverse in favor of provider" },
                    { key: "modified",   label: "Modify",     color: "#d97706", desc: "Partial reversal" },
                  ].map(opt => (
                    <button key={opt.key} onClick={() => setDecision(opt.key)}
                      style={{ flex: 1, padding: "12px 8px", borderRadius: 8, border: `2px solid ${decision === opt.key ? opt.color : "#e2e8f0"}`, background: decision === opt.key ? opt.color : "#fff", color: decision === opt.key ? "#fff" : "#374151", cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{opt.label}</div>
                      <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>{opt.desc}</div>
                    </button>
                  ))}
                </div>
                {decision !== "upheld" && decision && (
                  <div style={{ background: "#f0fdf4", borderRadius: 8, border: "1px solid #86efac", padding: 14, marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#15803d", marginBottom: 10 }}>New Determination</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {["Approved", "Partial Denial", "Pend"].map(d => (
                        <button key={d} onClick={() => setNewDet(d)}
                          style={{ padding: "5px 12px", borderRadius: 6, border: `1.5px solid ${newDet === d ? "#16a34a" : "#e2e8f0"}`, background: newDet === d ? "#dcfce7" : "#fff", fontSize: 12, cursor: "pointer", fontWeight: newDet === d ? 700 : 400 }}>
                          {d}
                        </button>
                      ))}
                    </div>
                    <input type="number" min={0} value={newVisits} onChange={e => setNewVisits(e.target.value)}
                      placeholder="Approved visits (optional)" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #86efac", fontSize: 13, width: 180 }} />
                  </div>
                )}
                {decision && (
                  <>
                    <textarea value={decNotes} onChange={e => setDecNotes(e.target.value)} rows={3}
                      placeholder="Decision rationale (will be sent to provider)..."
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", marginBottom: 14 }} />
                    <button onClick={handleDecide} disabled={saving}
                      style={{ background: "#1a3a5c", color: "#fff", border: "none", borderRadius: 8, padding: "11px 28px", fontSize: 14, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
                      {saving ? "Recording…" : "Record Decision & Notify Provider"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Statuses that are still editable by provider ──────────────────────────────
const EDITABLE_STATUSES = new Set(["submitted", "pending_review", "on_hold", "rmi_pending"]);

// ── EditSubmissionModal ────────────────────────────────────────────────────────
function EditSubmissionModal({ submission, token, plans, onClose, onSaved }) {
  const sub = submission;
  const [providerName, setProviderName]   = useState(sub.provider_name   || "");
  const [providerNpi,  setProviderNpi]    = useState(sub.provider_npi    || "");
  const [memberName,   setMemberName]     = useState(sub.member_name     || "");
  const [memberId,     setMemberId]       = useState(sub.member_id       || "");
  const [dob,          setDob]            = useState(sub.dob             || "");
  const [memberState,  setMemberState]    = useState(sub.member_state    || "");
  const [discipline,   setDiscipline]     = useState(sub.discipline      || "PT");
  const [diagCodes,    setDiagCodes]      = useState((sub.diagnosis_codes || []).join(", "));
  const [reqVisits,    setReqVisits]      = useState(String(sub.requested_visits || ""));
  const [planId,       setPlanId]         = useState(sub.plan_id         || "");
  const [docList,      setDocList]        = useState((sub.document_list  || []).join("\n"));
  const [notes,        setNotes]          = useState(sub.provider_notes  || "");
  const [loading,      setLoading]        = useState(false);
  const [error,        setError]          = useState("");

  const parsedDiags = diagCodes.split(",").map(s => s.trim()).filter(Boolean);
  const parsedDocs  = docList.split("\n").map(s => s.trim()).filter(Boolean);
  const completeness = Math.round([
    !!providerName.trim(), !!memberName.trim(), !!memberId.trim(), !!dob.trim(),
    !!discipline, parsedDiags.length > 0, parseInt(reqVisits, 10) > 0, parsedDocs.length > 0,
  ].filter(Boolean).length / 8 * 100);
  const meterColor = completeness >= 80 ? "#22c55e" : completeness >= 50 ? "#f59e0b" : "#ef4444";

  const handleSave = async () => {
    setError(""); setLoading(true);
    try {
      await axios.patch(
        `${API_BASE}/v1/submissions/${sub.submission_id}/edit`,
        {
          providerName: providerName.trim() || null, providerNpi: providerNpi.trim() || null,
          memberName: memberName.trim() || null, memberId: memberId.trim() || null,
          dob: dob.trim() || null, memberState: memberState.trim().toUpperCase().slice(0,2) || null,
          discipline, diagnosisCodes: parsedDiags,
          requestedVisits: parseInt(reqVisits, 10) || null,
          planId: planId || null, documentList: parsedDocs,
          providerNotes: notes.trim() || null,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || "Save failed. Please try again.");
    } finally { setLoading(false); }
  };

  const inputS = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 7, padding: "8px 12px", fontSize: 13, color: "#0f172a", background: "#f8fafc", outline: "none", boxSizing: "border-box", fontFamily: "'Public Sans', sans-serif" };
  const labelS = (t) => <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: "'Public Sans', sans-serif" }}>{t}</label>;
  const fieldS = { marginBottom: 12 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 9000, overflowY: "auto", padding: "32px 16px" }}>
      <div style={{ background: "#fff", borderRadius: 14, width: "100%", maxWidth: 640, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ background: "#1a3a5c", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif" }}>Edit Submission</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 2, fontFamily: "'Public Sans', sans-serif" }}>{sub.submission_id} · {sub.member_name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 80, height: 5, background: "rgba(255,255,255,0.2)", borderRadius: 3 }}>
                <div style={{ height: "100%", width: `${completeness}%`, background: meterColor, borderRadius: 3, transition: "width 0.2s" }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: meterColor, fontFamily: "'Public Sans', sans-serif" }}>{completeness}%</span>
            </div>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 6, color: "#fff", fontSize: 13, padding: "4px 12px", cursor: "pointer" }}>✕</button>
          </div>
        </div>

        {/* Edit notice */}
        <div style={{ background: "#fef3c7", borderBottom: "1px solid #fde68a", padding: "10px 24px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#92400e", fontFamily: "'Public Sans', sans-serif" }}>
            <strong>Editable while queued.</strong> Once a reviewer picks up this case it will be locked.
          </span>
        </div>

        {/* Form */}
        <div style={{ padding: "24px", maxHeight: "60vh", overflowY: "auto" }}>

          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #f1f5f9", fontFamily: "'Public Sans', sans-serif" }}>Provider</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div style={fieldS}>{labelS("Provider Name *")}<input value={providerName} onChange={e => setProviderName(e.target.value)} style={inputS} /></div>
            <div style={fieldS}>{labelS("Provider NPI")}<input value={providerNpi} onChange={e => setProviderNpi(e.target.value)} placeholder="10-digit NPI" style={inputS} /></div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #f1f5f9", fontFamily: "'Public Sans', sans-serif" }}>Member</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div style={fieldS}>{labelS("Member Name *")}<input value={memberName} onChange={e => setMemberName(e.target.value)} style={inputS} /></div>
            <div style={fieldS}>{labelS("Member ID *")}<input value={memberId} onChange={e => setMemberId(e.target.value)} style={inputS} /></div>
            <div style={fieldS}>{labelS("Date of Birth *")}<input type="date" value={dob} onChange={e => setDob(e.target.value)} style={inputS} /></div>
            <div style={fieldS}>{labelS("State")}<input value={memberState} onChange={e => setMemberState(e.target.value.toUpperCase().slice(0,2))} maxLength={2} placeholder="e.g. TX" style={{ ...inputS, textTransform: "uppercase" }} /></div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #f1f5f9", fontFamily: "'Public Sans', sans-serif" }}>Clinical</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
            <div style={fieldS}>{labelS("Discipline *")}<select value={discipline} onChange={e => setDiscipline(e.target.value)} style={{ ...inputS, cursor: "pointer" }}><option value="PT">PT</option><option value="OT">OT</option><option value="ST">ST</option></select></div>
            <div style={fieldS}>{labelS("Requested Visits *")}<input type="number" min="0" value={reqVisits} onChange={e => setReqVisits(e.target.value)} style={inputS} /></div>
            <div style={fieldS}>{labelS("Insurance Plan")}<select value={planId} onChange={e => setPlanId(e.target.value)} style={{ ...inputS, cursor: "pointer" }}><option value="">— Select —</option>{(plans||[]).map(p => <option key={p.plan_id} value={p.plan_id}>{p.plan_name}</option>)}</select></div>
          </div>
          <div style={fieldS}>{labelS("Diagnosis Codes * (comma-separated)")}<input value={diagCodes} onChange={e => setDiagCodes(e.target.value)} placeholder="e.g. M25.561, M75.1" style={inputS} /></div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", margin: "16px 0 12px", paddingBottom: 8, borderBottom: "1px solid #f1f5f9", fontFamily: "'Public Sans', sans-serif" }}>Documents</div>
          <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 7, padding: "10px 14px", marginBottom: 10, fontSize: 12, color: "#1d4ed8", fontFamily: "'Public Sans', sans-serif" }}>
            List the filenames of the clinical documents you are attaching (one per line). PDF upload integration coming soon — for now list the document names so the reviewer knows what to expect.
          </div>
          <div style={fieldS}>{labelS("Document List (one filename per line)")}<textarea value={docList} onChange={e => setDocList(e.target.value)} rows={4} placeholder={"IE_PatientName_05202026.pdf\nScript_PatientName_05182026.pdf"} style={{ ...inputS, resize: "vertical", lineHeight: 1.6 }} /></div>
          <div style={fieldS}>{labelS("Provider Notes")}<textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Clinical context, urgency, relevant history..." style={{ ...inputS, resize: "vertical", lineHeight: 1.6 }} /></div>

          {error && <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 7, color: "#991b1b", fontSize: 13, marginTop: 4, fontFamily: "'Public Sans', sans-serif" }}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, background: "#f8fafc" }}>
          <button onClick={handleSave} disabled={loading} style={{ flex: 1, padding: "11px 0", borderRadius: 8, border: "none", background: loading ? "#94a3b8" : "#1a3a5c", color: "#fff", fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Public Sans', sans-serif", boxShadow: loading ? "none" : "0 2px 10px rgba(26,58,92,0.2)" }}>
            {loading ? "Saving..." : `Save Changes (${completeness}% complete)`}
          </button>
          <button onClick={onClose} style={{ padding: "11px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#374151", fontSize: 14, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── INFO REQUESTED PANEL ──────────────────────────────────────────────────────
// Shown inside the expanded case row when status === 'info_requested'.
// Displays the pend reason/details and a document upload + resubmit flow.
function InfoRequestedPanel({ submission, token, onResubmitted }) {
  const [files, setFiles]       = React.useState([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError]       = React.useState("");

  const PEND_REASON_LABELS = {
    progress_note_missing:       "Most recent progress note missing",
    poc_incomplete:              "Plan of care incomplete (frequency/duration/goals)",
    functional_measures_missing: "Objective functional measures not documented",
    physician_order_missing:     "Physician order / referral missing",
    eval_outdated:               "Initial evaluation too old or not included",
    outcome_measure_missing:     "Standardized outcome measure not included",
    diagnosis_unsupported:       "Diagnosis codes not supported by documentation",
    other:                       "Other",
  };

  const reasonLabel = submission.pend_reason
    ? (PEND_REASON_LABELS[submission.pend_reason] || submission.pend_reason)
    : null;

  const handleFileChange = (e) => {
    const picked = Array.from(e.target.files || []).filter(f => f.type === "application/pdf");
    setFiles(picked);
    setError("");
  };

  const handleResubmit = async () => {
    if (files.length === 0) { setError("Please select at least one PDF to upload."); return; }
    setSubmitting(true);
    setError("");
    try {
      const fd = new FormData();
      files.forEach(f => fd.append("documents", f));
      await axios.post(
        `${API_BASE}/v1/submissions/${submission.submission_id}/resubmit`,
        fd,
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" } }
      );
      onResubmitted();
    } catch (e) {
      setError(e.response?.data?.error || "Resubmit failed — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ marginTop: 14, borderRadius: 10, border: "2px solid #f59e0b", overflow: "hidden" }}>
      {/* Amber header banner */}
      <div style={{ background: "#92400e", padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 16 }}>⚠</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", fontFamily: "'Public Sans', sans-serif" }}>
            Action Required — Additional Information Requested
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", fontFamily: "'Public Sans', sans-serif", marginTop: 1 }}>
            Upload the requested documentation and resubmit to continue review
          </div>
        </div>
      </div>

      <div style={{ background: "#fffbeb", padding: "16px 18px" }}>
        {/* Reason */}
        {reasonLabel && (
          <div style={{ marginBottom: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>
              Reason for pend
            </span>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", marginTop: 3, fontFamily: "'Public Sans', sans-serif" }}>
              {reasonLabel}
            </div>
          </div>
        )}

        {/* Details */}
        {submission.pend_details && (
          <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fff", borderRadius: 7, border: "1px solid #fde68a" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>
              What to submit
            </span>
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, marginTop: 4, fontFamily: "'Public Sans', sans-serif" }}>
              {submission.pend_details}
            </div>
          </div>
        )}

        {/* Upload area */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 6, fontFamily: "'Public Sans', sans-serif" }}>
            Upload documents (PDF only)
          </div>
          <label style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            padding: "14px 18px", borderRadius: 8, border: "2px dashed #f59e0b",
            background: "#fff", cursor: "pointer", fontFamily: "'Public Sans', sans-serif",
          }}>
            <span style={{ fontSize: 20 }}>📎</span>
            <span style={{ fontSize: 13, color: files.length > 0 ? "#1e293b" : "#9ca3af", fontWeight: files.length > 0 ? 600 : 400 }}>
              {files.length > 0
                ? files.map(f => f.name).join(", ")
                : "Click to select PDF files (up to 5)"}
            </span>
            <input type="file" accept="application/pdf" multiple style={{ display: "none" }} onChange={handleFileChange} />
          </label>
          {files.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>
              {files.length} file{files.length > 1 ? "s" : ""} selected · {(files.reduce((a, f) => a + f.size, 0) / 1024).toFixed(0)} KB total
            </div>
          )}
        </div>

        {error && (
          <div style={{ marginBottom: 10, padding: "8px 12px", background: "#fef2f2", borderRadius: 6, border: "1px solid #fca5a5", fontSize: 12, color: "#991b1b", fontFamily: "'Public Sans', sans-serif" }}>
            {error}
          </div>
        )}

        <button
          onClick={handleResubmit}
          disabled={files.length === 0 || submitting}
          style={{
            width: "100%", padding: "10px 0", borderRadius: 8,
            background: files.length === 0 || submitting ? "#d1d5db" : "#b45309",
            color: "#fff", fontSize: 13, fontWeight: 700, border: "none",
            cursor: files.length === 0 || submitting ? "not-allowed" : "pointer",
            fontFamily: "'Public Sans', sans-serif", letterSpacing: "0.02em",
          }}
        >
          {submitting ? "Submitting…" : "Resubmit for Review"}
        </button>
      </div>
    </div>
  );
}

// The three statuses that mean a determination has been made and the case is
// closed. Matches the backend's FINALIZED_STATUSES in utils/subsequentBaseline.js
// — pending_review, pending_md_review, submitted and under_review are NOT
// finalized, and a subsequent request must not be offered against them.
const FINALIZED_STATUSES = new Set(["approved", "partial_denial", "denied"]);

function MyCasesView({ token, deepLinkCaseId, onDeepLinkConsumed, onRequestMoreVisits }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [expanded, setExpanded]       = useState(null);
  const [decisions, setDecisions]     = useState({});
  const [details, setDetails]         = useState({});   // full submission from the detail fetch
  const [detailErrors, setDetailErrors] = useState({}); // id -> message, so a failed fetch is visible
  const [docsByCase, setDocsByCase]   = useState({});   // id -> [{name, signedUrl, ...}]
  const [docErrors, setDocErrors]     = useState({});
  const [p2pModal, setP2pModal]       = useState(null);
  const [acceptModal, setAcceptModal] = useState(null);
  const [editTarget, setEditTarget]     = useState(null);
  const [resubmitSuccess, setResubmitSuccess] = useState({});
  const [plans, setPlans]               = useState([]);

  const loadSubmissions = () => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/submissions`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setSubmissions(r.data.submissions || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadSubmissions(); }, [token]); // eslint-disable-line

  // Auto-expand case when navigating from a notification
  useEffect(() => {
    if (!deepLinkCaseId || submissions.length === 0) return;
    const match = submissions.find(s => s.submission_id === deepLinkCaseId);
    if (match) {
      setExpanded(deepLinkCaseId);
      setFilterStatus("all");
      if (onDeepLinkConsumed) onDeepLinkConsumed();
      setTimeout(() => {
        const el = document.getElementById(`case-row-${deepLinkCaseId}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [deepLinkCaseId, submissions]); // eslint-disable-line

  useEffect(() => {
    axios.get(`${API_BASE}/v1/plans`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setPlans(r.data.plans || []))
      .catch(() => {});
  }, [token]); // eslint-disable-line

  // A bare `catch {}` here hid a broken endpoint for months: the detail fetch
  // was returning 500, the decision stayed undefined, and the decision letter
  // quietly rendered without its approved-visit count or rationale — looking
  // structurally complete the whole time. Failures are now recorded and shown.
  const handleExpand = async (sub) => {
    const id = sub.submission_id;
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    loadDocs(id);
    if (decisions[id] === undefined && !detailErrors[id]) {
      try {
        const r = await axios.get(`${API_BASE}/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
        // null is a valid answer (no determination recorded yet) and must be
        // stored as such, or every expand refetches.
        setDecisions(prev => ({ ...prev, [id]: r.data.decision ?? null }));
        setDetailErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
        if (r.data.submission) {
          setDetails(prev => ({ ...prev, [id]: r.data.submission }));
        }
      } catch (err) {
        console.error("[MyCases] detail fetch failed for", id, err?.response?.status, err?.message);
        setDetailErrors(prev => ({
          ...prev,
          [id]: err?.response?.data?.error || "Could not load the decision details for this case.",
        }));
      }
    }
  };

  // Documents are fetched separately — the endpoint mints short-lived signed
  // URLs, so they are requested when a case is opened rather than with the list.
  const loadDocs = async (id) => {
    if (docsByCase[id]) return;
    try {
      const r = await axios.get(`${API_BASE}/v1/submissions/${id}/documents`, { headers: { Authorization: `Bearer ${token}` } });
      setDocsByCase(prev => ({ ...prev, [id]: r.data.documents || [] }));
      setDocErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch (err) {
      console.error("[MyCases] document fetch failed for", id, err?.response?.status, err?.message);
      setDocErrors(prev => ({ ...prev, [id]: err?.response?.data?.error || "Could not load documents for this case." }));
    }
  };

  const retryDetail = async (id) => {
    setDetailErrors(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const r = await axios.get(`${API_BASE}/v1/submissions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setDecisions(prev => ({ ...prev, [id]: r.data.decision ?? null }));
      if (r.data.submission) setDetails(prev => ({ ...prev, [id]: r.data.submission }));
    } catch (err) {
      setDetailErrors(prev => ({
        ...prev,
        [id]: err?.response?.data?.error || "Could not load the decision details for this case.",
      }));
    }
  };

  const [filterStatus, setFilterStatus] = useState("all");
  const [searchQ,      setSearchQ]      = useState("");

  const STATUS_FILTERS = [
    { v: "all",           label: "All" },
    { v: "queued",        label: "In Queue",      match: s => ["submitted","pending_review","on_hold"].includes(s) },
    { v: "under_review",  label: "In Review",     match: s => ["under_review","pending_md_review"].includes(s) },
    { v: "approved",      label: "Approved",      match: s => s === "approved" },
    { v: "denied",        label: "Denied",        match: s => ["denied","partial_denial"].includes(s) },
    { v: "info_requested",label: "Info Requested",match: s => s === "info_requested" },
    { v: "needs_action",  label: "Needs Action",  match: s => ["rmi_pending","on_hold","info_requested"].includes(s) },
  ];

  const filteredSubs = submissions.filter(sub => {
    const sf = STATUS_FILTERS.find(f => f.v === filterStatus);
    const statusOk = !sf || sf.v === "all" || (sf.match && sf.match(sub.status));
    const q = searchQ.trim().toLowerCase();
    const nameOk = !q || (sub.member_name || "").toLowerCase().includes(q)
      || (sub.member_id  || "").toLowerCase().includes(q)
      || (sub.submission_id || "").toLowerCase().includes(q);
    return statusOk && nameOk;
  });

  if (loading) return <div style={{ textAlign: "center", padding: "48px 0", color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>Loading...</div>;

  const canRequestP2P = (sub) =>
    ["denied", "partial_denial"].includes(sub.status) && !sub.p2p_requested;

  const canAcceptVisits = (sub) =>
    ["denied", "partial_denial"].includes(sub.status) && sub.provider_response !== "accepted";

  return (
    <div style={{ maxWidth: 760, margin: "28px auto", padding: "0 24px" }}>
      {editTarget && (
        <EditSubmissionModal
          submission={editTarget}
          token={token}
          plans={plans}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); loadSubmissions(); }}
        />
      )}

      {/* Search + filter bar */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: "14px 18px", marginBottom: 16 }}>
        <input
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="Search by member name, member ID, or case ID..."
          style={{ width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'Public Sans', sans-serif", outline: "none", boxSizing: "border-box", marginBottom: 12 }}
        />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STATUS_FILTERS.map(f => (
            <button key={f.v} onClick={() => setFilterStatus(f.v)} style={{
              padding: "5px 14px", borderRadius: 20, border: `1.5px solid ${filterStatus === f.v ? "#1a3a5c" : "#e2e8f0"}`,
              background: filterStatus === f.v ? "#1a3a5c" : "#fff",
              color: filterStatus === f.v ? "#fff" : "#6b7280",
              fontSize: 12, fontWeight: filterStatus === f.v ? 700 : 500, cursor: "pointer",
              fontFamily: "'Public Sans', sans-serif", transition: "all 0.1s",
            }}>{f.label}</button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#9ca3af", alignSelf: "center", fontFamily: "'Public Sans', sans-serif" }}>
            {filteredSubs.length} of {submissions.length} cases
          </span>
        </div>
      </div>

      {submissions.length === 0 && (
        <div style={{ background: "#fff", borderRadius: 12, padding: "48px 24px", textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginBottom: 6, fontFamily: "'Public Sans', sans-serif" }}>No submissions yet</div>
          <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif" }}>Use "New Auth" to request authorization.</div>
        </div>
      )}
      {submissions.length > 0 && filteredSubs.length === 0 && (
        <div style={{ padding: "24px 0", textAlign: "center", color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>
          No cases match the current filter.
        </div>
      )}

      {p2pModal && (
        <P2PRequestModal
          submissionId={p2pModal.submission_id}
          memberName={p2pModal.member_name}
          token={token}
          onClose={() => setP2pModal(null)}
          onSuccess={() => { setP2pModal(null); loadSubmissions(); }}
        />
      )}
      {acceptModal && (
        <AcceptVisitsModal
          submission={acceptModal}
          token={token}
          onClose={() => setAcceptModal(null)}
          onSuccess={() => { setAcceptModal(null); loadSubmissions(); }}
        />
      )}
      {filteredSubs.map(sub => {
        const isOpen = expanded === sub.submission_id;
        const priorityBadge = sub.review_priority && sub.review_priority !== "standard"
          ? { urgent: { bg: "#fffbeb", text: "#92400e", label: "URGENT" }, expedited: { bg: "#fef2f2", text: "#dc2626", label: "EXPEDITED" } }[sub.review_priority]
          : null;
        return (
          <div key={sub.submission_id} id={`case-row-${sub.submission_id}`} style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: sub.submission_id === deepLinkCaseId ? "2px solid #f59e0b" : "1px solid #e2e8f0", marginBottom: 14, overflow: "hidden" }}>
            <div onClick={() => handleExpand(sub)} style={{ padding: "16px 20px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#1e293b", fontFamily: "'Public Sans', sans-serif" }}>{sub.member_name || "Unknown Member"}</span>
                  <span style={{ fontSize: 10, fontFamily: "monospace", color: "#9ca3af" }}>{sub.submission_id?.slice(0,12)}…</span>
                  {priorityBadge && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: priorityBadge.bg, color: priorityBadge.text, borderRadius: 5, padding: "2px 7px" }}>{priorityBadge.label}</span>
                  )}
                  {sub.review_type === "concurrent" && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e", borderRadius: 5, padding: "2px 7px" }}>CONCURRENT</span>
                  )}
                  {sub.status === "info_requested" && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e", borderRadius: 5, padding: "2px 7px", border: "1px solid #fcd34d" }}>⚠ ACTION REQUIRED</span>
                  )}
                  {resubmitSuccess[sub.submission_id] && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#d1fae5", color: "#065f46", borderRadius: 5, padding: "2px 7px" }}>✓ RESUBMITTED</span>
                  )}
                  {canRequestP2P(sub) && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#fef3c7", color: "#92400e", borderRadius: 5, padding: "2px 7px" }}>P2P AVAILABLE</span>
                  )}
                  {sub.p2p_requested && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#d1fae5", color: "#065f46", borderRadius: 5, padding: "2px 7px" }}>P2P REQUESTED</span>
                  )}
                  {canAcceptVisits(sub) && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#f0fdf4", color: "#15803d", borderRadius: 5, padding: "2px 7px", border: "1px solid #86efac" }}>ACCEPT AVAILABLE</span>
                  )}
                  {sub.provider_response === "accepted" && (
                    <span style={{ fontSize: 10, fontWeight: 700, background: "#d1fae5", color: "#065f46", borderRadius: 5, padding: "2px 7px" }}>VISITS ACCEPTED</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>
                  {sub.discipline || "PT"} · {sub.requested_visits} visits requested · {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : "—"}
                </div>
                <div style={{ marginTop: 10 }}>
                  <StatusProgressBar status={sub.status} />
                </div>
                {/* Auth expiry countdown */}
                {sub.auth_expires_at && sub.status === "approved" && (() => {
                  const daysLeft = Math.ceil((new Date(sub.auth_expires_at) - Date.now()) / 86400000);
                  if (daysLeft > 60) return null;
                  const urgent = daysLeft <= 14;
                  return (
                    <div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, background: urgent ? "#fef2f2" : "#fef3c7", border: `1px solid ${urgent ? "#fca5a5" : "#fde68a"}` }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: urgent ? "#dc2626" : "#92400e", fontFamily: "'Public Sans', sans-serif" }}>
                        {daysLeft > 0 ? `Auth expires in ${daysLeft}d` : "Auth EXPIRED"}
                      </span>
                    </div>
                  );
                })()}
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                {EDITABLE_STATUSES.has(sub.status) && (
                  <button
                    onClick={e => { e.stopPropagation(); setEditTarget(sub); }}
                    style={{ padding: "5px 13px", borderRadius: 6, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Public Sans', sans-serif", whiteSpace: "nowrap" }}
                  >Edit</button>
                )}
                <span style={{ fontSize: 16, color: "#9ca3af" }}>{isOpen ? "▲" : "▼"}</span>
              </div>
            </div>
            {isOpen && (
              <div style={{ borderTop: "1px solid #f1f5f9", padding: "16px 20px" }}>
                {/* Member + request summary. Providers see status and outcome
                    only — nothing from the reviewer's internal assessment. */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px 18px", marginBottom: 14 }}>
                  {[
                    ["Member",         sub.member_name || "—"],
                    ["Member ID",      sub.member_id   || "—"],
                    ["Date of Birth",  sub.dob         || "—"],
                    ["Discipline",     sub.discipline  || "—"],
                    ["Visits Requested", sub.requested_visits != null ? String(sub.requested_visits) : "—"],
                    ["Review Type",    sub.review_type ? sub.review_type.replace(/_/g, " ") : "initial"],
                    ["Submitted",      sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : "—"],
                    ...(FINALIZED_STATUSES.has(sub.status) ? [
                      ["Determination", (decisions[sub.submission_id]?.determination) || sub.status.replace(/_/g, " ")],
                      ["Visits Approved", sub.approved_visits != null
                        ? String(sub.approved_visits)
                        : (decisions[sub.submission_id]?.approved_visits != null ? String(decisions[sub.submission_id].approved_visits) : "—")],
                      ["Determination Date", (() => {
                        const d = decisions[sub.submission_id]?.recorded_at || sub.approved_at || sub.reviewed_at;
                        return d ? new Date(d).toLocaleDateString() : "—";
                      })()],
                    ] : []),
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>{k}</span>
                      <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 500, fontFamily: "'Public Sans', sans-serif", textTransform: k === "Review Type" || k === "Determination" ? "capitalize" : "none" }}>{v}</div>
                    </div>
                  ))}
                </div>

                {/* Detail-fetch failure, surfaced instead of swallowed */}
                {detailErrors[sub.submission_id] && (
                  <div style={{ marginBottom: 12, padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 7, fontSize: 12, color: "#991b1b", fontFamily: "'Public Sans', sans-serif", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span>{detailErrors[sub.submission_id]}</span>
                    <button onClick={e => { e.stopPropagation(); retryDetail(sub.submission_id); }}
                      style={{ flexShrink: 0, padding: "4px 12px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#991b1b", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>Retry</button>
                  </div>
                )}

                {/* Uploaded documents */}
                <div style={{ marginBottom: 14 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>Documents</span>
                  {docErrors[sub.submission_id] ? (
                    <div style={{ fontSize: 12, color: "#991b1b", marginTop: 4, fontFamily: "'Public Sans', sans-serif" }}>{docErrors[sub.submission_id]}</div>
                  ) : !docsByCase[sub.submission_id] ? (
                    <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4, fontFamily: "'Public Sans', sans-serif" }}>Loading…</div>
                  ) : docsByCase[sub.submission_id].length === 0 ? (
                    <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4, fontFamily: "'Public Sans', sans-serif" }}>No documents were uploaded with this request.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 5 }}>
                      {docsByCase[sub.submission_id].map((d, i) => (
                        <div key={(d.key || d.name || "doc") + i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: "'Public Sans', sans-serif" }}>
                          <span style={{ color: "#6b7280" }}>📄</span>
                          {d.signedUrl ? (
                            <a href={d.signedUrl} target="_blank" rel="noopener noreferrer"
                               onClick={e => e.stopPropagation()}
                               style={{ color: "#1d4ed8", textDecoration: "none", fontWeight: 600 }}>{d.name || "Document"}</a>
                          ) : (
                            <span style={{ color: "#374151" }}>{d.name || "Document"}</span>
                          )}
                          {d.size != null && <span style={{ color: "#9ca3af", fontSize: 11 }}>({Math.round(d.size / 1024)} KB)</span>}
                          {!d.signedUrl && <span style={{ color: "#9ca3af", fontSize: 11 }}>— not retrievable</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Absence is itself worth showing: a case with no diagnosis
                    cannot be matched to a guideline and will come back as a
                    Pend, so say so rather than omitting the section. */}
                <div style={{ marginBottom: 12 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>Diagnosis Codes</span>
                  {Array.isArray(sub.diagnosis_codes) && sub.diagnosis_codes.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                      {sub.diagnosis_codes.map(c => (
                        <span key={c} style={{ padding: "2px 8px", borderRadius: 5, background: "#eff6ff", color: "#1a3a5c", fontSize: 11, fontFamily: "monospace", fontWeight: 600 }}>{c}</span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: "#92400e", marginTop: 4, fontFamily: "'Public Sans', sans-serif" }}>
                      No diagnosis on file — this case cannot be matched to a clinical guideline.
                    </div>
                  )}
                </div>
                <DecisionLetter submission={sub} decision={decisions[sub.submission_id]} />

                {/* Request Additional Visits — finalized cases only. An
                    undecided prior is not a baseline to continue from. */}
                {FINALIZED_STATUSES.has(sub.status) && onRequestMoreVisits && (
                  <div style={{ marginTop: 14, padding: "14px 16px", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#5b21b6", fontFamily: "'Public Sans', sans-serif" }}>Need more visits for this member?</div>
                      <div style={{ fontSize: 11, color: "#6d28d9", marginTop: 2, fontFamily: "'Public Sans', sans-serif" }}>
                        Starts a subsequent request pre-filled from this authorization. Attach the current progress note.
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); onRequestMoreVisits({ ...sub, ...(details[sub.submission_id] || {}) }); }}
                      style={{ flexShrink: 0, padding: "9px 18px", borderRadius: 8, background: "#7c3aed", color: "#fff", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Public Sans', sans-serif", whiteSpace: "nowrap" }}
                    >Request Additional Visits</button>
                  </div>
                )}
                {/* Info Requested — upload + resubmit */}
                {sub.status === "info_requested" && !resubmitSuccess[sub.submission_id] && (
                  <InfoRequestedPanel
                    submission={sub}
                    token={token}
                    onResubmitted={() => {
                      setResubmitSuccess(prev => ({ ...prev, [sub.submission_id]: true }));
                      loadSubmissions();
                    }}
                  />
                )}
                {resubmitSuccess[sub.submission_id] && (
                  <div style={{ marginTop: 14, padding: "14px 16px", background: "#d1fae5", borderRadius: 8, border: "1px solid #6ee7b7", fontSize: 13, color: "#065f46", fontFamily: "'Public Sans', sans-serif" }}>
                    ✓ Documents submitted — your case has returned to the review queue.
                  </div>
                )}
                {/* P2P request */}
                {canRequestP2P(sub) && (
                  <div style={{ marginTop: 14, padding: "14px 16px", background: "#fffbeb", borderRadius: 8, border: "1px solid #fde68a", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", fontFamily: "'Public Sans', sans-serif" }}>Disagree with this determination?</div>
                      <div style={{ fontSize: 12, color: "#78350f", marginTop: 2 }}>You may request a peer-to-peer review call with the reviewing clinician.</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); setP2pModal(sub); }}
                      style={{ flexShrink: 0, marginLeft: 16, padding: "8px 16px", background: "#d97706", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
                      Request P2P
                    </button>
                  </div>
                )}
                {sub.p2p_requested && (
                  <div style={{ marginTop: 12, padding: "12px 16px", background: "#d1fae5", borderRadius: 8, border: "1px solid #6ee7b7", fontSize: 13, color: "#065f46", fontFamily: "'Public Sans', sans-serif" }}>
                    ✓ P2P request submitted — you will be notified when a time is confirmed.
                  </div>
                )}
                {/* Accept visits */}
                {canAcceptVisits(sub) && (
                  <div style={{ marginTop: 10, padding: "14px 16px", background: "#f0fdf4", borderRadius: 8, border: "1px solid #86efac", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d", fontFamily: "'Public Sans', sans-serif" }}>Ready to move forward?</div>
                      <div style={{ fontSize: 12, color: "#166534", marginTop: 2 }}>Accept the authorized visits to close this case without a P2P.</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); setAcceptModal(sub); }}
                      style={{ flexShrink: 0, marginLeft: 16, padding: "8px 16px", background: "#15803d", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
                      Accept Visits
                    </button>
                  </div>
                )}
                {sub.provider_response === "accepted" && (
                  <div style={{ marginTop: 10, padding: "12px 16px", background: "#d1fae5", borderRadius: 8, border: "1px solid #6ee7b7", fontSize: 13, color: "#065f46", fontFamily: "'Public Sans', sans-serif" }}>
                    ✓ Visits accepted{sub.provider_responded_at ? ` on ${new Date(sub.provider_responded_at).toLocaleDateString()}` : ""}.
                  </div>
                )}
                {!["approved","denied","info_requested","pending_md_review","partial_denial"].includes(sub.status) && !resubmitSuccess[sub.submission_id] && (
                  <div style={{ marginTop: 12, padding: "12px 16px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>
                      Your case is in queue. You will be notified once a determination is made.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── PROVIDER DASHBOARD ────────────────────────────────────────────────────────
function ProviderDashboard({ token, clinicProfile, onNewAuth, onViewCases, onOpenCase }) {
  const [stats, setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API_BASE}/v1/provider-stats`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setStats(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]); // eslint-disable-line

  const bs = stats?.byStatus || {};
  const pending    = (bs.submitted || 0) + (bs.pending_review || 0) + (bs.on_hold || 0);
  const approved   = (bs.approved || 0);
  const denied     = (bs.denied || 0) + (bs.partial_denial || 0);
  const inReview   = (bs.under_review || 0) + (bs.pending_md_review || 0);
  const needsAttn  = (bs.rmi_pending || 0) + (bs.on_hold || 0) + (bs.info_requested || 0);

  const statCards = [
    { label: "In Queue",    value: pending,   color: "#1a3a5c", bg: "#eff6ff",  border: "#bfdbfe" },
    { label: "In Review",   value: inReview,  color: "#92400e", bg: "#fffbeb",  border: "#fde68a" },
    { label: "Approved",    value: approved,  color: "#15803d", bg: "#f0fdf4",  border: "#86efac" },
    { label: "Needs Action",value: needsAttn, color: "#dc2626", bg: "#fef2f2",  border: "#fca5a5" },
  ];

  const profileIncomplete = !clinicProfile?.clinic_name;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 28px 60px" }}>

      {/* Clinic profile setup prompt */}
      {profileIncomplete && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "14px 20px", marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", fontFamily: "'Public Sans', sans-serif" }}>Complete your clinic profile</div>
            <div style={{ fontSize: 12, color: "#78350f", marginTop: 2, fontFamily: "'Public Sans', sans-serif" }}>Add your clinic name, NPI, and contact info so it pre-fills every submission automatically.</div>
          </div>
          <button onClick={() => onViewCases("settings")} style={{ flexShrink: 0, padding: "8px 18px", background: "#d97706", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
            Set Up Profile
          </button>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
        {statCards.map(s => (
          <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 12, padding: "18px 20px" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color, fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1 }}>
              {loading ? "—" : s.value}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: s.color, marginTop: 5, fontFamily: "'Public Sans', sans-serif", opacity: 0.8 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Primary CTA */}
      <div style={{ background: "#1a3a5c", borderRadius: 14, padding: "28px 32px", marginBottom: 28, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 6 }}>Submit a new prior authorization</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", fontFamily: "'Public Sans', sans-serif" }}>
            Upload clinical PDFs for AI extraction, or fill the form manually.
            {clinicProfile?.clinic_name && <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 600 }}> Your clinic info will be pre-filled.</span>}
          </div>
        </div>
        <button onClick={onNewAuth} style={{ flexShrink: 0, padding: "13px 28px", background: "#fff", color: "#1a3a5c", border: "none", borderRadius: 9, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "'Public Sans', sans-serif", boxShadow: "0 2px 12px rgba(0,0,0,0.15)", whiteSpace: "nowrap" }}>
          New Auth Request
        </button>
      </div>

      {/* Recent cases */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>Recent Submissions</span>
          <button onClick={() => onViewCases("my_cases")} style={{ fontSize: 12, color: "#1a3a5c", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>View all →</button>
        </div>
        {loading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>Loading...</div>
        ) : !stats?.recentCases?.length ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>
            No submissions yet — use the button above to get started.
          </div>
        ) : stats.recentCases.map(r => {
          const diags = Array.isArray(r.diagnosis_codes) ? r.diagnosis_codes : [];
          const statusColors = {
            approved:         { bg: "#f0fdf4", text: "#15803d" },
            denied:           { bg: "#fef2f2", text: "#991b1b" },
            partial_denial:   { bg: "#fef2f2", text: "#991b1b" },
            info_requested:   { bg: "#fef3c7", text: "#92400e" },
            under_review:     { bg: "#fffbeb", text: "#92400e" },
            pending_md_review:{ bg: "#fffbeb", text: "#92400e" },
            submitted:        { bg: "#eff6ff", text: "#1d4ed8" },
            pending_review:   { bg: "#eff6ff", text: "#1d4ed8" },
            rmi_pending:      { bg: "#fef3c7", text: "#b45309" },
            on_hold:          { bg: "#f5f3ff", text: "#6d28d9" },
          };
          const sc = statusColors[r.status] || { bg: "#f3f4f6", text: "#374151" };
          return (
            <div
              key={r.submission_id}
              onClick={() => onOpenCase && onOpenCase(r.submission_id)}
              onKeyDown={e => { if (onOpenCase && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpenCase(r.submission_id); } }}
              role={onOpenCase ? "button" : undefined}
              tabIndex={onOpenCase ? 0 : undefined}
              onMouseEnter={e => { if (onOpenCase) e.currentTarget.style.background = "#f8fafc"; }}
              onMouseLeave={e => { if (onOpenCase) e.currentTarget.style.background = "transparent"; }}
              style={{ padding: "13px 20px", borderBottom: "1px solid #f8fafc", display: "flex", alignItems: "center", gap: 14, cursor: onOpenCase ? "pointer" : "default", transition: "background 0.12s", background: "transparent" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", fontFamily: "'Public Sans', sans-serif" }}>{r.member_name || "Unknown Member"}</div>
                <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1, fontFamily: "'DM Sans', monospace" }}>{r.discipline} · {r.requested_visits} visits · {diags[0] || "No diagnosis on file"}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: sc.bg, color: sc.text, flexShrink: 0, textTransform: "capitalize", fontFamily: "'Public Sans', sans-serif" }}>
                {(r.status || "submitted").replace(/_/g, " ")}
              </span>
              <span style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
                {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── CLINIC SETTINGS VIEW ───────────────────────────────────────────────────────
function ClinicSettingsView({ token, profile, onSaved }) {
  const [clinicName,     setClinicName]     = useState(profile?.clinic_name     || "");
  const [clinicNpi,      setClinicNpi]      = useState(profile?.clinic_npi      || "");
  const [clinicTaxId,    setClinicTaxId]    = useState(profile?.clinic_tax_id   || "");
  const [clinicAddress,  setClinicAddress]  = useState(profile?.clinic_address  || "");
  const [clinicPhone,    setClinicPhone]    = useState(profile?.clinic_phone    || "");
  const [clinicFax,      setClinicFax]      = useState(profile?.clinic_fax      || "");
  const [clinicSpecialty,setClinicSpecialty]= useState(profile?.clinic_specialty|| "");
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState("");

  const handleSave = async () => {
    setError(""); setSaving(true); setSaved(false);
    try {
      await axios.patch(`${API_BASE}/v1/clinic-profile`, {
        clinicName: clinicName.trim() || null,
        clinicNpi:  clinicNpi.trim()  || null,
        clinicTaxId: clinicTaxId.trim() || null,
        clinicAddress: clinicAddress.trim() || null,
        clinicPhone: clinicPhone.trim() || null,
        clinicFax:   clinicFax.trim()   || null,
        clinicSpecialty: clinicSpecialty || null,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setSaved(true);
      onSaved({ clinic_name: clinicName, clinic_npi: clinicNpi, clinic_tax_id: clinicTaxId, clinic_address: clinicAddress, clinic_phone: clinicPhone, clinic_fax: clinicFax, clinic_specialty: clinicSpecialty });
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err.response?.data?.error || "Save failed.");
    } finally { setSaving(false); }
  };

  const inputS = { width: "100%", padding: "9px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, color: "#0f172a", outline: "none", boxSizing: "border-box", fontFamily: "'Public Sans', sans-serif", background: "#fff" };
  const labelS = (t) => <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontFamily: "'Public Sans', sans-serif" }}>{t}</div>;

  return (
    <div style={{ maxWidth: 680, margin: "28px auto", padding: "0 24px 60px" }}>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #f1f5f9", background: "#f8fafc" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>Clinic Profile</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2, fontFamily: "'Public Sans', sans-serif" }}>This information pre-fills every authorization submission automatically.</div>
        </div>
        <div style={{ padding: "24px" }}>

          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14, fontFamily: "'Public Sans', sans-serif" }}>Clinic Identity</div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "10px 16px", marginBottom: 16 }}>
            <div>{labelS("Clinic / Practice Name *")}<input value={clinicName} onChange={e => setClinicName(e.target.value)} placeholder="e.g. Springfield Physical Therapy Associates" style={inputS} /></div>
            <div>{labelS("Primary Specialty")}<select value={clinicSpecialty} onChange={e => setClinicSpecialty(e.target.value)} style={{ ...inputS, cursor: "pointer" }}>
              <option value="">All disciplines</option>
              <option value="PT">Physical Therapy (PT)</option>
              <option value="OT">Occupational Therapy (OT)</option>
              <option value="ST">Speech Therapy (ST)</option>
              <option value="PT/OT">PT + OT</option>
              <option value="PT/OT/ST">PT + OT + ST</option>
            </select></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 20 }}>
            <div>{labelS("NPI Number")}<input value={clinicNpi} onChange={e => setClinicNpi(e.target.value.replace(/\D/g,"").slice(0,10))} placeholder="10-digit NPI" style={{ ...inputS, fontFamily: "monospace" }} /></div>
            <div>{labelS("Tax ID / EIN")}<input value={clinicTaxId} onChange={e => setClinicTaxId(e.target.value)} placeholder="XX-XXXXXXX" style={{ ...inputS, fontFamily: "monospace" }} /></div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14, fontFamily: "'Public Sans', sans-serif" }}>Contact & Location</div>
          <div style={{ marginBottom: 12 }}>{labelS("Clinic Address")}<input value={clinicAddress} onChange={e => setClinicAddress(e.target.value)} placeholder="123 Main St, Suite 100, Springfield, TX 75001" style={inputS} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 20 }}>
            <div>{labelS("Phone")}<input value={clinicPhone} onChange={e => setClinicPhone(e.target.value)} placeholder="(555) 123-4567" style={inputS} /></div>
            <div>{labelS("Fax")}<input value={clinicFax} onChange={e => setClinicFax(e.target.value)} placeholder="(555) 123-4568" style={inputS} /></div>
          </div>

          {error && <div style={{ padding: "10px 14px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 7, color: "#991b1b", fontSize: 13, marginBottom: 14, fontFamily: "'Public Sans', sans-serif" }}>{error}</div>}
          {saved  && <div style={{ padding: "10px 14px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 7, color: "#15803d", fontSize: 13, marginBottom: 14, fontFamily: "'Public Sans', sans-serif" }}>Profile saved successfully.</div>}

          <button onClick={handleSave} disabled={saving || !clinicName.trim()} style={{
            padding: "11px 28px", borderRadius: 8, background: saving || !clinicName.trim() ? "#94a3b8" : "#1a3a5c",
            color: "#fff", fontSize: 14, fontWeight: 700, border: "none",
            cursor: saving || !clinicName.trim() ? "not-allowed" : "pointer",
            fontFamily: "'Public Sans', sans-serif", boxShadow: saving ? "none" : "0 2px 10px rgba(26,58,92,0.2)",
          }}>{saving ? "Saving..." : "Save Profile"}</button>
        </div>
      </div>
    </div>
  );
}

function ProviderPortal({ user, token, onLogout }) {
  const [provView, setProvView]         = useState("dashboard");
  const [confirmation, setConfirmation] = useState(null);
  const [clinicProfile, setClinicProfile] = useState(null);
  const [deepLinkCaseId, setDeepLinkCaseId] = useState(null);

  const [prefillParent, setPrefillParent] = useState(null);

  const handleNavigateToCase = (caseId) => {
    setDeepLinkCaseId(caseId);
    setProvView("my_cases");
    setConfirmation(null);
  };

  // "Request Additional Visits" — carry the finalized parent into the New Auth
  // form. Keyed on submission_id so switching parents remounts the form with
  // fresh state rather than leaving the previous member's values behind.
  const handleRequestMoreVisits = (parentSubmission) => {
    setPrefillParent(parentSubmission);
    setProvView("new_submission");
    setConfirmation(null);
  };

  // Leaving the New Auth tab clears the parent, so returning to it later starts
  // a blank request instead of silently continuing an old case.
  const goToView = (v) => {
    if (v !== "new_submission") setPrefillParent(null);
    setProvView(v);
    setConfirmation(null);
  };

  useEffect(() => {
    axios.get(`${API_BASE}/v1/clinic-profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setClinicProfile(r.data.profile || {}))
      .catch(() => setClinicProfile({}));
  }, [token]); // eslint-disable-line

  const handleSubmitted = (data) => {
    setConfirmation(data);
    setProvView("confirmation");
  };

  const clinicName = clinicProfile?.clinic_name;

  const HEADER = (
    <div style={{ background: "#1a3a5c", padding: "13px 28px", display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif", letterSpacing: "-0.02em" }}>CogentCR</span>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>|</span>
      {clinicName ? (
        <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.9)", fontFamily: "'Public Sans', sans-serif" }}>{clinicName}</span>
      ) : (
        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.6)", fontFamily: "'Public Sans', sans-serif" }}>Provider Portal</span>
      )}
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", fontFamily: "'Public Sans', sans-serif" }}>{user.name || user.email}</span>
      <NotificationBell token={token} onNavigateToCase={handleNavigateToCase} />
      <button onClick={onLogout}
  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.2)"; }}
  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
  style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", transition: "background 0.1s" }}>Logout</button>
    </div>
  );

  const TABS = (
    <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 28px", display: "flex", gap: 0 }}>
      {[["dashboard","Dashboard"], ["new_submission","New Auth"], ["my_cases","My Cases"], ["settings","Settings"]].map(([v, label]) => (
        <button key={v} onClick={() => goToView(v)} style={{
          padding: "12px 20px", fontSize: 13, fontWeight: provView === v ? 700 : 500,
          color: provView === v ? "#1a3a5c" : "#6b7280", background: "none", border: "none",
          borderBottom: provView === v ? "2.5px solid #1a3a5c" : "2.5px solid transparent",
          cursor: "pointer", fontFamily: "'Public Sans', sans-serif", transition: "all 0.12s",
        }}>{label}</button>
      ))}
    </div>
  );

  // Confirmation / auto-approval result view
  if (provView === "confirmation" && confirmation) {
    const auto = confirmation.autoApproval;
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'Public Sans', system-ui, sans-serif" }}>
        {HEADER}{TABS}
        <div style={{ maxWidth: 700, margin: "28px auto", padding: "0 24px" }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "32px 28px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0" }}>
            {auto?.eligible ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>✓</div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#15803d", fontFamily: "'Fraunces', Georgia, serif" }}>Auto-Approved</div>
                    <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>Your request met all criteria for automatic authorization.</div>
                  </div>
                </div>
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "16px 20px", marginBottom: 18 }}>
                  <div style={{ fontSize: 11, color: "#15803d", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif" }}>Authorized</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: "#15803d", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.1 }}>{auto.approvedVisits} <span style={{ fontSize: 15, fontWeight: 600 }}>visits</span></div>
                  {auto.rationale && <div style={{ fontSize: 12, color: "#374151", marginTop: 8, fontFamily: "'Public Sans', sans-serif", lineHeight: 1.6 }}>{auto.rationale}</div>}
                </div>
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>⏳</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>Submitted for Review</div>
                  <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>A reviewer will process your request. You can track status in My Cases.</div>
                </div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px 16px", marginBottom: 20 }}>
              {[
                ["Case ID", confirmation.submissionId],
                ["Completeness", confirmation.completenessScore + "%"],
                ["Submitted", confirmation.submittedAt ? new Date(confirmation.submittedAt).toLocaleDateString() : "—"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif" }}>{k}</div>
                  <div style={{ fontSize: 13, color: "#1e293b", fontWeight: 600, fontFamily: "'Public Sans', sans-serif", marginTop: 2 }}>{v}</div>
                </div>
              ))}
            </div>
            {confirmation.extractedData && (() => {
              const ex = confirmation.extractedData;
              const dq = ex.documentationQuality || {};
              const dqFlags = [
                ["Objective Measures", dq.hasObjectiveMeasures],
                ["Functional Limitations", dq.hasFunctionalLimitations],
                ["Goals Documented", dq.hasGoals],
                ["Plan of Care", dq.hasPOC],
              ];
              return (
                <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: "16px 20px", marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <span style={{ fontSize: 16 }}>🤖</span>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif" }}>AI Extraction Complete</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" }}>
                    {ex.diagnosisCodes?.length > 0 && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>Diagnoses Extracted</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {ex.diagnosisCodes.map(c => (
                            <span key={c} style={{ background: "#e0f2fe", color: "#0369a1", borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>{c}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {ex.painScore != null && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif", marginBottom: 4 }}>Pain Score</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "#1e293b", fontFamily: "'Fraunces', Georgia, serif" }}>{ex.painScore}<span style={{ fontSize: 12, fontWeight: 500, color: "#6b7280" }}>/10</span></div>
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif", marginBottom: 6 }}>Documentation Quality</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {dqFlags.map(([label, val]) => (
                        <span key={label} style={{ display: "flex", alignItems: "center", gap: 4, background: val ? "#dcfce7" : "#f1f5f9", color: val ? "#15803d" : "#94a3b8", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>
                          <span>{val ? "✓" : "–"}</span>{label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
            <button onClick={() => { setProvView("my_cases"); setConfirmation(null); }}
              style={{ padding: "10px 24px", borderRadius: 8, background: "#1a3a5c", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
              View My Cases
            </button>
            <button onClick={() => { setProvView("new_submission"); setConfirmation(null); }}
              style={{ marginLeft: 10, padding: "10px 24px", borderRadius: 8, background: "none", color: "#1a3a5c", fontSize: 13, fontWeight: 600, border: "1px solid #d1d5db", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
              Submit Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'Public Sans', system-ui, sans-serif" }}>
      {HEADER}{TABS}
      {provView === "dashboard"      && <ProviderDashboard token={token} clinicProfile={clinicProfile} onNewAuth={() => setProvView("new_submission")} onViewCases={v => setProvView(v)} onOpenCase={handleNavigateToCase} />}
      {provView === "new_submission" && <NewSubmissionForm key={prefillParent?.submission_id || "blank"} token={token} clinicProfile={clinicProfile} onSubmitted={handleSubmitted} prefill={prefillParent} onCancelPrefill={() => setPrefillParent(null)} />}
      {provView === "my_cases"       && <MyCasesView token={token} deepLinkCaseId={deepLinkCaseId} onDeepLinkConsumed={() => setDeepLinkCaseId(null)} onRequestMoreVisits={handleRequestMoreVisits} />}
      {provView === "settings"       && <ClinicSettingsView token={token} profile={clinicProfile} onSaved={p => setClinicProfile(p)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MASTER DASHBOARD (Phase 12)
// ─────────────────────────────────────────────────────────────────────────────
function MasterDashboard({ token, onReviewCase, onNavigate }) {
  const [stats, setStats]       = useState(null);
  const [tatStats, setTatStats] = useState(null);
  const [brief, setBrief]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [period, setPeriod]     = useState("today");
  const [error, setError]       = useState("");

  useEffect(() => {
    const h = { Authorization: `Bearer ${token}` };
    Promise.all([
      axios.get(`${API_BASE}/v1/master-stats`, { headers: h }),
      axios.get(`${API_BASE}/v1/tat-stats`,    { headers: h }).catch(() => null),
      axios.get(`${API_BASE}/v1/ops-brief`,    { headers: h }).catch(() => null),
    ]).then(([r1, r2, r3]) => {
      setStats(r1.data);
      if (r2) setTatStats(r2.data);
      if (r3) setBrief(r3.data);
      setLoading(false);
    }).catch(() => { setError("Failed to load stats."); setLoading(false); });
  }, [token]);

  const PERIODS = [
    { key: "today",      label: "Today" },
    { key: "this_week",  label: "This Week" },
    { key: "this_month", label: "This Month" },
    { key: "all_time",   label: "All Time" },
  ];
  const DET_COLORS = {
    "Approved":      "#15803d",
    "Partial Denial":"#92400e",
    "Full Denial":   "#991b1b",
    "Pended":        "#1d4ed8",
  };
  const discColor = (d) => d === "OT" ? "#c2410c" : d === "ST" ? "#15803d" : "#1a3a5c";

  const detBadge = (det) => {
    if (!det) return { bg: "#f3f4f6", text: "#374151" };
    const l = det.toLowerCase();
    if (l.startsWith("approved"))       return { bg: "#dcfce7", text: "#15803d" };
    if (l.includes("denial"))           return { bg: "#fee2e2", text: "#991b1b" };
    if (l.startsWith("partial"))        return { bg: "#fef3c7", text: "#92400e" };
    if (l.startsWith("pend"))           return { bg: "#eff6ff", text: "#1d4ed8" };
    return { bg: "#f3f4f6", text: "#374151" };
  };

  if (loading) return <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af", fontSize: 13, fontFamily: "'Public Sans', sans-serif" }}>Loading team stats...</div>;
  if (error)   return <div style={{ textAlign: "center", padding: "60px 0", color: "#dc2626", fontSize: 13 }}>{error}</div>;
  if (!stats)  return null;

  const totals  = stats.totals  || {};
  const byDet   = stats.byDetermination || [];
  const revs    = stats.reviewers || [];
  const queue   = stats.queue || [];

  const totalForPeriod  = parseInt(totals[period] || 0);
  const detRows = byDet.map(r => ({
    det: r.determination,
    count: parseInt(r[period] || 0),
    color: DET_COLORS[r.determination] || "#6b7280",
  })).filter(r => r.count > 0).sort((a, b) => b.count - a.count);

  const autoApprPct = totalForPeriod > 0 && totals.auto_approved_all
    ? Math.round(parseInt(totals.auto_approved_all) / parseInt(totals.all_time) * 100)
    : 0;

  // Count total attention items
  const briefCount = brief
    ? (brief.breached?.length || 0) + (brief.awaitingMD?.length || 0) + (brief.rmiOverdue?.length || 0) + (brief.unassigned?.length || 0)
    : 0;

  return (
    <div style={{ maxWidth: 1100, margin: "28px auto", padding: "0 24px" }}>

      {/* ── Ops Brief ── */}
      {brief && briefCount > 0 && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", marginBottom: 24, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", background: briefCount > 3 ? "#fef2f2" : "#fffbeb", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: briefCount > 3 ? "#dc2626" : "#92400e", fontFamily: "'Fraunces', Georgia, serif" }}>
              {briefCount > 3 ? "⚠ " : "● "}{briefCount} item{briefCount !== 1 ? "s" : ""} need attention
            </span>
            <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>— Today's operational brief</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0 }}>
            {[
              { key: "breached",   label: "SLA Breached",       color: "#991b1b", bg: "#fef2f2", items: brief.breached },
              { key: "awaitingMD", label: "Awaiting MD Co-Sign",color: "#7c3aed", bg: "#f5f3ff", items: brief.awaitingMD },
              { key: "rmiOverdue", label: "RMI Overdue (3d+)",  color: "#92400e", bg: "#fffbeb", items: brief.rmiOverdue },
              { key: "unassigned", label: "Unassigned",          color: "#1d4ed8", bg: "#eff6ff", items: brief.unassigned },
            ].map((bucket, bi) => (
              <div key={bucket.key} style={{ borderRight: bi < 3 ? "1px solid #e2e8f0" : "none", padding: "14px 16px", background: (bucket.items||[]).length > 0 ? bucket.bg : "#fafafa" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: (bucket.items||[]).length > 0 ? bucket.color : "#9ca3af", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'Public Sans', sans-serif" }}>{bucket.label}</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: (bucket.items||[]).length > 0 ? bucket.color : "#9ca3af", fontFamily: "'Fraunces', Georgia, serif" }}>{(bucket.items||[]).length}</span>
                </div>
                {(bucket.items||[]).slice(0, 3).map((c, ci) => (
                  <div key={ci} style={{ fontSize: 11, color: "#374151", fontFamily: "'Public Sans', sans-serif", padding: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    · {c.member_name || c.submission_id?.slice(0,10) || "—"}
                  </div>
                ))}
                {(bucket.items||[]).length > 3 && (
                  <button onClick={() => onNavigate && onNavigate("queue")} style={{ marginTop: 4, fontSize: 10, color: bucket.color, background: "none", border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif", padding: 0, fontWeight: 600 }}>
                    +{(bucket.items||[]).length - 3} more → View All Cases
                  </button>
                )}
                {(bucket.items||[]).length === 0 && <div style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic", fontFamily: "'Public Sans', sans-serif" }}>All clear</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Period selector + top stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
        {PERIODS.map(p => {
          const val = parseInt(totals[p.key] || 0);
          const active = period === p.key;
          return (
            <button key={p.key} onClick={() => setPeriod(p.key)} style={{
              background: active ? "#1a3a5c" : "#fff",
              border: active ? "2px solid #1a3a5c" : "1px solid #e2e8f0",
              borderRadius: 12, padding: "18px 16px", cursor: "pointer", textAlign: "left",
              boxShadow: active ? "0 4px 16px rgba(26,58,92,0.18)" : "0 1px 4px rgba(0,0,0,0.06)",
              transition: "all 0.14s",
            }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: active ? "#fff" : "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1 }}>{val}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: active ? "rgba(255,255,255,0.75)" : "#6b7280", marginTop: 6, fontFamily: "'Public Sans', sans-serif" }}>Cases — {p.label}</div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* Determination breakdown */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "20px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 16, fontFamily: "'Fraunces', Georgia, serif" }}>
            Team Breakdown — {PERIODS.find(p => p.key === period)?.label}
          </div>
          {detRows.length === 0 ? (
            <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif" }}>No cases for this period.</div>
          ) : detRows.map(r => {
            const pct = totalForPeriod > 0 ? Math.round(r.count / totalForPeriod * 100) : 0;
            return (
              <div key={r.det} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", fontFamily: "'Public Sans', sans-serif" }}>{r.det}</span>
                  <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{r.count} ({pct}%)</span>
                </div>
                <div style={{ background: "#f1f5f9", borderRadius: 4, height: 8, overflow: "hidden" }}>
                  <div style={{ width: pct + "%", height: "100%", background: r.color, borderRadius: 4, transition: "width 0.4s ease" }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Queue health + auto-approval */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: "18px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", marginBottom: 14, fontFamily: "'Fraunces', Georgia, serif" }}>Queue Health</div>
            {queue.length === 0 ? (
              <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "'Public Sans', sans-serif" }}>Queue is clear.</div>
            ) : queue.map(q => {
              const slaRisk = parseInt(q.sla_at_risk || 0);
              const breached = parseInt(q.sla_breached || 0);
              return (
                <div key={q.discipline} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: "#eff6ff", color: discColor(q.discipline), minWidth: 28, textAlign: "center", fontFamily: "'DM Sans', sans-serif" }}>{q.discipline}</span>
                  <div style={{ flex: 1, background: "#f1f5f9", borderRadius: 4, height: 8, overflow: "hidden" }}>
                    <div style={{ width: "100%", height: "100%", background: breached > 0 ? "#dc2626" : slaRisk > 0 ? "#f59e0b" : "#1a3a5c", borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#374151", minWidth: 24, textAlign: "right", fontFamily: "'Fraunces', Georgia, serif" }}>{q.pending}</span>
                  {(slaRisk > 0 || breached > 0) && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: breached > 0 ? "#dc2626" : "#f59e0b", fontFamily: "'DM Sans', sans-serif" }}>
                      {breached > 0 ? `${breached} breached` : `${slaRisk} at risk`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ background: "#fff", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif", marginBottom: 6 }}>Auto-Approval Rate (All Time)</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: "#15803d", fontFamily: "'Fraunces', Georgia, serif" }}>{autoApprPct}%</span>
              <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "'Public Sans', sans-serif" }}>{totals.auto_approved_all || 0} of {totals.all_time || 0} cases</span>
            </div>
            <div style={{ marginTop: 6, background: "#f1f5f9", borderRadius: 4, height: 6, overflow: "hidden" }}>
              <div style={{ width: autoApprPct + "%", height: "100%", background: "#15803d", borderRadius: 4 }} />
            </div>
          </div>
        </div>
      </div>

      {/* SLA Compliance Panel */}
      {tatStats && (
        <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", overflow: "hidden", marginBottom: 20 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>SLA Compliance</span>
            {tatStats.summary.breached > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5" }}>
                {tatStats.summary.breached} BREACHED
              </span>
            )}
          </div>
          <div style={{ padding: "16px 20px" }}>
            {/* Summary row */}
            <div style={{ display: "flex", gap: 14, marginBottom: tatStats.atRiskCases.length > 0 ? 16 : 0 }}>
              {[
                { label: "Compliance Rate",  value: tatStats.summary.complianceRate + "%",  color: tatStats.summary.complianceRate >= 90 ? "#15803d" : tatStats.summary.complianceRate >= 75 ? "#d97706" : "#dc2626" },
                { label: "On Track",         value: tatStats.summary.onTrack,                color: "#15803d" },
                { label: "At Risk",          value: tatStats.summary.atRisk,                 color: "#d97706" },
                { label: "Breached",         value: tatStats.summary.breached,               color: tatStats.summary.breached > 0 ? "#dc2626" : "#9ca3af" },
                { label: "Avg Elapsed (h)",  value: tatStats.summary.avgElapsedHours,        color: "#374151" },
              ].map(s => (
                <div key={s.label} style={{ flex: 1, background: "#f8fafc", borderRadius: 8, padding: "12px 14px", border: "1px solid #f1f5f9", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4, fontFamily: "'DM Sans', sans-serif" }}>{s.label}</div>
                </div>
              ))}
            </div>
            {/* Compliance bar */}
            <div style={{ background: "#f1f5f9", borderRadius: 4, height: 6, overflow: "hidden", marginBottom: tatStats.atRiskCases.length > 0 ? 16 : 0 }}>
              <div style={{ width: tatStats.summary.complianceRate + "%", height: "100%", background: tatStats.summary.complianceRate >= 90 ? "#22c55e" : tatStats.summary.complianceRate >= 75 ? "#f59e0b" : "#ef4444", borderRadius: 4, transition: "width 0.6s" }} />
            </div>
            {/* At-risk cases list */}
            {tatStats.atRiskCases.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontFamily: "'DM Sans', sans-serif" }}>Cases Needing Attention</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {tatStats.atRiskCases.slice(0, 5).map(c => (
                    <div key={c.submissionId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 6, background: c.tatStatus === "breached" ? "#fef2f2" : "#fffbeb", border: `1px solid ${c.tatStatus === "breached" ? "#fca5a5" : "#fcd34d"}` }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: c.tatStatus === "breached" ? "#dc2626" : "#d97706", minWidth: 60 }}>{c.tatStatus === "breached" ? "BREACHED" : `${c.hoursLeft.toFixed(0)}h left`}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#374151", fontFamily: "'Public Sans', sans-serif", flex: 1 }}>{c.memberName}</span>
                      <span style={{ fontSize: 10, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{c.submissionId}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#eff6ff", color: "#1a3a5c" }}>{c.discipline}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: c.priority === "urgent" ? "#fef2f2" : "#f8fafc", color: c.priority === "urgent" ? "#dc2626" : "#9ca3af" }}>{c.priority.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Per-reviewer performance table */}
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", fontSize: 13, fontWeight: 700, color: "#1a3a5c", fontFamily: "'Fraunces', Georgia, serif" }}>
          Reviewer Performance
        </div>
        {revs.length === 0 ? (
          <div style={{ padding: "24px 20px", color: "#9ca3af", fontSize: 13, textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>No reviewer activity yet.</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px 70px 80px 90px 80px 80px 80px", gap: 0, padding: "8px 20px", background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
              {["Reviewer","Disc.","Active","Today","Week","Month","All Time","Approved","Denied"].map(h => (
                <span key={h} style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Sans', sans-serif" }}>{h}</span>
              ))}
            </div>
            {revs.map((r, i) => {
              const allTime = parseInt(r.all_time || 0);
              const approved = parseInt(r.approved || 0);
              const denied = parseInt(r.denied || 0);
              const active = parseInt(r.active_cases || 0);
              const approvePct = allTime > 0 ? Math.round(approved / allTime * 100) : 0;
              return (
                <div key={r.email} style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px 70px 80px 90px 80px 80px 80px", gap: 0, padding: "12px 20px", borderBottom: i < revs.length - 1 ? "1px solid #f1f5f9" : "none", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", fontFamily: "'Public Sans', sans-serif" }}>{r.full_name || "—"}</div>
                    <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "'DM Sans', sans-serif" }}>{r.email}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 5, background: "#eff6ff", color: discColor(r.discipline), fontFamily: "'DM Sans', sans-serif", width: "fit-content" }}>{r.discipline}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: active > 5 ? "#dc2626" : active > 2 ? "#92400e" : "#15803d", fontFamily: "'Fraunces', Georgia, serif" }}>{active}</span>
                  {[r.today, r.this_week, r.this_month, r.all_time].map((v, j) => (
                    <span key={j} style={{ fontSize: 13, fontWeight: j === 3 ? 700 : 400, color: j === 3 ? "#1a3a5c" : "#374151", fontFamily: j === 3 ? "'Fraunces', Georgia, serif" : "'Public Sans', sans-serif" }}>{parseInt(v || 0)}</span>
                  ))}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#15803d", fontFamily: "'DM Sans', sans-serif" }}>{approved} ({approvePct}%)</div>
                    <div style={{ background: "#f1f5f9", borderRadius: 3, height: 4, marginTop: 2, overflow: "hidden" }}>
                      <div style={{ width: approvePct + "%", height: "100%", background: "#15803d", borderRadius: 3 }} />
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: denied > 0 ? "#991b1b" : "#9ca3af", fontWeight: denied > 0 ? 600 : 400, fontFamily: "'DM Sans', sans-serif" }}>{denied}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function AssignCaseModal({ submissionId, token, onClose, onAssigned }) {
  const [reviewers, setReviewers] = useState([]);
  const [selected, setSelected]   = useState("");
  const [saving,   setSaving]     = useState(false);
  const [error,    setError]      = useState("");

  useEffect(() => {
    axios.get(`${API_BASE}/v1/reviewers`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setReviewers(r.data.reviewers || []))
      .catch(() => setError("Failed to load reviewers."));
  }, [token]); // eslint-disable-line

  const handleAssign = async () => {
    if (!selected) { setError("Select a reviewer."); return; }
    setSaving(true); setError("");
    try {
      await axios.patch(`${API_BASE}/v1/submissions/${submissionId}/assign`, { reviewerId: parseInt(selected, 10) }, { headers: { Authorization: `Bearer ${token}` } });
      onAssigned();
    } catch (err) {
      setError(err.response?.data?.error || "Assignment failed.");
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9000 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", width: 420, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#0d1b2a", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>Assign Case</div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20, fontFamily: "'Public Sans', sans-serif" }}>{submissionId}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'Public Sans', sans-serif" }}>Assign to Reviewer</div>
        <select value={selected} onChange={e => setSelected(e.target.value)} style={{ width: "100%", padding: "9px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 13, fontFamily: "'Public Sans', sans-serif", marginBottom: 16, boxSizing: "border-box", outline: "none" }}>
          <option value="">— Select reviewer —</option>
          {reviewers.map(r => (
            <option key={r.id} value={r.id}>
              {r.full_name || r.email} · {r.discipline || "PT"} · {r.active_cases} active
            </option>
          ))}
        </select>
        {error && <div style={{ marginBottom: 12, fontSize: 12, color: "#dc2626", fontFamily: "'Public Sans', sans-serif" }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleAssign} disabled={saving} style={{ flex: 1, padding: "10px 0", borderRadius: 8, background: saving ? "#94a3b8" : "#0d1b2a", color: "#fff", fontWeight: 700, fontSize: 13, border: "none", cursor: saving ? "not-allowed" : "pointer", fontFamily: "'Public Sans', sans-serif" }}>
            {saving ? "Assigning..." : "Assign"}
          </button>
          <button onClick={onClose} style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#374151", fontSize: 13, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const CASE_PAGE_SIZE = 50;

function MasterQueueView({ token, onReviewCase }) {
  const [submissions, setSubmissions] = useState([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(0); // 0-indexed
  const [loading, setLoading]         = useState(true);
  const [statusFilter, setStatusFilter]     = useState("all");
  const [discFilter, setDiscFilter]         = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [assignTarget, setAssignTarget]     = useState(null);
  const [deleteTarget, setDeleteTarget]     = useState(null);

  // "View all cases" fix — GET /v1/submissions previously had a hard, invisible
  // 50-row cap with no way to see anything past it (older completed cases
  // included). Now paginated: `total` (under the current filters) drives the
  // Prev/Next controls below the table instead of silently truncating.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter   !== "all") params.set("status", statusFilter);
      if (discFilter     !== "all") params.set("discipline", discFilter);
      params.set("limit",  String(CASE_PAGE_SIZE));
      params.set("offset", String(page * CASE_PAGE_SIZE));
      const r = await axios.get(`${API_BASE}/v1/submissions?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      setSubmissions(r.data.submissions || []);
      setTotal(r.data.total ?? (r.data.submissions || []).length);
    } catch {}
    setLoading(false);
  }, [token, statusFilter, discFilter, page]);

  useEffect(() => { load(); }, [load]);

  // Filter changes always jump back to page 0 -- old cases matching a fresh
  // filter shouldn't stay hidden behind a stale page number.
  useEffect(() => { setPage(0); }, [statusFilter, discFilter]);

  const statusBadge = (s) => {
    if (s === "approved")       return { bg: "#dcfce7", text: "#15803d" };
    if (s === "denied")         return { bg: "#fee2e2", text: "#991b1b" };
    if (s === "under_review")   return { bg: "#fef3c7", text: "#92400e" };
    if (s === "pending_review") return { bg: "#eff6ff", text: "#1d4ed8" };
    return { bg: "#f3f4f6", text: "#374151" };
  };

  const selS = { padding: "7px 12px", borderRadius: 7, border: "1px solid #d1d5db", fontSize: 12, fontFamily: "'DM Sans', sans-serif", outline: "none", background: "#fff", cursor: "pointer" };

  // Client-side priority filter + sort breached → at_risk → on_track
  const visible = submissions
    .filter(s => priorityFilter === "all" || (s.review_priority || "standard") === priorityFilter)
    .map(s => ({ ...s, _tat: computeTat(s) }))
    .sort((a, b) => {
      const rank = { breached: 0, at_risk: 1, on_track: 2 };
      return (rank[a._tat?.status] ?? 2) - (rank[b._tat?.status] ?? 2);
    });

  return (
    <div style={{ maxWidth: 1100, margin: "28px auto", padding: "0 24px" }}>
      {assignTarget && (
        <AssignCaseModal
          submissionId={assignTarget.submission_id}
          token={token}
          onClose={() => setAssignTarget(null)}
          onAssigned={() => { setAssignTarget(null); load(); }}
        />
      )}
      {deleteTarget && (
        <DeleteCaseModal
          submission={deleteTarget}
          token={token}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); load(); }}
        />
      )}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selS}>
          <option value="all">All Statuses</option>
          <option value="submitted">Submitted</option>
          <option value="pending_review">Pending Review</option>
          <option value="under_review">Under Review</option>
          <option value="on_hold">On Hold</option>
          <option value="pending_md_review">Pending MD Review</option>
          <option value="info_requested">Info Requested</option>
          <option value="rmi_pending">RMI Pending</option>
          <option value="rmi_requested">RMI Requested</option>
          <option value="rmi_responded">RMI Responded</option>
          <option value="approved">Approved</option>
          <option value="partial_denial">Partial Denial</option>
          <option value="denied">Denied</option>
        </select>
        <select value={discFilter} onChange={e => setDiscFilter(e.target.value)} style={selS}>
          <option value="all">All Disciplines</option>
          <option value="PT">PT</option>
          <option value="OT">OT</option>
          <option value="ST">ST</option>
        </select>
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} style={selS}>
          <option value="all">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="expedited">Expedited</option>
          <option value="standard">Standard</option>
        </select>
        <button onClick={load} style={{ padding: "7px 16px", borderRadius: 7, background: "#1a3a5c", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>Refresh</button>
        <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 4, fontFamily: "'DM Sans', sans-serif" }}>
          {total > 0 ? `${page * CASE_PAGE_SIZE + 1}–${Math.min((page + 1) * CASE_PAGE_SIZE, total)} of ${total}` : "0 cases"}
        </span>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 55px 120px 80px 110px 90px 130px", gap: 0, padding: "8px 20px", background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
          {["Member","Case ID","Disc.","Status","Visits","TAT / SLA","Submitted","Actions"].map(h => (
            <span key={h} style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Sans', sans-serif" }}>{h}</span>
          ))}
        </div>
        {loading ? (
          <div style={{ padding: "24px 20px", color: "#9ca3af", fontSize: 13, textAlign: "center" }}>Loading...</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: "24px 20px", color: "#9ca3af", fontSize: 13, textAlign: "center", fontFamily: "'Public Sans', sans-serif" }}>No submissions match the current filters.</div>
        ) : visible.map((s, i) => {
          const sb    = statusBadge(s.status);
          const discC = s.discipline === "OT" ? "#c2410c" : s.discipline === "ST" ? "#15803d" : "#1a3a5c";
          const tat   = s._tat;
          const rowBg = tat?.status === "breached" ? "#fffafa" : tat?.status === "at_risk" ? "#fffef5" : "#fff";
          const reviewable = ["submitted","pending_review","under_review","on_hold","rmi_pending"].includes(s.status);
          return (
            <div key={s.submission_id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 55px 120px 80px 110px 90px 130px", gap: 0, padding: "10px 20px", borderBottom: i < visible.length - 1 ? "1px solid #f1f5f9" : "none", alignItems: "center", background: rowBg }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", fontFamily: "'Public Sans', sans-serif" }}>{s.member_name || "—"}</span>
                  {(s.review_priority === "urgent" || s.review_priority === "expedited") && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 10, background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5" }}>⚡ {(s.review_priority || "").toUpperCase()}</span>
                  )}
                  {s.review_type === "concurrent" && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 10, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>CONC.</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "'DM Sans', sans-serif" }}>{s.member_id || "—"}</div>
              </div>
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "#374151" }}>{s.submission_id?.substring(0, 10) || "—"}</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: "#eff6ff", color: discC, fontFamily: "'DM Sans', sans-serif", width: "fit-content" }}>{s.discipline || "—"}</span>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: sb.bg, color: sb.text, textTransform: "capitalize", fontFamily: "'DM Sans', sans-serif", width: "fit-content" }}>{(s.status || "—").replace(/_/g," ")}</span>
              <span style={{ fontSize: 12, color: "#374151", fontFamily: "'Public Sans', sans-serif" }}>{s.requested_visits || "—"}</span>
              <TatBadge sub={s} />
              <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>{s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : "—"}</span>
              <div style={{ display: "flex", gap: 5 }}>
                {reviewable && onReviewCase && (
                  <button onClick={() => { const sm = s.extracted_metrics || {}; const diags = s.diagnosis_codes||[]; onReviewCase({
                    caseId: s.submission_id, submissionId: s.submission_id, memberName: s.member_name || "Unknown",
                    memberId: s.member_id || "—", dob: s.dob || "—",
                    discipline: s.discipline || "PT", reviewType: s.review_type || "initial",
                    submittedAt: s.submitted_at, documents: s.document_list || [],
                    requestedVisits: s.requested_visits || null,
                    // Same fix as handleGetCase/handleOpenSearchCase in ReviewerShell: the raw
                    // Claude extraction (sm) must not overwrite the already-merged, persisted
                    // requestedVisits when spread in below.
                    metrics: { diagnosisCodes: diags, requestedVisits: s.requested_visits||0, therapyType: s.discipline||"PT", functionalLimitations:[], sopIndicators:[], documentationQuality:{}, ...sm, diagnosisCodes: sm.diagnosisCodes?.length ? sm.diagnosisCodes : diags, primaryDiagnosisCode: sm.primaryDiagnosisCode || diags[0] || null, requestedVisits: s.requested_visits || 0 },
                    planRuleSet: s.plan_id ? { planId: s.plan_id } : null,
                  }); }} style={{ padding: "4px 9px", borderRadius: 5, background: "#0d1b2a", color: "#fff", fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
                    Review
                  </button>
                )}
                <button onClick={() => setAssignTarget(s)} style={{ padding: "4px 9px", borderRadius: 5, background: "#fff", color: "#374151", fontSize: 10, fontWeight: 600, border: "1px solid #e2e8f0", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
                  Assign
                </button>
                <button onClick={() => setDeleteTarget(s)} style={{ padding: "4px 9px", borderRadius: 5, background: "#fff", color: "#dc2626", fontSize: 10, fontWeight: 600, border: "1px solid #fca5a5", cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination — replaces the old hard 50-row cap with real paging so
          older completed cases are actually reachable, not silently hidden. */}
      {total > CASE_PAGE_SIZE && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 16 }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", color: page === 0 ? "#cbd5e1" : "#374151", fontSize: 12, fontWeight: 600, cursor: page === 0 ? "not-allowed" : "pointer", fontFamily: "'Public Sans', sans-serif" }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "'DM Sans', sans-serif" }}>
            Page {page + 1} of {Math.max(1, Math.ceil(total / CASE_PAGE_SIZE))}
          </span>
          <button
            onClick={() => setPage(p => ((p + 1) * CASE_PAGE_SIZE < total ? p + 1 : p))}
            disabled={(page + 1) * CASE_PAGE_SIZE >= total}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", color: (page + 1) * CASE_PAGE_SIZE >= total ? "#cbd5e1" : "#374151", fontSize: 12, fontWeight: 600, cursor: (page + 1) * CASE_PAGE_SIZE >= total ? "not-allowed" : "pointer", fontFamily: "'Public Sans', sans-serif" }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ── DeleteCaseModal: master-only, permanent hard delete of a case ───────────
// Requires typing DELETE to confirm, given how irreversible this is (removes
// the submission row, its Supabase Storage documents, and related
// notifications/p2p_requests/appeals rows -- see DELETE /v1/submissions/:id
// in index.js for exactly what it does and does NOT touch, i.e. audit_events).
function DeleteCaseModal({ submission, token, onClose, onDeleted }) {
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting]       = useState(false);
  const [error, setError]             = useState("");

  const canDelete = confirmText.trim().toUpperCase() === "DELETE";

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true); setError("");
    try {
      await axios.delete(`${API_BASE}/v1/submissions/${submission.submission_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      onDeleted();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to delete case.");
      setDeleting(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", width: 440, boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#991b1b", marginBottom: 8, fontFamily: "'Fraunces', Georgia, serif" }}>
          Permanently Delete Case
        </div>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 4, fontFamily: "'Public Sans', sans-serif" }}>
          <strong>{submission.member_name || "Unknown Member"}</strong> · {submission.submission_id?.substring(0, 12)}…
        </div>
        <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 16, lineHeight: 1.5, fontFamily: "'Public Sans', sans-serif" }}>
          This permanently removes the case, its uploaded documents, and related
          appeals/P2P/notification records. This cannot be undone. Audit log
          entries for this case are retained for compliance and are not affected.
        </div>
        <label style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6, fontFamily: "'DM Sans', sans-serif" }}>
          Type DELETE to confirm
        </label>
        <input
          autoFocus
          value={confirmText}
          onChange={e => setConfirmText(e.target.value)}
          placeholder="DELETE"
          style={{ width: "100%", padding: "9px 12px", borderRadius: 7, border: "1.5px solid #fca5a5", fontSize: 13, fontFamily: "'DM Sans', sans-serif", outline: "none", boxSizing: "border-box", marginBottom: 12 }}
        />
        {error && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleDelete}
            disabled={!canDelete || deleting}
            style={{
              flex: 1, padding: "10px 0", borderRadius: 7, border: "none",
              background: !canDelete || deleting ? "#fca5a5" : "#dc2626", color: "#fff",
              fontSize: 13, fontWeight: 700, cursor: !canDelete || deleting ? "not-allowed" : "pointer",
              fontFamily: "'Public Sans', sans-serif",
            }}
          >
            {deleting ? "Deleting…" : "Delete Permanently"}
          </button>
          <button
            onClick={onClose}
            disabled={deleting}
            style={{ padding: "10px 20px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", color: "#374151", fontSize: 13, cursor: "pointer", fontFamily: "'Public Sans', sans-serif" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MasterAppealsView: master sees all appeals + can assign reviewers ────────
function MasterAppealsView({ token }) {
  const [appeals, setAppeals]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [reviewers, setReviewers]     = useState([]);
  const [selected, setSelected]       = useState(null);
  const [assignTo, setAssignTo]       = useState("");
  const [assigning, setAssigning]     = useState(false);
  const [toast, setToast]             = useState(null);

  const fetchAppeals = () => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/appeals`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setAppeals(r.data.appeals || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchAppeals();
    axios.get(`${API_BASE}/v1/reviewers`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setReviewers(r.data.reviewers || []))
      .catch(() => {});
  }, [token]); // eslint-disable-line

  const handleAssign = async () => {
    if (!selected || !assignTo) return;
    setAssigning(true);
    try {
      await axios.post(`${API_BASE}/v1/appeals/${selected.appeal_id}/assign`, { reviewerId: assignTo }, { headers: { Authorization: `Bearer ${token}` } });
      setToast("Reviewer assigned and notified.");
      setSelected(null); setAssignTo("");
      fetchAppeals();
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setToast(err.response?.data?.error || "Failed to assign.");
      setTimeout(() => setToast(null), 5000);
    } finally {
      setAssigning(false);
    }
  };

  const levelColor = (l) => l === 1 ? "#1d4ed8" : l === 2 ? "#7c3aed" : "#dc2626";
  const statusColor = (s) => {
    const map = { filed: "#d97706", under_review: "#2563eb", decided: "#16a34a", withdrawn: "#94a3b8" };
    return map[s] || "#94a3b8";
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: 960, margin: "0 auto" }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, background: "#0d1b2a", color: "#fff", borderRadius: 8, padding: "12px 20px", fontSize: 13, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>{toast}</div>}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#0d1b2a", fontFamily: "'Fraunces', Georgia, serif" }}>Appeals Management</div>
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>All active and decided appeals across all levels</div>
      </div>
      {loading ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading appeals…</div> : appeals.length === 0 ? (
        <div style={{ background: "#fff", borderRadius: 12, padding: "40px 24px", textAlign: "center", border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>No appeals filed yet</div>
          <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>Appeal filings from providers will appear here.</div>
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {["Member", "Discipline", "Level", "Status", "Grounds", "Deadline", "Decision", "Action"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {appeals.map((a, i) => {
                const deadline = a.deadline_at ? new Date(a.deadline_at) : null;
                const daysLeft = deadline ? Math.ceil((deadline - Date.now()) / 86400000) : null;
                return (
                  <tr key={a.appeal_id} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "12px 16px", fontWeight: 600, color: "#1e293b" }}>{a.member_name || "—"}</td>
                    <td style={{ padding: "12px 16px", color: "#6b7280" }}>{a.discipline || "—"}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: "#eff6ff", color: levelColor(a.level) }}>L{a.level}</span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor(a.status) }}>{a.status?.replace("_"," ").toUpperCase()}</span>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#374151", maxWidth: 200 }}>{a.grounds?.slice(0, 40)}{a.grounds?.length > 40 ? "…" : ""}</td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: daysLeft !== null && daysLeft <= 5 ? "#dc2626" : "#64748b", fontWeight: daysLeft !== null && daysLeft <= 5 ? 700 : 400 }}>
                      {daysLeft !== null ? (daysLeft > 0 ? `${daysLeft}d` : "PAST") : "—"}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: a.decision === "overturned" ? "#16a34a" : a.decision === "upheld" ? "#dc2626" : "#64748b" }}>
                      {a.decision?.toUpperCase() || "—"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      {a.status === "filed" && a.level === 1 && (
                        <button onClick={() => setSelected(a)} style={{ padding: "5px 12px", borderRadius: 6, background: "#1a3a5c", color: "#fff", border: "none", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Assign</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 8000 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 440, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0d1b2a", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>Assign Appeal Reviewer</div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>{selected.member_name} · Level {selected.level}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 8 }}>Select Reviewer</div>
            <select value={assignTo} onChange={e => setAssignTo(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, marginBottom: 20, boxSizing: "border-box", outline: "none", cursor: "pointer" }}>
              <option value="">— Select a reviewer —</option>
              {reviewers.map(r => (
                <option key={r.id} value={r.id}>
                  {r.full_name || r.email} · {r.discipline || "PT"} · {r.active_cases} active
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => { setSelected(null); setAssignTo(""); }} style={{ padding: "9px 18px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleAssign} disabled={!assignTo || assigning} style={{ padding: "9px 18px", borderRadius: 7, background: "#1a3a5c", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: !assignTo || assigning ? "not-allowed" : "pointer", opacity: !assignTo || assigning ? 0.6 : 1 }}>
                {assigning ? "Assigning…" : "Assign Reviewer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AdminConsole: master manages plans + white-label config ──────────────────
function AdminConsole({ token }) {
  const [plans, setPlans]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);  // null | plan object | "new"
  const [form, setForm]       = useState({});
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState(null);

  const fetchPlans = () => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/admin/plans`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setPlans(r.data.plans || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchPlans(); }, [token]); // eslint-disable-line

  const openEdit = (plan) => {
    setEditing(plan);
    setForm({
      planName:            plan.plan_name || "",
      autoApproveThreshold: plan.auto_approve_threshold || 18,
      brandColor:          plan.brand_color || "#1a3a5c",
      logoUrl:             plan.logo_url || "",
      contactEmail:        plan.contact_email || "",
    });
  };

  const openNew = () => {
    setEditing("new");
    setForm({ planId: "", planName: "", autoApproveThreshold: 18, brandColor: "#1a3a5c", logoUrl: "", contactEmail: "" });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing === "new") {
        await axios.post(`${API_BASE}/v1/admin/plans`, {
          planId: form.planId, planName: form.planName,
          autoApproveThreshold: parseInt(form.autoApproveThreshold, 10),
          brandColor: form.brandColor, logoUrl: form.logoUrl, contactEmail: form.contactEmail,
        }, { headers: { Authorization: `Bearer ${token}` } });
      } else {
        await axios.patch(`${API_BASE}/v1/admin/plans/${editing.plan_id}`, {
          planName: form.planName,
          autoApproveThreshold: parseInt(form.autoApproveThreshold, 10),
          brandColor: form.brandColor, logoUrl: form.logoUrl, contactEmail: form.contactEmail,
        }, { headers: { Authorization: `Bearer ${token}` } });
      }
      setToast(editing === "new" ? "Plan created." : "Plan updated.");
      setEditing(null);
      fetchPlans();
      setTimeout(() => setToast(null), 3500);
    } catch (err) {
      setToast(err.response?.data?.error || "Save failed.");
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div style={{ padding: "24px 28px", maxWidth: 900, margin: "0 auto" }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, background: "#0d1b2a", color: "#fff", borderRadius: 8, padding: "12px 20px", fontSize: 13, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>{toast}</div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0d1b2a", fontFamily: "'Fraunces', Georgia, serif" }}>Payer Plan Console</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Configure payer plans, branding, and review rules</div>
        </div>
        <button onClick={openNew} style={{ padding: "10px 20px", background: "#0d1b2a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ New Plan</button>
      </div>

      {loading ? <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading plans…</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {plans.map(plan => (
            <div key={plan.plan_id} style={{ background: "#fff", borderRadius: 12, border: "2px solid", borderColor: plan.brand_color || "#1a3a5c", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>
              <div style={{ background: plan.brand_color || "#1a3a5c", padding: "16px 20px" }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", fontFamily: "'Fraunces', Georgia, serif" }}>{plan.plan_name}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", marginTop: 2, fontFamily: "monospace" }}>{plan.plan_id}</div>
              </div>
              <div style={{ padding: "14px 20px" }}>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, color: "#374151" }}>Auto-approve threshold: </span>{plan.auto_approve_threshold || 18} visits
                </div>
                {plan.contact_email && <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}><span style={{ fontWeight: 600, color: "#374151" }}>Contact: </span>{plan.contact_email}</div>}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 4, background: plan.brand_color || "#1a3a5c", border: "1px solid rgba(0,0,0,0.1)" }} />
                  <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>{plan.brand_color || "#1a3a5c"}</span>
                </div>
                <button onClick={() => openEdit(plan)} style={{ marginTop: 14, width: "100%", padding: "8px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#374151" }}>Edit Plan Config</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 8000, padding: 20 }}>
          <div style={{ background: "#fff", borderRadius: 14, padding: 28, maxWidth: 480, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#0d1b2a", fontFamily: "'Fraunces', Georgia, serif", marginBottom: 20 }}>
              {editing === "new" ? "Create New Plan" : `Edit ${editing.plan_name}`}
            </div>
            {[
              editing === "new" && { key: "planId", label: "Plan ID *", placeholder: "e.g. UHC-GOLD", type: "text" },
              { key: "planName", label: "Plan Name *", placeholder: "e.g. United Health Gold", type: "text" },
              { key: "autoApproveThreshold", label: "Auto-Approve Threshold (visits)", placeholder: "18", type: "number" },
              { key: "brandColor", label: "Brand Color (hex)", placeholder: "#005a8b", type: "text" },
              { key: "logoUrl", label: "Logo URL (optional)", placeholder: "https://...", type: "text" },
              { key: "contactEmail", label: "Contact Email", placeholder: "ur@payer.com", type: "email" },
            ].filter(Boolean).map(field => (
              <div key={field.key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 5 }}>{field.label}</div>
                <input type={field.type} value={form[field.key] || ""} onChange={e => f(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
                {field.key === "brandColor" && form.brandColor && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 6, background: form.brandColor, border: "1px solid rgba(0,0,0,0.1)" }} />
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>Preview</span>
                  </div>
                )}
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setEditing(null)} style={{ padding: "10px 20px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleSave} disabled={saving}
                style={{ padding: "10px 20px", borderRadius: 8, background: "#0d1b2a", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving…" : editing === "new" ? "Create Plan" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ReportsView: master reporting & CSV export ───────────────────────────────
function TrendChart({ weeks }) {
  if (!weeks || weeks.length === 0) return null;
  const W = 600, H = 160, PAD = 32, BOTTOM = 28;
  const innerW = W - PAD * 2, innerH = H - BOTTOM;
  const maxVal = Math.max(1, ...weeks.map(w => Math.max(w.total, w.approved, w.denied, w.pended)));
  const pts = (key, color) => {
    const points = weeks.map((w, i) => {
      const x = PAD + (i / (weeks.length - 1 || 1)) * innerW;
      const y = innerH - (w[key] / maxVal) * (innerH - 12);
      return [x, y];
    });
    const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    return (
      <g key={key}>
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {points.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" fill={color} />)}
      </g>
    );
  };
  const series = [["total","#0d1b2a"],["approved","#16a34a"],["denied","#dc2626"],["pended","#d97706"]];
  const fmtWk = (s) => { const d = new Date(s); return `${d.getMonth()+1}/${d.getDate()}`; };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }}>
      {[0, 0.5, 1].map(t => {
        const y = innerH - t * (innerH - 12);
        return <line key={t} x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#e2e8f0" strokeWidth="1" />;
      })}
      {series.map(([k, c]) => pts(k, c))}
      {weeks.map((w, i) => {
        const x = PAD + (i / (weeks.length - 1 || 1)) * innerW;
        return <text key={i} x={x} y={H - 6} textAnchor="middle" fontSize="9" fill="#94a3b8">{fmtWk(w.week)}</text>;
      })}
      {series.map(([k, c], i) => (
        <g key={k} transform={`translate(${PAD + i * 90}, 8)`}>
          <circle cx="5" cy="5" r="4" fill={c} />
          <text x="13" y="9" fontSize="10" fill="#374151" fontFamily="DM Sans, sans-serif">{k.charAt(0).toUpperCase()+k.slice(1)}</text>
        </g>
      ))}
    </svg>
  );
}

function ReportsView({ token }) {
  const [reportType, setReportType] = useState("cases");
  const [startDate, setStartDate]   = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate]       = useState(() => new Date().toISOString().split("T")[0]);
  const [planFilter, setPlanFilter] = useState("");
  const [discFilter, setDiscFilter] = useState("");
  const [plans, setPlans]           = useState([]);
  const [rows, setRows]             = useState(null);
  const [summary, setSummary]       = useState(null);
  const [trends, setTrends]         = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  useEffect(() => {
    axios.get(`${API_BASE}/v1/plans`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => setPlans(r.data.plans || [])).catch(() => {});
  }, [token]); // eslint-disable-line

  const runReport = async () => {
    setLoading(true); setError(""); setRows(null); setSummary(null); setTrends(null);
    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (planFilter) params.set("planId", planFilter);
      if (discFilter) params.set("discipline", discFilter);

      if (reportType === "cases") {
        const r = await axios.get(`${API_BASE}/v1/reports/cases?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        setRows(r.data.rows);
      } else if (reportType === "summary") {
        const r = await axios.get(`${API_BASE}/v1/reports/summary?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        setSummary(r.data);
      } else if (reportType === "appeals") {
        const r = await axios.get(`${API_BASE}/v1/reports/appeals?${params}`, { headers: { Authorization: `Bearer ${token}` } });
        setRows(r.data.rows);
      } else if (reportType === "trends") {
        const r = await axios.get(`${API_BASE}/v1/reports/trends`, { headers: { Authorization: `Bearer ${token}` } });
        setTrends(r.data.weeks);
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to generate report.");
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csvLines = [
      headers.join(","),
      ...rows.map(row =>
        headers.map(h => {
          const v = row[h] == null ? "" : String(row[h]);
          return v.includes(",") || v.includes('"') || v.includes("\n")
            ? `"${v.replace(/"/g, '""')}"` : v;
        }).join(",")
      ),
    ];
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `cogentcr_${reportType}_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const REPORT_TYPES = [
    { key: "cases",   label: "Case Activity",      desc: "All submissions with determination, TAT, reviewer" },
    { key: "summary", label: "Summary Dashboard",  desc: "Aggregated rates by plan, discipline, SLA" },
    { key: "appeals", label: "Appeals Outcomes",   desc: "All appeals with level, decision, days-to-decision" },
    { key: "trends",  label: "12-Week Trends",     desc: "Weekly volume chart: total, approved, denied, pended" },
  ];

  const NAVY = "#0d1b2a";

  // Column display configs
  const CASE_COLS = [
    { key: "member_name",            label: "Member" },
    { key: "member_id",              label: "Member ID" },
    { key: "discipline",             label: "Disc." },
    { key: "plan_id",                label: "Plan" },
    { key: "status",                 label: "Status" },
    { key: "review_priority",        label: "Priority" },
    { key: "requested_visits",       label: "Req. Visits" },
    { key: "final_determination",    label: "Determination" },
    { key: "final_approved_visits",  label: "Approved" },
    { key: "tat_hours",              label: "TAT (h)" },
    { key: "had_rmi",                label: "RMI" },
    { key: "appeal_count",           label: "Appeals" },
    { key: "submitted_at",           label: "Submitted" },
    { key: "decided_at",             label: "Decided" },
    { key: "reviewer",               label: "Reviewer" },
  ];

  const APPEAL_COLS = [
    { key: "member_name",            label: "Member" },
    { key: "discipline",             label: "Disc." },
    { key: "plan_id",                label: "Plan" },
    { key: "level",                  label: "Level" },
    { key: "status",                 label: "Status" },
    { key: "grounds",                label: "Grounds" },
    { key: "original_determination", label: "Original Det." },
    { key: "decision",               label: "Decision" },
    { key: "new_determination",      label: "New Det." },
    { key: "days_to_decision",       label: "Days" },
    { key: "filed_at",               label: "Filed" },
    { key: "decided_at",             label: "Decided" },
  ];

  const cols = reportType === "appeals" ? APPEAL_COLS : CASE_COLS;
  const fmtDate = (v) => v ? new Date(v).toLocaleDateString() : "—";
  const fmtVal  = (key, v) => {
    if (v == null) return "—";
    if (key.endsWith("_at")) return fmtDate(v);
    if (typeof v === "boolean") return v ? "Yes" : "No";
    return String(v);
  };

  const detColor = (v) => {
    if (!v) return "#374151";
    if (/approv/i.test(v)) return "#15803d";
    if (/denial|denied/i.test(v)) return "#dc2626";
    if (/partial/i.test(v)) return "#d97706";
    return "#374151";
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, fontFamily: "'Fraunces', Georgia, serif" }}>Reports & Analytics Export</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Generate, preview, and export data for compliance, actuarial, and operations teams</div>
        </div>
        {rows && rows.length > 0 && (
          <button onClick={exportCsv} style={{ padding: "10px 22px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
            ↓ Export CSV ({rows.length} rows)
          </button>
        )}
      </div>

      {/* Report type selector */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        {REPORT_TYPES.map(rt => (
          <button key={rt.key} onClick={() => { setReportType(rt.key); setRows(null); setSummary(null); }}
            style={{ flex: 1, padding: "14px 16px", borderRadius: 10, border: `2px solid ${reportType === rt.key ? NAVY : "#e2e8f0"}`, background: reportType === rt.key ? NAVY : "#fff", color: reportType === rt.key ? "#fff" : "#374151", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>{rt.label}</div>
            <div style={{ fontSize: 11, opacity: 0.75 }}>{rt.desc}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: "18px 20px", marginBottom: 20, display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>Start Date</div>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13 }} />
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>End Date</div>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13 }} />
        </div>
        {reportType !== "appeals" && (
          <>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>Plan</div>
              <select value={planFilter} onChange={e => setPlanFilter(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13, minWidth: 140 }}>
                <option value="">All Plans</option>
                {plans.map(p => <option key={p.plan_id} value={p.plan_id}>{p.plan_name}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.5 }}>Discipline</div>
              <select value={discFilter} onChange={e => setDiscFilter(e.target.value)}
                style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: 13 }}>
                <option value="">All</option>
                <option>PT</option><option>OT</option><option>ST</option>
              </select>
            </div>
          </>
        )}
        <button onClick={runReport} disabled={loading}
          style={{ padding: "9px 24px", background: NAVY, color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
          {loading ? "Running…" : "Run Report"}
        </button>
      </div>

      {error && <div style={{ padding: "12px 16px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, fontSize: 13, color: "#dc2626", marginBottom: 16 }}>{error}</div>}

      {/* Summary report */}
      {summary && (
        <div>
          {/* Totals row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Total Cases",      value: summary.totals?.total_cases   || 0, color: NAVY },
              { label: "Approved",         value: summary.totals?.approved       || 0, color: "#15803d" },
              { label: "Denied",           value: summary.totals?.denied         || 0, color: "#dc2626" },
              { label: "Avg TAT (hours)",  value: summary.totals?.avg_tat_hours  || "—", color: "#d97706" },
              { label: "Appeals Filed",    value: summary.totals?.total_appeals  || 0, color: "#7c3aed" },
              { label: "Appeals Overturned", value: summary.totals?.appeals_overturned || 0, color: "#0891b2" },
            ].map(card => (
              <div key={card.label} style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "16px 18px", textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: card.color, fontFamily: "'Fraunces', Georgia, serif" }}>{card.value}</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{card.label}</div>
              </div>
            ))}
          </div>

          {/* By Plan */}
          {summary.byPlan?.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", marginBottom: 16, overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", fontSize: 13, fontWeight: 700, color: NAVY }}>By Payer Plan</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc" }}>
                  {["Plan","Total","Approved","Partial Denial","Full Denial","Pended","Avg TAT (h)"].map(h => (
                    <th key={h} style={{ padding: "9px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {summary.byPlan.map((r, i) => (
                    <tr key={r.plan_id} style={{ borderTop: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "10px 16px", fontWeight: 600, color: NAVY }}>{r.plan_id}</td>
                      <td style={{ padding: "10px 16px" }}>{r.total}</td>
                      <td style={{ padding: "10px 16px", color: "#15803d", fontWeight: 600 }}>{r.approved}</td>
                      <td style={{ padding: "10px 16px", color: "#d97706" }}>{r.partial_denial}</td>
                      <td style={{ padding: "10px 16px", color: "#dc2626" }}>{r.full_denial}</td>
                      <td style={{ padding: "10px 16px", color: "#6b7280" }}>{r.pended}</td>
                      <td style={{ padding: "10px 16px" }}>{r.avg_tat_hours ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* By Discipline */}
          {summary.byDisc?.length > 0 && (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", fontSize: 13, fontWeight: 700, color: NAVY }}>By Discipline</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc" }}>
                  {["Discipline","Total","Approved","Approval Rate"].map(h => (
                    <th key={h} style={{ padding: "9px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {summary.byDisc.map((r, i) => (
                    <tr key={r.discipline} style={{ borderTop: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "10px 16px", fontWeight: 700, color: NAVY }}>{r.discipline}</td>
                      <td style={{ padding: "10px 16px" }}>{r.total}</td>
                      <td style={{ padding: "10px 16px", color: "#15803d", fontWeight: 600 }}>{r.approved}</td>
                      <td style={{ padding: "10px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: "#e2e8f0", borderRadius: 3, maxWidth: 80 }}>
                            <div style={{ height: "100%", width: `${r.approval_rate_pct || 0}%`, background: "#15803d", borderRadius: 3 }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#15803d" }}>{r.approval_rate_pct ?? "—"}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Trends chart */}
      {trends && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: "20px 24px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, fontFamily: "'Fraunces', Georgia, serif", marginBottom: 16 }}>Weekly Case Volume — Last 12 Weeks</div>
          <TrendChart weeks={trends} />
          {trends.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 24 }}>No data yet — submit cases to populate trends.</div>}
        </div>
      )}

      {/* Row data table (cases / appeals) */}
      {rows && (
        <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{rows.length} records</span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Preview shows all rows — Export CSV for full data</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  {cols.map(c => (
                    <th key={c.key} style={{ padding: "9px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                    {cols.map(c => (
                      <td key={c.key} style={{ padding: "9px 14px", whiteSpace: "nowrap", color: c.key === "final_determination" || c.key === "decision" ? detColor(row[c.key]) : "#374151", fontWeight: c.key === "final_determination" || c.key === "decision" ? 600 : 400 }}>
                        {fmtVal(c.key, row[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 100 && (
              <div style={{ padding: "12px 16px", textAlign: "center", fontSize: 12, color: "#94a3b8", borderTop: "1px solid #f1f5f9" }}>
                Showing first 100 of {rows.length} rows — export CSV for all data
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MasterShell({ user, token, onLogout }) {
  const [masterView, setMasterView] = useState("dashboard");
  const [cockpitCase, setCockpitCase] = useState(null); // set from case rows to open cockpit

  // Cockpit overlay — opened on-demand from a specific case, not a nav tab
  if (masterView === "cockpit" && cockpitCase) {
    return (
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <div style={{ background: "#0d1b2a", padding: "8px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif" }}>CogentCR</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>|</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.8)", fontFamily: "'Public Sans', sans-serif" }}>Case Review — {cockpitCase.memberName}</span>
          <div style={{ flex: 1 }} />
          <NotificationBell token={token} />
          <button onClick={() => { setMasterView("queue"); setCockpitCase(null); }} style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>← Back to All Cases</button>
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <Cockpit user={user} liveCase={cockpitCase} hideQueueNav={true} onCaseDone={() => { setMasterView("queue"); setCockpitCase(null); }} onBack={() => { setMasterView("queue"); setCockpitCase(null); }} />
        </div>
      </div>
    );
  }

  const TABS = [
    ["dashboard",    "Dashboard"],
    ["queue",        "All Cases"],
    ["appeals",      "Appeals"],
    ["reports",      "Reports"],
    ["users",        "Users"],
    ["admin",        "Plans"],
    ["providers",    "Providers"],
    ["bulk_import",  "Bulk Import"],
    ["integrations", "Integrations"],
    ["audit",        "Audit"],
    ["ur_form",      "UR Form"],
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Public Sans', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#0d1b2a", padding: "14px 28px", display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", fontFamily: "'Fraunces', Georgia, serif", letterSpacing: "-0.02em" }}>CogentCR</span>
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>|</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 10, background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.9)", fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.05em" }}>MASTER</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", fontFamily: "'Public Sans', sans-serif" }}>{user.name || user.email}</span>
        <NotificationBell token={token} />
        <button onClick={onLogout}
  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.2)"; }}
  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
  style={{ fontSize: 11, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 6, padding: "4px 12px", cursor: "pointer", transition: "background 0.1s" }}>Logout</button>
      </div>

      {/* Tab bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 28px", display: "flex", gap: 0, overflowX: "auto" }}>
        {TABS.map(([v, label]) => (
          <button key={v} onClick={() => setMasterView(v)} style={{
            padding: "12px 18px", fontSize: 13, fontWeight: masterView === v ? 700 : 500,
            color: masterView === v ? "#0d1b2a" : "#6b7280", background: "none", border: "none",
            borderBottom: masterView === v ? "2.5px solid #0d1b2a" : "2.5px solid transparent",
            cursor: "pointer", fontFamily: "'Public Sans', sans-serif", transition: "all 0.12s", whiteSpace: "nowrap",
          }}>{label}</button>
        ))}
      </div>

      {/* Content */}
      {masterView === "dashboard"    && <MasterDashboard token={token} onReviewCase={(c) => { setCockpitCase(c); setMasterView("cockpit"); }} onNavigate={setMasterView} />}
      {masterView === "queue"        && <MasterQueueView token={token} onReviewCase={(c) => { setCockpitCase(c); setMasterView("cockpit"); }} />}
      {masterView === "ur_form"      && <div style={{ background: "#f8fafc" }}><URFormEmbed user={user} token={token} /></div>}
      {masterView === "appeals"      && <MasterAppealsView token={token} />}
      {masterView === "reports"      && <ReportsView token={token} />}
      {masterView === "admin"        && <AdminConsole token={token} />}
      {masterView === "criteria"     && <CriteriaLibraryView token={token} />}
      {masterView === "providers"    && <ProviderDirectoryView token={token} />}
      {masterView === "state_rules"  && <StateRulesView token={token} />}
      {masterView === "integrations" && <IntegrationsView token={token} />}
      {masterView === "bulk_import"  && <BulkImportView token={token} />}
      {masterView === "users"        && <UserManagementView token={token} />}
      {masterView === "audit"        && <AuditExportView token={token} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDICAL DIRECTOR SHELL
// ─────────────────────────────────────────────────────────────────────────────
// MD-specific L2 appeals component
function MDAppealsView({ token }) {
  const [appeals, setAppeals]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [decision, setDecision] = useState("");
  const [decNotes, setDecNotes] = useState("");
  const [newDet, setNewDet]     = useState("Approved");
  const [newVisits, setNewVisits] = useState("");
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState(null);

  const fetchAppeals = () => {
    setLoading(true);
    axios.get(`${API_BASE}/v1/appeals`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { setAppeals(r.data.appeals || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchAppeals(); }, [token]); // eslint-disable-line

  const handleDecide = async () => {
    if (!selected || !decision) return;
    setSaving(true);
    try {
      await axios.post(`${API_BASE}/v1/appeals/${selected.appeal_id}/decide`, {
        decision, decisionNotes: decNotes,
        newDetermination:  decision !== "upheld" ? newDet   : undefined,
        newApprovedVisits: decision !== "upheld" ? (parseInt(newVisits, 10) || undefined) : undefined,
      }, { headers: { Authorization: `Bearer ${token}` } });
      setToast("L2 appeal decision recorded. Provider notified.");
      setSelected(null); setDecision(""); setDecNotes(""); setNewVisits("");
      fetchAppeals();
      setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setToast(err.response?.data?.error || "Failed.");
      setTimeout(() => setToast(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const NAVY = "#1a2e4a";
  return (
    <div style={{ display: "flex", height: "calc(100vh - 110px)" }}>
      {toast && <div style={{ position: "fixed", top: 16, right: 16, background: NAVY, color: "#fff", borderRadius: 8, padding: "12px 20px", fontSize: 13, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>{toast}</div>}
      <div style={{ width: 300, borderRight: "1px solid #e2e8f0", overflowY: "auto", background: "#fff" }}>
        <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, fontFamily: "'Fraunces', serif" }}>Level 2 Appeals</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Requires MD decision</div>
        </div>
        {loading ? <div style={{ padding: 24, color: "#94a3b8", fontSize: 13 }}>Loading…</div>
        : appeals.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center" }}>
            <div style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>No L2 appeals pending</div>
          </div>
        ) : appeals.map((a, i) => {
          const isSel = selected?.appeal_id === a.appeal_id;
          return (
            <div key={a.appeal_id} onClick={() => { setSelected(a); setDecision(""); setDecNotes(""); setNewVisits(""); }}
              style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: isSel ? "#f5f0ff" : i % 2 === 0 ? "#fff" : "#fafafa", borderLeft: isSel ? "3px solid #7c3aed" : "3px solid transparent" }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "#1e293b" }}>{a.member_name}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{a.discipline} · Level {a.level}</div>
              <div style={{ fontSize: 11, color: "#7c3aed", fontWeight: 600, marginTop: 3 }}>Original: {a.original_determination}</div>
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 28, background: "#faf8f3" }}>
        {!selected ? (
          <div style={{ maxWidth: 400, margin: "80px auto", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚖️</div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 700, color: NAVY }}>Level 2 Appeal Review</div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 8 }}>Level 1 uphold decisions escalated here for MD co-signature.</div>
          </div>
        ) : (
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24, marginBottom: 20 }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 700, color: NAVY }}>{selected.member_name}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>{selected.discipline} · Level {selected.level} Appeal</div>
              <div style={{ background: "#f5f0ff", borderRadius: 8, padding: 14, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6d28d9", textTransform: "uppercase", marginBottom: 5 }}>Provider Grounds</div>
                <div style={{ fontSize: 13, color: "#4c1d95" }}>{selected.grounds}</div>
                {selected.supporting_notes && <div style={{ fontSize: 12, color: "#5b21b6", marginTop: 6 }}>{selected.supporting_notes}</div>}
              </div>
              <div style={{ background: "#fff7ed", borderRadius: 8, padding: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#9a3412", textTransform: "uppercase", marginBottom: 4 }}>Original Determination</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#c2410c" }}>{selected.original_determination}</div>
              </div>
            </div>
            {selected.status === "decided" ? (
              <div style={{ background: "#f0fdf4", borderRadius: 12, border: "1px solid #86efac", padding: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#15803d" }}>Decision: {selected.decision?.toUpperCase()}</div>
                {selected.decision_notes && <div style={{ fontSize: 13, color: "#166534", marginTop: 6 }}>{selected.decision_notes}</div>}
              </div>
            ) : (
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 14 }}>MD Decision</div>
                <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                  {[
                    { key: "upheld",     label: "Uphold",   color: "#dc2626" },
                    { key: "overturned", label: "Overturn", color: "#16a34a" },
                    { key: "modified",   label: "Modify",   color: "#d97706" },
                  ].map(opt => (
                    <button key={opt.key} onClick={() => setDecision(opt.key)}
                      style={{ flex: 1, padding: "11px 8px", borderRadius: 8, border: `2px solid ${decision === opt.key ? opt.color : "#e2e8f0"}`, background: decision === opt.key ? opt.color : "#fff", color: decision === opt.key ? "#fff" : "#374151", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {decision !== "upheld" && decision && (
                  <div style={{ background: "#f0fdf4", borderRadius: 8, padding: 12, marginBottom: 14 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {["Approved", "Partial Denial", "Pend"].map(d => (
                        <button key={d} onClick={() => setNewDet(d)}
                          style={{ padding: "5px 12px", borderRadius: 6, border: `1.5px solid ${newDet === d ? "#16a34a" : "#e2e8f0"}`, background: newDet === d ? "#dcfce7" : "#fff", fontSize: 12, cursor: "pointer", fontWeight: newDet === d ? 700 : 400 }}>
                          {d}
                        </button>
                      ))}
                    </div>
                    <input type="number" value={newVisits} onChange={e => setNewVisits(e.target.value)} placeholder="Approved visits" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #86efac", fontSize: 13, width: 160 }} />
                  </div>
                )}
                {decision && (
                  <>
                    <textarea value={decNotes} onChange={e => setDecNotes(e.target.value)} rows={3}
                      placeholder="MD rationale for the record…"
                      style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", marginBottom: 14 }} />
                    <button onClick={handleDecide} disabled={saving}
                      style={{ background: NAVY, color: "#fff", border: "none", borderRadius: 8, padding: "11px 28px", fontSize: 14, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
                      {saving ? "Recording…" : "Record L2 Decision"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MDShell({ user, token, onLogout }) {
  const [mdTab, setMdTab]     = useState("md_queue"); // "md_queue" | "l2_appeals"
  const [queue, setQueue]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [action, setAction]   = useState(null); // "uphold"|"override"|"revision"
  const [mdNotes, setMdNotes] = useState("");
  const [overrideDet, setOverrideDet] = useState("Approved");
  const [overrideVisits, setOverrideVisits] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]     = useState(null);

  const NAVY  = "#1a2e4a";
  const CREAM = "#faf8f3";

  const fetchQueue = () => {
    setLoading(true);
    fetch(`${API_BASE}/v1/md-queue`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setQueue(d.cases || []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchQueue(); }, []); // eslint-disable-line

  const handleSubmit = () => {
    if (!selected || !action) return;
    if (action === "override" && !overrideDet) return;
    setSubmitting(true);
    fetch(`${API_BASE}/v1/md-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        submissionId:           selected.submission_id,
        action,
        mdNotes,
        overrideDetermination:  action === "override" ? overrideDet    : undefined,
        overrideApprovedVisits: action === "override" ? parseInt(overrideVisits, 10) || undefined : undefined,
      }),
    })
      .then(r => r.json())
      .then(d => {
        setSubmitting(false);
        if (d.ok) {
          setToast(`${action.charAt(0).toUpperCase() + action.slice(1)} recorded for ${selected.member_name}.`);
          setSelected(null);
          setAction(null);
          setMdNotes("");
          setOverrideVisits("");
          fetchQueue();
          setTimeout(() => setToast(null), 4000);
        } else {
          setToast("Error: " + (d.error || "Unknown error"));
          setTimeout(() => setToast(null), 5000);
        }
      })
      .catch(() => { setSubmitting(false); setToast("Network error."); setTimeout(() => setToast(null), 5000); });
  };

  const tatColor = (s) => s === "breached" ? "#fca5a5" : s === "at_risk" ? "#fcd34d" : "#86efac";
  const tatText  = (s) => s === "breached" ? "#7f1d1d" : s === "at_risk" ? "#78350f" : "#14532d";

  return (
    <div style={{ minHeight: "100vh", background: CREAM, fontFamily: "'Public Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ background: NAVY, color: "#fff", padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 700 }}>CogentCR</span>
          <span style={{ fontSize: 11, fontWeight: 700, background: "#7c3aed", color: "#fff", borderRadius: 4, padding: "2px 8px", letterSpacing: 1 }}>MEDICAL DIRECTOR</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 13, opacity: 0.75 }}>{user.full_name || user.email}</span>
          <button onClick={onLogout} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12 }}>Sign Out</button>
        </div>
      </div>

      {/* MD Tab bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 28px", display: "flex", gap: 0 }}>
        {[["md_queue","Co-Sign Queue"], ["l2_appeals","L2 Appeals"]].map(([v, label]) => (
          <button key={v} onClick={() => setMdTab(v)} style={{
            padding: "11px 20px", fontSize: 13, fontWeight: mdTab === v ? 700 : 500,
            color: mdTab === v ? NAVY : "#6b7280", background: "none", border: "none",
            borderBottom: mdTab === v ? `2.5px solid ${NAVY}` : "2.5px solid transparent",
            cursor: "pointer", fontFamily: "'Public Sans', sans-serif", transition: "all 0.12s",
          }}>{label}</button>
        ))}
      </div>

      {toast && (
        <div style={{ position: "fixed", top: 16, right: 16, background: NAVY, color: "#fff", borderRadius: 8, padding: "12px 20px", fontSize: 13, zIndex: 9999, boxShadow: "0 4px 16px rgba(0,0,0,0.3)" }}>{toast}</div>
      )}

      {mdTab === "l2_appeals" && <MDAppealsView token={token} />}
      {mdTab === "md_queue" && <div style={{ display: "flex", height: "calc(100vh - 110px)" }}>
        {/* Queue Panel */}
        <div style={{ width: 340, borderRight: "1px solid #e2e8f0", overflowY: "auto", background: "#fff" }}>
          <div style={{ padding: "16px 20px 10px", borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 700, color: NAVY }}>MD Review Queue</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{queue.length} case{queue.length !== 1 ? "s" : ""} pending co-sign</div>
          </div>
          {loading ? (
            <div style={{ padding: 24, color: "#94a3b8", fontSize: 13 }}>Loading queue...</div>
          ) : queue.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
              <div style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>Queue cleared</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>No cases pending MD review</div>
            </div>
          ) : queue.map((c, i) => {
            const tat = c.tat || {};
            const isSel = selected?.submission_id === c.submission_id;
            return (
              <div key={c.submission_id} onClick={() => { setSelected(c); setAction(null); setMdNotes(""); setOverrideVisits(""); }}
                style={{ padding: "14px 20px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: isSel ? "#eff6ff" : i % 2 === 0 ? "#fff" : "#fafafa", borderLeft: isSel ? "3px solid #3b82f6" : "3px solid transparent" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: NAVY }}>{c.member_name || "Unknown Patient"}</div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: tatColor(tat.status), color: tatText(tat.status) }}>
                    {tat.status === "breached" ? "⚠ SLA" : `${tat.hoursLeft?.toFixed(0)}h left`}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{c.discipline} · {c.plan_id}</div>
                <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 700, marginTop: 4 }}>
                  Reviewer: {c.reviewer_determination}
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{c.reviewer_name || "Reviewer"}</div>
              </div>
            );
          })}
        </div>

        {/* Review Panel */}
        <div style={{ flex: 1, overflowY: "auto", padding: 32 }}>
          {!selected ? (
            <div style={{ maxWidth: 480, margin: "80px auto", textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>⚕</div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 700, color: NAVY, marginBottom: 8 }}>Medical Director Review</div>
              <div style={{ fontSize: 14, color: "#64748b" }}>Select a case from the queue to begin co-signature review. All adverse determinations require MD sign-off before the provider is notified.</div>
            </div>
          ) : (
            <div style={{ maxWidth: 720, margin: "0 auto" }}>
              {/* Case Header */}
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24, marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 700, color: NAVY }}>{selected.member_name}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>ID: {selected.member_id} · DOB: {selected.dob || "N/A"} · {selected.discipline} · {selected.plan_id}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>Case ID</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, fontFamily: "monospace" }}>{selected.submission_id?.slice(0, 12)}...</div>
                  </div>
                </div>
                {/* Reviewer Finding */}
                <div style={{ background: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa", padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#9a3412", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.8 }}>Reviewer Finding</div>
                  <div style={{ display: "flex", gap: 24 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#92400e" }}>Determination</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#c2410c" }}>{selected.reviewer_determination}</div>
                    </div>
                    {selected.reviewer_approved_visits != null && (
                      <div>
                        <div style={{ fontSize: 11, color: "#92400e" }}>Approved Visits</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "#c2410c" }}>{selected.reviewer_approved_visits}</div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 11, color: "#92400e" }}>Engine Recommendation</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#92400e" }}>{selected.engine_determination || "N/A"} ({selected.engine_confidence || "—"})</div>
                    </div>
                  </div>
                  {selected.reviewer_notes && (
                    <div style={{ marginTop: 12, fontSize: 12, color: "#7c2d12" }}>
                      <span style={{ fontWeight: 700 }}>Reviewer rationale: </span>{selected.reviewer_notes}
                    </div>
                  )}
                </div>
              </div>

              {/* MD Action Panel */}
              <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e2e8f0", padding: 24 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 700, color: NAVY, marginBottom: 16 }}>MD Co-Signature Action</div>

                {/* Action Selector */}
                <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                  {[
                    { key: "uphold",   label: "Uphold",          desc: "Agree with reviewer",     color: "#dc2626" },
                    { key: "override", label: "Override",         desc: "Change determination",    color: "#d97706" },
                    { key: "revision", label: "Request Revision", desc: "Return to reviewer",      color: "#2563eb" },
                  ].map(opt => (
                    <button key={opt.key} onClick={() => { setAction(opt.key); setMdNotes(""); }}
                      style={{ flex: 1, padding: "12px 8px", borderRadius: 8, border: `2px solid ${action === opt.key ? opt.color : "#e2e8f0"}`, background: action === opt.key ? opt.color : "#fff", color: action === opt.key ? "#fff" : "#374151", cursor: "pointer", textAlign: "center", transition: "all 0.15s" }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{opt.label}</div>
                      <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>{opt.desc}</div>
                    </button>
                  ))}
                </div>

                {action === "override" && (
                  <div style={{ background: "#fff7ed", borderRadius: 8, border: "1px solid #fed7aa", padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", marginBottom: 10 }}>Override Determination</div>
                    <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                      {["Approved", "Partial Denial", "Full Denial", "Pend"].map(det => (
                        <button key={det} onClick={() => setOverrideDet(det)}
                          style={{ padding: "6px 12px", borderRadius: 6, border: `1.5px solid ${overrideDet === det ? "#d97706" : "#e2e8f0"}`, background: overrideDet === det ? "#fef3c7" : "#fff", fontSize: 12, cursor: "pointer", fontWeight: overrideDet === det ? 700 : 400 }}>
                          {det}
                        </button>
                      ))}
                    </div>
                    <label style={{ fontSize: 12, color: "#7c2d12" }}>Approved visits (if applicable)
                      <input type="number" min={0} value={overrideVisits} onChange={e => setOverrideVisits(e.target.value)}
                        placeholder="e.g. 12" style={{ display: "block", marginTop: 4, width: 120, padding: "6px 10px", borderRadius: 6, border: "1px solid #fed7aa", fontSize: 13 }} />
                    </label>
                  </div>
                )}

                {action && (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>MD Notes {action === "revision" ? "(required — explain what needs revision)" : "(optional — will appear in audit trail)"}</div>
                      <textarea value={mdNotes} onChange={e => setMdNotes(e.target.value)} rows={4}
                        placeholder={action === "revision" ? "Describe what the reviewer should reconsider or document..." : "Clinical rationale or co-signature notes..."}
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
                    </div>
                    <button onClick={handleSubmit} disabled={submitting || (action === "revision" && !mdNotes.trim())}
                      style={{ background: action === "revision" ? "#2563eb" : action === "override" ? "#d97706" : "#dc2626", color: "#fff", border: "none", borderRadius: 8, padding: "12px 28px", fontSize: 14, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1 }}>
                      {submitting ? "Recording..." : action === "uphold" ? "Co-Sign & Uphold" : action === "override" ? "Co-Sign & Override" : "Send Back for Revision"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}

// --- App --------------------------------------------------------------------
// ─────────────────────────────────────────────────────────────────────────────
// AI-ONLY DEMO — the two-call, no-rules-engine feasibility experiment.
//
// This REPLACES the legacy single-page UR form that used to live in App(). It
// is not a second route alongside it: opening the demo URL gets you this. The
// form posts to POST /v1/aionly/evaluate (extraction → shape validation →
// determination AND note in one model call), never to /api/generate-review,
// and nothing on this page touches the deterministic rules engine.
//
// The shell, header and auth are deliberately unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const AIO_C = {
  ink: "#0f172a", primary: "#1a3a5c", muted: "#64748b", faint: "#94a3b8",
  line: "#e2e8f0", wash: "#f8fafc", white: "#fff",
  amber: "#b45309", amberBg: "#fffbeb", amberLine: "#fcd34d",
  green: "#15803d", greenBg: "#f0fdf4", greenLine: "#86efac",
  red: "#991b1b", redBg: "#fef2f2", redLine: "#fca5a5",
  claim: "#7c3aed", claimBg: "#faf5ff", claimLine: "#ddd6fe",
};

const AIO_SOURCE_LABEL = {
  manual:     "entered",
  extracted:  "document",
  prior_note: "prior note",
  defaulted:  "default",
  absent:     "absent",
};
const AIO_SOURCE_TITLE = {
  manual:     "Entered manually on the form — this value wins over anything extracted.",
  extracted:  "Read out of the submitted documentation by the extraction call.",
  prior_note: "Parsed from the pasted prior determination and confirmed by the reviewer.",
  defaulted:  "No source supplied this; the pipeline applied a default.",
  absent:     "Not documented and not supplied.",
};

/** Small muted marker showing where a displayed value came from. */
function ProvTag({ source }) {
  if (!source) return null;
  const isManual = source === "manual" || source === "prior_note";
  const isGone   = source === "absent" || source === "defaulted";
  return (
    <span
      title={AIO_SOURCE_TITLE[source] || source}
      style={{
        marginLeft: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em",
        textTransform: "uppercase", padding: "1px 5px", borderRadius: 4,
        border: `1px solid ${isManual ? AIO_C.greenLine : isGone ? AIO_C.line : AIO_C.line}`,
        background: isManual ? AIO_C.greenBg : isGone ? AIO_C.wash : AIO_C.wash,
        color: isManual ? AIO_C.green : isGone ? AIO_C.faint : AIO_C.muted,
        fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap",
      }}
    >
      {AIO_SOURCE_LABEL[source] || source}
    </span>
  );
}

/** One label/value row with its provenance marker. */
function EvRow({ label, value, source, absentText }) {
  const gone = source === "absent" || value == null || value === "" ||
               (Array.isArray(value) && value.length === 0);
  return (
    <div style={{ display: "flex", gap: 10, padding: "5px 0", borderBottom: `1px solid ${AIO_C.wash}`, alignItems: "baseline" }}>
      <div style={{ flex: "0 0 148px", fontSize: 11, color: AIO_C.muted, fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, color: gone ? AIO_C.faint : AIO_C.ink, fontStyle: gone ? "italic" : "normal", lineHeight: 1.5 }}>
        {gone ? (absentText || "Not documented") : value}
        <ProvTag source={source} />
      </div>
    </div>
  );
}

function AioSection({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: AIO_C.muted, textTransform: "uppercase",
        letterSpacing: "0.08em", fontFamily: "'DM Sans', sans-serif",
        paddingBottom: 5, marginBottom: 4, borderBottom: `1px solid ${AIO_C.line}`,
      }}>{title}</div>
      {children}
    </div>
  );
}

function Collapsible({ title, children, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={{ marginTop: 12, border: `1px solid ${AIO_C.line}`, borderRadius: 8, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", textAlign: "left", padding: "8px 12px", background: AIO_C.wash,
          border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, color: AIO_C.muted,
          textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {open ? "▾" : "▸"} {title}
      </button>
      {open && (
        <pre style={{
          margin: 0, padding: 12, maxHeight: 340, overflow: "auto", background: AIO_C.white,
          fontSize: 11, lineHeight: 1.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: AIO_C.ink, whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>{children}</pre>
      )}
    </div>
  );
}

/** Render a ROM/MMT comparison map as "current (baseline)" pairs. */
function formatComparison(cmp, unit) {
  if (!cmp || !cmp.current || Object.keys(cmp.current).length === 0) return null;
  return Object.entries(cmp.current).map(([k, cur]) => {
    const prior = cmp.prior ? cmp.prior[k] : undefined;
    const u = unit || "";
    return `${k} ${cur}${u}${prior != null ? ` (${prior}${u})` : ""}`;
  }).join(", ");
}
function formatMap(map, unit) {
  if (!map || Object.keys(map).length === 0) return null;
  return Object.entries(map).map(([k, v]) => {
    const numeric = typeof v === "number" || /^-?\d+(\.\d+)?$/.test(String(v).trim());
    return `${k} ${v}${numeric ? (unit || "") : ""}`;
  }).join(", ");
}

/* ── LEFT PANEL — EXTRACTION ───────────────────────────────────────────────── */

function ExtractionPanel({ result }) {
  const r    = result.resolved   || {};
  const p    = result.provenance || {};
  const isSUB = result.reviewType === "subsequent";
  const romText = (isSUB && formatComparison(r.romComparison, "°")) || formatMap(r.rom, "°");
  const mmtText = (isSUB && formatComparison(r.mmtComparison, "")) || formatMap(r.mmt, "");
  const outText = (() => {
    const oc = r.outcomeComparison;
    if (isSUB && oc && oc.current) return `${oc.current}${oc.prior ? ` (${oc.prior})` : ""}`;
    return r.functionalOutcomeScore;
  })();

  return (
    <div>
      {/* Discrepancies, prominently — a reviewer should see these, not hunt for them. */}
      {result.discrepancies && result.discrepancies.length > 0 && (
        <div style={{
          marginBottom: 16, padding: "12px 14px", background: AIO_C.amberBg,
          border: `1px solid ${AIO_C.amberLine}`, borderRadius: 8,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800, color: AIO_C.amber, textTransform: "uppercase",
            letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif", marginBottom: 6,
          }}>
            {result.discrepancies.length} source disagreement{result.discrepancies.length === 1 ? "" : "s"}
          </div>
          {result.discrepancies.map((d, i) => (
            <div key={i} style={{ fontSize: 12.5, color: "#78350f", lineHeight: 1.55, marginTop: i ? 6 : 0 }}>
              <strong>{d.field}</strong> — using <strong>{String(d.used)}</strong> ({AIO_SOURCE_LABEL[d.usedSource] || d.usedSource}).
              {" "}Documentation states <strong>{String(d.alsoFound)}</strong>.
              <div style={{ fontSize: 11.5, color: AIO_C.amber, marginTop: 2 }}>{d.note}</div>
            </div>
          ))}
        </div>
      )}

      {!result.extraction.ran && (
        <div style={{
          marginBottom: 16, padding: "10px 14px", background: AIO_C.wash,
          border: `1px dashed ${AIO_C.line}`, borderRadius: 8, fontSize: 12.5, color: AIO_C.muted,
        }}>
          Extraction did not run — {result.extraction.skipReason} The case proceeded on manually
          entered fields alone.
        </div>
      )}

      {result.extraction.pastedTextRendered && (
        <div style={{ marginBottom: 12, fontSize: 11.5, color: AIO_C.muted }}>
          Pasted clinical text was rendered to a document and read by the same extraction call the
          PDF path uses.
        </div>
      )}

      <AioSection title="Case">
        <EvRow label="Review type"       value={r.reviewType}       source={p.reviewType} />
        <EvRow label="Requested visits"  value={r.requestedVisits}  source={p.requestedVisits} />
        <EvRow label="Requested freq/wk" value={r.requestedFrequency} source={p.requestedFrequency} absentText="Not stated on the form or in the plan of care" />
        <EvRow label="Visits to date"    value={r.visitsToDate}     source={p.visitsToDate} />
        <EvRow label="Diagnosis"         value={r.diagnosisCode ? `${r.diagnosisCode}${r.primaryDiagnosis ? ` — ${r.primaryDiagnosis}` : ""}` : null} source={p.diagnosisCode} absentText="No diagnosis code found or entered" />
        <EvRow label="Discipline"        value={r.therapyType}      source={p.therapyType} />
        <EvRow label="Document"          value={r.documentType && r.dateOfService ? `${r.documentType} ${r.dateOfService}` : (r.documentType || r.dateOfService)} source={p.documentType} />
        {isSUB && <EvRow label="IE date" value={r.evaluationDate}   source={p.evaluationDate} />}
      </AioSection>

      <AioSection title={isSUB ? "Objective measures — current (baseline)" : "Objective measures"}>
        <EvRow label="Pain" value={isSUB && r.painPrior ? `${r.painCurrent} (${r.painPrior})` : r.painCurrent}
               source={p.painCurrent} absentText="No pain rating documented in this note" />
        <EvRow label="Range of motion" value={romText} source={p.rom}
               absentText="No range of motion documented in this note" />
        <EvRow label="Strength (MMT)" value={mmtText} source={p.mmt}
               absentText="No strength grades documented in this note" />
        <EvRow label="Outcome score" value={outText} source={p.functionalOutcomeScore}
               absentText="No standardized outcome measure documented in this note" />
        <EvRow label="Special tests" value={r.specialTests ? r.specialTests.join(", ") : null} source={p.specialTests}
               absentText="No special tests documented in this note" />
      </AioSection>

      <AioSection title="Function and plan">
        <EvRow label="Functional limits" value={r.functionalLimitations ? r.functionalLimitations.join("; ") : null}
               source={p.functionalLimitations} absentText="No functional limitations documented in this note" />
        <EvRow label="Goals"
               value={r.goalsTotal != null ? `${r.goalsMet != null ? r.goalsMet : "?"}/${r.goalsTotal} met` : null}
               source={p.goalsTotal} absentText="No goals documented in this note" />
        <EvRow label="Skilled care" value={r.sopIndicators ? r.sopIndicators.join("; ") : null}
               source={p.sopIndicators} absentText="No skilled interventions documented in this note" />
        <EvRow label="HEP status" value={r.hepStatus} source={p.hepStatus}
               absentText="Home exercise program not mentioned" />
        <EvRow label="Plan of care" value={r.poc} source={p.poc}
               absentText="No plan of care statement found in this note" />
      </AioSection>

      {isSUB && Array.isArray(r.goalStatuses) && r.goalStatuses.length > 0 && (
        <AioSection title="Goal status">
          {r.goalStatuses.map((g, i) => (
            <div key={i} style={{ fontSize: 12.5, padding: "4px 0", borderBottom: `1px solid ${AIO_C.wash}`, lineHeight: 1.5 }}>
              <span style={{ color: AIO_C.ink }}>{g.goal}</span>
              <span style={{
                marginLeft: 8, fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                color: g.status === "met" ? AIO_C.green : g.status === "not addressed" ? AIO_C.faint : AIO_C.amber,
              }}>{g.status}</span>
            </div>
          ))}
        </AioSection>
      )}

      <Collapsible title="Raw extraction JSON">
        {result.extraction.raw ? JSON.stringify(result.extraction.raw, null, 2) : "Extraction did not run."}
      </Collapsible>
    </div>
  );
}

/* ── RIGHT PANEL — DETERMINATION AND NOTE ──────────────────────────────────── */

const DET_STYLE = {
  APPROVED:                  { c: AIO_C.green, bg: AIO_C.greenBg, b: AIO_C.greenLine, label: "Approved" },
  PARTIAL_DENIAL_TAPER:      { c: AIO_C.amber, bg: AIO_C.amberBg, b: AIO_C.amberLine, label: "Partial Denial — Taper" },
  PARTIAL_DENIAL_CUMULATIVE: { c: AIO_C.amber, bg: AIO_C.amberBg, b: AIO_C.amberLine, label: "Partial Denial — Cumulative Volume" },
  PARTIAL_DENIAL_FREQUENCY:  { c: AIO_C.amber, bg: AIO_C.amberBg, b: AIO_C.amberLine, label: "Partial Denial — Frequency" },
  PARTIAL_DENIAL_UNSKILLED:  { c: AIO_C.amber, bg: AIO_C.amberBg, b: AIO_C.amberLine, label: "Partial Denial — Unskilled" },
  FULL_DENIAL:               { c: AIO_C.red,   bg: AIO_C.redBg,   b: AIO_C.redLine,   label: "Full Denial" },
  PEND:                      { c: AIO_C.muted, bg: AIO_C.wash,    b: AIO_C.line,      label: "Pend" },
};

function NoteBox({ note }) {
  const [text, setText]     = useState(note || "");
  const [copied, setCopied] = useState(false);
  const ref = useRef(null);
  useEffect(() => { setText(note || ""); setCopied(false); }, [note]);
  // Size the box to the whole note so nothing has to be expanded or scrolled
  // to read it end to end. Re-measured on every edit.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.max(320, el.scrollHeight + 4) + "px";
  }, [text]);

  const copy = () => {
    // Edits affect the copy only — result.runs[n].note is never written back.
    const write = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error("clipboard unavailable"));
    write.then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })
         .catch(() => { setCopied(false); });
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: AIO_C.muted, textTransform: "uppercase",
          letterSpacing: "0.08em", fontFamily: "'DM Sans', sans-serif",
        }}>Composed note — editable, edits affect the copy only</div>
        <button
          type="button" onClick={copy}
          style={{
            padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer",
            background: copied ? AIO_C.green : AIO_C.primary, color: AIO_C.white,
            fontSize: 12, fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
            transition: "background 0.15s",
          }}
        >{copied ? "✓ Copied" : "Copy Note"}</button>
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        style={{
          width: "100%", minHeight: 320, boxSizing: "border-box",
          border: `1px solid ${AIO_C.line}`, borderRadius: 8, padding: "16px 18px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13.5, lineHeight: 1.7, color: AIO_C.ink, background: AIO_C.white,
          resize: "vertical", outline: "none", overflow: "hidden",
        }}
      />
    </div>
  );
}

function DeterminationPanel({ result, run }) {
  if (!run) return null;

  if (!run.ok) {
    return (
      <div style={{ padding: "14px 16px", background: AIO_C.redBg, border: `1px solid ${AIO_C.redLine}`, borderRadius: 8, fontSize: 13, color: AIO_C.red }}>
        {run.error}
      </div>
    );
  }

  const d = DET_STYLE[run.determination] || DET_STYLE.PEND;

  const chip = (label, value) => (
    <div style={{ minWidth: 82 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: AIO_C.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: AIO_C.ink, fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.2 }}>{value}</div>
    </div>
  );

  return (
    <div>
      {/* Basis strip */}
      <div style={{ background: d.bg, border: `1.5px solid ${d.b}`, borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: d.c, fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.15 }}>
          {d.label}
        </div>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginTop: 10 }}>
          {chip("Visits", run.approvedVisits)}
          {chip("Freq/wk", run.approvedFrequency || "—")}
          {chip("Weeks", run.approvedDurationWeeks || "—")}
        </div>
      </div>

      {/* MODEL-STATED BENCHMARKS — styled as a claim, not established fact.
          This is the block the reviewer checks hardest against their own
          knowledge, so benchmarkSource sits here in full, not collapsed. */}
      <div style={{
        marginBottom: 16, borderRadius: 9, overflow: "hidden",
        border: `1.5px dashed ${AIO_C.claimLine}`, background: AIO_C.claimBg,
      }}>
        <div style={{
          padding: "7px 12px", background: "#f3e8ff", fontSize: 10, fontWeight: 800,
          color: AIO_C.claim, textTransform: "uppercase", letterSpacing: "0.07em",
          fontFamily: "'DM Sans', sans-serif",
        }}>
          Benchmarks and guideline applied
        </div>
        <div style={{ padding: "10px 12px" }}>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 10 }}>
            {[["Typical visits", run.benchmarkTypicalVisits],
              ["Episode max", run.benchmarkMaxVisits],
              ["Max freq/wk", run.benchmarkMaxFrequency]].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: AIO_C.claim, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'DM Sans', sans-serif" }}>{k}</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#5b21b6", fontFamily: "'Fraunces', Georgia, serif", lineHeight: 1.2 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: AIO_C.claim, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "'DM Sans', sans-serif" }}>Guideline applied</div>
          <div style={{ fontSize: 12.5, color: "#4c1d95", lineHeight: 1.6, marginBottom: 8 }}>{run.guidelineApplied}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: AIO_C.claim, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "'DM Sans', sans-serif" }}>Source of the figures</div>
          <div style={{ fontSize: 12.5, color: "#4c1d95", lineHeight: 1.6 }}>{run.benchmarkSource}</div>
        </div>
      </div>

      <AioSection title="Rule applied">
        <div style={{ fontSize: 12.5, color: AIO_C.ink, lineHeight: 1.6 }}>{run.ruleApplied}</div>
      </AioSection>

      <AioSection title="Facts relied on">
        {Array.isArray(run.factsReliedOn) && run.factsReliedOn.length > 0 ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: AIO_C.ink, lineHeight: 1.7 }}>
            {run.factsReliedOn.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        ) : <div style={{ fontSize: 12.5, color: AIO_C.faint, fontStyle: "italic" }}>None stated.</div>}
      </AioSection>

      <AioSection title="Citation">
        <div style={{ fontSize: 12.5, color: AIO_C.ink, lineHeight: 1.6 }}>{run.citation}</div>
      </AioSection>

      {/* Prior plan assessment — given room, it is one of the more interesting
          things to read when a prior note was supplied. */}
      {result.resolved && result.resolved.priorRationale && (
        <div style={{
          marginBottom: 16, padding: "12px 14px", borderRadius: 9,
          background: "#eff6ff", border: "1px solid #bfdbfe",
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'DM Sans', sans-serif", marginBottom: 6 }}>
            Prior plan assessment
          </div>
          <div style={{ display: "flex", gap: 18, marginBottom: 8, fontSize: 12 }}>
            <span style={{ color: "#1e3a8a" }}>
              Prior plan referenced: <strong>{run.priorPlanReferenced ? "yes" : "no"}</strong>
            </span>
            <span style={{ color: "#1e3a8a" }}>
              Conditions met: <strong>{run.priorPlanConditionsMet ? "yes" : "no"}</strong>
            </span>
          </div>
          <div style={{ fontSize: 12.5, color: "#1e3a8a", lineHeight: 1.65 }}>
            {run.priorPlanAssessment || <span style={{ fontStyle: "italic", color: "#60a5fa" }}>No assessment returned.</span>}
          </div>
        </div>
      )}

      <Collapsible title="Raw determination JSON">
        {JSON.stringify(
          Object.fromEntries(Object.entries(run).filter(([k]) => k !== "guardrails" && k !== "telemetry")),
          null, 2
        )}
      </Collapsible>
    </div>
  );
}

/* ── TELEMETRY STRIP ───────────────────────────────────────────────────────── */

function TelemetryStrip({ telemetry, visitsToDateSource }) {
  if (!telemetry) return null;
  const calls = [telemetry.extraction, ...(telemetry.determinations || [])].filter(Boolean);
  const cell = (label, value) => (
    <span style={{ marginRight: 18, whiteSpace: "nowrap" }}>
      <span style={{ color: AIO_C.faint }}>{label} </span>
      <span style={{ color: AIO_C.muted, fontWeight: 600 }}>{value}</span>
    </span>
  );
  return (
    <div style={{
      marginTop: 18, padding: "10px 14px", background: AIO_C.wash,
      border: `1px solid ${AIO_C.line}`, borderRadius: 8,
      fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: 1.9,
    }}>
      {calls.map((c, i) => (
        <div key={i}>
          {cell("call", c.call)}
          {cell("model", c.model)}
          {c.effort && cell("effort", c.effort)}
          {cell("latency", `${(c.latencyMs / 1000).toFixed(1)}s`)}
          {cell("tokens", `${c.inputTokens != null ? c.inputTokens : "?"} in / ${c.outputTokens != null ? c.outputTokens : "?"} out`)}
          {cell("cost", c.estimatedCostUsd != null ? `$${c.estimatedCostUsd.toFixed(4)}` : "—")}
          {cell("stop", c.stopReason || "—")}
        </div>
      ))}
      <div style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${AIO_C.line}` }}>
        {cell("TOTAL", `${(telemetry.total.wallClockMs / 1000).toFixed(1)}s`)}
        {cell("tokens", `${telemetry.total.inputTokens} in / ${telemetry.total.outputTokens} out`)}
        {cell("cost", `$${telemetry.total.estimatedCostUsd.toFixed(4)}`)}
        {cell("visitsToDateSource", visitsToDateSource)}
      </div>
    </div>
  );
}

/* ── SESSION LOG ───────────────────────────────────────────────────────────── */

const LOG_COLUMNS = [
  { key: "timestamp",          label: "Time" },
  { key: "reviewType",         label: "Review" },
  { key: "diagnosisCode",      label: "Dx" },
  { key: "source",             label: "Source" },
  { key: "requestedVisits",    label: "Req" },
  { key: "visitsToDate",       label: "VTD" },
  { key: "visitsToDateSource", label: "VTD src" },
  { key: "determinations",     label: "Recommendation" },
  { key: "approvedVisits",     label: "Approved" },
  { key: "guardrailErrors",    label: "Guardrails" },
  { key: "costUsd",            label: "Cost $" },
  { key: "latencySec",         label: "Latency s" },
];

function toCsv(rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = LOG_COLUMNS.map((c) => esc(c.label)).join(",");
  const body = rows.map((r) => LOG_COLUMNS.map((c) => esc(r[c.key])).join(","));
  return [head, ...body].join("\n");
}

function SessionLog({ rows, onClear }) {
  if (!rows || rows.length === 0) return null;

  const download = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const now  = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    a.href = url;
    a.download = `aionly_session_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const totalCost = rows.reduce((s, r) => s + (parseFloat(r.costUsd) || 0), 0);

  return (
    <div style={{
      background: "#fff", border: `1px solid ${AIO_C.line}`, borderRadius: 12,
      marginTop: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.07)", overflow: "hidden",
    }}>
      <div style={{
        padding: "12px 18px", background: AIO_C.wash, borderBottom: `1px solid ${AIO_C.line}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
      }}>
        <div>
          <span style={{
            fontSize: 11, fontWeight: 700, color: AIO_C.muted, textTransform: "uppercase",
            letterSpacing: "0.08em", fontFamily: "'DM Sans', sans-serif",
          }}>Session log</span>
          <span style={{ marginLeft: 10, fontSize: 11.5, color: AIO_C.faint }}>
            {rows.length} case{rows.length === 1 ? "" : "s"} · ${totalCost.toFixed(4)} total ·
            in memory only, lost on reload
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={download} style={{
            padding: "7px 15px", borderRadius: 7, border: "none", background: AIO_C.primary,
            color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
            fontFamily: "'DM Sans', sans-serif",
          }}>Export CSV</button>
          <button type="button" onClick={onClear} style={{
            padding: "7px 15px", borderRadius: 7, border: `1px solid ${AIO_C.line}`,
            background: "#fff", color: AIO_C.muted, fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
          }}>Clear</button>
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr>
              {LOG_COLUMNS.map((c) => (
                <th key={c.key} style={{
                  textAlign: "left", padding: "7px 11px", borderBottom: `1px solid ${AIO_C.line}`,
                  fontSize: 9.5, fontWeight: 700, color: AIO_C.muted, textTransform: "uppercase",
                  letterSpacing: "0.05em", fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap",
                }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || i}>
                {LOG_COLUMNS.map((c) => (
                  <td key={c.key} style={{
                    padding: "6px 11px", borderBottom: `1px solid ${AIO_C.wash}`,
                    color: c.key === "agreement" && /identical/.test(String(r[c.key])) ? AIO_C.green
                         : c.key === "agreement" ? AIO_C.amber
                         : c.key === "guardrailErrors" && r[c.key] > 0 ? AIO_C.amber
                         : AIO_C.ink,
                    fontWeight: c.key === "agreement" ? 600 : 400,
                    whiteSpace: c.key === "agreement" ? "normal" : "nowrap",
                    maxWidth: c.key === "agreement" ? 260 : undefined,
                    fontFamily: ["costUsd", "latencySec", "timestamp"].includes(c.key)
                      ? "ui-monospace, SFMono-Regular, Menlo, monospace" : undefined,
                  }}>{r[c.key] == null || r[c.key] === "" ? "—" : String(r[c.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Flatten a completed pipeline response into one session-log row. */
function buildLogRow(result) {
  const runs = result.runs || [];
  const ok   = runs.filter((r) => r.ok);
  const src = [];
  if (result.extraction && result.extraction.ran) {
    if (result.extraction.pastedTextRendered) src.push("pasted");
    if (result.extraction.documentSummary || !result.extraction.pastedTextRendered) src.push("pdf");
  }
  if (src.length === 0) src.push("manual only");

  const now = new Date();
  return {
    id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    reviewType: result.reviewType,
    diagnosisCode: (result.resolved && result.resolved.diagnosisCode) || "",
    source: src.join("+"),
    requestedVisits: result.requestedVisits,
    visitsToDate: result.resolved ? result.resolved.visitsToDate : "",
    visitsToDateSource: result.visitsToDateSource,
    determinations: runs.length
      ? runs.map((r) => (r.ok ? r.determination : "ERROR")).join(" | ")
      : (result.determination || "PEND") + (result.determinationSource === "validation" ? " (validation)" : ""),
    approvedVisits: ok.length ? ok.map((r) => r.approvedVisits).join(" | ") : "",
    guardrailErrors: runs.reduce((s, r) => s + (r.guardrails || []).filter((g) => g.severity === "error").length, 0),
    costUsd: result.telemetry ? result.telemetry.total.estimatedCostUsd.toFixed(4) : "",
    latencySec: result.telemetry ? (result.telemetry.total.wallClockMs / 1000).toFixed(1) : "",
  };
}

/* ── THE APP ───────────────────────────────────────────────────────────────── */

function App() {
  // Auth state — initialised from localStorage. Unchanged.
  const [token, setToken] = useState(() => localStorage.getItem("cogentus_token") || "");
  const [user, setUser]   = useState(() => {
    try { return JSON.parse(localStorage.getItem("cogentus_user") || "null"); }
    catch { return null; }
  });

  // Section 1 — case context (always manual)
  const [reviewType, setReviewType]                 = useState("initial");
  const [requestedVisits, setRequestedVisits]       = useState("");
  const [requestedFrequency, setRequestedFrequency] = useState("");

  // Section 2 — clinical source (any, all, or none)
  const [files, setFiles]           = useState([]);
  const [pastedText, setPastedText] = useState("");

  // Section 3 — manual overrides
  const [showOverrides, setShowOverrides]           = useState(false);
  const [diagnosisCodeOverride, setDiagnosisCode]   = useState("");
  const [visitsToDateOverride, setVisitsToDate]     = useState("");
  const [vtdSource, setVtdSource]                   = useState("manual");

  // Section 4 — prior determination (subsequent only)
  const [priorReviewerNote, setPriorReviewerNote] = useState("");

  // Result
  const [result, setResult]   = useState(null);
  const [activeRun, setActiveRun] = useState(0);
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  // Session log — in memory for the life of the tab. The AI-only route persists
  // nothing, deliberately, so this is the only record; export before reloading.
  const [sessionLog, setSessionLog] = useState([]);

  const handleAuthSuccess = (tok, userData) => {
    localStorage.setItem("cogentus_token", tok);
    localStorage.setItem("cogentus_user", JSON.stringify(userData));
    setToken(tok); setUser(userData);
  };
  const handleAuthError = useCallback(() => {
    localStorage.removeItem("cogentus_token");
    localStorage.removeItem("cogentus_user");
    setToken(""); setUser(null);
  }, []);
  const handleLogout = () => {
    localStorage.removeItem("cogentus_token");
    localStorage.removeItem("cogentus_user");
    setToken(""); setUser(null);
  };

  if (!token || !user) {
    return <AuthPage onAuthSuccess={handleAuthSuccess} />;
  }

  const run = async (runCount) => {
    setError("");
    if (!requestedVisits) { setError("Requested visits is required."); return; }

    const fd = new FormData();
    fd.append("reviewType", reviewType);
    fd.append("requestedVisits", String(parseInt(requestedVisits, 10)));
    if (requestedFrequency)     fd.append("requestedFrequency", String(parseInt(requestedFrequency, 10)));
    files.forEach((f) => fd.append("documents", f));
    if (pastedText.trim())      fd.append("pastedClinicalText", pastedText.trim());
    if (diagnosisCodeOverride.trim()) fd.append("diagnosisCodeOverride", diagnosisCodeOverride.trim());
    if (visitsToDateOverride !== "") {
      fd.append("visitsToDateOverride", String(parseInt(visitsToDateOverride, 10)));
      fd.append("visitsToDateOverrideSource", vtdSource);
    }
    if (reviewType === "subsequent" && priorReviewerNote.trim()) {
      fd.append("priorReviewerNote", priorReviewerNote.trim());
    }
    fd.append("runCount", String(runCount));

    setLoading(true); setResult(null); setActiveRun(0);
    try {
      const res = await axios.post(`${API_BASE}/v1/aionly/evaluate`, fd, {
        headers: { "Content-Type": "multipart/form-data", Authorization: `Bearer ${token}` },
        timeout: 600000,
      });
      setResult(res.data);
      setSessionLog((log) => [...log, buildLogRow(res.data)]);
    } catch (err) {
      if (err?.response?.status === 401) handleAuthError();
      else setError(err?.response?.data?.error || err?.response?.data?.detail || `Run failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const acceptSuggestion = () => {
    const s = result && result.priorNoteSuggestion;
    if (!s) return;
    setVisitsToDate(String(s.visitsToDate));
    setVtdSource("prior_note");
    setShowOverrides(true);
  };

  /* -- style tokens (kept from the shell this replaces) -- */
  const card = {
    background: "#fff", border: `1px solid ${AIO_C.line}`, borderRadius: 12,
    marginBottom: 20, boxShadow: "0 2px 12px rgba(0,0,0,0.07)", overflow: "hidden",
  };
  const labelEl = (text, hint) => (
    <label style={{ display: "block", marginBottom: 6 }}>
      <span style={{
        display: "block", fontSize: 12, fontWeight: 600, color: "#475569",
        letterSpacing: "0.03em", textTransform: "uppercase", fontFamily: '"DM Sans", sans-serif',
      }}>{text}</span>
      {hint && <span style={{ display: "block", fontSize: 11.5, color: AIO_C.muted, fontWeight: 400, textTransform: "none", letterSpacing: 0, marginTop: 2, lineHeight: 1.45 }}>{hint}</span>}
    </label>
  );
  const inputBase = {
    width: "100%", border: `1px solid ${AIO_C.line}`, borderRadius: 8, padding: "10px 14px",
    fontSize: 14, color: AIO_C.ink, background: AIO_C.wash, outline: "none",
    boxSizing: "border-box", fontFamily: '"Inter", sans-serif',
  };
  const sectionHead = (n, text) => (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, margin: "0 0 14px",
      paddingBottom: 8, borderBottom: `1px solid #f1f5f9`,
    }}>
      <span style={{
        width: 20, height: 20, borderRadius: 5, background: AIO_C.primary, color: "#fff",
        fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: '"DM Sans", sans-serif', flexShrink: 0,
      }}>{n}</span>
      <span style={{
        fontSize: 11, fontWeight: 700, color: AIO_C.muted, textTransform: "uppercase",
        letterSpacing: "0.1em", fontFamily: '"DM Sans", sans-serif',
      }}>{text}</span>
    </div>
  );

  const activeRunObj = result && result.runs && result.runs.length > 0 ? result.runs[activeRun] : null;

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #f0f4f8 0%, #e8eef5 50%, #f0f4f8 100%)",
      padding: "0 0 60px", fontFamily: "'Public Sans', 'DM Sans', system-ui, sans-serif",
    }}>
      {/* -- Sticky page header (unchanged) -- */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10, background: "#fff",
        borderBottom: `1px solid ${AIO_C.line}`, boxShadow: "0 1px 8px rgba(0,0,0,0.06)", padding: "0 16px",
      }}>
        <div style={{ maxWidth: 1720, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <span style={{ fontSize: 18, fontWeight: 600, color: AIO_C.primary, letterSpacing: "-0.02em", fontFamily: '"DM Sans", sans-serif', lineHeight: 1 }}>
            AI Auth Demo
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={handleLogout} style={{
              background: "none", border: `1px solid ${AIO_C.line}`, borderRadius: 6, padding: "5px 12px",
              fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: '"DM Sans", sans-serif',
            }}>Log out</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1720, margin: "0 auto", padding: "24px 20px 0" }}>

        <div style={{ ...card, padding: "24px 28px" }}>
          {/* SECTION 1 — CASE CONTEXT */}
          {sectionHead(1, "Case context")}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 16, marginBottom: 24 }}>
            <div>
              {labelEl("Review type")}
              <div style={{ display: "flex", gap: 8 }}>
                {["initial", "subsequent"].map((t) => (
                  <button key={t} type="button" onClick={() => setReviewType(t)}
                    style={{
                      flex: 1, padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                      border: `1.5px solid ${reviewType === t ? AIO_C.primary : AIO_C.line}`,
                      background: reviewType === t ? AIO_C.primary : AIO_C.white,
                      color: reviewType === t ? "#fff" : "#475569",
                      fontSize: 13, fontWeight: 600, fontFamily: '"DM Sans", sans-serif',
                      textTransform: "capitalize",
                    }}>{t}</button>
                ))}
              </div>
            </div>
            <div>
              {labelEl("Requested visits *")}
              <input type="number" min="0" value={requestedVisits}
                onChange={(e) => setRequestedVisits(e.target.value)}
                placeholder="e.g. 14" style={inputBase} />
            </div>
            <div>
              {labelEl("Requested frequency / week", "Leave blank to read from the plan of care.")}
              <input type="number" min="0" value={requestedFrequency}
                onChange={(e) => setRequestedFrequency(e.target.value)}
                placeholder="e.g. 2" style={inputBase} />
            </div>
          </div>

          {/* SECTION 2 — CLINICAL SOURCE */}
          {sectionHead(2, "Clinical source — any, all, or none")}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 24 }}>
            <div>
              {labelEl("Upload documents", "One or more PDFs.")}
              <input type="file" accept="application/pdf" multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                style={{ ...inputBase, padding: "9px 12px", fontSize: 12.5, cursor: "pointer" }} />
              {files.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: AIO_C.muted, lineHeight: 1.6 }}>
                  {files.map((f, i) => <div key={i}>• {f.originalname || f.name}</div>)}
                </div>
              )}
            </div>
            <div>
              {labelEl("Paste clinical text", "Paste clinical documentation directly — for example, copied from Auth Intelligence.")}
              <textarea value={pastedText} onChange={(e) => setPastedText(e.target.value)} rows={5}
                placeholder="Paste the clinical narrative here…"
                style={{ ...inputBase, resize: "vertical", lineHeight: 1.55, fontSize: 12.5 }} />
            </div>
          </div>

          {/* SECTION 3 — MANUAL OVERRIDES */}
          <button type="button" onClick={() => setShowOverrides((s) => !s)}
            style={{
              width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
              padding: 0, marginBottom: showOverrides ? 14 : 22,
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 8, borderBottom: `1px solid #f1f5f9` }}>
              <span style={{
                width: 20, height: 20, borderRadius: 5, background: AIO_C.primary, color: "#fff",
                fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: '"DM Sans", sans-serif', flexShrink: 0,
              }}>3</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: AIO_C.muted, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: '"DM Sans", sans-serif' }}>
                {showOverrides ? "▾" : "▸"} Override what the documents say
              </span>
            </div>
          </button>
          {showOverrides && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, color: AIO_C.muted, marginBottom: 14, lineHeight: 1.55 }}>
                Anything entered here wins over extracted values.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
                <div>
                  {labelEl("Diagnosis code")}
                  <input value={diagnosisCodeOverride}
                    onChange={(e) => setDiagnosisCode(e.target.value)}
                    placeholder="e.g. S83.101" style={inputBase} />
                </div>
                <div>
                  {labelEl("Visits approved to date",
                    "If this is a continuation of care submitted as a new request — for example after a prior authorization expired — enter the visits already approved.")}
                  <input type="number" min="0" value={visitsToDateOverride}
                    onChange={(e) => { setVisitsToDate(e.target.value); setVtdSource("manual"); }}
                    placeholder="e.g. 14" style={inputBase} />
                  {vtdSource === "prior_note" && visitsToDateOverride !== "" && (
                    <div style={{ marginTop: 5, fontSize: 11, color: AIO_C.green, fontWeight: 600 }}>
                      ✓ Accepted from the prior reviewer's note.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* SECTION 4 — PRIOR DETERMINATION (subsequent only) */}
          {reviewType === "subsequent" && (
            <div style={{ marginBottom: 22 }}>
              {sectionHead(4, "Prior determination")}
              {labelEl("Paste the prior reviewer's determination note, if available",
                "Used for comparison and to check whether a previously stated plan has been met.")}
              <textarea value={priorReviewerNote} onChange={(e) => setPriorReviewerNote(e.target.value)} rows={5}
                placeholder="e.g. Approved 14 visits at 2x/week x 7 weeks…"
                style={{ ...inputBase, resize: "vertical", lineHeight: 1.55, fontSize: 12.5 }} />

              {result && result.priorNoteSuggestion && (
                <div style={{
                  marginTop: 12, padding: "12px 14px", background: AIO_C.amberBg,
                  border: `1px solid ${AIO_C.amberLine}`, borderRadius: 8,
                  display: "flex", alignItems: "flex-start", gap: 14, justifyContent: "space-between",
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: AIO_C.amber, marginBottom: 4 }}>
                      {result.priorNoteSuggestion.message}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#78350f", fontStyle: "italic", lineHeight: 1.5 }}>
                      “…{result.priorNoteSuggestion.excerpt}…”
                    </div>
                  </div>
                  <button type="button" onClick={acceptSuggestion}
                    style={{
                      flexShrink: 0, padding: "8px 16px", borderRadius: 7, border: "none",
                      background: AIO_C.amber, color: "#fff", fontSize: 12, fontWeight: 700,
                      cursor: "pointer", fontFamily: '"DM Sans", sans-serif',
                    }}>Accept</button>
                </div>
              )}
            </div>
          )}

          {error && (
            <div style={{
              marginBottom: 16, padding: "12px 16px", background: AIO_C.redBg,
              border: `1px solid ${AIO_C.redLine}`, borderRadius: 8, fontSize: 13, color: "#dc2626",
            }}>{error}</div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => run(1)} disabled={loading}
              style={{
                flex: 1, padding: "13px 20px", borderRadius: 9, border: "none",
                background: loading ? AIO_C.faint : AIO_C.primary, color: "#fff",
                fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
                fontFamily: '"DM Sans", sans-serif',
              }}>{loading ? "Extracting and reviewing…" : "Extract and Review"}</button>
          </div>
          {loading && (
            <div style={{ marginTop: 12, fontSize: 12, color: AIO_C.muted, textAlign: "center" }}>
              This takes about a minute — the documents are read first, then reviewed.
            </div>
          )}
        </div>

        {/* -- OUTPUT -- */}
        {result && (
          <>
            {result.validation && !result.validation.passed && (
              <div style={{ ...card, padding: "18px 22px", borderColor: AIO_C.amberLine, background: AIO_C.amberBg }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: AIO_C.amber, fontFamily: "'Fraunces', Georgia, serif", marginBottom: 4 }}>
                  Pend — validation did not pass
                </div>
                <div style={{ fontSize: 12.5, color: "#78350f", marginBottom: 10, lineHeight: 1.55 }}>
                  The review was not run. A recommendation that cannot be defended is a pend, not an error.
                </div>
                {result.validation.failures.map((f, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: "#78350f", lineHeight: 1.6 }}>
                    • <strong>{f.check}</strong> — {f.message}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))", gap: 20, alignItems: "start" }}>
              <div style={{ ...card, padding: "20px 22px", marginBottom: 0 }}>
                <h2 style={{
                  margin: "0 0 16px", fontSize: 11, fontWeight: 700, color: AIO_C.muted,
                  textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: '"DM Sans", sans-serif',
                }}>Extraction</h2>
                <ExtractionPanel result={result} />
              </div>

              <div style={{ ...card, padding: "20px 22px", marginBottom: 0 }}>
                <h2 style={{
                  margin: "0 0 16px", fontSize: 11, fontWeight: 700, color: AIO_C.muted,
                  textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: '"DM Sans", sans-serif',
                }}>Recommendation and note</h2>
                {activeRunObj
                  ? <DeterminationPanel result={result} run={activeRunObj} />
                  : <div style={{ fontSize: 12.5, color: AIO_C.faint, fontStyle: "italic" }}>
                      No recommendation was produced for this case.
                    </div>}
              </div>
            </div>

            {activeRunObj && activeRunObj.ok && (
              <div style={{ ...card, padding: "20px 22px", marginTop: 20, marginBottom: 0 }}>
                <NoteBox note={activeRunObj.note} />
              </div>
            )}

            <TelemetryStrip telemetry={result.telemetry} visitsToDateSource={result.visitsToDateSource} />
          </>
        )}

        <SessionLog rows={sessionLog} onClear={() => setSessionLog([])} />
      </div>
    </div>
  );
}

export default App;
