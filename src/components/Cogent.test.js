import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CogentWidget, CogentChat, cogentAvailable, COGENT_ROLES } from "./Cogent";

// SYNTHETIC. Server render only: checks who gets Cogent and what each role is told.
test("every platform role has Cogent; unknown roles do not", () => {
  for (const r of ["provider", "reviewer", "medical_director", "master", "admin"]) expect(cogentAvailable(r)).toBe(true);
  for (const r of ["", undefined, "md", "constructor", "__proto__"]) expect(cogentAvailable(r)).toBe(false);
});

test("launcher renders for a known role, nothing for an unknown or hidden one", () => {
  expect(renderToStaticMarkup(<CogentWidget token="t" role="reviewer" />)).toContain("Open Cogent assistant");
  expect(renderToStaticMarkup(<CogentWidget token="t" role="nobody" />)).toBe("");
  expect(renderToStaticMarkup(<CogentWidget token="t" role="master" hidden />)).toBe("");
});

test("only the provider chat offers a person; staff greetings state that determinations stay with the human", () => {
  expect(renderToStaticMarkup(<CogentChat token="t" role="provider" inline />)).toContain("Talk to a person");
  for (const r of ["reviewer", "medical_director", "master"]) expect(renderToStaticMarkup(<CogentChat token="t" role={r} inline />)).not.toContain("Talk to a person");
  expect(COGENT_ROLES.reviewer.greeting).toMatch(/yours to make/);
  expect(COGENT_ROLES.master.greeting).toMatch(/read-only/);
});
