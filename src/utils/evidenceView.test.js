import { evidenceViewFor, evidenceSummaryLine } from "./evidenceView";

// SYNTHETIC data only.
test("therapy disciplines keep the therapy layout", () => {
  for (const discipline of ["PT", "OT", "ST", "pt", " st "]) {
    expect(evidenceViewFor({ discipline })).toBe("therapy");
  }
});

test("a case with no discipline falls back to the therapy layout", () => {
  expect(evidenceViewFor({})).toBe("therapy");
  expect(evidenceViewFor({ discipline: null })).toBe("therapy");
  expect(evidenceViewFor(null)).toBe("therapy");
});

test("every other line of business uses the pack view", () => {
  for (const discipline of ["CARDIOLOGY", "ORTHOPEDICS", "IMAGING", "imaging"]) {
    expect(evidenceViewFor({ discipline })).toBe("pack");
  }
});

test("summary line separates findings from documents", () => {
  expect(evidenceSummaryLine(null)).toBe("");
  expect(evidenceSummaryLine({ summary: { fieldsPresent: 2, fieldsTotal: 6, documentsMissing: 0 } }))
    .toBe("2 of 6 findings on file · all required documents on file");
  expect(evidenceSummaryLine({ summary: { fieldsPresent: 0, fieldsTotal: 6, documentsMissing: 1 } }))
    .toBe("0 of 6 findings on file · 1 required document not on file");
  expect(evidenceSummaryLine({ summary: { fieldsPresent: 0, fieldsTotal: 6, documentsMissing: 3 } }))
    .toBe("0 of 6 findings on file · 3 required documents not on file");
});
