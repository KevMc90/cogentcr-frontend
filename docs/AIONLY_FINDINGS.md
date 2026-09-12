# AI-only determination — feasibility findings

**Date:** 2026-09-12
**Branch:** `demo-ur-only` (frontend) · backend `main`, additive only
**Deployed:** https://rapidcr-demo.vercel.app → `POST /v1/aionly/evaluate` on `rapidnote-backend.onrender.com`
**Recovery tags:** frontend `demo-deterministic-v1` (71b5fb82), backend `backend-pre-aionly-v1` (ea0c77ff)

## What was tested

The production system is *extraction (AI) → deterministic rules engine → note (deterministic assembly)*.
This experiment removed the engine and asked one question: **how well does a current model perform utilization review unaided?**

    extraction (AI, unchanged) → shape validation (deterministic) → determination AND note in one AI call
                                                                   → deterministic guardrails on internal consistency

The model — `claude-sonnet-5`, the same model extraction uses, so the reasoning step is the only variable — was given
no benchmark table, no visit thresholds, no citation. It had to state the guideline and the visit benchmarks it was
applying so a reviewer could check them. Extraction was reused unmodified (`utils/claudeExtract.js`), and the rules
engine (`utils/ruleEngine.js`) was never called on this path.

Three things were measured: how often the model disagrees with itself on identical input; whether the input model
(PDFs, pasted text, manual entry, prior-note context) works; and cost/latency. **Clinical correctness was not
assessed by the tooling.** Where a determination is described below as right or wrong, that is the reviewer's
(Kevin's) stated judgment, attributed as such.

Every response is a real API result, recorded in full. 13 executions, 22 determination calls, $2.24.

---

## The two findings that matter most

### 1. The ruling is stable. The stated reasoning is not.

Five cases were run three times each — identical input, extraction run once and reused, so the only thing varying
was the reasoning call. Five diagnoses, including three with well-established clinical practice guidelines.

| Case | Determination | Visits / freq / weeks | Severity | Bench typical | Bench max | Max freq |
|---|---|---|---|---|---|---|
| PCL tear S83.101, initial eval, 14 requested | APPROVED ×3 | 14 @ 2×7 ×3 | mod / mod / **severe** | 14 / 14 / 14 | **20 / 24 / 24** | 3 |
| PCL tear S83.101, subsequent, VTD 14, 8 requested | TAPER ×3 | 4 @ 1×4 ×3 | mod / **mild** / mod | **18 / 16 / 14** | **24 / 24 / 20** | 3 |
| Adhesive capsulitis M75.0, initial, 16 requested | APPROVED ×3 | 16 @ 2×8 ×3 | severe ×3 | **16 / 18 / 16** | 24 | 3 |
| Sciatica M54.4, initial, 12 requested | APPROVED ×3 | 12 @ 2×6 ×3 | severe ×3 | **12 / 12 / 14** | **16 / 16 / 20** | 3 |
| Parkinson's G20, initial, 20 requested | APPROVED ×3 | 20 @ 2×10 ×3 | severe ×3 | **18 / 18 / 20** | 24 | 3 |

    identical across all three runs:
      determination            5/5
      visits + freq + duration 5/5
      severity                 3/5
      benchmark figures        0/5     ← typical visits moved on every diagnosis; episode max on 3/5
      guideline wording        0/5
      ruleApplied wording      0/5
      note text                0/5

**Benchmark drift is general, not diagnosis-specific.** It was expected that the PCL codes, with no dedicated CPG,
might be poorly represented. But the typical-visit benchmark moved on adhesive capsulitis, low back pain and
Parkinson's too — all with published APTA/JOSPT guidelines the model named correctly. The only figure that held on
every run of every case was maximum frequency, always 3/week.

**Reviewer's assessment (Kevin):** the stable determination is reassuring for the thing that matters most, because a
reviewer gets the same recommendation. The drifting benchmark is the problem, because the rationale is what gets
pasted into BBI and becomes the determination of record. Two identical cases reviewed a week apart could carry
different stated justifications for the same conclusion.

**Would the drift have changed a determination?** For each three-run case: cumulative volume (visits to date +
requested) was compared against *each run's own* stated episode maximum, as a cumulative-volume rule would be.

- PCL subsequent: cumulative 22 sits **between** the stated maxima of 20 (run 3) and 24 (runs 1–2). Under run 3's
  benchmark a cumulative rule cuts the approval to 6; under runs 1–2 it does not fire. The outcome held only because
  step 3 (taper) resolved the case before step 4 (cumulative) was reached — ladder order, not benchmark agreement.
- The other four cases: cumulative sat well inside every stated maximum. Drift never approached the boundary.

So it nearly happened once in five, and the thing that prevented it was the order of the rules, not the model.

**There is no determinism lever.** Sampling parameters (`temperature`, `top_p`, `top_k`) are removed on every
current-generation model — Opus 5 and Sonnet 5 return HTTP 400 if one is sent. `temperature: 0` was in the spec and
could not be set. The variance above is real, not a setting being confirmed.

### 2. The prior-plan feature: identical clinical facts, opposite judgment

This was the feature of most interest: paste the prior reviewer's determination, and see whether the model checks
the current data against a plan that note anticipated. The prior note used:

> Approved 14 visits at 2x/week x 7 weeks. Grade II PCL tear, right knee, conservative management. Quadriceps 3+/5
> with extension lag of 5 degrees. Six functional limitations documented. Requested 14 falls within guideline range.
> Anticipate taper to 1x/week at re-evaluation once quadriceps approaches 4+/5.

Two runs. Same two PDFs, same prior note, same resolved visits-to-date of 14. The only difference in what the model
was shown: in T6 the 14 was entered manually (`[manual]`); in T6b it was left blank and extraction read it from the
progress note (`[extracted]`).

| | T6 | T6b |
|---|---|---|
| Determination | **Partial Denial — Taper**, 4 @ 1×/wk × 4 | **Approved**, 8 @ 2×/wk × 4 |
| `priorPlanReferenced` | true | true |
| `priorPlanConditionsMet` | **true** | **false** |
| Severity / benchmarks | moderate · 16 / 24 / 3 | moderate · 18 / 24 / 3 |
| Guardrail errors | none | none |

T6's own `ambiguityNote` anticipated exactly this: *"Quadriceps strength is 4/5, one increment below the 4+/5
threshold the prior reviewer named as the taper trigger. I am treating 4/5 with resolved extension lag and the
accompanying gains in ROM, pain, and LEFS as sufficiently 'approaching' that threshold to support taper, but a
stricter reading requiring literal attainment of 4+/5 would instead support continuing 2x/week briefly before
tapering; this is a judgment call."* T6b took the stricter reading.

One sample of each, so run-to-run variance cannot be separated from the provenance tag. But on identical clinical
values the prior-plan judgment flipped on how strictly to read "approaches". The engine encodes that threshold as a
number; the model re-decides it every run.

**Reviewer's assessment (Kevin):** the taper (T6) is the clinically correct call on this case; T6b's approval is not.
The feature that was most interesting is the least stable thing in the build.

The two determination notes are reproduced verbatim at the end of this document.

---

## Model-tier divergence

Earlier in the build, call 2 ran on Opus 5 before being moved to Sonnet 5 for parity with extraction. On the PCL
subsequent case, one run each:

| | Opus 5 | Sonnet 5 |
|---|---|---|
| Determination | APPROVED 8 @ 2×/wk × 4 | PARTIAL_DENIAL_TAPER 4 @ 1×/wk × 4 |
| Severity | moderate | mild |
| Stated benchmarks (typical / max) | 18 / 30 | 14 / 20 |

Opposite conclusions with different stated benchmarks on the same input. Variance is not only across repeated runs;
it is across model choice, and nothing in the architecture can adjudicate it — only a reviewer reading both can.

**Reviewer's assessment (Kevin):** Sonnet's taper was clinically correct; Opus approving the full 8 was wrong.

---

## The model overrode the reviewer's declared review type

**Test 4, the expired-authorization case.** When an authorization expires the provider resubmits as a new request,
so a continuation of care arrives labelled *initial* with zero visits on record — while the reviewer is looking at
the prior authorization on screen. The manual visits-to-date override exists for exactly this.

The progress note alone was uploaded with review type **initial**, 8 requested — once with visits-to-date blank
(T4a), once with 14 entered manually (T4b).

| | T4a (blank) | T4b (14 manual) |
|---|---|---|
| Resolved visits-to-date | 14 `[extracted]` | 14 `[manual]` |
| Determination | TAPER 4 @ 1×/wk | TAPER 4 @ 1×/wk |
| `ruleApplied` | Step C.3 — Stage of Care (taper) | Step C.3 — Stage of Care (taper) |
| Guardrail | `subsequentOnlyStepOnInitial` | `subsequentOnlyStepOnInitial` |

Two things to record.

First, **the override was not load-bearing on this fixture.** The progress note itself says "Visits This Episode:
14 of 14 authorized", extraction read it even on an initial review, and both runs resolved to 14. The manual entry
only matters when the resubmitted document does *not* carry the count — this one does. The test did not exercise the
feature it was designed to.

Second, and this is the finding: **on both runs the model applied step 3 — the taper rule, which the prompt restricts
to subsequent reviews — to a case declared as initial.** It read the document's history, concluded this was a
continuation, and reviewed it as one, in direct contradiction of the review type the form supplied. The guardrail
caught it both times.

**Reviewer's framing (Kevin):** clinically sensible, and a direct violation of the input precedence the spec set —
*the reviewer's explicit input always wins over a derived value*. Review type is the one field the spec said is never
derived. The model derived it anyway, from the document, and got the clinically right answer by doing so. That is a
design tension worth recording, not a bug: when the form and the document disagree about what kind of review this
is, the deterministic engine does what the form says and the model does what the document says.

---

## Guardrails

Twelve deterministic checks on call 2's output (`utils/aiOnlyGuardrails.js`). Because no benchmark table is supplied,
most are internal-consistency checks: does the output agree with itself? None block; each records and displays.

### The case the guardrails exist for

PCL subsequent, run 3 of 3. The structured determination said **1×/week**. The note's rationale never stated the
approved cadence at all; the only frequency anywhere in the prose a reviewer would sign was **3x/week** — the
benchmark maximum the model had named in passing. Caught by `noteFrequencyMismatch`. A reviewer copying that note
into BBI would have pasted a determination that contradicts its own approved frequency.

### The first scoring pass was inflated — by the checks, not the model

Raw scoring reported **16 of 21 runs** with an error-severity guardrail. On inspection, three classes were the checks
misreading the model:

- **`parseRuleStep` took the first step number in `ruleApplied`.** The model often narrates the whole ladder —
  *"Step C.1 satisfied; Step C.2 satisfied; Step C.3/C.4 not applicable; Step C.5 not triggered; Step C.6 applies"* —
  so a perfectly consistent APPROVED read as "cites step 1 → PEND". 3 runs.
- **"0/5 goals met" has exactly the shape of an MMT grade.** On the two five-goal fixtures every run flagged a
  fabricated `0/5` *and* a rationale "relying on absent MMT data". 12 firings that were goal tallies.
- **"HEP instruction" listed among skilled interventions matched the HEP-status alias.** hepStatus means the patient's
  independence with the programme; naming instruction as an intervention is not a claim about it. 5 firings.

All three were fixed (backend commit `96ed564`) and the same 21 recorded runs were re-scored offline. The
twelve-check unit suite was unchanged and green throughout.

### Corrected firing rate

| Check | Fired | What it caught |
|---|---|---|
| `possibleFabricatedClinicalValue` | **5 / 21** | Every instance is the model **subtracting a deficit** — "flexion 125° (10° deficit from 135° norm)", "40° deficit" — which the prompt forbids ("do not infer, calculate, or add clinical facts"). Harmless arithmetic each time, and a standing instruction violation on roughly one run in four. |
| `subsequentOnlyStepOnInitial` | 2 / 21 | T4a and T4b, above. |
| `noteFrequencyMismatch` | 1 / 21 | The 1×/week vs 3x/week case above. |
| `exceedsOwnBenchmarkMaxVisits` | 1 / 21 | T8: the model stated an episode maximum of 22, then approved 4 visits on top of 21 delivered = 25. Self-contradiction within one response. |
| `ruleStepUnparseable` (informational) | 3 / 21 | Ladder narrations with no single clear resolver; reported rather than guessed. |
| `citationUnverified` (informational) | 21 / 21 | Standing reminder, by design. |

**6 of 21 runs carried an error, and every one is a genuine catch.** The `ruleApplied` phrasing that broke the parser
drifted on every three-run set — "STEP C.6 —", "Step C item 6", "Step 6 (Otherwise APPROVED as requested)", full
narrations — all on identical input. A small instance of the same variance measured above.

---

## Cost and latency

Sonnet 5 on both calls. Single-run cases and three-run cases pooled.

    extraction     n=11   17.5 s mean            14,035 in / 2,242 out tokens    $0.0505
    determination  n=21   58.5 s (36.9–86.0)      4,493 in / 6,450 out tokens    $0.0735

    single-run case  ≈ $0.124, ~76 s
    Run 3×           ≈ $0.271, ~2.5–3 min sequential

The determination call is three times slower and 1.5× the cost of extraction, driven by output: ~6,500 tokens per
run, most of it thinking plus a 1,300–2,000-character note. The deterministic engine's reasoning step costs $0 and
~0 s. Opus 5 on call 2 was ~$0.125–0.150 per determination.

---

## The input model — all nine tests

| Test | Setup | Result |
|---|---|---|
| **1** | IE only, initial, 14 requested, Run 3× | APPROVED 14 ×3. VTD `extracted` → 0. |
| **2** | Both PDFs, subsequent, 8 requested, VTD 14 manual, Run 3× | TAPER 4 @ 1×4 ×3. Drift table above. |
| **3** | As 2, VTD blank, no prior note | Did not break. `visitsToDateSource = extracted`, value 14 (the note says "14 of 14 authorized"). Same ruling as Test 2. |
| **4a / 4b** | PN only as *initial*, VTD blank / 14 manual | TAPER 4 both. Section above. |
| **5** | Pasted PN text, no upload, subsequent, 8, VTD 14 | Extraction ran through the pdfkit render (single document). TAPER 4 — same as the PDF path. |
| **6 / 6b** | Both PDFs, prior note, VTD 14 manual / blank | Opposite prior-plan judgments. Section above. In 6b the parsed suggestion fired — `{14, "Approved 14 visits at 2x/week x 7 weeks…", "Confirm to use."}` — and was not applied on its own. |
| **7** | No PDFs, no text, subsequent, 8, VTD 14 | PEND at validation (`diagnosisCodePresent`, `objectiveMeasurePresent`). No model call, $0, no crash. |
| **8** | Both PDFs, VTD **21** manual vs document's 14 | Discrepancy recorded `{used 21 (manual), alsoFound 14 (extracted)}`, shown in amber above the clinical data. The note says "21 VTD" — the resolved value, not the document's. `exceedsOwnBenchmarkMaxVisits` fired (21 + 4 = 25 > stated 22). |
| **9** | Case tripping ≥2 guardrails | Test 2 run 3 (two errors), Tests 4a and 4b (two each). Displayed; none blocked the run. |

**Pasted text vs PDF (Test 5 vs Test 2).** 12 of 24 extraction fields byte-identical. Every substantive value matched
— ROM, MMT, pain, LEFS, visits-to-date, plan of care, diagnosis. Differences were key casing ("Right Knee Flexion"
vs "Right knee flexion"), `documentType` RE vs PN, list wording, and — expected — no baseline comparisons, because
Test 5 was one document and Test 2 was two. The standalone scenario, a reviewer copying the narrative out of Auth
Intelligence with no document access, works.

**Provenance.** Every field resolved to a defensible source on every test; no case where the tag was confusing or
wrong. `manual` and `prior_note` (accepted from a parsed suggestion) are distinguished, so "I know this" and "I
confirmed this" are visibly different. Discrepancy detection fired exactly once, on Test 8, correctly.

---

## Where this architecture is weakest — observed, not principled

1. **The rationale is not reproducible even when the ruling is.** 0/5 cases produced a stable stated benchmark. If
   the note is the determination of record, the record varies.
2. **The prior-plan feature is the most valuable thing here and the least stable.** Identical facts, opposite
   judgment, on how strictly to read a threshold the engine would encode as a number.
3. **The model overrides the reviewer's declared context when the document disagrees with it.** Test 4.
4. **Roughly one run in four calculates a clinical value it was told only to report.** Harmless arithmetic each time
   observed, but the rate did not fall across diagnoses.
5. **Benchmark drift crossed a decision boundary once in five cases** and was saved by rule order, not agreement.

The deterministic route (`POST /v1/evaluate`), fed the Test 2 extraction, returned *"Partial Denial — Taper to
Discharge Indicated"*, 4 visits, CPG cited — the same ruling as all three Sonnet runs, with a citation that does not
move between runs.

---

## Verification and deployment

    frontend  demo-ur-only at 68f3443c · main e64b0a9a untouched (0 commits) · tag demo-deterministic-v1 = 71b5fb82
    backend   main 96ed564 · additive vs tag backend-pre-aionly-v1: index.js +8, package.json ±2 (pdfkit → dependencies),
              routes/aiOnlyRoute.js, utils/aiOnlyPipeline.js, utils/aiOnlyGuardrails.js · protected files 0 changed ·
              applyRules still at its 4 call sites
    rm -rf node_modules && npm ci && CI=true npm run build  →  exit 0, 72.42 kB gzipped
    frontend tests: 33 passing (src/App.aionly.test.js), five pinned to a recorded three-run response

Vercel `rapidcr-demo` production is `68f3443c`, READY, on `demo-ur-only`. Render: serving `96ed564` (the guardrail fix), confirmed by behavioural fingerprint rather than
a version endpoint — one live call on the M75.0 fixture produced a note containing "0/5 LTGs met" and did *not*
raise `possibleFabricatedClinicalValue`; the previous build raised it on 3 of 3 recorded runs of that exact input.
The live route also answers the no-visits probe with the expected 400.

Not verified from this environment: the deployed page **in a browser** — no browser was available and login needs
the database — so layout is verified by render tests, not by eye. The two-panel grid collapses to a single column
below roughly **880px**; test at that width.

Known gap recorded separately in `docs/KNOWN_GAPS.md`: the CI lint gate is not armed (no `eslintConfig`), so a green
build proves the file parses and little else.

---

## Appendix — the T6 and T6b determination notes, verbatim

Same two PDFs, same prior reviewer note, same resolved visits-to-date (14). T6: visits-to-date entered manually.
T6b: left blank, read from the progress note by extraction.

### T6 — visits-to-date 14 (manual) → Partial Denial, taper

```
HPI/Care History:
36 year old male, Tear of posterior cruciate ligament, right knee, Grade II (conservative management), IE 04/23/2026. Total Approved 14 visits.

Clinical Summary:
PN 06/11/2026 (IE 04/23/2026): 14 VTD. Pain 2/10 with stair descent; 0/10 at rest (5/10 with stair descent, 2/10 at rest). PT ROM: Right Knee Flexion 125° (95°), Right Knee Extension 0° (-5°). MMT: Right Quadriceps 4/5 (3+/5), Right Hamstrings 4+/5 (4/5), Left Quadriceps 5/5 (5/5). LEFS 58/80 (36/80). Special tests: Posterior drawer Grade I laxity right with firm end feel, Posterior sag sign trace positive right. 1/4 LTGs met.

POC:
2x/week × 4 weeks

Requested Visits:
8

Determination and Rationale:
Partial Denial — Taper Indicated: Quadriceps strength has improved to 4/5 (baseline 3+/5) with resolution of the extension lag (0° vs -5°), pain is now mild (2/10 with stairs, 0/10 at rest, down from 5/10 and 2/10), flexion has improved to 125° (baseline 95°, norm 135°), and LEFS has risen to 58/80 (baseline 36/80). This mild residual pain/ROM/strength profile, together with documented measurable progress and 14 visits already delivered against a typical episode benchmark of 12-16 visits (upper bound ~24) for moderate conservatively-managed Grade II PCL injury, supports tapering toward discharge rather than continuing at 2x/week. This is consistent with the prior plan's anticipated taper to 1x/week once quadriceps strength approached 4+/5. Approving 4 visits at 1x/week for 4 weeks to allow continued skilled progression of neuromuscular control and return-to-sport training at a reduced frequency while remaining functional/goal deficits (reciprocal stair descent, Y-Balance asymmetry, return to running/soccer) are addressed.

Approved Visits:
4
```

### T6b — visits-to-date 14 (extracted) → Approved

```
HPI/Care History:
36 year old male, Tear of posterior cruciate ligament, right knee, Grade II (conservative management), IE 04/23/2026. Total Approved 14 visits.

Clinical Summary:
PN 06/11/2026 (IE 04/23/2026): 14 VTD. Pain 2/10 with stair descent, 0/10 at rest (5/10 with stair descent, 2/10 at rest). PT ROM: Right knee flexion 125° (95°), Right knee extension 0° (-5°). MMT: Right quadriceps 4/5 (3+/5), Right hamstrings 4+/5 (4/5), Left quadriceps 5/5 (5/5). LEFS 58/80 (36/80). Special tests: Posterior drawer Grade I laxity right with firm end feel, Posterior sag sign trace positive right. 1/4 LTGs met.

POC:
2x/week × 4 weeks

Requested Visits:
8

Determination and Rationale:
Approved: Quadriceps strength 4/5 (baseline 3+/5) has not yet reached the 4+/5 threshold the prior reviewer identified as the trigger for tapering, and functional/neuromuscular deficits remain, including an 11% Y-Balance asymmetry, mild dynamic valgus with single-leg step-down, and failure to return to running or recreational soccer. Only 1 of 4 long-term goals is met, with the quadriceps 5/5 and full flexion ROM goals not met and the stair-descent goal only partially met; skilled interventions including neuromuscular control training and return-to-sport progression remain active and ongoing. Cumulative visits (14 delivered + 8 requested = 22) remain within the estimated 18-24 visit benchmark range for Grade II PCL conservative management applied by analogy to the JOSPT/APTA Knee Stability and Movement Coordination Impairments CPG (no PCL-specific CPG is published), and the requested frequency of 2x/week remains supportable given unresolved return-to-sport goals.

Approved Visits:
8
```

### The model's own prior-plan assessments

**T6:** The prior determination anticipated a taper to 1x/week once quadriceps strength approached 4+/5. Current data shows quadriceps at 4/5 (up from 3+/5) with full resolution of the extension lag, mild residual pain, and a 10° flexion deficit — consistent with the mild pain/ROM/strength profile that supports tapering per the stage-of-care rule. The remaining functional limitations (sport-specific, neuromuscular) do not by themselves negate the taper criterion, which is defined by pain, ROM, and strength. Continuity with the prior reviewer's plan is appropriate here.

**T6b:** The prior determination anticipated a taper to 1x/week once quadriceps strength approached 4+/5. Current quadriceps strength is 4/5, not yet at the stated 4+/5 threshold, and functional/neuromuscular deficits (11% Y-Balance asymmetry, dynamic valgus, no return to running or soccer) remain unresolved with only 1/4 goals met. The conditions for the anticipated taper have not yet been met, so continued care at 2x/week is supported at this review rather than an immediate reduction in frequency.
