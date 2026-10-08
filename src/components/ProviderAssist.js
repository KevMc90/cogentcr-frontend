import React, { useState, useEffect } from "react";
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
