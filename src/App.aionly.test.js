/**
 * Render test for the AI Auth Demo form.
 *
 * This project has no `eslintConfig` in package.json, so CRA falls back to
 * eslint-config-react-app/base — which enables exactly two rules. Neither
 * no-unused-vars nor react-hooks/rules-of-hooks is enforced, so `npm run build`
 * passing proves only that the file parses. This test is the actual safety net.
 *
 * The form's flow is: pre-extract on upload (POST /v1/aionly/extract, cached
 * on the file contents) → POST /v1/aionly/recommend (JSON, with the cached
 * extraction) → in split mode, POST /v1/aionly/note streamed as SSE. The
 * single-call route /v1/aionly/evaluate is never called by the form.
 *
 * The fixture in __fixtures__/aionlyResult.sample.json is a genuine
 * single-call response (PCL subsequent review, both PDFs, manual VTD 14).
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { act } from "react-dom/test-utils";
import axios from "axios";
import App from "./App";
import sample from "./__fixtures__/aionlyResult.sample.json";

jest.mock("axios");
global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

// A split-mode recommendation response: the same case, but the run carries
// only the seven recommendation fields — no note, no benchmarks.
const SPLIT_RUN = (() => {
  const r = sample.runs[0];
  return {
    ok: true, runIndex: 1,
    determination: r.determination, approvedVisits: r.approvedVisits,
    approvedFrequency: r.approvedFrequency, approvedDurationWeeks: r.approvedDurationWeeks,
    ruleApplied: r.ruleApplied, factsReliedOn: r.factsReliedOn, citation: r.citation,
    guardrails: [],
    telemetry: { call: "recommendation", model: "claude-sonnet-5", effort: "effort low", thinking: "on",
                 latencyMs: 6100, inputTokens: 3900, outputTokens: 420, stopReason: "end_turn", estimatedCostUsd: 0.012 },
  };
})();
const splitResult = { ...sample, config: { mode: "split", model: "claude-sonnet-5", effort: "low", thinking: "on" },
  runs: [SPLIT_RUN], telemetry: { ...sample.telemetry, determinations: [SPLIT_RUN.telemetry] } };
const singleResult = { ...sample, config: { mode: "single", model: "claude-sonnet-5", effort: "low", thinking: "on" } };

const STREAMED_NOTE = "HPI/Care History:\n36 year old male, PCL tear.\n\nDetermination and Rationale:\nPartial Denial — Taper Indicated: streamed.\n\nApproved Visits:\n4";
function sseBody() {
  const delta = (t) => `data: ${JSON.stringify({ type: "delta", text: t })}\n\n`;
  const done = `data: ${JSON.stringify({ type: "done", note: STREAMED_NOTE,
    telemetry: { call: "note", model: "claude-sonnet-5", effort: "thinking off · effort low", thinking: "off", latencyMs: 9800, firstTokenMs: 900, inputTokens: 4000, outputTokens: 610, stopReason: "end_turn", estimatedCostUsd: 0.014 },
    guardrails: [] })}\n\n`;
  return delta("HPI/Care History:\n36 year old male, PCL tear.") + delta("\n\nDetermination and Rationale:\nPartial Denial — Taper Indicated: streamed.\n\nApproved Visits:\n4") + done;
}

function mockApi({ recommend = splitResult, extract } = {}) {
  axios.post.mockImplementation(async (url) => {
    if (url.endsWith("/v1/aionly/extract")) {
      return { data: extract || { ok: true, extraction: sample.extraction, telemetry: { extraction: sample.telemetry.extraction } } };
    }
    if (url.endsWith("/v1/aionly/recommend")) return { data: recommend };
    throw new Error("unexpected axios.post to " + url);
  });
  global.fetch = jest.fn(async (url) => {
    if (!String(url).endsWith("/v1/aionly/note")) throw new Error("unexpected fetch to " + url);
    return { ok: true, body: null, text: async () => sseBody() };
  });
}

beforeEach(() => {
  localStorage.setItem("cogentus_token", "test-token");
  localStorage.setItem("cogentus_user", JSON.stringify({ name: "Test Reviewer", email: "t@e.st" }));
  container = document.createElement("div");
  document.body.appendChild(container);
  axios.post.mockReset();
  mockApi();
});

afterEach(() => {
  act(() => { if (root) root.unmount(); });
  container.remove();
  localStorage.clear();
  delete global.fetch;
});

function mount() {
  act(() => { root = ReactDOM.createRoot(container); root.render(<App />); });
}
const text = () => container.textContent;
const buttonNamed = (label) => Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === label);
const selectNamed = (label) => container.querySelector(`select[aria-label="${label}"]`);
const RUN = "Extract and Review";

function click(el) { act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function setInput(el, value) {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}
function setSelect(el, value) {
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(el, value);
  act(() => { el.dispatchEvent(new Event("change", { bubbles: true })); });
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 150)); });

async function runReview({ subsequent = false } = {}) {
  if (subsequent) click(buttonNamed("subsequent"));
  setInput(container.querySelector('input[type="number"]'), "8");
  await act(async () => { buttonNamed(RUN).click(); });
  await settle();
}

describe("AI Auth Demo form", () => {
  test("header is the demo title only — no product name, no reviewer name, no badge", () => {
    mount();
    const t = text();
    expect(t).toContain("AI Auth Demo");
    expect(t).not.toContain("CogentCR");
    expect(t).not.toContain("Test Reviewer");
    expect(buttonNamed("Log out")).toBeTruthy();
  });

  test("renders the input sections, the latency controls, and a single Extract and Review button", () => {
    mount();
    const t = text();
    expect(t).toContain("Case context");
    expect(t).toContain("Clinical source");
    expect(t).toContain("Override what the documents say");
    expect(buttonNamed(RUN)).toBeTruthy();
    expect(buttonNamed("Run 3×")).toBeUndefined();
    expect(t).not.toContain("No rules engine");
    expect(selectNamed("Review model").value).toBe("claude-sonnet-5");
    expect(selectNamed("Review effort").value).toBe("low");
    expect(Array.from(selectNamed("Review effort").options).map((o) => o.value)).toEqual(["low", "medium", "high"]);
    expect(selectNamed("Thinking").value).toBe("on");
    expect(selectNamed("Review path").value).toBe("split");
  });

  test("section 4 appears only for a subsequent review", () => {
    mount();
    expect(text()).not.toContain("Prior determination");
    click(buttonNamed("subsequent"));
    expect(text()).toContain("Prior determination");
  });

  test("requested visits is required before a run is attempted", async () => {
    mount();
    await act(async () => { buttonNamed(RUN).click(); });
    expect(axios.post).not.toHaveBeenCalled();
    expect(text()).toContain("Requested visits is required.");
  });

  test("with no clinical source it skips extraction and posts the recommendation with the chosen settings", async () => {
    mount();
    setSelect(selectNamed("Review effort"), "high");
    setSelect(selectNamed("Thinking"), "off");
    await runReview();
    const calls = axios.post.mock.calls.map((c) => c[0]);
    expect(calls.some((u) => u.endsWith("/v1/aionly/extract"))).toBe(false);
    expect(calls.some((u) => u.endsWith("/v1/aionly/evaluate"))).toBe(false);
    const rec = axios.post.mock.calls.find((c) => c[0].endsWith("/v1/aionly/recommend"));
    expect(rec).toBeTruthy();
    const body = rec[1];
    expect(body.requestedVisits).toBe(8);
    expect(body.extraction.ran).toBe(false);
    expect(body.mode).toBe("split");
    expect(body.model).toBe("claude-sonnet-5");
    expect(body.effort).toBe("high");
    expect(body.thinking).toBe("off");
  });

  test("split path: recommendation renders first, then the note streams in and the timings line appears", async () => {
    mount();
    await runReview();
    const t = text();
    expect(t).toContain("Recommendation and note");
    expect(t).toContain("Partial Denial — Taper");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(global.fetch.mock.calls[0][0])).toMatch(/\/v1\/aionly\/note$/);
    const noteBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(noteBody.ruling.determination).toBe("PARTIAL_DENIAL_TAPER");
    expect(noteBody.resolved.visitsToDate).toBe(14);
    const ta = Array.from(container.querySelectorAll("textarea")).find((x) => x.value && x.value.includes("Determination and Rationale:"));
    expect(ta).toBeTruthy();
    expect(ta.value).toContain("Taper Indicated: streamed.");
    expect(ta.value).toContain("Approved Visits:\n4");
    expect(t).toContain("Recommendation visible");
    expect(t).toContain("Note complete");
    expect(t).toContain("split · sonnet-5 · effort low · thinking on");
    expect(t).not.toContain("Benchmarks and guideline applied");
    expect(t).toContain("note");
    expect(t).toContain("recommendation");
  });

  test("single path: one call, no note stream, benchmarks block shown", async () => {
    mockApi({ recommend: singleResult });
    mount();
    setSelect(selectNamed("Review path"), "single");
    await runReview();
    expect(global.fetch).not.toHaveBeenCalled();
    const rec = axios.post.mock.calls.find((c) => c[0].endsWith("/v1/aionly/recommend"));
    expect(rec[1].mode).toBe("single");
    const t = text();
    expect(t).toContain("Benchmarks and guideline applied");
    expect(t).toContain("Guideline applied");
    expect(t).toContain("Source of the figures");
    const ta = Array.from(container.querySelectorAll("textarea")).find((x) => x.value && x.value.includes("Determination and Rationale:"));
    expect(ta.value).toBe(sample.runs[0].note);
    expect(t).toContain("single · sonnet-5");
  });

  test("pre-extraction: choosing a file extracts in the background, and the click reuses it", async () => {
    mount();
    const input = container.querySelector('input[type="file"]');
    const file = new File(["%PDF-1.4 test"], "ie.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    expect(text()).toContain("Extraction ready");
    const extractCalls = () => axios.post.mock.calls.filter((c) => c[0].endsWith("/v1/aionly/extract")).length;
    expect(extractCalls()).toBe(1);
    const fd = axios.post.mock.calls.find((c) => c[0].endsWith("/v1/aionly/extract"))[1];
    expect(fd.get("documents")).toBeTruthy();

    await runReview();
    expect(extractCalls()).toBe(1);
    const rec = axios.post.mock.calls.find((c) => c[0].endsWith("/v1/aionly/recommend"))[1];
    expect(rec.extraction.ran).toBe(true);
    expect(rec.extraction.raw.primaryDiagnosisCode).toBe("S83.101");
    expect(text()).toContain("extraction cached");
  });

  test("a pre-extraction failure is shown and the run reports it rather than proceeding", async () => {
    axios.post.mockImplementation(async (url) => {
      if (url.endsWith("/v1/aionly/extract")) { const e = new Error("bad pdf"); e.response = { status: 400, data: { detail: "Unreadable PDF" } }; throw e; }
      return { data: splitResult };
    });
    mount();
    const input = container.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { value: [new File(["x"], "bad.pdf", { type: "application/pdf" })], configurable: true });
    act(() => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await settle();
    expect(text()).toContain("Extraction failed: Unreadable PDF");
    await runReview();
    expect(text()).toContain("Unable to read the clinical documentation: Unreadable PDF");
    expect(axios.post.mock.calls.some((c) => c[0].endsWith("/v1/aionly/recommend"))).toBe(false);
  });

  describe("with a split result rendered", () => {
    beforeEach(async () => { mount(); await runReview(); });

    test("left panel shows extracted values with provenance markers and baseline comparison", () => {
      const t = text();
      expect(t).toContain("Extraction");
      expect(t).toContain("document");
      expect(t).toContain("entered");
      expect(t).toMatch(/125°\s*\(95°\)/);
    });

    test("right panel carries the basis without severity, guardrails or ambiguity boxes", () => {
      const t = text();
      expect(t).toContain("Rule applied");
      expect(t).toContain("Facts relied on");
      expect(t).toContain("Citation");
      expect(t).not.toContain("Severity basis");
      expect(t).not.toContain("guardrail");
      expect(t).not.toContain("unverified");
    });

    test("the note is editable, sized to content, with Copy Note", () => {
      const ta = Array.from(container.querySelectorAll("textarea")).find((x) => x.value && x.value.includes("Determination and Rationale:"));
      expect(ta.style.overflow).toBe("hidden");
      setInput(ta, ta.value + "\n\nREVIEWER EDIT");
      expect(ta.value).toContain("REVIEWER EDIT");
      expect(buttonNamed("Copy Note")).toBeTruthy();
      expect(buttonNamed("Copy Note").disabled).toBe(false);
    });

    test("raw JSON sections are present and collapsed by default", () => {
      expect(text()).toContain("Raw extraction JSON");
      expect(text()).toContain("Raw determination JSON");
      expect(container.querySelectorAll("pre").length).toBe(0);
    });
  });

  test("absence is stated explicitly rather than rendered as nothing", async () => {
    mockApi({ recommend: { ...splitResult,
      resolved: { ...sample.resolved, rom: null, romComparison: null, functionalOutcomeScore: null },
      provenance: { ...sample.provenance, rom: "absent", functionalOutcomeScore: "absent" } } });
    mount();
    await runReview();
    expect(text()).toContain("No range of motion documented in this note");
    expect(text()).toContain("No standardized outcome measure documented in this note");
  });

  test("a source disagreement about the reviewer's own input is still surfaced", async () => {
    mockApi({ recommend: { ...splitResult, discrepancies: [{ field: "visitsToDate", used: 14, usedSource: "manual", alsoFound: 21, alsoSource: "extracted", note: "Manual entry differs from the value found in the documentation." }] } });
    mount();
    await runReview();
    expect(text()).toContain("1 source disagreement");
  });

  test("a prior-note suggestion is offered for confirmation and never auto-applied", async () => {
    mockApi({ recommend: { ...splitResult, priorNoteSuggestion: { visitsToDate: 14, excerpt: "Approved 14 visits at 2x/week x 7 weeks", message: "Prior note appears to state 14 visits approved. Confirm to use." } } });
    mount();
    await runReview({ subsequent: true });
    expect(text()).toContain("Prior note appears to state 14 visits approved");
    const before = Array.from(container.querySelectorAll("input")).filter((i) => i.type === "number").map((i) => i.value);
    expect(before).not.toContain("14");
    click(buttonNamed("Accept"));
    const after = Array.from(container.querySelectorAll("input")).filter((i) => i.type === "number").map((i) => i.value);
    expect(after).toContain("14");
  });

  test("a validation failure renders as PEND with its specific failures and no note", async () => {
    mockApi({ recommend: { ...splitResult, determination: "PEND", determinationSource: "validation",
      validation: { passed: false, failures: [{ check: "objectiveMeasurePresent", message: "No clinical source was supplied." }] }, runs: [] } });
    mount();
    await runReview();
    const t = text();
    expect(t).toContain("Pend — validation did not pass");
    expect(t).toContain("objectiveMeasurePresent");
    expect(t).toContain("No recommendation was produced for this case.");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(t).not.toContain("Composed note");
  });
});

describe("Session log", () => {
  test("records path, model, effort, thinking, timings, tokens and the recommendation per run", async () => {
    mount();
    await runReview();
    const t = text();
    expect(t).toContain("Session log");
    for (const col of ["Path", "Model", "Effort", "Thinking", "Extract s", "Rec visible s", "Note done s", "Rec out tok", "Note out tok", "Recommendation", "Approved"]) {
      expect(t).toContain(col);
    }
    expect(t).toContain("PARTIAL_DENIAL_TAPER");
    expect(t).toContain("4@1x4w");
    expect(t).toContain("420");
    expect(t).toContain("610");
    await act(async () => { buttonNamed(RUN).click(); });
    await settle();
    expect(text()).toContain("2 cases ·");
    click(buttonNamed("Clear"));
    expect(text()).not.toContain("Session log");
  });

  test("CSV export has one header row, one row per case, and consistent column counts", async () => {
    const captured = [];
    const OrigBlob = global.Blob;
    global.Blob = function (parts, opts) { captured.push(String(parts.join(""))); return new OrigBlob(parts, opts); };
    const origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:mock"; URL.revokeObjectURL = () => {};
    const origClick = window.HTMLAnchorElement.prototype.click;
    let downloadName = "";
    window.HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };

    mount();
    await runReview();
    click(buttonNamed("Export CSV"));
    expect(downloadName).toMatch(/^aionly_session_\d{8}_\d{4}\.csv$/);
    const lines = captured[0].trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("Path,Model,Effort,Thinking,Extract s,Rec visible s,Note done s");
    const fields = lines[1].match(/("([^"]|"")*"|[^,]*)(,|$)/g).filter((f, i, a) => i < a.length - 1);
    expect(fields.length).toBe(lines[0].split(",").length);

    global.Blob = OrigBlob;
    URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke;
    window.HTMLAnchorElement.prototype.click = origClick;
  });
});
