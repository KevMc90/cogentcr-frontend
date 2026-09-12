/**
 * Render test for the AI Auth Demo form.
 *
 * This project has no `eslintConfig` in package.json, so CRA falls back to
 * eslint-config-react-app/base — which enables exactly two rules. Neither
 * no-unused-vars nor react-hooks/rules-of-hooks is enforced, so `npm run build`
 * passing proves only that the file parses. This test is the actual safety net:
 * it mounts App, drives a real run against a recorded API response, and asserts
 * the things a reviewer relies on are actually on screen — and that the things
 * deliberately removed from the demo view stay removed.
 *
 * The fixture in __fixtures__/aionlyResult.sample.json is a genuine
 * POST /v1/aionly/evaluate response (PCL subsequent review, both PDFs, manual
 * visits-to-date 14), not a hand-written mock.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { act } from "react-dom/test-utils";
import axios from "axios";
import App from "./App";
import sample from "./__fixtures__/aionlyResult.sample.json";

jest.mock("axios");

// React 18 wants this flag before it will accept act() without warning.
global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  localStorage.setItem("cogentus_token", "test-token");
  localStorage.setItem("cogentus_user", JSON.stringify({ name: "Test Reviewer", email: "t@e.st" }));
  container = document.createElement("div");
  document.body.appendChild(container);
  axios.post.mockReset();
});

afterEach(() => {
  act(() => { if (root) root.unmount(); });
  container.remove();
  localStorage.clear();
});

function mount() {
  act(() => {
    root = ReactDOM.createRoot(container);
    root.render(<App />);
  });
}

const text = () => container.textContent;
const buttonNamed = (label) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === label);
const RUN = "Extract and Review";

function click(el) {
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

/** Set a controlled React input's value and fire the change React listens for. */
function setInput(el, value) {
  const proto = el.tagName === "TEXTAREA"
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}

async function runWith(data, { subsequent = false } = {}) {
  axios.post.mockResolvedValue({ data });
  mount();
  if (subsequent) click(buttonNamed("subsequent"));
  setInput(container.querySelector('input[type="number"]'), "8");
  await act(async () => { buttonNamed(RUN).click(); });
}

describe("AI Auth Demo form", () => {
  test("header is the demo title only — no product name, no reviewer name, no badge", () => {
    mount();
    const t = text();
    expect(t).toContain("AI Auth Demo");
    expect(t).not.toContain("CogentCR");
    expect(t).not.toContain("AI-only demo");
    expect(t).not.toContain("Test Reviewer");
    expect(buttonNamed("Log out")).toBeTruthy();
  });

  test("renders the input sections and a single Extract and Review button", () => {
    mount();
    const t = text();
    expect(t).toContain("Case context");
    expect(t).toContain("Clinical source");
    expect(t).toContain("Override what the documents say");
    expect(t).toContain("Leave blank to read from the plan of care.");
    expect(t).toContain("copied from Auth Intelligence");
    expect(buttonNamed(RUN)).toBeTruthy();
    expect(buttonNamed("Run")).toBeUndefined();
    expect(buttonNamed("Run 3×")).toBeUndefined();
    // the architecture blurb is gone
    expect(t).not.toContain("No rules engine");
  });

  test("section 4 appears only for a subsequent review", () => {
    mount();
    expect(text()).not.toContain("Prior determination");
    click(buttonNamed("subsequent"));
    expect(text()).toContain("Prior determination");
  });

  test("posts one run to /v1/aionly/evaluate — never to the rules-engine route", async () => {
    await runWith(sample);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toMatch(/\/v1\/aionly\/evaluate$/);
    expect(url).not.toMatch(/generate-review/);
    expect(body.get("runCount")).toBe("1");
    expect(body.get("requestedVisits")).toBe("8");
  });

  test("requested visits is required before a run is attempted", async () => {
    mount();
    await act(async () => { buttonNamed(RUN).click(); });
    expect(axios.post).not.toHaveBeenCalled();
    expect(text()).toContain("Requested visits is required.");
  });

  describe("with a result rendered", () => {
    beforeEach(async () => { await runWith(sample); });

    test("left panel shows extracted values with provenance markers and baseline comparison", () => {
      const t = text();
      expect(t).toContain("Extraction");
      expect(t).toContain("Objective measures");
      expect(t).toContain("document");
      expect(t).toContain("entered");
      expect(t).toMatch(/125°\s*\(95°\)/);
    });

    test("right panel is titled Recommendation and note and carries the basis without severity", () => {
      const t = text();
      expect(t).toContain("Recommendation and note");
      expect(t).not.toContain("Determination and note");
      expect(t).toContain("Rule applied");
      expect(t).toContain("Facts relied on");
      expect(t).toContain("Citation");
      // severity is backend-only now
      expect(t).not.toContain("Severity basis");
      expect(t).not.toMatch(/Severity\s*(mild|moderate|severe)/);
    });

    test("benchmarks block is present with neutral wording and the model's stated source", () => {
      const t = text();
      expect(t).toContain("Benchmarks and guideline applied");
      expect(t).toContain("Guideline applied");
      expect(t).toContain("Source of the figures");
      expect(t).toContain(sample.runs[0].benchmarkSource.slice(0, 40));
      expect(t).toContain(String(sample.runs[0].benchmarkMaxVisits));
      expect(t).not.toContain("unverified");
    });

    test("guardrail and ambiguity boxes are not shown in the demo view", () => {
      const t = text();
      expect(t).not.toContain("guardrail");
      expect(t).not.toContain("have not been verified against a source");
      expect(t).not.toContain("The model flagged this as a judgment call");
      // still present in the raw JSON for anyone who opens it
      click(buttonNamed("▸ Raw determination JSON"));
      expect(container.querySelector("pre").textContent).toContain("severityAssigned");
    });

    test("the composed note sits in its own full-width block, sized to its content, editable, with Copy Note", () => {
      const ta = Array.from(container.querySelectorAll("textarea"))
        .find((x) => x.value && x.value.includes("Determination and Rationale:"));
      expect(ta).toBeTruthy();
      expect(ta.value).toContain("Approved Visits:");
      expect(ta.style.overflow).toBe("hidden");   // no inner scrolling
      expect(ta.style.maxHeight).toBe("");        // no cap
      expect(text()).toContain("Composed note");
      setInput(ta, ta.value + "\n\nREVIEWER EDIT");
      expect(ta.value).toContain("REVIEWER EDIT");
      expect(sample.runs[0].note).not.toContain("REVIEWER EDIT");
      expect(buttonNamed("Copy Note")).toBeTruthy();
      // it is a sibling of the two panels, not nested inside the right panel
      const noteCard = ta.closest("div[style]").parentElement;
      expect(noteCard.textContent).not.toContain("Recommendation and note");
    });

    test("telemetry strip reports per-call cost, tokens, model and visitsToDateSource", () => {
      const t = text();
      expect(t).toContain("determination[1]");
      expect(t).toContain("claude-sonnet-5");
      expect(t).toContain("visitsToDateSource");
      expect(t).toContain("TOTAL");
    });

    test("raw JSON sections are present and collapsed by default", () => {
      expect(text()).toContain("Raw extraction JSON");
      expect(text()).toContain("Raw determination JSON");
      expect(container.querySelectorAll("pre").length).toBe(0);
    });
  });

  test("absence is stated explicitly rather than rendered as nothing", async () => {
    const missing = {
      ...sample,
      resolved: { ...sample.resolved, rom: null, romComparison: null, functionalOutcomeScore: null, specialTests: null },
      provenance: { ...sample.provenance, rom: "absent", functionalOutcomeScore: "absent", specialTests: "absent" },
    };
    await runWith(missing);
    const t = text();
    expect(t).toContain("No range of motion documented in this note");
    expect(t).toContain("No standardized outcome measure documented in this note");
    expect(t).toContain("No special tests documented in this note");
  });

  test("the no-clinical-source path explains why extraction did not run", async () => {
    await runWith({
      ...sample,
      extraction: { ran: false, skipReason: "No PDFs and no pasted clinical text were supplied.", pastedTextRendered: false, documentSummary: null, raw: null },
    });
    expect(text()).toContain("Extraction did not run");
  });

  test("a source disagreement about the reviewer's own input is still surfaced", async () => {
    await runWith({
      ...sample,
      discrepancies: [{ field: "visitsToDate", used: 14, usedSource: "manual", alsoFound: 21, alsoSource: "extracted",
                        note: "Manual entry differs from the value found in the documentation." }],
    });
    const t = text();
    expect(t).toContain("1 source disagreement");
    expect(t).toContain("Documentation states");
  });

  test("a prior-note suggestion is offered for confirmation and never auto-applied", async () => {
    await runWith({
      ...sample,
      priorNoteSuggestion: { visitsToDate: 14, excerpt: "Approved 14 visits at 2x/week x 7 weeks",
                             message: "Prior note appears to state 14 visits approved. Confirm to use." },
    }, { subsequent: true });
    expect(text()).toContain("Prior note appears to state 14 visits approved");
    const before = Array.from(container.querySelectorAll("input")).filter((i) => i.type === "number").map((i) => i.value);
    expect(before).not.toContain("14");
    click(buttonNamed("Accept"));
    const after = Array.from(container.querySelectorAll("input")).filter((i) => i.type === "number").map((i) => i.value);
    expect(after).toContain("14");
  });

  test("a prior-plan assessment is shown when a prior note was supplied", async () => {
    await runWith({
      ...sample,
      resolved: { ...sample.resolved, priorRationale: "Approved 14 visits. Anticipate taper once quads approach 4+/5." },
      runs: [{ ...sample.runs[0], priorPlanReferenced: true, priorPlanConditionsMet: true,
               priorPlanAssessment: "Quadriceps now 4/5; conditions met." }],
    }, { subsequent: true });
    const t = text();
    expect(t).toContain("Prior plan assessment");
    expect(t).toContain("Quadriceps now 4/5; conditions met.");
  });

  test("a validation failure renders as PEND with its specific failures, not an error", async () => {
    await runWith({
      ...sample, determination: "PEND", determinationSource: "validation",
      validation: { passed: false, failures: [
        { check: "objectiveMeasurePresent", message: "No clinical source was supplied, so no objective measure is available." },
      ] },
      runs: [],
    });
    const t = text();
    expect(t).toContain("Pend — validation did not pass");
    expect(t).toContain("objectiveMeasurePresent");
    expect(t).toContain("No recommendation was produced for this case.");
    expect(t).not.toContain("Composed note");
  });
});

describe("Session log", () => {
  test("appends a row per run without run-count or agreement columns, and clears", async () => {
    await runWith(sample);
    let t = text();
    expect(t).toContain("Session log");
    expect(t).toContain("1 case ·");
    expect(t).toContain("Recommendation");
    expect(t).not.toContain("Agreement");
    expect(t).not.toContain("identical");
    await act(async () => { buttonNamed(RUN).click(); });
    expect(text()).toContain("2 cases ·");
    click(buttonNamed("Clear"));
    expect(text()).not.toContain("Session log");
  });

  test("a validation pend is logged, not skipped", async () => {
    await runWith({
      ...sample, determination: "PEND", determinationSource: "validation",
      validation: { passed: false, failures: [{ check: "objectiveMeasurePresent", message: "none" }] }, runs: [],
    });
    expect(text()).toContain("PEND (validation)");
  });

  test("CSV export produces a header row and one row per case with matching column counts", async () => {
    // jsdom's Blob has no .text(), so capture the CSV at construction instead.
    const captured = [];
    const OrigBlob = global.Blob;
    global.Blob = function (parts, opts) { captured.push(String(parts.join(""))); return new OrigBlob(parts, opts); };
    const origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:mock"; URL.revokeObjectURL = () => {};
    const origClick = window.HTMLAnchorElement.prototype.click;
    let downloadName = "";
    window.HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };

    await runWith(sample);
    click(buttonNamed("Export CSV"));

    expect(downloadName).toMatch(/^aionly_session_\d{8}_\d{4}\.csv$/);
    expect(captured.length).toBe(1);
    const lines = captured[0].trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("Time,Review,Dx,Source,Req,VTD");
    expect(lines[0]).toContain("Recommendation");
    expect(lines[0]).not.toContain("Agreement");
    const fields = lines[1].match(/("([^"]|"")*"|[^,]*)(,|$)/g).filter((f, i, a) => i < a.length - 1);
    expect(fields.length).toBe(lines[0].split(",").length);

    global.Blob = OrigBlob;
    URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke;
    window.HTMLAnchorElement.prototype.click = origClick;
  });
});
