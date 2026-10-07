import React, { useState, useEffect } from "react";
import axios from "axios";

// ── DESIGN TOKENS (mirrors Cockpit.js / App.js — keep in sync by eye) ──────────
const NAVY  = "#1a3a5c";
const FONTS = { heading: "'Fraunces', Georgia, serif", body: "'Public Sans', system-ui, sans-serif" };

// ── STATUS → COLOR ──────────────────────────────────────────────────────────────
// Same hex palette already used for status/determination badges across the app
// (see detColors / statusColor in Cockpit.js and App.js), re-mapped per the
// member-timeline spec: approved=green, denied/partial_denial=red,
// pending-ish/submitted=amber, info_requested=blue. Anything unrecognized falls
// back to a neutral gray rather than guessing or throwing.
function statusStyle(status) {
  const s = (status || "").toLowerCase();
  if (s === "approved") return { bg: "#dcfce7", text: "#15803d", border: "#86efac" };
  if (s === "denied" || s === "partial_denial") return { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5" };
  if (s === "info_requested") return { bg: "#eff6ff", text: "#1d4ed8", border: "#93c5fd" };
  if (s === "submitted" || s === "under_review" || s === "pending_md_review" || s.startsWith("pend")) {
    return { bg: "#fef3c7", text: "#92400e", border: "#fcd34d" };
  }
  return { bg: "#f3f4f6", text: "#374151", border: "#d1d5db" };
}

function statusLabel(status) {
  if (!status) return "Unknown";
  return String(status).replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

// Group request lines by bodyRegion, each group's rows sorted most-recent-first,
// and groups themselves ordered by the most recent createdAt within the group.
function groupByBodyRegion(requestLines) {
  const groups = new Map();
  for (const line of requestLines) {
    const key = line && line.bodyRegion ? String(line.bodyRegion) : "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  }

  const toTime = iso => {
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    return isNaN(t) ? 0 : t;
  };

  const sections = Array.from(groups.entries()).map(([bodyRegion, rows]) => {
    const sorted = [...rows].sort((a, b) => toTime(b && b.createdAt) - toTime(a && a.createdAt));
    const mostRecent = sorted.length > 0 ? toTime(sorted[0].createdAt) : 0;
    return { bodyRegion, rows: sorted, mostRecent };
  });

  sections.sort((a, b) => b.mostRecent - a.mostRecent);
  return sections;
}

function TimelineRow({ line, isCurrent }) {
  const status = statusStyle(line && line.status);
  const decision = line && line.decision;
  const units = decision && decision.unitsApproved != null ? decision.unitsApproved : null;

  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: 7,
        border: isCurrent ? `1.5px solid ${NAVY}` : "1px solid #e2e8f0",
        background: isCurrent ? "#eff6ff" : "#fff",
        marginBottom: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: NAVY, fontFamily: FONTS.body }}>
          {(line && line.lineOfBusiness) || "Unknown service"}
        </span>
        {isCurrent && (
          <span
            style={{
              fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
              background: NAVY, color: "#fff", fontFamily: FONTS.body,
              textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0,
            }}
          >
            Viewing
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
            background: status.bg, color: status.text, border: `1px solid ${status.border}`,
            fontFamily: FONTS.body, textTransform: "uppercase", letterSpacing: "0.04em",
          }}
        >
          {statusLabel(line && line.status)}
        </span>
        <span style={{ fontSize: 11, color: "#64748b", fontFamily: FONTS.body }}>
          {fmtDate(line && line.createdAt)}
        </span>
        {units != null && (
          <span style={{ fontSize: 11, color: "#15803d", fontFamily: FONTS.body, fontWeight: 600 }}>
            {units} {units === 1 ? "visit" : "visits"}
          </span>
        )}
      </div>
    </div>
  );
}

export default function MemberTimeline({ token, memberId, currentCaseId, apiBase }) {
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!memberId) {
      setTimeline(null);
      setError("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    axios
      .get(`${apiBase}/v1/members/${memberId}/timeline`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (cancelled) return;
        setTimeline(res.data || {});
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load this member's history");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [memberId, token, apiBase]);

  // Quiet empty state — no memberId means there's nothing to look up yet.
  if (!memberId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto", background: "#fff" }}>
        <div style={{ padding: "16px 20px", fontSize: 11, color: "#94a3b8", fontFamily: FONTS.body, fontStyle: "italic" }}>
          No member selected.
        </div>
      </div>
    );
  }

  const requestLines = (timeline && timeline.requestLines) || [];
  const sections = groupByBodyRegion(requestLines);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto", overflowX: "hidden", background: "#fff" }}>
      <div style={{ padding: "12px 20px 11px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", position: "sticky", top: 0, zIndex: 1 }}>
        <span
          style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
            textTransform: "uppercase", color: "#64748b", fontFamily: FONTS.body,
          }}
        >
          Member Timeline
        </span>
        <div style={{ marginTop: 4, fontSize: 14, fontWeight: 700, color: NAVY, fontFamily: FONTS.heading }}>
          {(timeline && timeline.memberName) || "—"}
        </div>
        <div style={{ marginTop: 2, fontSize: 11, color: "#64748b", fontFamily: FONTS.body }}>
          {requestLines.length} request{requestLines.length === 1 ? "" : "s"} on record
        </div>
      </div>

      <div style={{ padding: "14px 20px", flex: 1 }}>
        {loading && (
          <div style={{ textAlign: "center", padding: "24px 12px" }}>
            <div
              style={{
                width: 22, height: 22, border: "2.5px solid #e2e8f0", borderTop: `2.5px solid ${NAVY}`,
                borderRadius: "50%", animation: "rn-spin 0.8s linear infinite", margin: "0 auto 10px",
              }}
            />
            <div style={{ fontSize: 11, color: "#64748b", fontFamily: FONTS.body }}>Loading member history...</div>
          </div>
        )}

        {!loading && error && (
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: FONTS.body, fontStyle: "italic", padding: "8px 2px" }}>
            {error}
          </div>
        )}

        {!loading && !error && sections.length === 0 && (
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: FONTS.body, fontStyle: "italic", padding: "8px 2px" }}>
            No other requests on record for this member.
          </div>
        )}

        {!loading && !error && sections.map(section => (
          <div key={section.bodyRegion} style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase",
                letterSpacing: "0.07em", fontFamily: FONTS.body, marginBottom: 6,
              }}
            >
              {section.bodyRegion}
            </div>
            {section.rows.map((line, i) => (
              <TimelineRow
                key={(line && line.caseId) || i}
                line={line}
                isCurrent={!!currentCaseId && !!line && line.caseId === currentCaseId}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
