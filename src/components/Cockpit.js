import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from "react";
import { parseRequestedFreqWeeks, formatVisitLine } from "../utils/visitComparison";
import { buildUNFNote } from "../utils/unfNote";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  "https://rapidnote-backend.onrender.com";

// ── PEND REASONS ───────────────────────────────────────────────────────────────
const PEND_REASONS = [
  { value: "progress_note_missing",       label: "Most recent progress note missing",                  defaultDetail: "Please include the most recent signed progress note from the treating therapist." },
  { value: "poc_incomplete",              label: "Plan of care incomplete (frequency/duration/goals)", defaultDetail: "Please resubmit with a complete plan of care including frequency, duration, and measurable treatment goals." },
  { value: "functional_measures_missing", label: "Objective functional measures not documented",       defaultDetail: "Please include objective functional measures (e.g. ROM, MMT, standardized outcome scores) in the submitted documentation." },
  { value: "physician_order_missing",     label: "Physician order / referral missing",                 defaultDetail: "Please include a signed physician order or referral authorizing the requested therapy services." },
  { value: "eval_outdated",               label: "Initial evaluation too old or not included",          defaultDetail: "Please include a current initial evaluation or re-evaluation performed within the last 90 days." },
  { value: "outcome_measure_missing",     label: "Standardized outcome measure not included",           defaultDetail: "Please include a validated standardized outcome measure (e.g. DASH, KOOS, FIM, ARAT) in the submitted documentation." },
  { value: "diagnosis_unsupported",       label: "Diagnosis codes not supported by documentation",     defaultDetail: "The submitted documentation does not support the diagnosis codes provided. Please include documentation that clearly supports the listed diagnosis." },
  { value: "other",                       label: "Other (describe below)",                              defaultDetail: "" },
];

// ── DESIGN TOKENS ──────────────────────────────────────────────────────────────
const NAVY      = "#1a3a5c";
const NAVY_DARK = "#0d1b2a";
const NAVY_MID  = "#2d5a8e";
const FONTS     = { heading: "'Fraunces', Georgia, serif", body: "'Public Sans', system-ui, sans-serif" };

// UNF note box: opens at the note's own height, between these bounds. The drag
// handle can go anywhere in the same range.
const NOTE_MIN_H = 280;
const NOTE_MAX_H = 2000;

// ── SYNTHETIC QUEUE ────────────────────────────────────────────────────────────
// All names/IDs/dates are fictitious. No PHI.
const SYNTH_QUEUE = [
  {
    caseId: "SYNTH-001",
    memberName: "Alex Rivera",
    memberId: "MBR-10042",
    dob: "03/15/1978",
    discipline: "PT",
    reviewType: "initial",
    submittedAt: "2026-05-22T09:15:00Z",
    documents: [{ name: "Initial_Eval_Rivera_05022026.pdf", type: "Initial Evaluation", date: "05/02/2026" }],
    contract: {
      extraction: {
        rom: { "Shldr Flex": 110, "Shldr Abd": 95, "Shldr ER": 55 },
        romNormals: { "Shldr Flex": 180, "Shldr Abd": 180, "Shldr ER": 90 },
        mmt: { Supraspinatus: "3/5", Deltoid: "4−/5", Biceps: "4/5" },
        painCurrent: "6/10 rest, 9/10 overhead",
        functionalOutcomeScore: null,
        goals: ["Increase shoulder flex to 150° within 6 wks", "Return to overhead reaching for ADLs"],
        poc: "2x/week × 6 weeks",
        diagnosisCodes: ["M25.561"],
        primaryDiagnosisCode: "M25.561",
        primaryDiagnosis: "Left shoulder pain — rotator cuff",
        requestedVisits: 12,
        requestedFrequency: "2x/week × 6 weeks",
        severity: "severe",
        functionalLimitations: ["Unable to reach overhead", "Difficulty with dressing", "Cannot lift above shoulder"],
        documentationQuality: {
          hasEvalDate: true, hasDiagnosisCodes: true, hasObjectiveMeasures: true,
          hasFunctionalLimitations: true, hasGoals: true, hasPOC: true,
          hasStandardizedOutcomeMeasure: false, goalsMeasurable: true,
          goalsFunctional: true, goalsHaveTimeframes: true, hasHEP: false,
        },
        sopIndicators: ["Manual therapy", "Therapeutic exercise", "Neuromuscular re-education"],
        goalsTotal: 2, goalsMet: 0, visitsToDate: 0,
      },
      assessment: {
        d1: { finding: "FULLY_ESTABLISHED", reasoning: "Clinical deficits present; skilled care criteria met." },
        d2: { finding: "FULLY_ALIGNED", supportedFreq: 2, supportedDuration: 8, supportedVisits: 16, pocMaxVisits: 12, reasoning: "" },
        d3: { finding: "COMPLETE", gaps: [], notes: ["No standardized outcome measure documented."] },
      },
      recommendation: {
        determination: "Approved",
        approvedVisits: 12, frequency: 2, durationWeeks: 6,
        criteria: [
          "Pain 6/10; ROM: Flex 110°/180°, Abd 95°/180°, ER 55°/90°",
          "MMT: Supraspinatus 3/5, Deltoid 4−/5, Biceps 4/5",
          "Skilled: Manual therapy, Therapeutic exercise, NMR",
          "APTA CPG Shoulder (2021): benchmark typical 10 visits (p75: 16)",
        ],
        rationale: "Approved — Skilled PT is supported for Left shoulder pain (M25.561) with pain of 6/10, significant ROM deficits, and MMT averaging 3.7/5. Per APTA CPG, 2x/week is supported for severe presentation. Approving 12 visits at 2x/week × 6 weeks.",
        confidence: "high",
        autoApprovalEligible: true,
      },
      cpgInfo: { diagCode: "M25.561", conditionLabel: "Shoulder pain — non-operative", typicalVisits: 10, p75Visits: 16, maxEpisodeVisits: 28, cpgCitation: "APTA CPG Shoulder (2021)" },
    },
  },
  {
    caseId: "SYNTH-002",
    memberName: "Sam Lewis",
    memberId: "MBR-20811",
    dob: "07/28/1965",
    discipline: "PT",
    reviewType: "subsequent",
    submittedAt: "2026-05-22T09:42:00Z",
    documents: [{ name: "Progress_Note_Lewis_05102026.pdf", type: "Progress Note", date: "05/10/2026" }],
    contract: {
      extraction: {
        rom: { "Knee Flex": 108, "Knee Ext": -5 },
        romNormals: { "Knee Flex": 135, "Knee Ext": 0 },
        mmt: { Quadriceps: "3+/5", Hamstrings: "4/5", "Hip Abd": "3/5" },
        painCurrent: "4/10",
        functionalOutcomeScore: "KOOS 52/100",
        goals: ["Knee flex to 120° within 4 wks", "Ascend/descend stairs independently"],
        poc: "3x/week × 6 weeks",
        diagnosisCodes: ["M17.11"],
        primaryDiagnosisCode: "M17.11",
        primaryDiagnosis: "Primary osteoarthritis, right knee",
        requestedVisits: 18,
        requestedFrequency: "3x/week × 6 weeks",
        severity: "moderate",
        functionalLimitations: ["Unable to ascend stairs without rail", "Difficulty with prolonged walking"],
        documentationQuality: {
          hasEvalDate: true, hasDiagnosisCodes: true, hasObjectiveMeasures: true,
          hasFunctionalLimitations: true, hasGoals: true, hasPOC: true,
          hasStandardizedOutcomeMeasure: true, goalsMeasurable: true,
          goalsFunctional: true, goalsHaveTimeframes: true, hasHEP: true,
        },
        sopIndicators: ["Therapeutic exercise", "Manual therapy", "Gait training"],
        goalsTotal: 2, goalsMet: 0, visitsToDate: 8,
        romComparison: {
          "Knee Flex": { prior: 95, current: 108, normal: 135 },
          "Knee Ext":  { prior: -10, current: -5, normal: 0 },
        },
        mmtComparison: {
          Quadriceps: { prior: "3/5",  current: "3+/5" },
          Hamstrings: { prior: "3+/5", current: "4/5"  },
          "Hip Abd":  { prior: "2+/5", current: "3/5"  },
        },
        outcomeComparison: { tool: "KOOS", prior: 41, current: 52, maxScore: 100 },
        painPrior: "6/10",
      },
      assessment: {
        d1: { finding: "FULLY_ESTABLISHED", reasoning: "Functional deficits persist; skilled care criteria met." },
        d2: { finding: "FREQUENCY_MISALIGNED", supportedFreq: 2, supportedDuration: 6, supportedVisits: 12, pocMaxVisits: 18, reasoning: "3x/week exceeds CPG max of 2x/week for moderate knee OA." },
        d3: { finding: "COMPLETE", gaps: [], notes: [] },
      },
      recommendation: {
        determination: "Partial Denial — Unsupported Frequency",
        approvedVisits: 11, frequency: 2, durationWeeks: 6,
        criteria: [
          "ROM: Knee Flex 108°/135°, Ext -5°/0°; KOOS 52/100",
          "Pain 4/10; 2 functional limitations; 8 VTD",
          "Requested 3x/week > CPG max 2x/week for moderate presentation",
          "APTA CPG Knee OA (2021): benchmark typical 8 visits (p75: 12)",
        ],
        rationale: "Partial Denial — Unsupported Frequency: Skilled PT is supported for right knee OA (M17.11). Requested 3x/week exceeds the evidence-supported maximum of 2x/week per APTA CPG. Approving 11 visits at 2x/week × 6 weeks.",
        confidence: "high",
        autoApprovalEligible: false,
      },
      cpgInfo: { diagCode: "M17.11", conditionLabel: "Knee osteoarthritis — non-operative", typicalVisits: 8, p75Visits: 12, maxEpisodeVisits: 20, cpgCitation: "APTA CPG Knee OA (2021)" },
    },
  },
  {
    caseId: "SYNTH-003",
    memberName: "Casey Martinez",
    memberId: "MBR-31567",
    dob: "11/03/1988",
    discipline: "PT",
    reviewType: "initial",
    submittedAt: "2026-05-22T10:10:00Z",
    documents: [{ name: "IE_Martinez_05152026.pdf", type: "Initial Evaluation", date: "05/15/2026" }],
    contract: {
      extraction: {
        rom: { "Lumbar Flex": "fingertips to knees (limited)", "Lumbar Ext": "limited" },
        romNormals: {},
        mmt: {},
        painCurrent: "7/10 LBP, 5/10 left leg",
        functionalOutcomeScore: null,
        goals: [],
        poc: null,
        diagnosisCodes: ["M51.16"],
        primaryDiagnosisCode: "M51.16",
        primaryDiagnosis: "IVD degeneration, lumbar region",
        requestedVisits: 16,
        requestedFrequency: null,
        severity: "moderate",
        functionalLimitations: ["Unable to sit >20 min", "Cannot perform lifting tasks at work"],
        documentationQuality: {
          hasEvalDate: true, hasDiagnosisCodes: true, hasObjectiveMeasures: true,
          hasFunctionalLimitations: true, hasGoals: false, hasPOC: false,
          hasStandardizedOutcomeMeasure: false, goalsMeasurable: false,
          goalsFunctional: false, goalsHaveTimeframes: false, hasHEP: false,
        },
        sopIndicators: ["Therapeutic exercise", "Manual therapy"],
        goalsTotal: 0, goalsMet: null, visitsToDate: 0,
      },
      assessment: {
        d1: { finding: "FULLY_ESTABLISHED", reasoning: "Pain and functional deficits documented; skilled indicators present." },
        d2: { finding: "VOLUME_MISALIGNED", supportedFreq: null, supportedDuration: null, supportedVisits: null, pocMaxVisits: null, reasoning: "No POC frequency or duration identified." },
        d3: { finding: "INCOMPLETE", gaps: ["goals", "poc"], notes: ["Treatment goals not identified.", "Plan of care frequency not identified."] },
      },
      recommendation: {
        determination: "Pend",
        approvedVisits: 0, frequency: null, durationWeeks: null,
        criteria: [
          "Pain 7/10 LBP, 5/10 left leg; 2 functional limitations",
          "Missing: treatment goals (required per APTA standards)",
          "Missing: plan of care — frequency and duration not specified",
        ],
        rationale: "Pend — Insufficient Clinical Documentation: The following elements are required to complete this review: treatment goals, plan of care (frequency and duration). Please resubmit with complete documentation.",
        confidence: "low",
        autoApprovalEligible: false,
      },
      cpgInfo: { diagCode: "M51.16", conditionLabel: "Lumbar disc degeneration — non-operative", typicalVisits: 10, p75Visits: 14, maxEpisodeVisits: 20, cpgCitation: "APTA CPG Lumbar Spine (2021)" },
    },
  },
  {
    caseId: "SYNTH-004",
    memberName: "Jordan Park",
    memberId: "MBR-40293",
    dob: "09/22/1952",
    discipline: "OT",
    reviewType: "initial",
    submittedAt: "2026-05-22T10:45:00Z",
    documents: [{ name: "OT_IE_Park_05182026.pdf", type: "Initial Evaluation", date: "05/18/2026" }],
    contract: {
      extraction: {
        rom: {}, mmt: {},
        painCurrent: "3/10 left UE",
        functionalOutcomeScore: null,
        goals: [
          "Improve UE dressing independence from max assist to min assist within 6 wks",
          "Improve meal prep safety to modified independent within 8 wks",
        ],
        poc: "5x/week × 4 weeks",
        diagnosisCodes: ["G81.91"],
        primaryDiagnosisCode: "G81.91",
        primaryDiagnosis: "Hemiplegia, right dominant side, CVA",
        requestedVisits: 20,
        requestedFrequency: "5x/week × 4 weeks",
        severity: "severe",
        functionalLimitations: [
          "Max assist for upper body dressing", "Unable to perform bilateral meal prep",
          "Dependent for grooming tasks", "Impaired left UE active ROM limiting ADL reach",
        ],
        documentationQuality: {
          hasEvalDate: true, hasDiagnosisCodes: true, hasObjectiveMeasures: true,
          hasFunctionalLimitations: true, hasGoals: true, hasPOC: true,
          hasStandardizedOutcomeMeasure: true, goalsMeasurable: true,
          goalsFunctional: true, goalsHaveTimeframes: true, hasHEP: false,
        },
        sopIndicators: ["Neuromuscular re-education", "ADL training", "Constraint-induced movement therapy"],
        goalsTotal: 2, goalsMet: 0, visitsToDate: 0,
        fim: 68,
        adlLevels: {
          "Dressing (upper)": "Max Assist",
          "Meal Prep": "Dependent",
          "Grooming": "Max Assist",
          "Bathing": "Moderate Assist",
        },
        iadlLevels: { "Home management": "Dependent", "Community mobility": "Dependent" },
      },
      assessment: {
        d1: { finding: "FULLY_ESTABLISHED", reasoning: "FIM 68 (severe); significant ADL deficits; skilled OT criteria met for post-CVA rehabilitation." },
        d2: { finding: "FULLY_ALIGNED", supportedFreq: 5, supportedDuration: 4, supportedVisits: 20, pocMaxVisits: 20, reasoning: "5x/week within AOTA CPG Stroke Rehab 2022 benchmark for severe presentation." },
        d3: { finding: "COMPLETE", gaps: [], notes: [] },
      },
      recommendation: {
        determination: "Approved",
        approvedVisits: 20, frequency: 5, durationWeeks: 4,
        criteria: [
          "FIM 68/126 (severe functional impairment)",
          "ADL: Max Assist dressing/grooming; Dependent meal prep",
          "Skilled: NMR, ADL training, CIMT",
          "AOTA CPG Stroke Rehab (2022): benchmark typical 20 visits (p75: 32)",
        ],
        rationale: "Approved — Skilled OT is supported for right hemiplegia post-CVA (G81.91). FIM score of 68 indicates severe functional impairment across ADLs. Per AOTA CPG Stroke Rehab (2022), 5x/week is supported for severe presentation. Approving 20 visits at 5x/week × 4 weeks.",
        confidence: "high",
        autoApprovalEligible: false,
      },
      cpgInfo: { diagCode: "G81.91", conditionLabel: "Hemiplegia — CVA (OT)", typicalVisits: 20, p75Visits: 32, maxEpisodeVisits: 48, cpgCitation: "AOTA CPG Stroke Rehab (2022)" },
    },
  },
  {
    caseId: "SYNTH-005",
    memberName: "Riley Chen",
    memberId: "MBR-50817",
    dob: "06/14/2019",
    discipline: "ST",
    reviewType: "initial",
    submittedAt: "2026-05-22T11:00:00Z",
    documents: [{ name: "ST_IE_Chen_05192026.pdf", type: "Initial Evaluation", date: "05/19/2026" }],
    contract: {
      extraction: {
        rom: {}, mmt: {},
        painCurrent: null,
        functionalOutcomeScore: null,
        goals: [
          "Increase receptive vocabulary age equivalency by 6 months within 12 wks",
          "Produce 3-word utterances spontaneously in structured context within 16 wks",
        ],
        poc: "3x/week × 12 weeks",
        diagnosisCodes: ["F80.2"],
        primaryDiagnosisCode: "F80.2",
        primaryDiagnosis: "Mixed receptive-expressive language disorder",
        requestedVisits: 32,
        requestedFrequency: "3x/week × 12 weeks",
        severity: "severe",
        functionalLimitations: [
          "Unable to follow 2-step directions", "Expressive vocabulary <50 words at age 7",
          "Significant classroom participation deficit",
        ],
        documentationQuality: {
          hasEvalDate: true, hasDiagnosisCodes: true, hasObjectiveMeasures: true,
          hasFunctionalLimitations: true, hasGoals: true, hasPOC: true,
          hasStandardizedOutcomeMeasure: true, goalsMeasurable: true,
          goalsFunctional: true, goalsHaveTimeframes: true, hasHEP: false,
        },
        sopIndicators: ["Structured language therapy", "AAC device training", "Parent education"],
        goalsTotal: 2, goalsMet: 0, visitsToDate: 0,
        standardizedScores: { "CELF-5 Core Language": 64, "PLS-5 Auditory Comprehension": 62 },
        languageAgeEquivalent: "2y 4m (chronological age: 7y 0m)",
        swallowingFindings: null,
        dysphagiaSeverity: null,
      },
      assessment: {
        d1: { finding: "FULLY_ESTABLISHED", reasoning: "CELF-5 SS 64 (severe); significant receptive/expressive language delay; skilled ST criteria met." },
        d2: { finding: "FULLY_ALIGNED", supportedFreq: 3, supportedDuration: 12, supportedVisits: 36, pocMaxVisits: 32, reasoning: "3x/week within ASHA CPG benchmark for severe mixed language disorder." },
        d3: { finding: "COMPLETE", gaps: [], notes: [] },
      },
      recommendation: {
        determination: "Approved",
        approvedVisits: 32, frequency: 3, durationWeeks: 12,
        criteria: [
          "CELF-5 SS 64 / PLS-5 AC SS 62 (both severe range, <70)",
          "Language age equivalent 2y 4m vs. chronological age 7y 0m",
          "Skilled: Structured language therapy, AAC training, parent education",
          "ASHA CPG Language Disorders (2021): benchmark typical 20 visits (p75: 36)",
        ],
        rationale: "Approved — Skilled ST is supported for mixed receptive-expressive language disorder (F80.2). CELF-5 Core Language SS of 64 indicates severe impairment with language age equivalent 2y 4m vs. chronological age 7y 0m. Per ASHA CPG, 3x/week is supported for severe presentation. Approving 32 visits at 3x/week × 12 weeks.",
        confidence: "high",
        autoApprovalEligible: false,
      },
      cpgInfo: { diagCode: "F80.2", conditionLabel: "Mixed receptive-expressive language disorder (ST)", typicalVisits: 20, p75Visits: 36, maxEpisodeVisits: 52, cpgCitation: "ASHA CPG Language Disorders (2021)" },
    },
  },
];

// ── POST-APPROVAL OPTIONS ──────────────────────────────────────────────────────
const APPROVE_OPTIONS = [
  "Transition to Home Exercise Program (HEP) upon discharge",
  "Taper treatment frequency in upcoming visits",
  "Emphasize skilled intervention documentation for future reviews",
  "Progress to functional activity training",
  "Recommend maintenance/wellness program post-discharge",
  "Patient education re: self-management techniques",
  "Reassess goals at next visit for continued necessity",
  "Consider referral to specialist if plateau is reached",
  "Coordinate with PCP regarding long-term plan",
  "Update outcome measures at next visit",
];

// ── SUBMISSION CONTRACT ────────────────────────────────────────────────────────
function buildSubmissionContract(sub) {
  const diags = sub.diagnosis_codes || [];
  return {
    extraction: {
      rom: {}, mmt: {}, painCurrent: null, functionalOutcomeScore: null,
      goals: [], poc: null,
      diagnosisCodes:       diags,
      primaryDiagnosisCode: diags[0] || null,
      primaryDiagnosis:     null,
      requestedVisits:      sub.requested_visits || null,
      requestedFrequency:   null, severity: null, functionalLimitations: [],
      documentationQuality: {}, sopIndicators: [],
      goalsTotal: 0, goalsMet: null, visitsToDate: 0,
    },
    assessment: {
      d1: { finding: "PENDING_REVIEW", reasoning: "Provider submission — manual document review required." },
      d2: { finding: "PENDING_REVIEW", supportedFreq: null, supportedDuration: null, supportedVisits: null, pocMaxVisits: null, reasoning: "" },
      d3: { finding: "PENDING_REVIEW", gaps: [], notes: ["Documents listed but not yet extracted."] },
    },
    recommendation: {
      determination: "Pend",
      approvedVisits: 0, frequency: null, durationWeeks: null,
      criteria: [
        `Provider: ${sub.provider_name || "Unknown"}`,
        `Requested: ${sub.requested_visits || 0} visits`,
        `Dx: ${diags.join(", ") || "Not specified"}`,
        "Manual document review required.",
      ],
      rationale: `Provider submission from ${sub.provider_name || "unknown provider"} — pending manual document review. Documents listed: ${(sub.document_list || []).join(", ") || "none"}.`,
      confidence: "low",
      autoApprovalEligible: false,
    },
    cpgInfo: null,
  };
}

// ── FALLBACK CONTRACT ──────────────────────────────────────────────────────────
function buildFallbackContract(metrics, ruling) {
  const m  = metrics  || {};
  const r  = ruling   || {};
  const dd = r.domainDetails || {
    d1: { finding: "UNKNOWN", reasoning: "" },
    d2: { finding: "UNKNOWN", supportedFreq: null, supportedDuration: null, supportedVisits: null, pocMaxVisits: null, reasoning: "" },
    d3: { finding: "UNKNOWN", gaps: [], notes: [] },
  };
  return {
    extraction: {
      rom:                    m.rom                    || {},
      romNormals:             {},
      mmt:                    m.mmt                    || {},
      painCurrent:            m.painCurrent            || null,
      functionalOutcomeScore: m.functionalOutcomeScore || null,
      goals:                  m.goalsText              || [],
      poc:                    m.poc                    || null,
      diagnosisCodes:         m.diagnosisCodes         || [],
      primaryDiagnosisCode:   m.primaryDiagnosisCode   || null,
      primaryDiagnosis:       m.primaryDiagnosis       || null,
      requestedVisits:        m.requestedVisits        || null,
      requestedFrequency:     m.requestedFrequency     || null,
      severity:               r.severity               || null,
      functionalLimitations:  m.functionalLimitations  || [],
      documentationQuality:   m.documentationQuality   || {},
      sopIndicators:          m.sopIndicators          || [],
      goalsTotal:             m.goalsTotal ?? (m.goalsText || []).length,
      goalsMet:               m.goalsMet   ?? 0,
      // Same source the note builder reads, so the VTD badge can't disagree
      // with the note even when the engine is offline.
      visitsToDate:           m.visitsToDate != null ? m.visitsToDate : 0,
      documentType:           m.documentType   || null,
      dateOfService:          m.dateOfService  || null,
      evaluationDate:         m.evaluationDate || null,
    },
    assessment: {
      d1: { finding: dd.d1.finding, reasoning: dd.d1.reasoning || "" },
      d2: {
        finding:           dd.d2.finding,
        supportedFreq:     dd.d2.supportedFreq     || null,
        supportedDuration: dd.d2.supportedDuration || null,
        supportedVisits:   dd.d2.supportedVisits   || null,
        pocMaxVisits:      dd.d2.pocMaxVisits       || null,
        reasoning:         dd.d2.reasoning          || "",
      },
      d3: { finding: dd.d3.finding, gaps: dd.d3.gaps || [], notes: dd.d3.notes || [] },
    },
    recommendation: {
      determination:        r.determination   || "Pend",
      approvedVisits:       r.visitsApproved  || 0,
      // Same fields the live /v1/evaluate contract carries (see ISSUE 2 FIX) — read
      // straight off the ruling, never recomputed, so the chip/comparison stay
      // consistent even when the engine is offline and this fallback is in use.
      frequency:            r.approvedFrequency     ?? null,
      durationWeeks:        r.approvedDurationWeeks ?? null,
      criteria:             [],
      rationale:            r.determinationLine || "Engine offline — determination from prior form review.",
      confidence:           "low",
      autoApprovalEligible: false,
    },
    cpgInfo: r.cpgInfo || null,
  };
}

// ── PLANS FETCH ────────────────────────────────────────────────────────────────
async function fetchPlans(setPlans) {
  const token = localStorage.getItem("cogentus_token") || "";
  if (!token) return;
  try {
    const r = await fetch(`${API_BASE}/v1/plans`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    setPlans(data.plans || []);
  } catch {
    // best-effort; cockpit works without plans
  }
}

// ── SUBMISSIONS FETCH ──────────────────────────────────────────────────────────
async function fetchSubmissions(setSubmissions) {
  const token = localStorage.getItem("cogentus_token") || "";
  if (!token) return;
  try {
    const r = await fetch(`${API_BASE}/v1/submissions`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    setSubmissions(data.submissions || []);
  } catch {
    setSubmissions([]);
  }
}

// ── AUDIT LOG FETCH ────────────────────────────────────────────────────────────
async function fetchAuditEvents(setAuditLog, setAuditLogLoading) {
  const token = localStorage.getItem("cogentus_token") || "";
  if (!token) return;
  setAuditLogLoading(true);
  try {
    const r = await fetch(`${API_BASE}/v1/audit-events?limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const data = await r.json();
    setAuditLog(data.events || []);
  } catch {
    setAuditLog(null); // null signals fetch error
  } finally {
    setAuditLogLoading(false);
  }
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
function detColors(determination) {
  if (!determination) return { bg: "#f3f4f6", text: "#374151", border: "#d1d5db", glow: "transparent" };
  const d = determination.toLowerCase();
  if (d.startsWith("approved"))     return { bg: "#dcfce7", text: "#15803d", border: "#86efac", glow: "#22c55e33" };
  if (d.startsWith("partial"))      return { bg: "#fef3c7", text: "#92400e", border: "#fcd34d", glow: "#f59e0b33" };
  if (d.startsWith("full denial"))  return { bg: "#fee2e2", text: "#991b1b", border: "#fca5a5", glow: "#ef444433" };
  if (d.startsWith("pend"))         return { bg: "#eff6ff", text: "#1d4ed8", border: "#93c5fd", glow: "#3b82f633" };
  return { bg: "#f3f4f6", text: "#374151", border: "#d1d5db", glow: "transparent" };
}

function domainColors(finding) {
  if (!finding || finding === "UNKNOWN" || finding === "PENDING_REVIEW") return { bg: "#f3f4f6", text: "#6b7280" };
  if (finding.startsWith("FULLY") || finding === "COMPLETE") return { bg: "#dcfce7", text: "#166534" };
  if (finding.includes("ESTABLISHED") || finding.includes("ALIGNED")) return { bg: "#dcfce7", text: "#166534" };
  if (finding === "INCOMPLETE" || finding.includes("PARTIALLY")) return { bg: "#fef3c7", text: "#92400e" };
  return { bg: "#fee2e2", text: "#991b1b" };
}

function domainLabel(key, finding) {
  const short = finding
    .replace("FULLY_", "").replace("NOT_ESTABLISHED_", "").replace(/_/g, " ")
    .toLowerCase().replace(/^\w/, c => c.toUpperCase());
  const labels = { d1: "D1 Clinical", d2: "D2 Evidence", d3: "D3 Docs" };
  return { key: labels[key] || key.toUpperCase(), finding: short };
}

function confidenceStyle(c) {
  if (c === "high")     return { color: "#15803d", label: "HIGH" };
  if (c === "moderate") return { color: "#92400e", label: "MED" };
  return { color: "#6b7280", label: "LOW" };
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function disciplineColor(d) {
  if (d === "OT") return { bg: "#fff7ed", text: "#c2410c", border: "#fdba74" };
  if (d === "ST") return { bg: "#f0fdf4", text: "#15803d", border: "#86efac" };
  return { bg: "#eff6ff", text: NAVY, border: "#93c5fd" };
}

function disciplineLabel(d, rt) {
  const disc = d || "PT";
  const type = rt === "subsequent" ? "SUB" : "IE";
  return `${disc} · ${type}`;
}

// ── LOADING PULSE ──────────────────────────────────────────────────────────────
function LoadingPulse({ label }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 24px" }}>
      <div style={{
        width: 28, height: 28,
        border: "2.5px solid #e2e8f0", borderTop: `2.5px solid ${NAVY}`,
        borderRadius: "50%", animation: "rn-spin 0.8s linear infinite",
        margin: "0 auto 14px",
      }} />
      <div style={{ fontSize: 12, color: "#64748b", fontFamily: FONTS.body }}>{label}</div>
    </div>
  );
}

// ── KEYBOARD HINT CHIP ─────────────────────────────────────────────────────────
function KbdChip({ k, label, style }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, ...style }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 20, height: 20, borderRadius: 4,
        background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.3)",
        fontSize: 11, fontWeight: 700, color: "#fff", fontFamily: FONTS.body, flexShrink: 0,
      }}>{k}</span>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", fontFamily: FONTS.body }}>{label}</span>
    </span>
  );
}

// ── ZONE HEADER ────────────────────────────────────────────────────────────────
function ZoneHeader({ title }) {
  return (
    <div style={{ padding: "12px 20px 11px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", position: "sticky", top: 0, zIndex: 1 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
        textTransform: "uppercase", color: "#64748b", fontFamily: FONTS.body,
      }}>{title}</span>
    </div>
  );
}

// ── EVIDENCE ZONE ──────────────────────────────────────────────────────────────
/**
 * A comparison object from the engine is keyed by SIDE, not by measure:
 *   { current: {joint: val}, prior: {joint: val}, change: {joint: val} }
 * Flatten it to one row per measure so a table can render it. Rows are driven by
 * `current` (what the note shows now), with any measure that exists only in
 * `prior` appended so a dropped measurement is visible rather than silently gone.
 */
function comparisonRows(cmp) {
  if (!cmp || typeof cmp !== "object") return [];
  const current = cmp.current && typeof cmp.current === "object" ? cmp.current : {};
  const prior   = cmp.prior   && typeof cmp.prior   === "object" ? cmp.prior   : {};
  const change  = cmp.change  && typeof cmp.change  === "object" ? cmp.change  : {};
  // Prior-only keys must be matched the same normalized way, or a casing variant
  // of a measure already in `current` gets appended as a duplicate row.
  const keys = [
    ...Object.keys(current),
    ...Object.keys(prior).filter(k => valueFor(current, k) === undefined),
  ];
  return keys.map(key => ({
    key,
    current: current[key],
    prior:   valueFor(prior, key),
    change:  valueFor(change, key),
  }));
}

/** Case- and whitespace-insensitive key lookup — extraction's key casing varies between calls. */
function valueFor(obj, key) {
  if (!obj || typeof obj !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  const norm = s => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();
  const target = norm(key);
  for (const [k, v] of Object.entries(obj)) if (norm(k) === target) return v;
  return undefined;
}

/** "4+/5" → 4.5, "4-/5" → 3.5, "4/5" → 4. Matches the engine's avgMMT convention. */
function mmtGradeNum(g) {
  const m = String(g == null ? "" : g).match(/(\d+)([+-]?)/);
  if (!m) return null;
  return parseFloat(m[1]) + (m[2] === "+" ? 0.5 : m[2] === "-" ? -0.5 : 0);
}

/** "LEFS 36/80" → 36, "36/80" → 36, 36 → 36. Numerator only. */
function scoreNum(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).match(/(-?\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

// ── PROGRESS COMPARISON (subsequent reviews) ───────────────────────────────────
/** Punctuation-insensitive key lookup — the backend's normalizeKey convention. */
function valueForLoose(obj, key) {
  const direct = valueFor(obj, key);
  if (direct !== undefined || !obj || typeof obj !== "object") return direct;
  const norm = s => String(s == null ? "" : s).toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const target = norm(key);
  for (const [k, v] of Object.entries(obj)) if (norm(k) === target) return v;
  return undefined;
}

/**
 * One row per measure from a {current, prior, change} comparison. Fills in
 * whichever of prior/change the extraction left out when the other two sides
 * are numeric, so a row never shows a dash for a value that is derivable.
 */
function progressRows(cmp) {
  if (!cmp || typeof cmp !== "object") return [];
  const current = cmp.current && typeof cmp.current === "object" ? cmp.current : {};
  const prior   = cmp.prior   && typeof cmp.prior   === "object" ? cmp.prior   : {};
  const change  = cmp.change  && typeof cmp.change  === "object" ? cmp.change  : {};
  const keys = [
    ...Object.keys(current),
    ...Object.keys(prior).filter(k => valueForLoose(current, k) === undefined),
  ];
  return keys.map(key => {
    const cur = current[key] !== undefined ? current[key] : valueForLoose(current, key);
    let pri = valueForLoose(prior, key);
    let chg = valueForLoose(change, key);
    const curN = scoreNum(cur), priN = scoreNum(pri), chgN = scoreNum(chg);
    if (pri == null && curN != null && chgN != null) pri = curN - chgN;
    if (chg == null && curN != null && priN != null) chg = curN - priN;
    return { key, current: cur, prior: pri, change: chg };
  });
}

/** "5/10 with stair descent, 2/10 at rest" → [{rating: 5, context: "with stair descent"}, …] */
function painContexts(str) {
  if (str == null || str === "") return [];
  const out = [];
  for (const part of String(str).split(/[;,]|\band\b/i)) {
    const m = part.match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
    if (!m) continue;
    const context = part.replace(m[0], "").replace(/\b(pain|nprs|nrs|vas)\b\s*:?/ig, "")
      .replace(/^[\s\-–—:()]+|[\s\-–—:().]+$/g, "").trim();
    out.push({ rating: parseFloat(m[1]), context });
  }
  return out;
}

/**
 * Append measures the extraction reported currently but did not put in the
 * comparison, so a documented value still renders with an empty baseline rather
 * than vanishing. Comparison objects go missing for real reasons — a progress
 * note uploaded with no IE and no stored baseline to assemble one from, or an
 * extraction run that returned current values only — and the reviewer needs to
 * see today's measurement either way. The engine reads `rom`/`mmt` in exactly
 * the same situation, so hiding them here contradicted the determination.
 */
function withCurrentOnly(rows, currentMap) {
  if (!currentMap || typeof currentMap !== "object") return rows;
  const out = rows.slice();
  for (const [key, value] of Object.entries(currentMap)) {
    if (value == null) continue;
    if (out.some(r => valueForLoose({ [r.key]: true }, key) !== undefined)) continue;
    out.push({ key, current: value, prior: null, change: null });
  }
  return out;
}

/** Half-grade MMT change: 0.5 → "+½", 1 → "+1", 1.5 → "+1½", 0 → "—". */
function mmtHalfSteps(delta) {
  if (delta == null || Number.isNaN(delta)) return null;
  const steps = Math.round(delta * 2);
  if (steps === 0) return "—";
  const whole = Math.floor(Math.abs(steps) / 2), half = Math.abs(steps) % 2 === 1;
  return (steps > 0 ? "+" : "−") + (whole ? whole : "") + (half ? "½" : "");
}

const GOAL_STATUS = {
  "met":           { icon: "✓", color: "#15803d" },
  "partially met": { icon: "◐", color: "#b45309" },
  "not met":       { icon: "✗", color: "#dc2626" },
  "not addressed": { icon: "?", color: "#94a3b8" },
};

/**
 * Absence is a finding. Every measure section used to omit itself when it had
 * no data, so a reviewer could not tell "the therapist documented no ROM" from
 * "our extraction lost the ROM" — the panel looked identical either way, and a
 * dropped field reached a determination unnoticed. Saying so costs one line and
 * makes the gap visible where the measurement would have been.
 */
function NotDocumented({ what, docNoun }) {
  return (
    <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: FONTS.body, fontStyle: "italic" }}>
      No {what} documented in this {docNoun}.
    </div>
  );
}

/**
 * Which measures a discipline is expected to document. A speech evaluation has
 * no range of motion or manual muscle testing by design, so calling out their
 * absence there would be noise rather than a finding.
 */
const EXPECTED_MEASURES = {
  PT: ["pain", "rom", "mmt", "outcome"],
  OT: ["pain", "rom", "mmt", "outcome"],
  ST: ["outcome"],
};
function expectsMeasure(discipline, key) {
  return (EXPECTED_MEASURES[discipline] || EXPECTED_MEASURES.PT).includes(key);
}

function ProgressComparison({ kase }) {
  const ex        = kase.contract.extraction || {};
  const hpi       = kase.contract.hpiData || {};
  const label     = { fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body };
  const th        = { textAlign: "left", padding: "3px 6px", fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: FONTS.body };
  const tdName    = { padding: "4px 6px", color: "#374151", fontFamily: FONTS.body };
  const tdBase    = { padding: "4px 6px", color: "#6b7280", fontFamily: FONTS.body };
  const tdCur     = { padding: "4px 6px", fontWeight: 600, color: "#1e293b", fontFamily: FONTS.body };
  const tdChange  = d => ({ padding: "4px 6px", fontWeight: 700, fontFamily: FONTS.body, color: d > 0 ? "#15803d" : d < 0 ? "#dc2626" : "#6b7280" });
  const deg       = v => v == null ? "—" : (typeof v === "number" ? `${v}°` : String(v));

  // ── Header line ──────────────────────────────────────────────────────
  const ieDate  = ex.evaluationDate || hpi.ieDate || null;
  const pnDate  = ex.dateOfService || null;
  const pnLabel = ex.documentType && ex.documentType !== "IE" ? ex.documentType : "PN";
  const vtd     = ex.visitsToDate != null ? ex.visitsToDate : 0;

  // ── Pain ─────────────────────────────────────────────────────────────
  const painRows = (() => {
    const cur = painContexts(ex.painCurrent), base = painContexts(ex.painPrior);
    const norm = s => String(s || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    if (cur.length === 0 && base.length === 0) {
      return (ex.painCurrent || ex.painPrior)
        ? [{ context: "", baseline: ex.painPrior ?? null, current: ex.painCurrent ?? null, delta: null }]
        : [];
    }
    const usedBase = new Set();
    const rows = cur.map((c, i) => {
      let bi = base.findIndex((b, j) => !usedBase.has(j) && norm(b.context) === norm(c.context));
      if (bi === -1 && cur.length === 1 && base.length === 1) bi = 0;
      if (bi !== -1) usedBase.add(bi);
      const b = bi !== -1 ? base[bi] : null;
      return { context: c.context || (b && b.context) || "", baseline: b ? `${b.rating}/10` : null, current: `${c.rating}/10`, delta: b ? c.rating - b.rating : null };
    });
    base.forEach((b, j) => { if (!usedBase.has(j)) rows.push({ context: b.context, baseline: `${b.rating}/10`, current: null, delta: null }); });
    return rows;
  })();

  // ── ROM ──────────────────────────────────────────────────────────────
  const romRows = withCurrentOnly(progressRows(ex.romComparison), ex.rom);

  // ── MMT ──────────────────────────────────────────────────────────────
  // Muscles graded in the note but absent from the comparison (typically the
  // contralateral side) still count as assessed.
  const { mmtRows, unaffected } = (() => {
    const rows = withCurrentOnly(progressRows(ex.mmtComparison), ex.mmt);
    const isFull = g => mmtGradeNum(g) === 5;
    const unaffected = [], kept = [];
    for (const r of rows) {
      const pn = mmtGradeNum(r.prior), cn = mmtGradeNum(r.current);
      const unchanged = r.prior == null ? true : (pn != null && cn != null && pn === cn);
      if (unchanged && isFull(r.current) && (r.prior == null || isFull(r.prior))) unaffected.push(r.key);
      else kept.push({ ...r, delta: r.change != null ? scoreNum(r.change) : (pn != null && cn != null ? cn - pn : null) });
    }
    return { mmtRows: kept, unaffected };
  })();

  // ── Outcome ──────────────────────────────────────────────────────────
  const outcome = (() => {
    const oc = ex.outcomeComparison;
    const current = oc && oc.current != null ? String(oc.current) : (ex.functionalOutcomeScore ? String(ex.functionalOutcomeScore) : null);
    if (!current) return null;
    const toolMatch = current.match(/^([A-Za-z][A-Za-z0-9\-\s]*?)\s*(?=[\d(])/);
    const tool = toolMatch ? toolMatch[1].trim() : null;
    const strip = s => tool ? String(s).replace(new RegExp("^" + tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "i"), "").trim() : String(s);
    const prior = oc && oc.prior != null ? String(oc.prior) : null;
    const change = oc && oc.change != null ? scoreNum(oc.change)
      : (prior != null && scoreNum(current) != null && scoreNum(prior) != null ? scoreNum(current) - scoreNum(prior) : null);
    return { tool, baseline: prior != null ? strip(prior) : null, current: strip(current), change };
  })();

  // ── Goals ────────────────────────────────────────────────────────────
  const goals = (() => {
    const fromBaseline = kase.contract.baseline && Array.isArray(kase.contract.baseline.goals) ? kase.contract.baseline.goals : null;
    if (fromBaseline && fromBaseline.length > 0) {
      return fromBaseline.map(g => ({ text: g.text, status: String(g.status || "not addressed").toLowerCase(), evidence: g.evidence || null }));
    }
    return (ex.goals || []).map(g => ({ text: g, status: "not addressed", evidence: null }));
  })();
  const goalsTotal = goals.length;
  const goalsMet   = ex.goalsMet != null ? ex.goalsMet : goals.filter(g => g.status === "met").length;

  const fx = ex.functionalLimitations || [];
  const showRule = { marginBottom: 12 };
  const expects  = k => expectsMeasure(kase.discipline, k);
  const absent   = what => <NotDocumented what={what} docNoun="progress note" />;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: NAVY, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10, fontFamily: FONTS.body }}>
        Progress · IE {ieDate || "—"} → {pnLabel} {pnDate || "—"} · {vtd} {vtd === 1 ? "visit" : "visits"} delivered
      </div>

      {(painRows.length > 0 || expects("pain")) && (
        <div style={showRule}>
          <div style={label}>Pain</div>
          {painRows.length === 0 && absent("pain rating")}
          {painRows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, fontFamily: FONTS.body, marginBottom: 2 }}>
              {r.context && <span style={{ color: "#374151", minWidth: 110 }}>{r.context}</span>}
              <span style={{ color: "#6b7280" }}>{r.baseline ?? "—"}</span>
              <span style={{ color: "#9ca3af", fontSize: 11 }}>→</span>
              <span style={{ color: "#1e293b", fontWeight: 600 }}>{r.current ?? "—"}</span>
              {r.delta != null && (
                <span style={{ fontWeight: 700, color: r.delta < 0 ? "#15803d" : r.delta > 0 ? "#dc2626" : "#6b7280" }}>
                  {r.delta < 0 ? `↓${Math.abs(r.delta)}` : r.delta > 0 ? `↑${r.delta}` : "—"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {(romRows.length > 0 || expects("rom")) && (
        <div style={showRule}>
          <div style={label}>ROM</div>
          {romRows.length === 0 ? absent("range of motion") : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Movement", "Baseline", "Current", "Change"].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {romRows.map(({ key, prior, current, change }) => {
                const d = scoreNum(change);
                return (
                  <tr key={key} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={tdName}>{key}</td>
                    <td style={tdBase}>{deg(prior)}</td>
                    <td style={tdCur}>{deg(current)}</td>
                    <td style={tdChange(d)}>{d == null ? "—" : `${d > 0 ? "+" : ""}${d}°`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
      )}

      {(mmtRows.length > 0 || unaffected.length > 0 || expects("mmt")) && (
        <div style={showRule}>
          <div style={label}>MMT</div>
          {mmtRows.length === 0 && unaffected.length === 0 && absent("manual muscle testing")}
          {mmtRows.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Muscle", "Baseline", "Current", "Change"].map(h => <th key={h} style={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {mmtRows.map(({ key, prior, current, delta }) => (
                  <tr key={key} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={tdName}>{key}</td>
                    <td style={{ ...tdBase, fontFamily: "monospace" }}>{prior == null ? "—" : String(prior)}</td>
                    <td style={{ ...tdCur, fontFamily: "monospace" }}>{current == null ? "—" : String(current)}</td>
                    <td style={tdChange(delta)}>{mmtHalfSteps(delta) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {unaffected.length > 0 && (
            <div style={{ fontSize: 11, color: "#6b7280", fontFamily: FONTS.body, marginTop: 4 }}>
              Unaffected side: {unaffected.join(", ")} 5/5
            </div>
          )}
        </div>
      )}

      {(outcome || expects("outcome")) && (
        <div style={showRule}>
          <div style={label}>Outcome</div>
          {!outcome ? absent("standardized outcome measure") : (
          <div style={{ fontSize: 12, fontFamily: FONTS.body, display: "flex", gap: 8, alignItems: "baseline" }}>
            {outcome.tool && <span style={{ color: "#374151", fontWeight: 600 }}>{outcome.tool}</span>}
            <span style={{ color: "#6b7280" }}>{outcome.baseline ?? "—"}</span>
            <span style={{ color: "#9ca3af", fontSize: 11 }}>→</span>
            <span style={{ color: "#1e293b", fontWeight: 600 }}>{outcome.current}</span>
            {outcome.change != null && (
              <span style={{ fontWeight: 700, color: outcome.change > 0 ? "#15803d" : outcome.change < 0 ? "#dc2626" : "#6b7280" }}>
                {outcome.change > 0 ? `+${outcome.change}` : outcome.change}
              </span>
            )}
          </div>
          )}
        </div>
      )}

      <div style={showRule}>
        <div style={label}>Goals — {goalsMet} of {goalsTotal} met</div>
        {goalsTotal === 0 ? (
          <div style={{ padding: "8px 10px", background: "#fef3c7", borderRadius: 6, border: "1px solid #fcd34d" }}>
            <span style={{ fontSize: 12, color: "#92400e", fontFamily: FONTS.body }}>No treatment goals documented</span>
          </div>
        ) : goals.map((g, i) => {
          const s = GOAL_STATUS[g.status] || GOAL_STATUS["not addressed"];
          const detail = g.evidence && g.evidence.toLowerCase() !== g.status ? g.evidence : null;
          return (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 3, alignItems: "flex-start" }}>
              <span title={g.status} style={{ color: s.color, fontSize: 11, marginTop: 2, flexShrink: 0, width: 10, textAlign: "center" }}>{s.icon}</span>
              <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.4, fontFamily: FONTS.body }}>
                {g.text}{detail && <span style={{ color: "#6b7280" }}> — {detail}</span>}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ marginBottom: 0 }}>
        <div style={label}>Remaining functional limitations</div>
        {fx.length === 0 ? absent("functional limitations") : (
          <>{fx.map((lim, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 3, alignItems: "flex-start" }}>
              <span style={{ color: "#dc2626", fontSize: 11, marginTop: 2, flexShrink: 0 }}>✕</span>
              <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.4, fontFamily: FONTS.body }}>{lim}</span>
            </div>
          ))}</>
        )}
      </div>
    </div>
  );
}

function EvidenceZone({ kase, onToggleDocs, showDocs }) {
  const [inlineDocs, setInlineDocs]       = React.useState(kase.documents || []);
  const [inlineDocsReady, setInlineDo]    = React.useState(false);

  React.useEffect(() => {
    setInlineDocs(kase.documents || []);
    setInlineDo(false);
    const realId = kase.submissionId || kase.caseId;
    if (!realId || realId.startsWith("SYNTH") || realId.startsWith("SUB-")) { setInlineDo(true); return; }
    const token = localStorage.getItem("cogentus_token") || "";
    if (!token) { setInlineDo(true); return; }
    fetch(`${API_BASE}/v1/submissions/${realId}/documents`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.documents) setInlineDocs(data.documents); })
      .catch(() => {})
      .finally(() => setInlineDo(true));
  }, [kase.caseId]); // eslint-disable-line

  if (!kase.contract) {
    return (
      <div>
        <ZoneHeader title="Clinical Evidence" />
        <div style={{ padding: "16px 20px" }}>
          <LoadingPulse label="Awaiting engine response..." />
        </div>
      </div>
    );
  }

  const ex          = kase.contract.extraction;
  const rec         = kase.contract.recommendation;
  // Subsequent reviews get the unified baseline→current comparison in place of
  // the current-only blocks; initial reviews keep the layout below unchanged.
  const isSubsequent = kase.reviewType === "subsequent" || kase.contract.reviewType === "subsequent";
  const hasROM      = ex.rom && Object.keys(ex.rom).length > 0;
  const hasMMT      = ex.mmt && Object.keys(ex.mmt).length > 0;
  // Guard on actual rows, not on the wrapper's key count — a comparison object
  // always has current/prior/change keys, so the old check passed even when every
  // one of them was empty and the table rendered nothing but headers.
  const romCompRows = comparisonRows(ex.romComparison);
  const mmtCompRows = comparisonRows(ex.mmtComparison);
  const hasROMComp  = romCompRows.length > 0;
  const hasMMTComp  = mmtCompRows.length > 0;
  const hasOutComp  = !!(ex.outcomeComparison &&
                        (ex.outcomeComparison.current != null || ex.outcomeComparison.prior != null));
  const hasProgress = hasROMComp || hasMMTComp || hasOutComp || !!ex.painPrior;
  const isOT        = kase.discipline === "OT";
  const isST        = kase.discipline === "ST";
  const hasFIM      = isOT && ex.fim != null;
  const hasADL      = isOT && ex.adlLevels && Object.keys(ex.adlLevels).length > 0;
  const hasScores   = isST && ex.standardizedScores && Object.keys(ex.standardizedScores).length > 0;
  const OT_COLOR    = "#c2410c";
  const ST_COLOR    = "#15803d";

  // Detect cases where no clinical metrics were extracted (form-only submission, no PDF processed)
  const hasAnyClinicalData = hasROM || hasMMT || ex.painCurrent || hasFIM || hasADL || hasScores
    || (ex.functionalLimitations && ex.functionalLimitations.length > 0)
    || (ex.goals && ex.goals.length > 0);
  const docs = kase.documents || [];

  const sevColor = rec.confidence === "high" ? "#15803d"
    : rec.determination.toLowerCase().startsWith("pend") ? "#1d4ed8" : "#92400e";

  return (
    <div>
      <ZoneHeader title="Clinical Evidence" />
      <div style={{ padding: "16px 20px" }}>

        <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #f1f5f9" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: NAVY, fontFamily: FONTS.heading, lineHeight: 1.2 }}>
            {kase.memberName}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#64748b", fontFamily: FONTS.body }}>DOB {kase.dob}</span>
            <span style={{ fontSize: 11, color: "#cbd5e1" }}>·</span>
            <span style={{ fontSize: 11, color: "#64748b", fontFamily: FONTS.body }}>{kase.memberId}</span>
            <span style={{ fontSize: 11, color: "#cbd5e1" }}>·</span>
            <span style={{ fontSize: 11, color: "#64748b", fontFamily: FONTS.body }}>{disciplineLabel(kase.discipline, kase.reviewType)}</span>
          </div>
          <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: NAVY, fontFamily: "monospace" }}>{ex.primaryDiagnosisCode}</span>
            <span style={{ fontSize: 12, color: "#374151", fontFamily: FONTS.body }}>{ex.primaryDiagnosis}</span>
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
              background: sevColor + "18", color: sevColor, fontFamily: FONTS.body,
              textTransform: "uppercase", letterSpacing: "0.06em",
            }}>{ex.severity || "—"}</span>
            <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: FONTS.body }}>{ex.visitsToDate || 0} VTD</span>
          </div>
        </div>

        {/* Form submission data — shown when no PDF clinical metrics were extracted */}
        {!hasAnyClinicalData && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ padding: "10px 14px", borderRadius: 8, border: "1.5px dashed #c7d2fe", background: "#eef2ff", marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#4338ca", fontFamily: FONTS.body, marginBottom: 2 }}>No clinical metrics extracted from PDF</div>
              <div style={{ fontSize: 10, color: "#6366f1", fontFamily: FONTS.body, lineHeight: 1.5 }}>
                Showing submitted form data below. Upload clinical documents for objective findings (ROM, MMT, pain).
              </div>
            </div>

            {/* Submitted form fields as structured evidence rows */}
            {(() => {
              const rows = [];
              const addRow = (label, value) => { if (value) rows.push({ label, value }); };
              addRow("Member Name",   kase.memberName);
              addRow("Member ID",     kase.memberId);
              addRow("Date of Birth", kase.dob);
              addRow("Discipline",    kase.discipline);
              addRow("Review Type",   kase.reviewType);
              addRow("Provider",      kase.providerName);
              addRow("Requested Visits", kase.requestedVisits != null ? String(kase.requestedVisits) : null);
              const diagCodes = (ex.diagnosisCodes || kase.diagnosisCodes || []);
              if (diagCodes.length > 0) addRow("Diagnosis Codes", diagCodes.join(", "));
              addRow("Provider Notes", kase.providerNotes);
              return rows.length > 0 ? (
                <div style={{ borderRadius: 7, border: "1px solid #e2e8f0", overflow: "hidden" }}>
                  {rows.map(({ label, value }, i) => (
                    <div key={label} style={{
                      display: "flex", gap: 8, padding: "7px 12px",
                      background: i % 2 === 0 ? "#f8fafc" : "#fff",
                      borderBottom: i < rows.length - 1 ? "1px solid #f1f5f9" : "none",
                    }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: FONTS.body, minWidth: 110, flexShrink: 0, paddingTop: 1 }}>{label}</span>
                      <span style={{ fontSize: 11, color: "#1e293b", fontFamily: FONTS.body, lineHeight: 1.5, wordBreak: "break-word" }}>{value}</span>
                    </div>
                  ))}
                </div>
              ) : null;
            })()}

            {/* Document list */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: FONTS.body, marginBottom: 4 }}>Submitted Documents</div>
              {docs.length > 0 ? docs.map((d, i) => (
                <div key={i} style={{ fontSize: 11, color: "#374151", fontFamily: FONTS.body, padding: "2px 0" }}>
                  · {typeof d === "string" ? d : d.name || "Unnamed document"}
                </div>
              )) : (
                <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: FONTS.body, fontStyle: "italic" }}>No documents listed</div>
              )}
            </div>
          </div>
        )}

        {isSubsequent && hasAnyClinicalData && <ProgressComparison kase={kase} />}

        {!isSubsequent && <>
        {(ex.painCurrent || expectsMeasure(kase.discipline, "pain")) && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4, fontFamily: FONTS.body }}>Pain</div>
            {ex.painCurrent
              ? <div style={{ fontSize: 14, color: "#1e293b", fontFamily: FONTS.body }}>{ex.painCurrent}</div>
              : <NotDocumented what="pain rating" docNoun="evaluation" />}
          </div>
        )}

        {!hasROM && expectsMeasure(kase.discipline, "rom") && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>ROM</div>
            <NotDocumented what="range of motion" docNoun="evaluation" />
          </div>
        )}

        {hasROM && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>ROM</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Movement", "Measured", "Normal"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "4px 6px", fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: FONTS.body }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(ex.rom).map(([joint, val]) => {
                  const norm   = ex.romNormals && ex.romNormals[joint];
                  const numVal = typeof val === "number" ? val : parseFloat(val);
                  const pctDef = (norm && !isNaN(numVal)) ? Math.round(((norm - numVal) / norm) * 100) : null;
                  return (
                    <tr key={joint} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "5px 6px", color: "#374151", fontFamily: FONTS.body }}>{joint}</td>
                      <td style={{ padding: "5px 6px", fontWeight: 600, color: pctDef && pctDef > 15 ? "#dc2626" : "#1e293b", fontFamily: FONTS.body }}>
                        {typeof val === "number" ? `${val}°` : val}
                        {pctDef !== null && pctDef > 5 && <span style={{ fontSize: 10, color: "#dc2626", marginLeft: 4 }}>{pctDef}%↓</span>}
                      </td>
                      <td style={{ padding: "5px 6px", color: "#9ca3af", fontFamily: FONTS.body }}>{norm != null ? `${norm}°` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!hasMMT && expectsMeasure(kase.discipline, "mmt") && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>MMT</div>
            <NotDocumented what="manual muscle testing" docNoun="evaluation" />
          </div>
        )}

        {hasMMT && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>MMT</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                {Object.entries(ex.mmt).map(([muscle, grade]) => (
                  <tr key={muscle} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "5px 6px", color: "#374151", fontFamily: FONTS.body }}>{muscle}</td>
                    <td style={{ padding: "5px 6px", fontWeight: 600, fontFamily: "monospace", color: parseFloat(grade) < 4 ? "#dc2626" : "#1e293b" }}>{grade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(ex.functionalOutcomeScore || expectsMeasure(kase.discipline, "outcome")) && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4, fontFamily: FONTS.body }}>Outcome Score</div>
            {ex.functionalOutcomeScore
              ? <div style={{ fontSize: 13, color: "#1e293b", fontFamily: FONTS.body, fontWeight: 600 }}>{ex.functionalOutcomeScore}</div>
              : <NotDocumented what="standardized outcome measure" docNoun="evaluation" />}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>Functional Limitations</div>
          {(ex.functionalLimitations && ex.functionalLimitations.length > 0)
            ? ex.functionalLimitations.map((lim, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 3, alignItems: "flex-start" }}>
                <span style={{ color: "#dc2626", fontSize: 11, marginTop: 2, flexShrink: 0 }}>✕</span>
                <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.4, fontFamily: FONTS.body }}>{lim}</span>
              </div>
            ))
            : <NotDocumented what="functional limitations" docNoun="evaluation" />}
        </div>

        {ex.goals && ex.goals.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>
              Goals — {ex.goalsMet || 0}/{ex.goalsTotal || ex.goals.length} met
            </div>
            {ex.goals.map((g, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 3, alignItems: "flex-start" }}>
                <span style={{ color: "#22c55e", fontSize: 11, marginTop: 2, flexShrink: 0 }}>◎</span>
                <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.4, fontFamily: FONTS.body }}>{g}</span>
              </div>
            ))}
          </div>
        )}
        {/* Was `goalsTotal === 0`, which rendered nothing at all when the field
            was absent rather than zero — the one case where the gap most needed
            saying. Driven off the list now, so an empty goal set always shows. */}
        {!(ex.goals && ex.goals.length > 0) && (
          <div style={{ marginBottom: 14, padding: "8px 10px", background: "#fef3c7", borderRadius: 6, border: "1px solid #fcd34d" }}>
            <span style={{ fontSize: 12, color: "#92400e", fontFamily: FONTS.body }}>No treatment goals documented</span>
          </div>
        )}
        </>}

        {ex.documentationQuality && Object.keys(ex.documentationQuality).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>Doc Quality</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {Object.entries(ex.documentationQuality).filter(([k]) => k !== "missingElements").map(([key, val]) => {
                const labels = {
                  hasEvalDate: "Date", hasDiagnosisCodes: "Dx", hasObjectiveMeasures: "Obj",
                  hasFunctionalLimitations: "FxLim", hasGoals: "Goals", hasPOC: "POC",
                  hasStandardizedOutcomeMeasure: "Outcome", goalsMeasurable: "Measurable",
                  goalsFunctional: "Functional", goalsHaveTimeframes: "Timeframes", hasHEP: "HEP",
                };
                const label = labels[key];
                if (!label) return null;
                return (
                  <span key={key} style={{
                    fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                    background: val ? "#dcfce7" : "#fee2e2", color: val ? "#166534" : "#991b1b",
                    fontFamily: FONTS.body, letterSpacing: "0.04em",
                  }}>
                    {val ? "✓" : "✗"} {label}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {!isSubsequent && hasProgress && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontFamily: FONTS.body }}>
              Progress Since Last Review
            </div>

            {ex.painPrior && ex.painCurrent && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#64748b", fontFamily: FONTS.body, marginBottom: 4 }}>Pain</div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#6b7280", fontFamily: FONTS.body }}>Prior: <strong>{ex.painPrior}</strong></span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>→</span>
                  <span style={{ fontSize: 12, color: "#1e293b", fontFamily: FONTS.body }}>Current: <strong>{ex.painCurrent}</strong></span>
                </div>
              </div>
            )}

            {hasROMComp && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#64748b", fontFamily: FONTS.body, marginBottom: 4 }}>ROM</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["Movement", "Prior", "Current", "Change", "Normal"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "3px 6px", fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: FONTS.body }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {romCompRows.map(({ key: joint, prior, current, change }) => {
                      const delta = change != null ? change
                        : (typeof current === "number" && typeof prior === "number" ? current - prior : null);
                      const normal = ex.romNormals ? valueFor(ex.romNormals, joint) : undefined;
                      return (
                        <tr key={joint} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "4px 6px", color: "#374151", fontFamily: FONTS.body }}>{joint}</td>
                          <td style={{ padding: "4px 6px", color: "#6b7280", fontFamily: FONTS.body }}>{prior == null ? "—" : (typeof prior === "number" ? `${prior}°` : prior)}</td>
                          <td style={{ padding: "4px 6px", fontWeight: 600, color: "#1e293b", fontFamily: FONTS.body }}>{current == null ? "—" : (typeof current === "number" ? `${current}°` : current)}</td>
                          <td style={{ padding: "4px 6px", fontWeight: 700, fontFamily: FONTS.body, color: delta > 0 ? "#15803d" : delta < 0 ? "#dc2626" : "#6b7280" }}>
                            {delta != null ? (delta > 0 ? `+${delta}°` : `${delta}°`) : "—"}
                          </td>
                          <td style={{ padding: "4px 6px", color: "#9ca3af", fontFamily: FONTS.body }}>{normal != null ? `${normal}°` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {hasMMTComp && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#64748b", fontFamily: FONTS.body, marginBottom: 4 }}>MMT</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["Muscle", "Prior", "Current"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "3px 6px", fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: FONTS.body }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mmtCompRows.map(({ key: muscle, prior, current }) => {
                      // Grade convention matches the engine's avgMMT: "4+/5" → 4.5.
                      const pn = mmtGradeNum(prior), cn = mmtGradeNum(current);
                      const improved = pn != null && cn != null ? cn >= pn : null;
                      return (
                        <tr key={muscle} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "4px 6px", color: "#374151", fontFamily: FONTS.body }}>{muscle}</td>
                          <td style={{ padding: "4px 6px", color: "#6b7280", fontFamily: "monospace" }}>{prior == null ? "—" : prior}</td>
                          <td style={{ padding: "4px 6px", fontWeight: 600, fontFamily: "monospace", color: improved === null ? "#1e293b" : improved ? "#15803d" : "#dc2626" }}>{current == null ? "—" : current}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {hasOutComp && (
              <div>
                <div style={{ fontSize: 10, color: "#64748b", fontFamily: FONTS.body, marginBottom: 4 }}>Outcome</div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  {/* current/prior are full strings ("LEFS 36/80") — they already
                      carry the tool name and the max, so no "/maxScore" suffix. */}
                  <span style={{ fontSize: 12, color: "#6b7280", fontFamily: FONTS.body }}>Prior: <strong>{ex.outcomeComparison.prior ?? "—"}</strong></span>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>→</span>
                  <span style={{ fontSize: 12, color: "#1e293b", fontFamily: FONTS.body }}>Current: <strong>{ex.outcomeComparison.current ?? "—"}</strong></span>
                  {(() => {
                    // Prefer the change the engine already computed; otherwise take
                    // the numerator off each string ("LEFS 36/80" → 36) so the delta
                    // is arithmetic, not string subtraction (which yielded NaN).
                    const d = ex.outcomeComparison.change != null
                      ? ex.outcomeComparison.change
                      : (() => {
                          const c = scoreNum(ex.outcomeComparison.current);
                          const p = scoreNum(ex.outcomeComparison.prior);
                          return c != null && p != null ? c - p : null;
                        })();
                    if (d == null || Number.isNaN(d)) return null;
                    return <span style={{ fontSize: 12, fontWeight: 700, color: d > 0 ? "#15803d" : d < 0 ? "#dc2626" : "#6b7280", fontFamily: FONTS.body }}>({d > 0 ? `+${d}` : d})</span>;
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* OT — FIM + ADL table */}
        {(hasFIM || hasADL) && (
          <div style={{ marginTop: hasProgress ? 14 : 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: OT_COLOR, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontFamily: FONTS.body }}>
              OT Functional Measures
            </div>
            {hasFIM && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#64748b", fontFamily: FONTS.body, marginBottom: 4 }}>
                  FIM Score <span style={{ color: "#94a3b8" }}>(18–126; higher = more independent)</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, height: 10, background: "#f1f5f9", borderRadius: 5, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round(((ex.fim - 18) / 108) * 100)}%`, background: ex.fim < 55 ? "#dc2626" : ex.fim < 90 ? "#f59e0b" : "#15803d", borderRadius: 5, transition: "width 0.3s" }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: ex.fim < 55 ? "#dc2626" : ex.fim < 90 ? "#92400e" : "#15803d", fontFamily: FONTS.body, width: 52 }}>{ex.fim}/126</span>
                  <span style={{ fontSize: 10, color: "#6b7280", fontFamily: FONTS.body }}>{ex.fim < 55 ? "Severe" : ex.fim < 90 ? "Moderate" : "Mild"}</span>
                </div>
              </div>
            )}
            {hasADL && (
              <div>
                <div style={{ fontSize: 10, color: "#64748b", fontFamily: FONTS.body, marginBottom: 4 }}>ADL Independence</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#fff7ed" }}>
                      {["Activity", "Level"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "3px 6px", fontSize: 9, fontWeight: 700, color: OT_COLOR, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: FONTS.body }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(ex.adlLevels).map(([act, lvl]) => (
                      <tr key={act} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "4px 6px", color: "#374151", fontFamily: FONTS.body }}>{act}</td>
                        <td style={{ padding: "4px 6px", fontWeight: 600, fontFamily: FONTS.body, color: /dependent|max/i.test(lvl) ? "#dc2626" : /mod/i.test(lvl) ? "#92400e" : "#15803d" }}>{lvl}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ST — standardized scores + swallowing */}
        {(hasScores || ex.dysphagiaSeverity) && (
          <div style={{ marginTop: hasProgress || hasFIM || hasADL ? 14 : 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: ST_COLOR, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontFamily: FONTS.body }}>
              ST Assessment Scores
            </div>
            {hasScores && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: "#64748b", fontFamily: FONTS.body, marginBottom: 4 }}>Standardized Test Scores</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f0fdf4" }}>
                      {["Test", "SS", "Range"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "3px 6px", fontSize: 9, fontWeight: 700, color: ST_COLOR, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: FONTS.body }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(ex.standardizedScores).map(([test, ss]) => (
                      <tr key={test} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "4px 6px", color: "#374151", fontFamily: FONTS.body }}>{test}</td>
                        <td style={{ padding: "4px 6px", fontWeight: 700, fontFamily: "monospace", color: ss < 70 ? "#dc2626" : ss <= 85 ? "#92400e" : "#15803d" }}>{ss}</td>
                        <td style={{ padding: "4px 6px", fontSize: 10, color: ss < 70 ? "#dc2626" : ss <= 85 ? "#92400e" : "#15803d", fontFamily: FONTS.body }}>{ss < 70 ? "Severe" : ss <= 85 ? "Moderate" : "Mild"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {ex.languageAgeEquivalent && (
              <div style={{ marginBottom: 8, fontSize: 11, color: "#374151", fontFamily: FONTS.body }}>
                <span style={{ fontWeight: 600 }}>Language AE: </span>{ex.languageAgeEquivalent}
              </div>
            )}
            {ex.dysphagiaSeverity && (
              <div style={{ fontSize: 11, fontFamily: FONTS.body }}>
                <span style={{ fontWeight: 600, color: "#374151" }}>Dysphagia Severity: </span>
                <span style={{ color: /severe/i.test(ex.dysphagiaSeverity) ? "#dc2626" : /mod/i.test(ex.dysphagiaSeverity) ? "#92400e" : "#15803d" }}>{ex.dysphagiaSeverity}</span>
              </div>
            )}
            {ex.swallowingFindings && (
              <div style={{ marginTop: 6, fontSize: 11, color: "#6b7280", fontFamily: FONTS.body }}>
                <span style={{ fontWeight: 600, color: "#374151" }}>Swallowing: </span>{ex.swallowingFindings}
              </div>
            )}
          </div>
        )}

        {/* ── Inline document list — inside the scroll area so it's always reachable ── */}
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: FONTS.body }}>
              Clinical Documents ({inlineDocs.length})
            </span>
            {inlineDocs.length > 0 && (
              <button onClick={onToggleDocs} style={{ fontSize: 10, color: NAVY, background: "none", border: "none", cursor: "pointer", fontFamily: FONTS.body, fontWeight: 600, padding: 0 }}>
                {showDocs ? "Hide viewer" : "Full viewer ↗"}
              </button>
            )}
          </div>
          {!inlineDocsReady && (
            <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: FONTS.body, padding: "4px 0" }}>Loading documents…</div>
          )}
          {inlineDocsReady && inlineDocs.length === 0 && (
            <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: FONTS.body, fontStyle: "italic" }}>No documents attached</div>
          )}
          {inlineDocsReady && inlineDocs.map((doc, i) => {
            const name      = typeof doc === "string" ? doc : (doc.name || "Unnamed document");
            const signedUrl = typeof doc === "object" ? (doc.signedUrl || doc.url || doc.file_url) : null;
            const sizeMB    = typeof doc === "object" && doc.size ? (doc.size / 1024 / 1024).toFixed(1) : null;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 11, color: "#374151", fontFamily: FONTS.body, wordBreak: "break-word", flex: 1, minWidth: 0 }}>
                  📄 {name}{sizeMB ? ` · ${sizeMB} MB` : ""}
                </span>
                {signedUrl ? (
                  <a href={signedUrl} target="_blank" rel="noopener noreferrer"
                    style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: NAVY, textDecoration: "none", fontFamily: FONTS.body, whiteSpace: "nowrap", padding: "3px 8px", borderRadius: 5, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                    Open ↗
                  </a>
                ) : (
                  <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: FONTS.body, flexShrink: 0 }}>Not stored</span>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

// ── RECOMMENDATION ZONE ────────────────────────────────────────────────────────
function RecommendationZone({ kase, engineState, selectedPlan }) {
  if (!kase.contract) {
    return (
      <div>
        <ZoneHeader title="Recommendation" />
        <div style={{ padding: "16px 20px" }}>
          <LoadingPulse label="Calling live engine..." />
        </div>
      </div>
    );
  }

  const rec  = kase.contract.recommendation;
  const asmn = kase.contract.assessment;
  const cpg  = kase.contract.cpgInfo;
  const dc   = detColors(rec.determination);
  // Demo cleanup — confidence label removed from the chip display (see below);
  // rec.confidence itself is untouched, still present on the contract/ruling.
  // confidenceStyle() is left defined, just unused here, in case this comes back.

  return (
    <div>
      <ZoneHeader title="Recommendation" />
      <div style={{ padding: "16px 20px" }}>

        {kase.isLive && engineState === "offline" && (
          <div style={{
            marginBottom: 12, padding: "8px 12px", borderRadius: 6,
            background: "#fef2f2", border: "1px solid #fca5a5",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#991b1b", fontFamily: FONTS.body }}>● Engine Offline</span>
            <span style={{ fontSize: 11, color: "#dc2626", fontFamily: FONTS.body }}>
              Showing determination from prior form review. Full contract unavailable.
            </span>
          </div>
        )}

        <div style={{
          padding: "12px 16px", borderRadius: 8, border: `1px solid ${dc.border}`,
          background: dc.bg, marginBottom: 16, boxShadow: `0 0 0 3px ${dc.glow}`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: dc.text, fontFamily: FONTS.heading, lineHeight: 1.3 }}>
            {rec.determination}
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: dc.text, fontFamily: FONTS.body, opacity: 0.85 }}>
              <strong>{rec.approvedVisits}</strong> visits
            </span>
            {rec.frequency && rec.durationWeeks && (
              <span style={{ fontSize: 12, color: dc.text, fontFamily: FONTS.body, opacity: 0.85 }}>
                {rec.frequency}x/wk × {rec.durationWeeks} wks
              </span>
            )}
          </div>
          {rec.autoApprovalEligible && (
            <div style={{
              marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 8px", borderRadius: 4, background: "#166534", color: "#fff",
              fontSize: 10, fontWeight: 700, fontFamily: FONTS.body, letterSpacing: "0.05em",
            }}>
              ✓ Auto-approval eligible
            </div>
          )}
          {selectedPlan && (
            <div style={{ marginTop: 6 }}>
              <span style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 4,
                background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe",
                fontFamily: FONTS.body,
              }}>
                {selectedPlan.plan_name} · auto-approve ≤ {selectedPlan.auto_approve_threshold} visits
              </span>
            </div>
          )}
        </div>

        {/* ISSUE 3 — Requested (provider) vs. Recommended (ruling) side-by-side.
            Requested comes from the submitted request (extraction.requestedVisits +
            frequency/duration parsed from the POC); Recommended reads straight off
            rec (same approvedVisits/frequency/durationWeeks the chip above uses).
            Falls back to the visit count alone when a frequency/duration can't be
            parsed or wasn't approved (e.g. Pend, transition visits). */}
        {(() => {
          const ext = kase.contract.extraction || {};
          const { freqPerWeek: reqFreq, durationWeeks: reqWeeks } =
            parseRequestedFreqWeeks(ext.requestedFrequency);
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #f1f5f9", background: "#fafafa" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontFamily: FONTS.body }}>Requested (provider)</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", fontFamily: FONTS.body }}>
                  {formatVisitLine(ext.requestedVisits, reqFreq, reqWeeks)}
                </div>
              </div>
              <div style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #f1f5f9", background: "#fafafa" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontFamily: FONTS.body }}>Recommended</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", fontFamily: FONTS.body }}>
                  {formatVisitLine(rec.approvedVisits, rec.frequency, rec.durationWeeks)}
                </div>
              </div>
            </div>
          );
        })()}

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontFamily: FONTS.body }}>Three Domain Assessment</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {["d1", "d2", "d3"].map(key => {
              const domain = asmn[key];
              const dc2    = domainColors(domain.finding);
              const lbl    = domainLabel(key, domain.finding);
              return (
                <div key={key} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "7px 10px", borderRadius: 6, border: "1px solid #f1f5f9", background: "#fafafa",
                }}>
                  <span style={{ flex: "0 0 72px", fontSize: 10, fontWeight: 700, color: "#374151", fontFamily: FONTS.body, paddingTop: 1 }}>{lbl.key}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                    background: dc2.bg, color: dc2.text, fontFamily: FONTS.body,
                    letterSpacing: "0.04em", flex: "0 0 auto",
                  }}>{lbl.finding}</span>
                  {domain.reasoning && (
                    <span style={{ fontSize: 11, color: "#6b7280", fontFamily: FONTS.body, lineHeight: 1.3, flex: 1 }}>
                      {domain.reasoning}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {rec.criteria && rec.criteria.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>Criteria</div>
            {rec.criteria.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 7, marginBottom: 5, alignItems: "flex-start" }}>
                <span style={{ color: NAVY_MID, fontSize: 10, marginTop: 2, flexShrink: 0, fontWeight: 700 }}>▸</span>
                <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.4, fontFamily: FONTS.body }}>{c}</span>
              </div>
            ))}
          </div>
        )}

        {cpg && (
          <div style={{ marginBottom: 16, padding: "8px 10px", background: "#eff6ff", borderRadius: 6, border: "1px solid #bfdbfe" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#1d4ed8", fontFamily: FONTS.body, marginBottom: 2 }}>CPG Reference</div>
            <div style={{ fontSize: 11, color: "#1e3a5f", fontFamily: FONTS.body }}>
              {cpg.cpgCitation} · benchmark typical: <strong>{cpg.typicalVisits}</strong> · p75: <strong>{cpg.p75Visits}</strong>
            </div>
          </div>
        )}

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6, fontFamily: FONTS.body }}>Rationale</div>
          <div style={{
            fontSize: 12, lineHeight: 1.7, color: "#374151", fontFamily: FONTS.body,
            background: "#f8fafc", padding: "10px 12px", borderRadius: 6, border: "1px solid #e2e8f0",
          }}>
            {rec.rationale}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── RATIONALE EDITOR ───────────────────────────────────────────────────────────
function RationaleEditor({ value, onChange, color }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: color || "#374151", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontFamily: FONTS.body, opacity: 0.75 }}>
        Determination Letter Rationale (editable)
      </div>
      <textarea
        value={value}
        onChange={e => onChange && onChange(e.target.value)}
        rows={3}
        style={{
          width: "100%", borderRadius: 6, border: "1.5px solid #e2e8f0",
          padding: "7px 10px", fontSize: 11, fontFamily: FONTS.body, lineHeight: 1.5,
          resize: "vertical", outline: "none", background: "#fffef9", color: "#374151",
          boxSizing: "border-box",
        }}
        placeholder="Edit the AI-drafted rationale before it appears in the determination letter..."
      />
    </div>
  );
}

// ── ACTION BUTTON ──────────────────────────────────────────────────────────────
function ActionBtn({ kbd, label, color, bg, border, onClick, disabled, compact }) {
  const [hover, setHover] = useState(false);
  // UNF panel — compact mode renders a slim horizontal-row button (used in the
  // footer action row) instead of the full-width stacked button (used while an
  // action is mid-flow, e.g. the pend/partial/deny detail panels).
  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={compact ? {
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        flex: 1, padding: "7px 4px", minWidth: 0,
        border: `1.5px solid ${disabled ? "#e2e8f0" : border}`,
        borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer",
        background: disabled ? "#f8fafc" : bg,
        filter: !disabled && hover ? "brightness(0.93)" : "none",
        transition: "all 0.12s", opacity: disabled ? 0.45 : 1,
      } : {
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", padding: "11px 14px",
        border: `1.5px solid ${disabled ? "#e2e8f0" : border}`,
        borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        background: disabled ? "#f8fafc" : hover ? bg : bg,
        filter: !disabled && hover ? "brightness(0.93)" : "none",
        transition: "all 0.12s", opacity: disabled ? 0.45 : 1,
      }}
    >
      <span style={{
        width: compact ? 18 : 24, height: compact ? 18 : 24, borderRadius: 5,
        background: disabled ? "#e2e8f0" : border,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: compact ? 10 : 12, fontWeight: 800, color: disabled ? "#9ca3af" : color,
        fontFamily: FONTS.body, flexShrink: 0,
      }}>{kbd}</span>
      <span style={{
        fontSize: compact ? 11 : 13, fontWeight: 600, color: disabled ? "#9ca3af" : color, fontFamily: FONTS.body,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{label}</span>
    </button>
  );
}

// ── UNF NOTE PANEL ─────────────────────────────────────────────────────────────
// Universal Note Format — primary content of the Determination (right) panel.
// A reviewer reads the generated note, edits it in place if needed, copies it,
// and pastes it directly into BBI. Nothing here writes back to BBI; the paste
// is manual. Edits are local UI state only and never touch kase.contract.
function UNFNotePanel({ kase, onReleaseCase }) {
  const rec = kase.contract.recommendation;
  const ext = kase.contract.extraction || {};
  const isSubsequent = kase.reviewType === "subsequent";

  // Auto-HPI (subsequent only) — the current submission's own hpiData.ieDate is
  // frequently null for a subsequent review (only populated when the document
  // itself restates the original IE date), and it never carries "visits
  // authorized to date" at all. This reuses GET /v1/episode-context (Issue 1's
  // endpoint) for the true initial IE date/age and the SAME cumulativeVisits
  // the header bar shows -- not recomputed here. Best-effort: any failure just
  // leaves the override empty, falling back to the current submission's own
  // hpiData (or, failing that, "[No HPI provided]" via buildUNFNote).
  const [episodeOverride, setEpisodeOverride] = useState(null);
  useEffect(() => {
    setEpisodeOverride(null);
    if (!isSubsequent || !kase.memberId || kase.memberId === "—" || !kase.discipline) return;
    const token = localStorage.getItem("cogentus_token") || "";
    if (!token) return;
    let cancelled = false;
    fetch(`${API_BASE}/v1/episode-context?memberId=${encodeURIComponent(kase.memberId)}&discipline=${encodeURIComponent(kase.discipline)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (!cancelled && data) setEpisodeOverride(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isSubsequent, kase.memberId, kase.discipline]);

  // Recomputed only when kase.contract, kase.providerNotes, or the episode
  // override actually change (a new case loaded, the engine re-evaluating
  // after a plan change, or the episode fetch above resolving) -- never on
  // every render, so an in-progress edit below isn't silently overwritten by
  // unrelated cockpit state changes (e.g. typing in a pend-detail box). Reads
  // the raw kase.contract.* paths directly (not the ext/rec aliases declared
  // above, which are only for the JSX below) so the dependency array doesn't
  // need to track them separately, and no eslint-disable is needed.
  const builtNote = useMemo(() => {
    const base = kase.contract.hpiData || {};
    const override = episodeOverride?.subsequentHpiOverride;
    const autoHpiData = {
      age:                   override?.age ?? base.age ?? null,
      sex:                   base.sex ?? null,
      diagnosisDescription:  base.diagnosisDescription ?? null,
      ieDate:                override?.ieDate ?? base.ieDate ?? null,
      totalApprovedVisits:   isSubsequent ? (episodeOverride?.cumulativeVisits ?? null) : null,
      isSubsequent,
    };
    return buildUNFNote({
      hpi:               kase.providerNotes,
      autoHpiData,
      clinicalSummary:   kase.contract.clinicalSummary,
      poc:               kase.contract.extraction?.poc,
      requestedVisits:   kase.contract.extraction?.requestedVisits,
      determinationLine: kase.contract.recommendation.rationale,
      approvedVisits:    kase.contract.recommendation.approvedVisits,
    });
  }, [kase.contract, kase.providerNotes, isSubsequent, episodeOverride]);

  const [noteText, setNoteText] = useState(builtNote);
  const [copied, setCopied]     = useState(false);

  // The note box sizes itself to the note, so HPI through Approved Visits is
  // visible without dragging. It used to open at 280px and stop at 480px —
  // roughly 25 lines — which cut a full UNF note off partway down, and the
  // drag handle hit the cap before the rest came into view. The right column
  // scrolls, so a tall box is fine here. NOTE_MAX_H is a backstop against a
  // pathological note, not an expected limit; past it the box scrolls itself.
  const noteRef      = useRef(null);
  const autoHeight   = useRef(0);
  const [userSized, setUserSized] = useState(false);

  useLayoutEffect(() => {
    const el = noteRef.current;
    if (!el || userSized) return;
    el.style.height = "auto";                       // shrink first, or it only ever grows
    const h = Math.min(Math.max(el.scrollHeight + 3, NOTE_MIN_H), NOTE_MAX_H);
    el.style.height = `${h}px`;
    autoHeight.current = h;
  }, [noteText, userSized]);

  // Once the reviewer drags the handle, their height wins — stop re-fitting it
  // out from under them on the next keystroke.
  useEffect(() => {
    const el = noteRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (autoHeight.current && Math.abs(el.offsetHeight - autoHeight.current) > 2) setUserSized(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new case (or a re-evaluation) gets a fresh auto-fit rather than inheriting
  // the height the reviewer dragged for the previous note.
  useEffect(() => { setNoteText(builtNote); setCopied(false); setUserSized(false); }, [builtNote]);

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
    a.download = `UNF_${kase.caseId || "note"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button onClick={handleCopy} style={{
          flex: 1, padding: "9px 0", borderRadius: 7, border: "none",
          background: copied ? "#166534" : NAVY_MID, color: "#fff",
          fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONTS.body,
          transition: "background 0.15s",
        }}>
          {copied ? "✓ Copied" : "Copy Note"}
        </button>
        <button onClick={handleExport} style={{
          padding: "9px 14px", borderRadius: 7, border: "1px solid #e2e8f0",
          background: "#fff", color: "#374151", fontSize: 12, fontWeight: 600,
          cursor: "pointer", fontFamily: FONTS.body, whiteSpace: "nowrap",
        }}>
          Export .txt
        </button>
        {/* Demo cleanup — Return to Queue restored as a small secondary action here
            (outline style, no fill) after the determination-actions footer it used
            to live in was removed. Same onReleaseCase callback as before -- opens
            App.js's existing exit modal (reason prompt) and existing
            PATCH /v1/submissions/:id/release flow, unchanged. Hold and the
            determination buttons are intentionally not restored. */}
        {kase.isLive && onReleaseCase && (
          <button onClick={onReleaseCase} style={{
            padding: "9px 14px", borderRadius: 7, border: "1px solid #fca5a5",
            background: "transparent", color: "#dc2626", fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: FONTS.body, whiteSpace: "nowrap",
          }}>
            Return to Queue
          </button>
        )}
      </div>
      <textarea
        ref={noteRef}
        value={noteText}
        onChange={e => setNoteText(e.target.value)}
        spellCheck={false}
        style={{
          width: "100%", minHeight: NOTE_MIN_H, maxHeight: NOTE_MAX_H, boxSizing: "border-box",
          resize: "vertical", overflowY: "auto",
          fontFamily: "'SF Mono', 'Consolas', 'Menlo', monospace", fontSize: 12, lineHeight: 1.6,
          padding: "14px 16px", borderRadius: 8, border: "1.5px solid #e2e8f0",
          background: "#fff", color: "#1e293b", outline: "none",
        }}
      />
    </div>
  );
}

// ── DETERMINATION ZONE ─────────────────────────────────────────────────────────
function DeterminationZone({ kase, queue, cursor, total, decisions, auditState, actionState,
  partialVisits, pendReason, pendDetails, approveChecks, denyNote, rationaleEdit,
  onAction, onPartialVisitsChange, onPartialSubmit, onDenyConfirm,
  onPendReasonChange, onPendDetailsChange, onPendSubmit,
  onApproveChecksChange, onApproveSubmit,
  onDenyNoteChange, onDenySignoffSubmit,
  onCancelAction, onNavigate, hideQueueNav,
  onHoldCase, onReleaseCase, onRationaleChange }) {

  const decided    = decisions[kase.caseId];
  const rec        = kase.contract?.recommendation;
  const partialRef = useRef(null);

  useEffect(() => {
    if (actionState === "partial_input" && partialRef.current) {
      partialRef.current.focus();
    }
  }, [actionState]);

  const decColor = decided ? detColors(decided.determination) : null;

  return (
    <div>
      <ZoneHeader title="Determination" />
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Decided overlay with audit status */}
        {decided && (
          <div style={{
            padding: "12px 14px", borderRadius: 8, border: `1.5px solid ${decColor.border}`,
            background: decColor.bg, textAlign: "center",
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: decColor.text, fontFamily: FONTS.heading }}>
              {decided.determination}
            </div>
            {decided.approvedVisits != null && (
              <div style={{ fontSize: 11, color: decColor.text, marginTop: 3, fontFamily: FONTS.body, opacity: 0.8 }}>
                {decided.approvedVisits} visits approved
              </div>
            )}
            <div style={{ fontSize: 10, color: decColor.text, marginTop: 4, fontFamily: FONTS.body, opacity: 0.85 }}>
              {/denial|partial/i.test(decided.determination)
                ? "→ Pending Medical Director Co-Sign"
                : "Recorded — use J/K to navigate"}
            </div>
            {auditState && (
              <div style={{ marginTop: 6 }}>
                {auditState === "recording" && (
                  <span style={{ fontSize: 9, color: NAVY, fontFamily: FONTS.body }}>● Saving to audit log...</span>
                )}
                {auditState === "recorded" && (
                  <span style={{ fontSize: 9, color: "#166534", fontWeight: 700, fontFamily: FONTS.body }}>✓ Audit logged</span>
                )}
                {auditState === "error" && (
                  <span style={{ fontSize: 9, color: "#991b1b", fontFamily: FONTS.body }}>✗ Audit log error</span>
                )}
              </div>
            )}
            {decided.pendReason && (
              <div style={{ marginTop: 8, fontSize: 11, color: decColor.text, fontFamily: FONTS.body, textAlign: "left", background: "rgba(255,255,255,0.55)", borderRadius: 5, padding: "6px 8px" }}>
                <span style={{ fontWeight: 700 }}>Pend reason: </span>
                {PEND_REASONS.find(r => r.value === decided.pendReason)?.label || decided.pendReason}
                {decided.pendDetails && (
                  <div style={{ marginTop: 3, color: decColor.text, opacity: 0.85 }}>{decided.pendDetails}</div>
                )}
              </div>
            )}
            {decided.approveChecks && decided.approveChecks.length > 0 && (
              <div style={{ marginTop: 8, textAlign: "left" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: decColor.text, fontFamily: FONTS.body, marginBottom: 3 }}>Recommendations recorded:</div>
                {decided.approveChecks.map((r, i) => (
                  <div key={i} style={{ fontSize: 11, color: decColor.text, fontFamily: FONTS.body }}>✓ {r}</div>
                ))}
              </div>
            )}
            {decided.denyNote && (
              <div style={{ marginTop: 8, fontSize: 11, color: decColor.text, fontFamily: FONTS.body, textAlign: "left", background: "rgba(255,255,255,0.55)", borderRadius: 5, padding: "6px 8px" }}>
                <span style={{ fontWeight: 700 }}>Reviewer note: </span>{decided.denyNote}
              </div>
            )}
          </div>
        )}

        {/* UNF panel — primary content. Always visible once the engine has a
            contract (before AND after a decision is recorded), since copying
            the note into BBI isn't tied to which button the reviewer clicked. */}
        {kase.contract && <UNFNotePanel kase={kase} onReleaseCase={onReleaseCase} />}

        {/* Approve / Partial Denial / Full Denial / Pend / Hold / Return to Queue
            removed from this panel -- the right column is note-only now (copy/adjust
            the UNF note, paste into BBI). The transient action-state panels (deny
            confirm, pend/partial/deny detail entry) and the idle action-button row
            used to render here; see git history on this file for that code if a
            future cockpit-as-popup design brings determination actions back in. */}
        {!decided && !kase.contract && actionState === "idle" && (
          <div style={{ padding: "14px", borderRadius: 8, border: "1px dashed #e2e8f0", background: "#f8fafc", textAlign: "center" }}>
            <span style={{ fontSize: 12, color: "#94a3b8", fontFamily: FONTS.body }}>Awaiting engine...</span>
          </div>
        )}

        {!hideQueueNav && <div style={{ borderTop: "1px solid #f1f5f9" }} />}

        {/* Queue list — hidden in single-case reviewer mode */}
        {!hideQueueNav && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontFamily: FONTS.body }}>
            Queue ({total}) · J prev · K next
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {queue.map((q, i) => {
              const isCurrent = i === cursor;
              const dec       = decisions[q.caseId];
              const dc2       = dec ? detColors(dec.determination) : null;
              const discC     = disciplineColor(q.discipline);
              return (
                <div
                  key={q.caseId}
                  onClick={() => onNavigate(i)}
                  style={{
                    padding: "8px 10px", borderRadius: 7, cursor: "pointer",
                    border: `1.5px solid ${isCurrent ? NAVY_MID : "#e2e8f0"}`,
                    background: isCurrent ? "#eff6ff" : "#fff", transition: "all 0.1s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: isCurrent ? NAVY_MID : "#94a3b8", fontFamily: FONTS.body, width: 14 }}>{isCurrent ? "●" : "○"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#1e293b", fontFamily: FONTS.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {q.memberName}
                          {q.isLive && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: NAVY_MID }}>[LIVE]</span>}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: discC.bg, color: discC.text, border: `1px solid ${discC.border}`, fontFamily: FONTS.body, flexShrink: 0 }}>
                          {q.discipline || "PT"}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: "#6b7280", fontFamily: FONTS.body }}>{q.caseId} · {q.reviewType === "subsequent" ? "SUB" : "IE"}</div>
                    </div>
                    {dc2 && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                        background: dc2.bg, color: dc2.text, border: `1px solid ${dc2.border}`,
                        fontFamily: FONTS.body, flexShrink: 0,
                      }}>
                        {dec.determination.split(" ")[0].toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        )}

      </div>
    </div>
  );
}

// ── DOCUMENTS PANEL ────────────────────────────────────────────────────────────
function DocumentsPanel({ kase, onClose }) {
  const [docs, setDocs]     = useState(kase.documents || []);
  const [loading, setLoad]  = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    const realId = kase.submissionId || kase.caseId;
    if (!realId || realId.startsWith("SYNTH") || realId.startsWith("SUB-")) { setFetched(true); return; }
    const token = localStorage.getItem("cogentus_token") || "";
    if (!token) { setFetched(true); return; }
    setLoad(true);
    fetch(`${API_BASE}/v1/submissions/${realId}/documents`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.documents) setDocs(data.documents);
        setFetched(true);
      })
      .catch(() => setFetched(true))
      .finally(() => setLoad(false));
  }, [kase.caseId]); // eslint-disable-line

  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 380,
      background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
      display: "flex", flexDirection: "column", zIndex: 100,
      animation: "rn-slidein 0.18s ease-out",
    }}>
      <div style={{ padding: "14px 20px", background: NAVY, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: FONTS.heading }}>Clinical Documents</span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginLeft: 8, fontFamily: FONTS.body }}>{docs.length} file{docs.length !== 1 ? "s" : ""}</span>
        </div>
        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.28)", borderRadius: 5, padding: "3px 10px", color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: FONTS.body }}>
          Esc / V
        </button>
      </div>

      {loading && (
        <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8", fontSize: 12, fontFamily: FONTS.body }}>
          Loading secure document links…
        </div>
      )}

      <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1 }}>
        {!loading && fetched && docs.length === 0 && (
          <div style={{ padding: "32px 0", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>📄</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", fontFamily: FONTS.body }}>No documents attached</div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4, fontFamily: FONTS.body }}>The provider did not upload clinical documents with this submission.</div>
          </div>
        )}
        {docs.map((doc, i) => {
          const name      = typeof doc === "string" ? doc : (doc.name || "Unnamed document");
          const type      = typeof doc === "object" ? doc.type  : null;
          const date      = typeof doc === "object" ? doc.date  : null;
          const signedUrl = typeof doc === "object" ? (doc.signedUrl || doc.url || doc.file_url) : null;
          const hasKey    = typeof doc === "object" && !!doc.key;
          const sizeMB    = typeof doc === "object" && doc.size ? (doc.size / 1024 / 1024).toFixed(2) : null;
          return (
            <div key={i} style={{ padding: "14px 16px", borderRadius: 10, border: `1px solid ${signedUrl ? "#bfdbfe" : "#e2e8f0"}`, background: signedUrl ? "#f0f9ff" : "#f8fafc", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: NAVY, fontFamily: FONTS.body, marginBottom: 3, wordBreak: "break-word" }}>
                    📄 {name}
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {type && <span style={{ fontSize: 10, color: "#64748b", fontFamily: FONTS.body }}>{type}</span>}
                    {date && <span style={{ fontSize: 10, color: "#64748b", fontFamily: FONTS.body }}>{date}</span>}
                    {sizeMB && <span style={{ fontSize: 10, color: "#94a3b8", fontFamily: FONTS.body }}>{sizeMB} MB</span>}
                    {hasKey && <span style={{ fontSize: 10, fontWeight: 700, color: "#15803d", fontFamily: FONTS.body }}>✓ Stored</span>}
                  </div>
                </div>
                {signedUrl ? (
                  <a
                    href={signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flexShrink: 0, padding: "7px 14px", borderRadius: 7, background: NAVY, color: "#fff", fontSize: 12, fontWeight: 700, textDecoration: "none", fontFamily: FONTS.body, display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    Open PDF ↗
                  </a>
                ) : (
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: FONTS.body }}>Not stored</div>
                  </div>
                )}
              </div>
              {!hasKey && (
                <div style={{ marginTop: 8, padding: "6px 10px", background: "#fef3c7", borderRadius: 6, fontSize: 11, color: "#92400e", fontFamily: FONTS.body }}>
                  Provider listed this document but did not upload the file. Ask provider to re-submit with PDFs attached.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── AUDIT LOG PANEL ────────────────────────────────────────────────────────────
function AuditLogPanel({ events, loading, onClose, onRefresh }) {
  return (
    <div style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: 420,
      background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
      display: "flex", flexDirection: "column", zIndex: 100,
      animation: "rn-slidein 0.18s ease-out",
    }}>
      <div style={{ padding: "14px 20px", background: NAVY, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: FONTS.heading }}>Audit Log</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onRefresh} style={{
            background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)",
            borderRadius: 5, padding: "3px 10px", color: "rgba(255,255,255,0.8)", fontSize: 12, cursor: "pointer", fontFamily: FONTS.body,
          }}>Refresh</button>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.28)",
            borderRadius: 5, padding: "3px 10px", color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: FONTS.body,
          }}>Close</button>
        </div>
      </div>
      <div style={{ padding: "12px 20px 16px", overflowY: "auto", flex: 1 }}>
        {loading ? (
          <LoadingPulse label="Loading audit log..." />
        ) : events === null ? (
          <div style={{ padding: "24px 0", textAlign: "center" }}>
            <div style={{ color: "#991b1b", fontSize: 13, fontFamily: FONTS.body }}>Failed to load audit log</div>
            <button onClick={onRefresh} style={{ marginTop: 10, padding: "5px 14px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: "pointer", fontFamily: FONTS.body }}>
              Retry
            </button>
          </div>
        ) : events.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: "#9ca3af", fontSize: 13, fontFamily: FONTS.body, fontStyle: "italic" }}>
            No audit events recorded yet. Make a determination in the cockpit to start the trail.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {events.map((evt, i) => {
              const dc        = detColors(evt.determination);
              const isOverride = evt.is_override;
              const isSynth   = evt.is_synthetic;
              const engineDiffers = evt.engine_determination && evt.engine_determination !== evt.determination;
              return (
                <div key={evt.id || i} style={{
                  padding: "10px 14px", borderRadius: 8, marginBottom: 8,
                  border: `1px solid ${isOverride ? "#fcd34d" : "#e2e8f0"}`,
                  background: isOverride ? "#fffbeb" : "#f8fafc",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                      background: dc.bg, color: dc.text, border: `1px solid ${dc.border}`,
                      fontFamily: FONTS.body, letterSpacing: "0.04em", flexShrink: 0,
                    }}>
                      {evt.determination.split(" ")[0].toUpperCase()}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: NAVY, fontFamily: FONTS.body, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {evt.case_id}
                    </span>
                    {isOverride && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#92400e", fontFamily: FONTS.body, flexShrink: 0 }}>OVERRIDE</span>
                    )}
                    {isSynth && (
                      <span style={{ fontSize: 9, color: "#9ca3af", fontFamily: FONTS.body, flexShrink: 0 }}>SYNTH</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#374151", fontFamily: FONTS.body, marginBottom: 4 }}>
                    {evt.determination}
                    {evt.approved_visits != null && ` · ${evt.approved_visits} visits`}
                  </div>
                  {engineDiffers && (
                    <div style={{ fontSize: 11, color: "#92400e", fontFamily: FONTS.body, marginBottom: 4 }}>
                      Engine rec: {evt.engine_determination}
                      {evt.engine_confidence ? ` (${evt.engine_confidence} conf.)` : ""}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, color: "#6b7280", fontFamily: FONTS.body }}>{evt.reviewer_email}</span>
                    <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: FONTS.body }}>{fmtDateTime(evt.recorded_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── SUBMISSIONS PANEL ──────────────────────────────────────────────────────────
function SubmissionsPanel({ submissions, onClose, onForward, onRefresh }) {
  const [rmiTargetId, setRmiTargetId] = useState(null);
  const [rmiText, setRmiText]         = useState("");
  const [rmiLoading, setRmiLoading]   = useState(false);

  const STATUS = {
    submitted:   { bg: "#eff6ff", text: "#1d4ed8", border: "#bfdbfe", label: "SUBMITTED" },
    in_review:   { bg: "#fffbeb", text: "#92400e", border: "#fcd34d", label: "IN REVIEW" },
    rmi_pending: { bg: "#fff7ed", text: "#c2410c", border: "#fed7aa", label: "RMI SENT" },
    decided:     { bg: "#dcfce7", text: "#166534", border: "#86efac", label: "DECIDED" },
  };

  const token = localStorage.getItem("cogentus_token") || "";

  const markStatus = async (submissionId, status, rmiRequest) => {
    setRmiLoading(true);
    try {
      await fetch(`${API_BASE}/v1/submissions/${submissionId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status, rmiRequest: rmiRequest || undefined }),
      });
      onRefresh();
      setRmiTargetId(null); setRmiText("");
    } catch { /* best-effort */ } finally { setRmiLoading(false); }
  };

  return (
    <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 480, background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", zIndex: 100, animation: "rn-slidein 0.18s ease-out" }}>
      <div style={{ padding: "14px 20px", background: NAVY, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: FONTS.heading }}>Provider Submissions</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onRefresh} style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 5, padding: "3px 10px", color: "rgba(255,255,255,0.8)", fontSize: 12, cursor: "pointer", fontFamily: FONTS.body }}>Refresh</button>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.28)", borderRadius: 5, padding: "3px 10px", color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: FONTS.body }}>Close</button>
        </div>
      </div>
      <div style={{ overflowY: "auto", flex: 1, padding: "12px 16px" }}>
        {submissions.length === 0 ? (
          <div style={{ padding: "32px 0", textAlign: "center", color: "#9ca3af", fontSize: 13, fontFamily: FONTS.body, fontStyle: "italic" }}>
            No submissions yet. Providers submit via the "Submit Case" view.
          </div>
        ) : submissions.map(sub => {
          const sc  = STATUS[sub.status] || STATUS.submitted;
          const diags = Array.isArray(sub.diagnosis_codes) ? sub.diagnosis_codes : [];
          const docs  = Array.isArray(sub.document_list)   ? sub.document_list  : [];
          const pct   = sub.completeness_score || 0;
          const mColor = pct >= 80 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
          return (
            <div key={sub.id} style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${sc.border}`, background: sc.bg, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3, background: "#fff", color: sc.text, border: `1px solid ${sc.border}`, fontFamily: FONTS.body }}>{sc.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: NAVY, fontFamily: FONTS.heading, flex: 1 }}>{sub.member_name || "Unknown Member"}</span>
                <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: FONTS.body }}>{sub.discipline} · {fmtDateTime(sub.submitted_at)}</span>
              </div>
              <div style={{ fontSize: 11, color: "#374151", fontFamily: FONTS.body, marginBottom: 6 }}>
                <strong>{sub.provider_name || "Unknown Provider"}</strong>
                {sub.provider_npi && <span style={{ color: "#9ca3af", marginLeft: 6 }}>NPI {sub.provider_npi}</span>}
              </div>
              <div style={{ fontSize: 11, color: "#374151", fontFamily: FONTS.body, marginBottom: 6 }}>
                {diags.length > 0 && <span style={{ fontFamily: "monospace", fontWeight: 700, color: NAVY, marginRight: 8 }}>{diags.join(", ")}</span>}
                {sub.requested_visits != null && <span>{sub.requested_visits} visits requested</span>}
                {sub.member_id && <span style={{ color: "#9ca3af", marginLeft: 8 }}>ID: {sub.member_id}</span>}
              </div>
              {pct > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ height: 4, background: "#e2e8f0", borderRadius: 2 }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: mColor, borderRadius: 2 }} />
                  </div>
                  <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2, fontFamily: FONTS.body }}>{pct}% complete</div>
                </div>
              )}
              {docs.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3, fontFamily: FONTS.body }}>Documents ({docs.length})</div>
                  {docs.map((d, i) => <div key={i} style={{ fontSize: 11, color: "#374151", fontFamily: FONTS.body }}>· {d}</div>)}
                </div>
              )}
              {sub.provider_notes && <div style={{ fontSize: 11, color: "#374151", fontFamily: FONTS.body, fontStyle: "italic", marginBottom: 6, padding: "6px 8px", background: "rgba(255,255,255,0.6)", borderRadius: 5 }}>{sub.provider_notes}</div>}
              {sub.rmi_request && <div style={{ fontSize: 11, color: "#c2410c", fontFamily: FONTS.body, marginBottom: 6, padding: "6px 8px", background: "#fff7ed", borderRadius: 5, border: "1px solid #fed7aa" }}><strong>RMI: </strong>{sub.rmi_request}</div>}

              {/* Actions */}
              {sub.status !== "decided" && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {sub.status === "submitted" && (
                    <button onClick={() => markStatus(sub.submission_id, "in_review")} disabled={rmiLoading} style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 5, border: "1px solid #fcd34d", background: "#fffbeb", color: "#92400e", cursor: "pointer", fontFamily: FONTS.body }}>Mark In Review</button>
                  )}
                  {rmiTargetId !== sub.submission_id ? (
                    <button onClick={() => { setRmiTargetId(sub.submission_id); setRmiText(""); }} style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 5, border: "1px solid #fed7aa", background: "#fff7ed", color: "#c2410c", cursor: "pointer", fontFamily: FONTS.body }}>Request Info</button>
                  ) : (
                    <div style={{ width: "100%", marginTop: 4 }}>
                      <textarea value={rmiText} onChange={e => setRmiText(e.target.value)} placeholder="Describe what additional information is needed..." rows={2} style={{ width: "100%", borderRadius: 6, border: "1px solid #fed7aa", padding: "6px 8px", fontSize: 12, fontFamily: FONTS.body, resize: "vertical", outline: "none", boxSizing: "border-box" }} />
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <button onClick={() => markStatus(sub.submission_id, "rmi_pending", rmiText)} disabled={!rmiText.trim() || rmiLoading} style={{ flex: 1, fontSize: 11, fontWeight: 700, padding: "5px 0", borderRadius: 5, border: "none", background: "#c2410c", color: "#fff", cursor: "pointer", fontFamily: FONTS.body }}>Send RMI</button>
                        <button onClick={() => { setRmiTargetId(null); setRmiText(""); }} style={{ fontSize: 11, padding: "5px 10px", borderRadius: 5, border: "1px solid #e2e8f0", background: "#fff", color: "#374151", cursor: "pointer", fontFamily: FONTS.body }}>Cancel</button>
                      </div>
                    </div>
                  )}
                  <button onClick={() => onForward(sub)} style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 5, border: `1px solid ${NAVY_MID}`, background: "#eff6ff", color: NAVY_MID, cursor: "pointer", fontFamily: FONTS.body }}>Forward to Cockpit</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── COCKPIT ROOT ───────────────────────────────────────────────────────────────
export default function Cockpit({ user, onBack, liveCase, hideQueueNav, onCaseDone, onHoldCase, onReleaseCase }) {
  const [cursor, setCursor]               = useState(0);
  const [decisions, setDecisions]         = useState({});
  const [actionState, setActionState]     = useState("idle");
  const [partialVisits, setPartialVisits] = useState("");
  const [pendReason, setPendReason]       = useState("");
  const [pendDetails, setPendDetails]     = useState("");
  const [approveChecks, setApproveChecks] = useState([]);
  const [denyNote, setDenyNote]           = useState("");
  const [rationaleEdit, setRationaleEdit] = useState("");
  const [showDocs, setShowDocs]           = useState(false);
  const [liveContract, setLiveContract]   = useState(null);
  const [engineState, setEngineState]     = useState("idle");
  // Phase 4: audit trail
  const [auditStates, setAuditStates]     = useState({}); // caseId → "recording"|"recorded"|"error"
  const [showAuditLog, setShowAuditLog]   = useState(false);
  const [auditLog, setAuditLog]           = useState([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  // Phase 5: plan config
  const [plans, setPlans]                 = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState(liveCase?.planRuleSet?.planId || null);
  // Phase 6: provider submissions
  const [submissions, setSubmissions]       = useState([]);
  const [submissionCases, setSubmissionCases] = useState([]);
  const [showSubmissions, setShowSubmissions] = useState(false);

  const liveCaseId = liveCase?.caseId ?? null;

  const liveCaseEntry = liveCase ? {
    caseId:          liveCase.caseId,
    submissionId:    liveCase.submissionId || liveCase.caseId,
    memberName:      liveCase.memberName      || "Live Case",
    memberId:        liveCase.memberId        || "—",
    dob:             liveCase.dob             || "—",
    discipline:      liveCase.discipline      || "PT",
    reviewType:      liveCase.reviewType      || "initial",
    submittedAt:     liveCase.submittedAt     || new Date().toISOString(),
    documents:       liveCase.documents       || [],
    contract:        liveContract,
    isLive:          true,
    providerName:    liveCase.providerName    || null,
    diagnosisCodes:  liveCase.diagnosisCodes  || [],
    requestedVisits: liveCase.requestedVisits || null,
    providerNotes:   liveCase.providerNotes   || null,
  } : null;

  const queue = hideQueueNav
    ? (liveCaseEntry ? [liveCaseEntry] : [])
    : [
        ...(liveCaseEntry ? [liveCaseEntry] : []),
        ...submissionCases,
        ...SYNTH_QUEUE,
      ];
  const kase  = queue[cursor];

  const selectedPlan = selectedPlanId
    ? (plans.find(p => p.plan_id === selectedPlanId) || null)
    : null;

  // Reset cursor only when a new live case arrives
  useEffect(() => {
    if (!liveCaseId) return;
    setCursor(0);
    setActionState("idle");
  }, [liveCaseId]);

  // Engine call — re-runs when live case or selected plan changes
  useEffect(() => {
    if (!liveCase || !liveCaseId) return;
    setLiveContract(null);
    setEngineState("loading");
    const controller = new AbortController();
    const activePlan = selectedPlanId && plans.length > 0
      ? (plans.find(p => p.plan_id === selectedPlanId) || null) : null;
    const planRuleSet = activePlan
      ? { planId: activePlan.plan_id, planName: activePlan.plan_name, payer: activePlan.payer,
          autoApproveThreshold: activePlan.auto_approve_threshold,
          maxVisitsPerEpisode:  activePlan.max_visits_per_episode }
      : (liveCase.planRuleSet || null);
    fetch(`${API_BASE}/v1/evaluate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        caseId:           liveCaseId,
        discipline:       liveCase.discipline,
        reviewType:       liveCase.reviewType,
        // Explicit override, same as discipline/reviewType above — /v1/evaluate's own
        // merge (requestedVisits ?? extractedMetrics.requestedVisits ?? 0) prefers this
        // over whatever's in extractedMetrics, so a stale/mismatched value there (e.g.
        // from the object-spread bug fixed in App.js's handleGetCase/handleOpenSearchCase)
        // can't silently override the actually-submitted visit count again.
        requestedVisits:  liveCase.requestedVisits ?? undefined,
        extractedMetrics: liveCase.metrics,
        planRuleSet,
      }),
      signal: controller.signal,
    })
      .then(r => { if (!r.ok) throw new Error("Engine " + r.status); return r.json(); })
      .then(contract => { setLiveContract(contract); setEngineState("ok"); })
      .catch(err => {
        if (err.name === "AbortError") return;
        setLiveContract(buildFallbackContract(liveCase.metrics, liveCase.ruling));
        setEngineState("offline");
      });
    return () => controller.abort();
  }, [liveCaseId, selectedPlanId]); // eslint-disable-line

  // Fetch plans on mount
  useEffect(() => { fetchPlans(setPlans); }, []);

  // Fetch submissions on mount
  useEffect(() => { fetchSubmissions(setSubmissions); }, []);

  // Fetch audit log when panel opens
  useEffect(() => {
    if (showAuditLog) fetchAuditEvents(setAuditLog, setAuditLogLoading);
  }, [showAuditLog]);

  const recordDecision = useCallback((determination, approvedVisits, extras = {}) => {
    const caseId = kase.caseId;
    setDecisions(prev => ({
      ...prev,
      [caseId]: { determination, approvedVisits, recordedAt: new Date().toISOString(), ...extras },
    }));
    setActionState("idle");
    setPartialVisits("");
    setPendReason("");
    setPendDetails("");
    setApproveChecks([]);
    setDenyNote("");

    // When reviewer is working a single assigned live case, signal done after audit fires
    if (hideQueueNav && onCaseDone && kase.isLive) {
      setTimeout(onCaseDone, 1800);
    }

    // Fire audit event best-effort
    const token = localStorage.getItem("cogentus_token") || "";
    if (token) {
      const rec        = kase.contract?.recommendation;
      const isOverride = rec ? rec.determination !== determination : false;
      setAuditStates(prev => ({ ...prev, [caseId]: "recording" }));
      fetch(`${API_BASE}/v1/audit-event`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          caseId,
          determination,
          approvedVisits,
          engineDetermination:   rec?.determination          || null,
          engineApprovedVisits:  rec?.approvedVisits         ?? null,
          engineConfidence:      rec?.confidence             || null,
          autoApprovalEligible:  rec?.autoApprovalEligible  ?? null,
          isOverride,
          discipline:    kase.discipline  || null,
          reviewType:    kase.reviewType  || null,
          isSynthetic:       !kase.isLive,
          reviewerNotes:     extras.denyNote || extras.pendDetails || "",
          reviewerRationale: extras.reviewerRationale || "",
          pendReason:        extras.pendReason  || null,
          pendDetails:       extras.pendDetails || null,
        }),
      })
        .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(() => setAuditStates(prev => ({ ...prev, [caseId]: "recorded" })))
        .catch(() => setAuditStates(prev => ({ ...prev, [caseId]: "error" })));
    }
  }, [kase]); // eslint-disable-line

  const handleAction = useCallback((type) => {
    if (decisions[kase.caseId] || !kase.contract) return;
    const rec = kase.contract.recommendation;
    // Pre-fill rationale from engine for reviewer to edit
    setRationaleEdit(rec.rationale || "");
    if (type === "approve") {
      setApproveChecks([]);
      setActionState("approve_checklist");
    } else if (type === "partial") {
      setPartialVisits(String(rec.approvedVisits ?? ""));
      setActionState("partial_input");
    } else if (type === "deny") {
      setActionState("deny_confirm");
    } else if (type === "pend") {
      setPendReason("");
      setPendDetails("");
      setActionState("pend_input");
    }
  }, [kase, decisions]);

  const handleDenyConfirm = useCallback(() => {
    setDenyNote("");
    setActionState("deny_signoff");
  }, []);

  const handlePartialSubmit = useCallback(() => {
    const v = parseInt(partialVisits, 10);
    recordDecision("Partial Denial", isNaN(v) ? (kase.contract?.recommendation?.approvedVisits ?? 0) : v);
  }, [partialVisits, kase, recordDecision]);

  const handlePendSubmit = useCallback(() => {
    recordDecision("Pend", 0, { pendReason, pendDetails, reviewerRationale: rationaleEdit });
  }, [pendReason, pendDetails, rationaleEdit, recordDecision]);

  const handleApproveSubmit = useCallback(() => {
    const rec = kase.contract?.recommendation;
    recordDecision(
      rec?.determination?.startsWith("Approved") ? rec.determination : "Approved",
      rec?.approvedVisits ?? 0,
      { approveChecks: [...approveChecks], reviewerRationale: rationaleEdit }
    );
  }, [approveChecks, rationaleEdit, kase, recordDecision]);

  const handleDenySignoffSubmit = useCallback(() => {
    recordDecision("Full Denial", 0, { denyNote, reviewerRationale: rationaleEdit });
  }, [denyNote, rationaleEdit, recordDecision]);

  const handleNavigate = useCallback((i) => {
    setCursor(i);
    setActionState("idle");
    setPartialVisits("");
    setPendReason("");
    setPendDetails("");
    setApproveChecks([]);
    setDenyNote("");
  }, []);

  // Keyboard handler
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const key = e.key.toLowerCase();
      if (key === "escape") { setActionState("idle"); setPendReason(""); setPendDetails(""); setApproveChecks([]); setDenyNote(""); setShowDocs(false); setShowAuditLog(false); setShowSubmissions(false); return; }
      if (key === "v") { setShowDocs(s => !s); return; }
      if (!hideQueueNav && key === "j" && cursor > 0)                { handleNavigate(cursor - 1); return; }
      if (!hideQueueNav && key === "k" && cursor < queue.length - 1) { handleNavigate(cursor + 1); return; }
      // Demo cleanup — A/P/D/N determination shortcuts disabled along with the
      // buttons/hint chips themselves. With no determination UI in this panel, a
      // stray keypress during a demo must not silently change actionState. J/K/V
      // above are untouched.
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cursor, hideQueueNav, queue.length, handleNavigate]);

  const decided      = !!decisions[kase.caseId];
  const decidedCount = Object.keys(decisions).length;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: NAVY_DARK, fontFamily: FONTS.body, overflow: "hidden" }}>

      {/* ── Top bar ── */}
      <div style={{
        height: 52, background: NAVY,
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        display: "flex", alignItems: "center",
        padding: "0 20px", gap: 20, flexShrink: 0,
        boxShadow: "0 1px 8px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: FONTS.heading, letterSpacing: "-0.02em" }}>CogentCR</span>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.2)" }} />
          <button onClick={onBack} style={{
            background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 5, padding: "3px 10px", color: "rgba(255,255,255,0.75)",
            fontSize: 11, cursor: "pointer", fontFamily: FONTS.body, fontWeight: 600,
          }}>UR Form</button>
          <div style={{
            background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: 5, padding: "3px 10px", color: "#fff",
            fontSize: 11, fontFamily: FONTS.body, fontWeight: 700,
          }}>Cockpit</div>
          <button
            onClick={() => { setShowAuditLog(s => !s); setShowDocs(false); setShowSubmissions(false); }}
            style={{
              background: showAuditLog ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 5, padding: "3px 10px", color: showAuditLog ? "#fff" : "rgba(255,255,255,0.65)",
              fontSize: 11, cursor: "pointer", fontFamily: FONTS.body, fontWeight: 600,
            }}
          >
            Audit Log
          </button>
          <button
            onClick={() => { setShowSubmissions(s => !s); setShowDocs(false); setShowAuditLog(false); if (!showSubmissions) fetchSubmissions(setSubmissions); }}
            style={{
              background: showSubmissions ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 5, padding: "3px 10px", color: showSubmissions ? "#fff" : "rgba(255,255,255,0.65)",
              fontSize: 11, cursor: "pointer", fontFamily: FONTS.body, fontWeight: 600,
            }}
          >
            Submissions {submissions.length > 0 && `(${submissions.length})`}
          </button>
          {plans.length > 0 && (
            <select
              value={selectedPlanId || ""}
              onChange={e => setSelectedPlanId(e.target.value || null)}
              style={{
                background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 5, padding: "3px 8px", color: "#fff",
                fontSize: 11, cursor: "pointer", fontFamily: FONTS.body, outline: "none",
              }}
            >
              <option value="" style={{ color: "#000" }}>Default Plan</option>
              {plans.map(p => (
                <option key={p.plan_id} value={p.plan_id} style={{ color: "#000" }}>
                  {p.plan_name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: FONTS.body }}>
            {cursor + 1} / {queue.length}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: FONTS.heading }}>
            {kase.caseId}
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", fontFamily: FONTS.body }}>
            {kase.memberName}
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: FONTS.body }}>
            submitted {fmtTime(kase.submittedAt)}
          </span>
          {kase.receivedAt && (() => {
            const priority     = kase.reviewPriority || "standard";
            const hoursAllowed = priority === "urgent" ? 24 : priority === "expedited" ? 8 : 72;
            const elapsedMs    = Date.now() - new Date(kase.receivedAt);
            const elapsedH     = Math.max(0, elapsedMs / 3600000);
            const pct          = Math.min(100, (elapsedH / hoursAllowed) * 100);
            const hoursLeft    = Math.max(0, hoursAllowed - elapsedH);
            const tatStatus    = pct >= 100 ? "breached" : pct >= 70 ? "at_risk" : "on_track";
            const tatColor     = tatStatus === "breached" ? "#fca5a5" : tatStatus === "at_risk" ? "#fcd34d" : "#86efac";
            const tatTextColor = tatStatus === "breached" ? "#7f1d1d" : tatStatus === "at_risk" ? "#78350f" : "#14532d";
            return (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: tatColor, color: tatTextColor, fontFamily: FONTS.body }}>
                {tatStatus === "breached" ? "⚠ SLA BREACHED" : `${priority === "urgent" ? "⚡" : "⏱"} ${hoursLeft.toFixed(0)}h / ${hoursAllowed}h`}
              </span>
            );
          })()}
          {kase.isLive && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
              background: engineState === "ok" ? "#dcfce7" : engineState === "offline" ? "#fee2e2" : "#fef3c7",
              color:      engineState === "ok" ? "#166534" : engineState === "offline" ? "#991b1b" : "#92400e",
              fontFamily: FONTS.body, letterSpacing: "0.04em",
            }}>
              {engineState === "loading" ? "Engine..." : engineState === "ok" ? "● Live" : "● Offline"}
            </span>
          )}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center" }}>
          {decidedCount > 0 && (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontFamily: FONTS.body }}>
              {decidedCount}/{queue.length} decided
            </span>
          )}
          <KbdChip k="J" label="prev" />
          <KbdChip k="K" label="next" />
          <KbdChip k="V" label="docs" />
          {/* Demo cleanup — A/P/D/N hint chips removed along with the determination
              buttons themselves (the corresponding keyboard handlers are disabled
              below, so these would have been misleading if left showing). */}
          {user && (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: FONTS.body, borderLeft: "1px solid rgba(255,255,255,0.15)", paddingLeft: 14 }}>
              {user.name || user.email}
            </span>
          )}
        </div>
      </div>

      {/* ── Three-zone body — Evidence 30 / Recommendation 36 / Determination 34 ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 1, overflow: "hidden" }}>
        <div style={{ width: "30%", minHeight: 0, height: "100%", background: "#fff", borderRight: "1px solid #e2e8f0", overflowY: "auto", overflowX: "hidden" }}>
          <EvidenceZone
            kase={kase}
            onToggleDocs={() => { setShowDocs(s => !s); setShowAuditLog(false); setShowSubmissions(false); }}
            showDocs={showDocs}
          />
        </div>
        <div style={{ width: "36%", minHeight: 0, height: "100%", background: "#fff", borderRight: "1px solid #e2e8f0", overflowY: "auto", overflowX: "hidden" }}>
          <RecommendationZone kase={kase} engineState={engineState} selectedPlan={selectedPlan} />
        </div>
        <div style={{ flex: 1, minHeight: 0, height: "100%", background: "#fff", overflowY: "auto", overflowX: "hidden" }}>
          <DeterminationZone
            kase={kase}
            queue={queue}
            cursor={cursor}
            total={queue.length}
            decisions={decisions}
            auditState={auditStates[kase.caseId]}
            actionState={actionState}
            partialVisits={partialVisits}
            pendReason={pendReason}
            pendDetails={pendDetails}
            approveChecks={approveChecks}
            denyNote={denyNote}
            onAction={handleAction}
            onPartialVisitsChange={setPartialVisits}
            onPartialSubmit={handlePartialSubmit}
            onDenyConfirm={handleDenyConfirm}
            onPendReasonChange={setPendReason}
            onPendDetailsChange={setPendDetails}
            onPendSubmit={handlePendSubmit}
            onApproveChecksChange={setApproveChecks}
            onApproveSubmit={handleApproveSubmit}
            onDenyNoteChange={setDenyNote}
            onDenySignoffSubmit={handleDenySignoffSubmit}
            onCancelAction={() => { setActionState("idle"); setPendReason(""); setPendDetails(""); setApproveChecks([]); setDenyNote(""); setRationaleEdit(""); }}
            onNavigate={handleNavigate}
            hideQueueNav={!!hideQueueNav}
            onHoldCase={kase.isLive ? onHoldCase : null}
            onReleaseCase={kase.isLive ? onReleaseCase : null}
            rationaleEdit={rationaleEdit}
            onRationaleChange={setRationaleEdit}
          />
        </div>
      </div>

      {showDocs && <DocumentsPanel kase={kase} onClose={() => setShowDocs(false)} />}
      {showAuditLog && (
        <AuditLogPanel
          events={auditLog}
          loading={auditLogLoading}
          onClose={() => setShowAuditLog(false)}
          onRefresh={() => fetchAuditEvents(setAuditLog, setAuditLogLoading)}
        />
      )}
      {showSubmissions && (
        <SubmissionsPanel
          submissions={submissions}
          onClose={() => setShowSubmissions(false)}
          onRefresh={() => fetchSubmissions(setSubmissions)}
          onForward={sub => {
            const sm = sub.extracted_metrics || {};
            const diags = sub.diagnosis_codes || [];
            const entry = {
              caseId:          `SUB-${sub.submission_id.substring(0, 8).toUpperCase()}`,
              submissionId:    sub.submission_id,
              memberName:      sub.member_name       || "Unknown",
              memberId:        sub.member_id         || "—",
              dob:             sub.dob               || "—",
              discipline:      sub.discipline        || "PT",
              reviewType:      sub.review_type       || "initial",
              submittedAt:     sub.submitted_at,
              documents:       (sub.document_list || []).map(name => typeof name === "string" ? { name, type: "Provider Document", date: null } : name),
              contract:        buildSubmissionContract(sub),
              isSubmission:    true,
              providerName:    sub.provider_name     || null,
              diagnosisCodes:  sm.diagnosisCodes?.length ? sm.diagnosisCodes : diags,
              // Persisted submissions.requested_visits is authoritative (it's already the
              // merged provider-input-wins value /v1/submit-with-docs computed) — the raw
              // Claude extraction (sm.requestedVisits) must not take precedence over it.
              requestedVisits: sub.requested_visits || sm.requestedVisits || null,
              providerNotes:   sub.provider_notes    || null,
              metrics:         { diagnosisCodes: diags, requestedVisits: sub.requested_visits||0, functionalLimitations:[], sopIndicators:[], documentationQuality:{}, ...sm, diagnosisCodes: sm.diagnosisCodes?.length ? sm.diagnosisCodes : diags, primaryDiagnosisCode: sm.primaryDiagnosisCode || diags[0] || null, requestedVisits: sub.requested_visits || 0, dateOfBirth: sm.dateOfBirth || sub.dob || null },
            };
            setSubmissionCases(prev => {
              if (prev.some(c => c.caseId === entry.caseId)) return prev;
              return [entry, ...prev];
            });
            setCursor(liveCaseEntry ? 1 : 0);
            setShowSubmissions(false);
          }}
        />
      )}
    </div>
  );
}
