import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VisitsStrip } from "./Cockpit";

// SYNTHETIC. Server render only (no effects), so the episode lookup is not exercised here.
test("initial request shows requested visits and no approved-to-date tile", () => {
  const html = renderToStaticMarkup(<VisitsStrip kase={{ reviewType: "initial", requestedVisits: 12 }} />);
  expect(html).toContain("Requested by provider");
  expect(html).toContain("12");
  expect(html).not.toContain("Approved to date");
});

test("subsequent request always shows an approved-to-date tile, never hides it", () => {
  const html = renderToStaticMarkup(<VisitsStrip kase={{ reviewType: "subsequent", requestedVisits: 6 }} />);
  expect(html).toContain("Approved to date");
  expect(html).toContain("Requested by provider");
});

test("missing requested count reads 'not stated' rather than a number", () => {
  const html = renderToStaticMarkup(<VisitsStrip kase={{ reviewType: "initial" }} />);
  expect(html).toContain("not stated");
});

test("falls back to the extracted requested visits", () => {
  const html = renderToStaticMarkup(<VisitsStrip kase={{ reviewType: "initial", contract: { extraction: { requestedVisits: 9 } } }} />);
  expect(html).toContain(">9<");
});
