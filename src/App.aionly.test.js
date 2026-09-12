/**
 * Render test for the AI-only demo form.
 *
 * This project has no `eslintConfig` in package.json, so CRA falls back to
 * eslint-config-react-app/base — which enables exactly two rules. Neither
 * no-unused-vars nor react-hooks/rules-of-hooks is enforced, so `npm run build`
 * passing proves only that the file parses. This test is the actual safety net:
 * it mounts App, drives a real run against the recorded API response, and
 * asserts the things a reviewer relies on are actually on screen.
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
import run3x from "./__fixtures__/aionlyRun3x.sample.json";

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

describe("AI-only demo form", () => {
  test("renders all four input sections and both run buttons", () => {
    mount();
    expect(text()).toContain("Case context");
    expect(text()).toContain("Clinical source");
    expect(text()).toContain("Override what the documents say");
    expect(text()).toContain("Requested visits");
    // "leave blank to read from the plan of care" help text
    expect(text()).toContain("Leave blank to read from the plan of care.");
    // the standalone / Auth Intelligence path
    expect(text()).toContain("copied from Auth Intelligence");
    expect(buttonNamed("Run")).toBeTruthy();
    expect(buttonNamed("Run 3×")).toBeTruthy();
  });

  test("section 4 appears only for a subsequent review", () => {
    mount();
    expect(text()).not.toContain("Prior determination");
    click(buttonNamed("subsequent"));
    expect(text()).toContain("Prior determination");
    expect(text()).toContain("Paste the prior reviewer's determination note");
  });

  test("posts to /v1/aionly/evaluate — never to the rules-engine route", async () => {
    axios.post.mockResolvedValue({ data: sample });
    mount();
    setInput(container.querySelector('input[type="number"]'), "8");
    await act(async () => { buttonNamed("Run").click(); });

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toMatch(/\/v1\/aionly\/evaluate$/);
    expect(url).not.toMatch(/generate-review/);
    expect(body.get("runCount")).toBe("1");
    expect(body.get("requestedVisits")).toBe("8");
  });

  test("Run 3× requests three determination runs", async () => {
    axios.post.mockResolvedValue({ data: sample });
    mount();
    setInput(container.querySelector('input[type="number"]'), "8");
    await act(async () => { buttonNamed("Run 3×").click(); });
    expect(axios.post.mock.calls[0][1].get("runCount")).toBe("3");
  });

  test("requested visits is required before a run is attempted", async () => {
    mount();
    await act(async () => { buttonNamed("Run").click(); });
    expect(axios.post).not.toHaveBeenCalled();
    expect(text()).toContain("Requested visits is required.");
  });

  describe("with a result rendered", () => {
    beforeEach(async () => {
      axios.post.mockResolvedValue({ data: sample });
      mount();
      setInput(container.querySelector('input[type="number"]'), "8");
      await act(async () => { buttonNamed("Run").click(); });
    });

    test("left panel shows extracted values with provenance markers", () => {
      expect(text()).toContain("Extraction");
      expect(text()).toContain("Objective measures");
      // provenance tags
      expect(text()).toContain("document");
      expect(text()).toContain("entered");
      // baseline comparison on a subsequent review: "125° (95°)"
      expect(text()).toMatch(/125°\s*\(95°\)/);
    });

    test("right panel shows the determination and the model's own benchmarks prominently", () => {
      const t = text();
      expect(t).toContain("Determination and note");
      // model-stated benchmark block, styled as a claim
      expect(t).toContain("Benchmarks stated by the model");
      expect(t).toContain("unverified claim");
      expect(t).toContain("Guideline it says it applied");
      // benchmarkSource must be on screen in full, not buried
      expect(t).toContain("Where it says the figures come from");
      expect(t).toContain(sample.runs[0].benchmarkSource.slice(0, 40));
      // the numbers themselves
      expect(t).toContain(String(sample.runs[0].benchmarkMaxVisits));
      expect(t).toContain(String(sample.runs[0].benchmarkTypicalVisits));
      // basis strip
      expect(t).toContain("Severity basis");
      expect(t).toContain("Rule applied");
      expect(t).toContain("Facts relied on");
      expect(t).toContain("Citation — unverified");
    });

    test("guardrail results are displayed", () => {
      const t = text();
      const errs = sample.runs[0].guardrails.filter((g) => g.severity === "error");
      if (errs.length) {
        expect(t).toContain("guardrail");
        expect(t).toContain(errs[0].check);
      }
      expect(t).toContain("have not been verified against a source");
    });

    test("the note is rendered, editable, and edits do not touch the ruling", () => {
      const ta = Array.from(container.querySelectorAll("textarea"))
        .find((t) => t.value && t.value.includes("Determination and Rationale:"));
      expect(ta).toBeTruthy();
      expect(ta.value).toContain("Approved Visits:");
      setInput(ta, ta.value + "\n\nREVIEWER EDIT");
      expect(ta.value).toContain("REVIEWER EDIT");
      // the stored ruling is untouched
      expect(sample.runs[0].note).not.toContain("REVIEWER EDIT");
      expect(buttonNamed("Copy Note")).toBeTruthy();
    });

    test("telemetry strip reports per-call cost, tokens, model and visitsToDateSource", () => {
      const t = text();
      expect(t).toContain("extraction");
      expect(t).toContain("determination[1]");
      expect(t).toContain("claude-sonnet-5");
      expect(t).toContain("visitsToDateSource");
      expect(t).toContain(sample.visitsToDateSource);
      expect(t).toContain("TOTAL");
    });

    test("raw JSON sections are present and collapsed by default", () => {
      expect(text()).toContain("Raw extraction JSON");
      expect(text()).toContain("Raw determination JSON");
      expect(container.querySelectorAll("pre").length).toBe(0);
      click(buttonNamed("▸ Raw extraction JSON"));
      expect(container.querySelectorAll("pre").length).toBe(1);
    });
  });

  test("absence is stated explicitly rather than rendered as nothing", async () => {
    // A section with no data must say so. Rendering nothing makes a missing
    // measure indistinguishable from a measure the document never took.
    const missing = {
      ...sample,
      resolved: { ...sample.resolved, rom: null, romComparison: null, functionalOutcomeScore: null, specialTests: null },
      provenance: { ...sample.provenance, rom: "absent", functionalOutcomeScore: "absent", specialTests: "absent" },
    };
    axios.post.mockResolvedValue({ data: missing });
    mount();
    setInput(container.querySelector('input[type="number"]'), "8");
    await act(async () => { buttonNamed("Run").click(); });

    const t = text();
    expect(t).toContain("No range of motion documented in this note");
    expect(t).toContain("No standardized outcome measure documented in this note");
    expect(t).toContain("No special tests documented in this note");
    expect(t).toContain("absent");
  });

  test("the no-clinical-source path explains why extraction did not run", async () => {
    const noSource = {
      ...sample,
      extraction: { ran: false, skipReason: "No PDFs and no pasted clinical text were supplied.", pastedTextRendered: false, documentSummary: null, raw: null },
    };
    axios.post.mockResolvedValue({ data: noSource });
    mount();
    setInput(container.querySelector('input[type="number"]'), "8");
    await act(async () => { buttonNamed("Run").click(); });

    expect(text()).toContain("Extraction did not run");
    expect(text()).toContain("proceeded on manually");
  });

  test("a discrepancy is surfaced above the clinical data in its own block", async () => {
    const withDiscrepancy = {
      ...sample,
      discrepancies: [{
        field: "visitsToDate", used: 14, usedSource: "manual",
        alsoFound: 21, alsoSource: "extracted",
        note: "Manual entry differs from the value found in the documentation.",
      }],
    };
    axios.post.mockResolvedValue({ data: withDiscrepancy });
    mount();
    setInput(container.querySelector('input[type="number"]'), "8");
    await act(async () => { buttonNamed("Run").click(); });

    const t = text();
    expect(t).toContain("1 source disagreement");
    expect(t).toContain("visitsToDate");
    expect(t).toContain("Documentation states");
    expect(t).toContain("Manual entry differs from the value found in the documentation.");
  });

  test("a prior-note suggestion is offered for confirmation and never auto-applied", async () => {
    const withSuggestion = {
      ...sample,
      priorNoteSuggestion: {
        visitsToDate: 14,
        excerpt: "Approved 14 visits at 2x/week x 7 weeks",
        message: "Prior note appears to state 14 visits approved. Confirm to use.",
      },
    };
    axios.post.mockResolvedValue({ data: withSuggestion });
    mount();
    click(buttonNamed("subsequent"));
    setInput(container.querySelector('input[type="number"]'), "8");
    await act(async () => { buttonNamed("Run").click(); });

    expect(text()).toContain("Prior note appears to state 14 visits approved");
    expect(text()).toContain("Approved 14 visits at 2x/week x 7 weeks");

    // Nothing is populated until the reviewer clicks.
    const vtdBefore = Array.from(container.querySelectorAll("input"))
      .filter((i) => i.type === "number").map((i) => i.value);
    expect(vtdBefore).not.toContain("14");

    click(buttonNamed("Accept"));
    const vtdAfter = Array.from(container.querySelectorAll("input"))
      .filter((i) => i.type === "number").map((i) => i.value);
    expect(vtdAfter).toContain("14");
    expect(text()).toContain("Accepted from the prior reviewer's note.");
  });

  test("a validation failure renders as PEND with its specific failures, not an error", async () => {
    const pended = {
      ...sample,
      determination: "PEND",
      determinationSource: "validation",
      validation: {
        passed: false,
        failures: [
          { check: "objectiveMeasurePresent", message: "No clinical source was supplied, so no objective measure is available." },
          { check: "diagnosisCodePresent", message: "No diagnosis code was found in the documentation or entered manually." },
        ],
      },
      runs: [],
    };
    axios.post.mockResolvedValue({ data: pended });
    mount();
    setInput(container.querySelector('input[type="number"]'), "8");
    await act(async () => { buttonNamed("Run").click(); });

    const t = text();
    expect(t).toContain("Pend — validation did not pass");
    expect(t).toContain("objectiveMeasurePresent");
    expect(t).toContain("diagnosisCodePresent");
    expect(t).toContain("No determination was produced for this case.");
  });
});

/* ── PHASE 4 — INSTRUMENTATION ─────────────────────────────────────────────── */

/** Build a 3-run payload from the sample, applying per-run overrides. */
function threeRuns(overrides) {
  const base = sample.runs[0];
  return {
    ...sample,
    runs: overrides.map((o, i) => ({ ...base, runIndex: i + 1, guardrails: [], ...o })),
  };
}

async function runWith(data) {
  axios.post.mockResolvedValue({ data });
  mount();
  setInput(container.querySelector('input[type="number"]'), "8");
  await act(async () => { buttonNamed("Run 3×").click(); });
}

describe("Run 3× — self-consistency", () => {
  test("three identical runs produce the identical headline", async () => {
    await runWith(threeRuns([{}, {}, {}]));
    expect(text()).toContain("Self-consistency — 3 runs, one extraction");
    expect(text()).toContain("3/3 identical");
    expect(text()).toContain("same determination, visit count, severity and stated benchmarks");
  });

  test("a differing visit count is named in the headline", async () => {
    await runWith(threeRuns([{}, { approvedVisits: 6 }, {}]));
    const t = text();
    expect(t).toContain("3/3 agreed on determination");
    expect(t).toContain("the visit count differed");
    expect(t).not.toContain("3/3 identical");
  });

  test("a split determination is reported as a majority", async () => {
    await runWith(threeRuns([
      {},
      { determination: "APPROVED", approvedVisits: 8 },
      {},
    ]));
    expect(text()).toContain("2/3 agreed on determination");
  });

  test("benchmark drift gets its own explicit callout", async () => {
    await runWith(threeRuns([{}, { benchmarkMaxVisits: 30 }, {}]));
    const t = text();
    expect(t).toContain("the episode-max benchmark differed");
    expect(t).toContain("different visit benchmarks for the same diagnosis on");
  });

  test("guideline wording drift is distinguished from figure drift", async () => {
    await runWith(threeRuns([{}, { guidelineApplied: "A completely different guideline" }, {}]));
    const t = text();
    expect(t).toContain("Benchmark figures held steady, but the guideline was named differently");
  });

  test("side-by-side table shows every run and a per-field agreement count", async () => {
    await runWith(threeRuns([{}, { severityAssigned: "moderate" }, {}]));
    const t = text();
    expect(t).toContain("Run 1"); expect(t).toContain("Run 2"); expect(t).toContain("Run 3");
    expect(t).toContain("Benchmark — typical");
    expect(t).toContain("Benchmark — episode max");
    expect(t).toContain("Benchmark — max freq/wk");
    expect(t).toContain("Guideline named");
    expect(t).toContain("Rule applied");
    expect(t).toContain("Guardrail failures");
    expect(t).toContain("2/3");   // severity split
    expect(t).toContain("3/3");   // fields that held
  });

  test("an errored run is shown rather than dropped", async () => {
    await runWith(threeRuns([{}, { ok: false, error: "unparseable JSON" }, {}]));
    const t = text();
    expect(t).toContain("errored");
    expect(t).toContain("1 run errored");
  });

  test("note diffs compare runs 2 and 3 against run 1", async () => {
    await runWith(threeRuns([{}, { note: sample.runs[0].note.replace("Approved Visits", "Authorized Visits") }, {}]));
    const t = text();
    expect(t).toContain("Note text — runs 2 and 3 against run 1");
    expect(t).toContain("Run 2 vs run 1");
    expect(t).toContain("Run 3 vs run 1");
    expect(t).toContain("byte-identical to run 1");   // run 3
    expect(t).toMatch(/Run 2 vs run 1\s*—\s*\d+ change/);
  });
});

describe("Session log", () => {
  test("appends a row per run and reports agreement", async () => {
    await runWith(threeRuns([{}, {}, {}]));
    const t = text();
    expect(t).toContain("Session log");
    expect(t).toContain("1 case ·");
    expect(t).toContain("in memory only, lost on reload");
    expect(t).toContain("Export CSV");
    // headline is carried into the row
    expect(t).toContain("3/3 identical");
  });

  test("accumulates across runs and clears on demand", async () => {
    await runWith(threeRuns([{}, {}, {}]));
    await act(async () => { buttonNamed("Run 3×").click(); });
    expect(text()).toContain("2 cases ·");
    click(buttonNamed("Clear"));
    expect(text()).not.toContain("Session log");
  });

  test("a validation pend is logged, not skipped", async () => {
    const pended = {
      ...sample, determination: "PEND", determinationSource: "validation",
      validation: { passed: false, failures: [{ check: "objectiveMeasurePresent", message: "none" }] },
      runs: [],
    };
    axios.post.mockResolvedValue({ data: pended });
    mount();
    setInput(container.querySelector('input[type="number"]'), "8");
    await act(async () => { buttonNamed("Run").click(); });
    expect(text()).toContain("Session log");
    expect(text()).toContain("PEND (validation)");
    expect(text()).toContain("not run — validation pend");
  });

  test("CSV export triggers a download with a header row and one row per case", async () => {
    // jsdom's Blob has no .text(), so capture the CSV at construction instead.
    const captured = [];
    const OrigBlob = global.Blob;
    global.Blob = function (parts, opts) { captured.push(String(parts.join(""))); return new OrigBlob(parts, opts); };
    const created = [];
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (blob) => { created.push(blob); return "blob:mock"; };
    URL.revokeObjectURL = () => {};
    const origClick = window.HTMLAnchorElement.prototype.click;
    let downloadName = "";
    window.HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };

    // The real 3-run response: its agreement sentence lists three drifted fields
    // and therefore contains a comma, so the quoting path actually runs.
    await runWith(run3x);
    click(buttonNamed("Export CSV"));

    expect(created.length).toBe(1);
    expect(downloadName).toMatch(/^aionly_session_\d{8}_\d{4}\.csv$/);
    expect(captured.length).toBe(1);
    const lines = captured[0].trim().split("\n");
    expect(lines[0]).toContain("Time,Review,Dx,Source,Req,VTD");
    expect(lines[0]).toContain("Agreement");
    expect(lines[0]).toContain("Cost $");
    expect(lines.length).toBe(2);
    // The agreement sentence contains a comma, so it must arrive quoted — an
    // unquoted comma would silently shift every column after it.
    expect(lines[1]).toContain('"3/3 agreed on determination and the visit count;');
    expect(lines[1]).toContain('the typical-visit benchmark and the episode-max benchmark differed."');
    // and the row still parses to exactly one field per header column
    const fields = lines[1].match(/("([^"]|"")*"|[^,]*)(,|$)/g).filter((f, i, a) => i < a.length - 1);
    expect(fields.length).toBe(lines[0].split(",").length);

    global.Blob = OrigBlob;
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
    window.HTMLAnchorElement.prototype.click = origClick;
  });
});

/* ── GROUNDED IN REAL OUTPUT ───────────────────────────────────────────────
 * run3x fixture is a genuine 3-run response: identical input, one extraction
 * reused across three determination calls. The runs agreed on the ruling and
 * disagreed on the benchmarks they claimed to be applying it against — the
 * exact shape of finding this instrumentation exists to surface, so it is
 * pinned here rather than described.
 */
describe("Run 3× against a real recorded response", () => {
  beforeEach(async () => {
    axios.post.mockResolvedValue({ data: run3x });
    mount();
    setInput(container.querySelector('input[type="number"]'), "8");
    await act(async () => { buttonNamed("Run 3×").click(); });
  });

  test("the headline separates the ruling that held from the benchmarks that moved", () => {
    const t = text();
    expect(t).toContain("3/3 agreed on determination and the visit count");
    expect(t).toContain("the typical-visit benchmark");
    expect(t).toContain("differed");
    expect(t).not.toContain("3/3 identical");
  });

  test("benchmark drift raises the explicit downstream-instability warning", () => {
    expect(text()).toContain("different visit benchmarks for the same diagnosis on");
  });

  test("all three determinations and all three benchmark sets are on screen", () => {
    const t = text();
    // the ruling every run reached
    expect(t).toContain("Partial Denial — Taper");
    // the three distinct typical-visit benchmarks
    for (const v of run3x.runs.map((r) => String(r.benchmarkTypicalVisits))) {
      expect(t).toContain(v);
    }
  });

  test("guardrails that fired on real runs are shown per run", () => {
    const t = text();
    expect(t).toContain("possibleFabricatedClinicalValue");
    expect(t).toContain("noteFrequencyMismatch");
    expect(t).toContain("none");   // run 2 tripped no errors
  });

  test("the three notes are diffed and none is byte-identical", () => {
    const t = text();
    expect(t).toContain("Run 2 vs run 1");
    expect(t).toContain("Run 3 vs run 1");
    expect(t).not.toContain("byte-identical to run 1");
  });
});
