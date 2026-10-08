import React from "react";
import { renderToString } from "react-dom/server";
import Cockpit, { PackEvidenceBody } from "./Cockpit";
import { submissionToCockpitCase } from "../utils/cockpitCase";

// SYNTHETIC data only. Server render runs no effects, so no network calls are made.
const liveCase = submissionToCockpitCase({
  submission_id: "SYN-1", member_name: "SYNTHETIC Member", member_id: "SYN-M1", discipline: "PT",
  plan_id: "p1", requested_visits: 12, diagnosis_codes: ["M17.11"], extracted_metrics: {},
}, "PT");

test("Cockpit renders the redesigned layout without crashing", () => {
  const html = renderToString(
    <Cockpit user={{ name: "SYNTHETIC Reviewer", role: "reviewer" }} onBack={() => {}} liveCase={liveCase} />
  );
  expect(html).toContain("CogentCR");
  expect(html).toContain("SYN-1");
  expect(html).toContain("More");
});

describe("PackEvidenceBody", () => {
  const kneeCase = submissionToCockpitCase({
    submission_id: "SYN-2", member_name: "SYNTHETIC Member", member_id: "SYN-M2", discipline: "ORTHOPEDICS",
    diagnosis_codes: ["M17.11"], document_list: ["orthopedic_evaluation"],
  }, "ORTHOPEDICS");
  const evidence = {
    pack: { id: "knee-replacement", name: "Knee replacement", version: "1.0.0" },
    groups: [
      { title: "Condition", fields: [
        { key: "radiographicGrade", label: "Radiographic grade", present: true, value: "4" },
        { key: "activeInfection", label: "Active infection", present: false, value: null },
      ] },
    ],
    documents: [
      { type: "orthopedic_evaluation", label: "Orthopedic evaluation", optional: false, present: true },
      { type: "knee_radiograph_report", label: "Knee radiograph report", optional: false, present: false },
    ],
    summary: { fieldsPresent: 1, fieldsTotal: 2, documentsMissing: 1 },
  };

  test("shows pack fields with explicit not-on-file states", () => {
    const html = renderToString(<PackEvidenceBody kase={kneeCase} evidence={evidence} status="ready" />);
    expect(html).toContain("Knee replacement");
    expect(html).toContain("Radiographic grade");
    expect(html).toContain("Not on file");
    expect(html).toContain("1 of 2 findings on file");
    expect(html).toContain("Knee radiograph report");
    expect(html).not.toMatch(/ROM|MMT|Pain/);
  });

  test("renders a clear state when no evidence layout is available", () => {
    const html = renderToString(<PackEvidenceBody kase={kneeCase} evidence={null} status="ready" />);
    expect(html).toContain("No evidence layout for this service");
  });

  test("Cockpit routes a non-therapy case to the pack view", () => {
    const html = renderToString(
      <Cockpit user={{ name: "SYNTHETIC Reviewer", role: "reviewer" }} liveCase={kneeCase} />
    );
    expect(html).toContain("Loading evidence");
  });
});
