import React from "react";
import { renderToString } from "react-dom/server";
import Cockpit from "./Cockpit";
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
