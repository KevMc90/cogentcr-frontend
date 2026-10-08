// Which evidence layout the Cockpit uses for a case. Therapy (PT / OT / ST) keeps
// the pain / ROM / MMT / score layout; every other line of business is described
// by its pack. Display only: nothing here touches a determination.
const THERAPY_DISCIPLINES = new Set(["PT", "OT", "ST"]);

export function evidenceViewFor(kase) {
  const d = String((kase && kase.discipline) || "").trim().toUpperCase();
  if (!d || THERAPY_DISCIPLINES.has(d)) return "therapy";
  return "pack";
}

// One line for the top of the pack view. Wording keeps "not on file" distinct
// from "not extracted": a missing value was not captured at intake.
export function evidenceSummaryLine(evidence) {
  if (!evidence || !evidence.summary) return "";
  const { fieldsPresent, fieldsTotal, documentsMissing } = evidence.summary;
  const parts = [`${fieldsPresent} of ${fieldsTotal} findings on file`];
  if (documentsMissing > 0) {
    parts.push(`${documentsMissing} required ${documentsMissing === 1 ? "document" : "documents"} not on file`);
  } else {
    parts.push("all required documents on file");
  }
  return parts.join(" · ");
}
