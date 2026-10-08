import { submissionToCockpitCase } from "./cockpitCase";

test("submitted values win over extraction for requestedVisits and diagnoses", () => {
  const c = submissionToCockpitCase({
    submission_id: "s1", member_name: "SYNTHETIC Member", discipline: "ST", plan_id: "p1",
    requested_visits: 12, diagnosis_codes: ["F80.1"],
    extracted_metrics: { requestedVisits: 99, diagnosisCodes: [] },
  });
  expect(c.caseId).toBe("s1");
  expect(c.discipline).toBe("ST");
  expect(c.metrics.requestedVisits).toBe(12);
  expect(c.metrics.diagnosisCodes).toEqual(["F80.1"]);
  expect(c.planRuleSet).toEqual({ planId: "p1" });
});

test("a case with no discipline falls back instead of crashing the Cockpit", () => {
  const c = submissionToCockpitCase({ submission_id: "s2" }, "PT");
  expect(c.discipline).toBe("PT");
  expect(c.planRuleSet).toBeNull();
});
