import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SourceHover from "./SourceHover";

// SYNTHETIC data only. Server render: the tooltip is closed until a hover/focus event.
const PROV = { painCurrent: { snippet: "Current pain: 6/10 at rest.", docIndex: 0, docName: "eval.pdf" } };

test("renders children untouched when there is no provenance for the field", () => {
  const html = renderToStaticMarkup(<SourceHover provenance={PROV} fieldKey="mmt:quadriceps"><b>4/5</b></SourceHover>);
  expect(html).toBe("<b>4/5</b>");
});

test("renders children untouched when provenance is missing entirely", () => {
  expect(renderToStaticMarkup(<SourceHover fieldKey="painCurrent">6</SourceHover>)).toBe("6");
});

test("marks a value that has a verified source as hoverable, tooltip closed by default", () => {
  const html = renderToStaticMarkup(<SourceHover provenance={PROV} fieldKey="painCurrent">6</SourceHover>);
  expect(html).toContain('role="button"');
  expect(html).toContain(">6<");
  expect(html).not.toContain('role="tooltip"');
});

test("ignores an entry with an empty snippet", () => {
  const html = renderToStaticMarkup(
    <SourceHover provenance={{ painCurrent: { snippet: "", docIndex: 0, docName: "a" } }} fieldKey="painCurrent">6</SourceHover>
  );
  expect(html).toBe("6");
});
