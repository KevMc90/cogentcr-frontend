// Maps a submissions row (as returned by the backend) to the liveCase shape
// the Cockpit expects. Mirrors ReviewerShell's handleGetCase mapping.
export function submissionToCockpitCase(sub, fallbackDiscipline = "PT") {
  const diags = Array.isArray(sub.diagnosis_codes) ? sub.diagnosis_codes : [];
  const stored = sub.extracted_metrics || {};
  const discipline = sub.discipline || fallbackDiscipline;
  return {
    caseId:          sub.submission_id,
    submissionId:    sub.submission_id,
    memberName:      sub.member_name || "Unknown Member",
    memberId:        sub.member_id || "—",
    memberState:     sub.member_state || null,
    dob:             sub.dob || "—",
    discipline,
    reviewType:      sub.review_type || "initial",
    submittedAt:     sub.submitted_at,
    receivedAt:      sub.received_at || sub.submitted_at,
    reviewPriority:  sub.review_priority || "standard",
    rmiSentAt:       sub.rmi_sent_at || null,
    rmiRespondedAt:  sub.rmi_responded_at || null,
    documents:       sub.document_list || [],
    providerName:    sub.provider_name || null,
    diagnosisCodes:  diags,
    providerNotes:   sub.provider_notes || null,
    requestedVisits: sub.requested_visits || null,
    metrics: {
      diagnosisCodes: diags,
      requestedVisits: sub.requested_visits || 0,
      therapyType: discipline,
      functionalLimitations: [],
      sopIndicators: [],
      documentationQuality: {},
      ...stored,
      diagnosisCodes: stored.diagnosisCodes?.length ? stored.diagnosisCodes : diags,
      primaryDiagnosisCode: stored.primaryDiagnosisCode || diags[0] || null,
      requestedVisits: sub.requested_visits || 0,
      dateOfBirth: stored.dateOfBirth || sub.dob || null,
    },
    planRuleSet: sub.plan_id ? { planId: sub.plan_id } : null,
  };
}
