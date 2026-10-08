// Reads the reviewer's note and says which determinations it supports, so the
// decision menu can only offer outcomes that match what the note actually says.
// Pure: no React, no network. The note is the source of truth for the outcome,
// the approved-visit count and the rationale that get recorded.

const RATIONALE_HEAD = /^\s*Determination and Rationale:\s*$/im;
const APPROVED_HEAD  = /^\s*Approved Visits:\s*$/im;
const SECTION_HEAD   = /^\s*(HPI\/Care History|Clinical Summary|POC|Requested Visits|Determination and Rationale|Approved Visits):\s*$/im;

function section(text, headRe) {
  const m = headRe.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const next = SECTION_HEAD.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function toCount(s) {
  if (s == null) return null;
  const m = /^\s*(\d+)\b/.exec(String(s));
  return m ? parseInt(m[1], 10) : null;
}

function labelOutcome(rationale) {
  const head = rationale.slice(0, 80);
  if (/^\s*pend/i.test(head)) return "pend";
  if (/^\s*(partial|partially)/i.test(head)) return "partial";
  if (/^\s*(full denial|denied|denial|not approved|deny)/i.test(head)) return "deny";
  if (/^\s*approv/i.test(head)) return "approve";
  // No leading label: fall back to the words the reviewer wrote.
  if (/\bpartial(ly)?\b/i.test(rationale)) return "partial";
  if (/\b(full denial|denied|denial|not approved|deny)\b/i.test(rationale)) return "deny";
  if (/\bapprov/i.test(rationale)) return "approve";
  return null;
}

const OUTCOME_NAME = { approve: "Approved", partial: "Partial approval", deny: "Denied", pend: "Pend" };
const KEY_FOR = { approve: "approve", partial: "partial", deny: "deny", pend: "pend" };

/**
 * @param {string} noteText
 * @param {number|string|null} requestedVisits
 * @returns {{
 *   status: "ok"|"conflict"|"unreadable",
 *   outcome: "approve"|"partial"|"deny"|"pend"|null,
 *   approvedVisits: number|null, requestedVisits: number|null,
 *   rationale: string, allowed: string[], message: string
 * }}
 */
export function analyzeNote(noteText, requestedVisits) {
  const text = String(noteText || "");
  const requested = toCount(requestedVisits);
  const rationale = section(text, RATIONALE_HEAD) || "";
  const approved  = toCount(section(text, APPROVED_HEAD));
  const base = { rationale, approvedVisits: approved, requestedVisits: requested };

  const label = rationale ? labelOutcome(rationale) : null;

  if (!rationale || (label !== "pend" && (approved == null || requested == null))) {
    return { ...base, status: "unreadable", outcome: null, allowed: ["pend"],
      message: "The note needs a Determination and Rationale and a numeric Approved Visits (and Requested Visits) to record a determination." };
  }

  let visitsOutcome = null;
  if (approved === 0) visitsOutcome = "deny";
  else if (approved === requested) visitsOutcome = "approve";
  else if (approved > 0 && approved < requested) visitsOutcome = "partial";
  else {
    return { ...base, status: "conflict", outcome: null, allowed: [],
      message: `Approved Visits (${approved}) is more than the ${requested} requested. Correct the note.` };
  }

  if (label === "pend") {
    return { ...base, status: "ok", outcome: "pend", allowed: ["pend"],
      message: "The note reads as a pend. Use Request information." };
  }

  const outcome = label || visitsOutcome;
  if (label && label !== visitsOutcome) {
    return { ...base, status: "conflict", outcome: null, allowed: [],
      message: `The note says "${OUTCOME_NAME[label]}" but Approved Visits is ${approved} of ${requested}. Make them agree to record a determination.` };
  }

  return { ...base, status: "ok", outcome, allowed: [KEY_FOR[outcome], "pend"],
    message: `Note reads: ${OUTCOME_NAME[outcome]} · ${approved} of ${requested} visits.` };
}
