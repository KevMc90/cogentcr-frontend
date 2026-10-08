import React, { useState, useRef, useEffect, useId } from "react";

// Hover-to-source: wraps an extracted value and, when the backend has a verified
// passage for it, shows the quoted source text on hover / focus / tap.
//
//   <SourceHover provenance={kase.contract?.extraction?.provenance} fieldKey="rom:kneeFlexion">
//     {value}
//   </SourceHover>
//
// provenance: { [fieldKey]: { snippet, docIndex, docName } }. With no entry for
// the key, children render untouched, so it is safe to wrap every value.

const FONT = "'DM Sans', system-ui, sans-serif";

export default function SourceHover({ provenance, fieldKey, children }) {
  const src = provenance && fieldKey ? provenance[fieldKey] : null;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!src || typeof src.snippet !== "string" || !src.snippet) return <>{children}</>;

  return (
    <span
      ref={wrapRef}
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        tabIndex={0}
        role="button"
        aria-describedby={open ? tipId : undefined}
        aria-label="Show source in document"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
        style={{ borderBottom: "1px dotted #3b82f6", cursor: "help", outline: "none" }}
      >
        {children}
      </span>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          style={{
            position: "absolute", zIndex: 50, left: 0, top: "100%", marginTop: 6,
            width: 280, maxWidth: "80vw", padding: "8px 10px", borderRadius: 8,
            background: "#0f172a", color: "#f8fafc", boxShadow: "0 6px 18px rgba(15,23,42,0.28)",
            fontFamily: FONT, fontSize: 11.5, lineHeight: 1.45, fontWeight: 400,
            textAlign: "left", whiteSpace: "normal", overflowWrap: "anywhere",
          }}
        >
          <span style={{ display: "block", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#93c5fd", marginBottom: 3 }}>
            Source{src.docName ? ` · ${src.docName}` : ""}
          </span>
          <span style={{ fontStyle: "italic" }}>{`“${src.snippet}”`}</span>
        </span>
      )}
    </span>
  );
}
