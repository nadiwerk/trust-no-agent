# DESIGN.md — trust-no-agent site

Design direction for the GitHub Pages site, per antislop R-37. Direction chosen
by the owner (2026-09-09): **dark terminal-style developer-tool site**. This
file is the source of visual truth for everything in `site/`.

## Reading this as

Documentation landing for **developers and agent users evaluating a discipline
framework**, in a **terminal / work-log language**, dial
**ENERGY 2 / RHYTHM 2 / MOTION 1**.

## Why this direction (R-21: the reason is written)

The framework is a tool that developers point at coding agents, and its natural
habitat is the terminal: gates print to stdout, receipts live in ledger files,
the whole discipline is shell commands and exit codes. A dark-first site with
terminal cadence matches the product's actual daily use. Dark is chosen for
this brand reason, not because "dark looks tech". Light mode is not shipped:
with one strong brand reason for a fixed dark theme, R-21's toggle requirement
does not trigger.

## Palette (R-29: 2 core + 1 accent, neutrals excluded)

- **Core 1: terminal black** `#0D1117` (background) with **off-white ink**
  `#E6EDF3` (primary text). Chosen over pure black/blue-dark defaults: a warm
  neutral dark with a slight blue-slate cast reads as a code editor, the
  product's real environment. (Reason: C-1, environment-derived identity.)
- **Core 2: ledger grey** `#8B949E` (secondary text, borders, captions). Passes
  4.5:1 on the background for body text.
- **Accent: exit-zero green** `#3FB950` (one deliberate accent, Part 3). The
  framework's whole promise is "exit zero or it didn't happen"; green marks
  exactly those moments: gate outputs, PASS verdicts, the prompt glyph. Dose
  cap: never as page background, never as large fill, never on non-evidence
  text. A secondary evidence tone, gate red `#F85149`, appears only inside
  command output where the product itself uses it (failure states in the eval
  narrative). (Reason for two evidence tones: they encode the product's own
  PASS/FAIL semantics, not decoration.)

## Typography (R-06: reasons written)

- **Headings and body: the mono stack** (ui-monospace / SF Mono / Cascadia /
  Consolas). Reason: this is the one product category where monospace as the
  primary face is brand-true rather than terminal-aesthetic cosplay: the
  framework literally works as commands and files. The R-06 "terminal
  aesthetics" ban targets monospace borrowed for vibes on products that are not
  command-shaped; this product is command-shaped.
- Body 16px/1.7 mono for prose is too heavy for long paragraphs, so prose is
  kept short (this site is a spec, not an essay) and long-form links out to the
  repo docs. No serif, no sans secondary.
- Weight, not size, does hierarchy: 400 body, 600 headings, 700 verdicts. No
  uppercase labels with wide tracking (R-06).

## Layout rules

- Single column, max-width 46rem for prose; the eval table spans wider (max
  62rem) because tabular evidence needs room. (Reason: C-3, content needs.)
- Terminal grammar carries the identity motif (Part 3): sections open with a
  `$`-prompt line, output blocks are the "screenshots" (real gate output, real
  eval numbers), and the prompt glyph is the repeated gesture that makes every
  section belong to the product. The motif is real (commands exist), not
  costume: no fake traffic-light window chrome, no fake typing animation
  (R-05 fake-terminal ban is about costume windows; these are real commands
  with real output, and the site's hero itself is a prompt line).
- Sections vary by composition (RHYTHM 2): prompt+output blocks, a statute list
  for the Iron Laws, a wide evidence table, a two-column install. No feature
  cards (R-14: the content is rules, not features).
- Footer mirrors the product: one line, repo links, license. No 4-column
  template footer (R-05).
- Nav: Gates, Install, GitHub. Every link has a real destination (R-24).

## Motion (MOTION 1)

Hover states and focus outlines only. No scroll-reveal, no typing animation, no
blinking cursor loops (R-19: a blinking cursor on every line is the terminal
costume the site refuses). Nothing animates because nothing here should feel
like it might fail silently.

## Content honesty (R-17, R-18, R-36, R-38, C-5)

Every number is cited from repo files: eval results from
`evals/live-results.md`, the 11-skills count and 0/3 self-trigger figure from
README and `docs/design.md`, the harness list from `docs/compatibility.md`
evidence levels. No user counts, no testimonials, no uptime claims, no
"trusted by". The framework has no customers to name; the site states that by
omission, never by fabrication.

## Dials

ENERGY 2 / RHYTHM 2 / MOTION 1
