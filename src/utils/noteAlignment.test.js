import { analyzeNote } from "./noteAlignment";

const note = (rationale, approved, requested = 12) =>
  ["HPI/Care History:", "x", "", "Clinical Summary:", "y", "", "POC:", "2x/week × 6 weeks", "",
   "Requested Visits:", String(requested), "", "Determination and Rationale:", rationale, "",
   "Approved Visits:", String(approved)].join("\n");

test("full approval allows only approve (plus request information)", () => {
  const r = analyzeNote(note("Approved — Skilled PT is supported.", 12), 12);
  expect(r.status).toBe("ok");
  expect(r.outcome).toBe("approve");
  expect(r.allowed).toEqual(["approve", "pend"]);
});

test("fewer visits than requested allows only partial", () => {
  const r = analyzeNote(note("Partial Denial — benchmark exceeded.", 8), 12);
  expect(r.outcome).toBe("partial");
  expect(r.allowed).toEqual(["partial", "pend"]);
});

test("zero visits allows only denial", () => {
  const r = analyzeNote(note("Full Denial — no deficits.", 0), 12);
  expect(r.outcome).toBe("deny");
  expect(r.allowed).toEqual(["deny", "pend"]);
});

test("says approved but visits are reduced: blocked", () => {
  const r = analyzeNote(note("Approved — supported.", 8), 12);
  expect(r.status).toBe("conflict");
  expect(r.allowed).toEqual([]);
});

test("says partial but all visits approved: blocked", () => {
  const r = analyzeNote(note("Partial Denial — x.", 12), 12);
  expect(r.status).toBe("conflict");
  expect(r.allowed).toEqual([]);
});

test("approved visits above requested: blocked", () => {
  expect(analyzeNote(note("Approved — x.", 14), 12).allowed).toEqual([]);
});

test("no leading label falls back to the reviewer's words", () => {
  expect(analyzeNote(note("The request is denied for lack of skilled need.", 0), 12).outcome).toBe("deny");
});

test("missing sections is unreadable, pend only", () => {
  const r = analyzeNote("just some text", 12);
  expect(r.status).toBe("unreadable");
  expect(r.allowed).toEqual(["pend"]);
});

test("pend note", () => {
  const r = analyzeNote(note("Pend — missing documentation.", 0), 12);
  expect(r.outcome).toBe("pend");
  expect(r.allowed).toEqual(["pend"]);
});
