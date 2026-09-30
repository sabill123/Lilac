# V2 bounded anti-slop audit

## Verdict

**Home: SLOP (severity 3, 3 hits) -> PASS (severity 0, 0 hits).**

**About: SLOP (severity 14, 24 hits) -> SLOP (severity 13, 23 hits).** No clean About verdict is claimed. Of the remaining 23 hits, 5 are advisory and 18 affect the verdict; severity caps each rule at 4.

These final numbers are from the supplied rendered DOM scans with only the updated owned CSS transplanted into copies. They are not a fresh browser render, a full computed-style audit, or deployment verification. The parent owns those checks.

## Scope and evidence

- Tool: `@gessobuild/anti-slop@0.4.2`; followed `.claude/skills/anti-slop/SKILL.md` and relevant `references/rules.md` entries.
- Inputs: session temporary directory `v2-design-check/{home,about}.html` and `v2-anti-slop.json`.
- Full automatic experiments: `v2-anti-slop-fix/{home,about}.html`, with exact line-expanded before/after diffs inspected; results in `v2-anti-slop-fixed.json`.
- Safe final scan copies: `v2-anti-slop-final/{home,about}.html`; results in `v2-anti-slop-final.json`.
- Structural match tracing: `v2-anti-slop-structural.json`. Instrumentation ran only in the temporary directory, not in the installed detector or production.
- Session temporary root: `/Users/jaeseokhan/.aside/u/0/sessions/2026-09-05_WHYRFW1JrqpRhNl7/tmp/`.
- Production writes limited to `frontend/src/discovery/home-immersive.css`, `frontend/src/site/landing-immersive.css`, and this new audit. No TS/component, data, asset, license, or private-file changes. No opt-outs added.

## Deterministic findings

Counts below are detector hits, not necessarily distinct visible elements.

| Page / guard | Raw -> final hits | Action and reason |
| --- | ---: | --- |
| Home `over-rounded-card` | 2 -> 0 | Ported the fixer's exact `100px` -> `24px` radius clamp to `.li-home-play` and `.li-home-unavailable button`. These are controls rather than content cards, so the rule's name overstates the diagnosis. The modest corner adjustment is safe; their sizes and hit areas are unchanged. |
| Home `ghost-card` | 1 -> 0 | Removed the fallback record-jacket halo, retaining its edge. Used explicit `box-shadow:none` because simply deleting the declaration would expose the heavier shadow in `discovery.css`. |
| About `underlined-text` | 2 -> 2 | Retained hover underlines on `.li-text-link:hover` and `.li-stage-index a:hover`. They are functional hyperlink feedback, not decorative heading type. |
| About `oversized-number` | 6 -> 6 | Retained all exact displayed currency amounts. Numeric precision is a product requirement, not mockup slop. |
| About `em-dash-copy` | 1 -> 1 | Existing carousel category subtitle in `.uc-label .sub`. This module already hides `.sub`; the scan nevertheless includes its DOM text. Not edited or newly hidden by this task. Copy cleanup is outside the CSS-only ownership boundary. |
| About `redundant-border` | 1 -> 1 | Kept `.li-vinyl`'s 7px border: it depicts the record rim, not an app-card boundary. The automatic deletion would also change the inner geometry of this absolutely positioned illustration. |
| About `multiline-row-meta` (advisory) | 2 -> 2 | Traced to whole `section.site-shell.li-artists` and `section.site-section.li-features` sections, not compact application list rows. Wrapping explanatory landing copy is appropriate here. |
| About `overstuffed-row` (advisory) | 2 -> 2 | Detector counts 36 slots in the complete features section and 19 in the complete pricing section. It mistakes sibling marketing sections for repeated list items. No information removed. |
| About `ghost-card` | 1 -> 0 | Removed `.li-record .editorial-art-frame`'s halo, retaining the album-sleeve border. Explicit `box-shadow:none` makes the intended cascade unambiguous. |
| About `nested-cards` | 7 -> 7 | Traced every hit: three `figure.li-record` wrappers, their three `.editorial-art-frame` children, and `.demo-shell`. The detector concatenates declarations for every class occurring anywhere in a selector, assigning descendant surfaces to `.li-landing` and `.li-record`. These false ancestor surfaces do not represent CSS selector matching. See below. |
| About `layout-prop-animation` | 1 -> 1 | Real unresolved motion issue: the `.fx-tip` inline style from `frontend/src/site/chart.ts:267` transitions `left` and `top` for .35s. Not excused as a false positive. Changing renderer behavior exceeds this deterministic CSS pass. |
| About `hover-scale-image` (advisory) | 1 -> 1 | Retained the targeted artist-image `scale(1.035)` hover. A discretionary landing-page effect, not a blanket zoom on every image; reduced-motion CSS already disables its transition. Parent may remove it as a design decision. |

### Exact automatic changes reviewed but not blindly shipped

The full fixer experiment reported Home 6 changes: 2 radius clamps, 1 shadow removal, and 3 BASE additions. About reported 14 changes: 2 underline removals, 6 number abbreviations, 1 copy deletion, 1 border removal, 1 shadow removal, and 3 BASE additions.

The automatic About copy would replace:

| Exact original amount | Automatic replacement rejected |
| --- | --- |
| ₩28,092 | ₩28.1K |
| ₩30,526 | ₩30.5K |
| ₩32,961 | ₩33K |
| ₩35,395 | ₩35.4K |
| ₩28,520 | ₩28.5K |
| ₩34,872 | ₩34.9K |

It also replaces both functional `text-decoration:underline` declarations with `none`, removes the vinyl rim, removes the existing subtitle punctuation, strips CSS comments, and injects global text-wrap, font-smoothing and image-outline styles. Those unrelated changes were not ported. BASE absence is not a finding; global wrapping could change line layout and is not warranted by this bounded pass.

The unfiltered automatic experiment scores Home PASS/0 and About SLOP/5 with 13 hits. **About severity 5 is not the production result**, because it requires rejected currency and link-affordance changes. The safe result is severity 13. Remaining classification: 21 justified preservation/rule-mismatch hits (including 5 advisories), 1 hidden-copy cleanup outside scope, and 1 real unresolved tooltip-motion hit.

### Structural rule mismatch evidence

The installed detector's `collectClassDecls()` explicitly implements a naive class-name-to-concatenated-declarations map. For `#siteRoot .li-record .editorial-art-frame`, it assigns the frame's radius, fill, border and shadow to both `.li-record` and `.editorial-art-frame`. Likewise, every `.li-landing` descendant's styles are pooled onto `.li-landing` itself. `findNestedCards()` then sees a card-surfaced ancestor that the actual selectors never created.

Instrumented matches confirm all seven nested-card hits use these false ancestors: the three figures and demo shell point to `.li-landing`, and the three artwork frames point to their figures. This is a static-rule mismatch, not evidence that all nested surfaces should be stripped. The album fallback consists of record artwork and a sleeve; the demo shell is one intentional application-preview surface.

## Production delta and geometry

Exactly four declaration changes:

1. Home jacket shadow `6px 18px 24px #20212720` -> `none`.
2. Home play radius `100px` -> `24px`.
3. Home unavailable-state button radius `100px` -> `24px`.
4. About record frame shadow `5px 20px 24px #272b4220` -> `none`.

No width, height, padding, margin, grid, flex, position, border width, text content, font, line-height or motion declaration changed. Painted appearance changes: two halos removed and two control corners clamped. CSS box geometry/layout is unchanged by these properties; that is a source-level conclusion, not a claimed browser measurement. No responsive, interaction or deployment verification is implied.

## Validation

- Both full fixer copies rechecked with the CLI. Home: 0 hits; About: 13 hits, severity 5 (experiment only).
- Second full-fixer application asserted idempotent for both experimental copies: 0 fixes and byte-identical HTML.
- Safe final copies rechecked with the CLI. Home: 0 hits; About: 23 hits, severity 13. Expected nonzero detector exit retained honestly.
- Asserted each original scan contains the exact corresponding production CSS module before edits.
- Asserted the complete `<body>` portion of each safe final scan is byte-identical to its original, preserving all displayed currency strings and DOM affordances.
- Asserted each production CSS file equals its saved baseline plus only the four declared replacements. All other properties are unchanged.
- `npm run test:landing`: PASS (4 reported groups).
- `npm run test:discovery`: PASS (18 model groups and 22 UI groups).
- These tests exercise component/model behavior, not browser geometry. Parent still owns fresh rendered scans, viewport/overflow checks, screenshots and deployment.

## Beyond the ruleset

Judgment: retain exact money, readable link feedback, the record rim and explanatory marketing sections. Do not optimize a static score at their expense. The remaining actionable technical defect is the FX tooltip's layout-property transition. A follow-up should leave `left`/`top` positions immediate and animate opacity only, or update the renderer to use measured transform movement, then verify hover positioning and reduced motion in the browser. The hidden subtitle punctuation can be cleaned in its component source during an authorized copy pass; it is not a visible layout defect in this module.
