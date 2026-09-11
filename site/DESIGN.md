# DESIGN.md — trust-no-agent site

Design direction for the GitHub Pages site, per antislop R-37. Direction chosen
by the owner (2026-09-09): **dark terminal-style developer-tool site**. This
file is the source of visual truth for everything in `site/`.

## Reading this as

Documentation landing for **developers and agent users evaluating a discipline
framework**, in a **terminal / work-log language**, dial
**ENERGY 2 / RHYTHM 2 / MOTION 1**.

## Information architecture

The page sells five connected ideas in this order:

1. **The core**: claims become evidence, evidence becomes receipts, and accepted findings become future guardrails.
2. **The chain**: large work crosses `breakpoint`, `save-as`, `fork-it`, `make-it-so`, `roast-my-code`, and `ship-log` in order.
3. **Verification gates**: four real repository commands turn a completion claim into an observable exit code.
4. **The iron laws**: four boundaries protect fail-first testing, root-cause investigation, receipts, and human sign-off.
5. **The ledger**: `.trust/progress.txt` carries state, rulings, recipes, and open evidence across sessions.

The remaining comparison and install sections support the decision without adding
feature-card repetition, social proof, or invented product metrics.

## Why this direction (R-21: the reason is written)

The framework is a tool that developers point at coding agents, and its natural
habitat is the terminal: gates print to stdout, receipts live in ledger files,
the whole discipline is shell commands and exit codes. A dark-first site with
terminal cadence matches the product's actual daily use. Dark is chosen for this
brand reason, not because "dark looks tech". Light mode is not shipped: with one
strong brand reason for a fixed dark theme, R-21's toggle requirement does not
trigger.

## Palette (R-29: 2 core + 1 accent, neutrals excluded)

- **Core 1: terminal black** `#0D1117` (background) with off-white ink
  `#E6EDF3`. Chosen over pure black and blue-dark defaults: a warm neutral dark
  with a slight blue-slate cast reads as a code editor, the product's real
  environment. (Reason: C-1, environment-derived identity.)
- **Core 2: ledger grey** `#8B949E` (secondary text, borders, captions). Passes
  4.5:1 on the background for body text.
- **Accent: exit-zero green** `#3FB950` (prompts, PASS states, verdicts, and the
  primary action). The framework's promise is "exit zero or it did not happen".
  It never becomes a page background or decorative wash. Gate red `#F85149`
  remains reserved for failure output.

## Typography (R-06: reasons written)

- **Headings and body: the mono stack** (ui-monospace / SF Mono / Cascadia /
  Consolas). Reason: this product literally works through commands and files, so
  monospace is brand-true rather than terminal costume.
- Body remains short and link-heavy because long mono paragraphs are tiring.
- Weight, not wide uppercase tracking, creates hierarchy: 400 body, 600 headings,
  and 700 verdicts.

## Layout and composition

- Content uses one fluid column capped at 48rem. The comparison table can scroll
  inside its own wrapper because tabular evidence needs more room than prose.
- The focal point is the hero's command, verdict, and “proof before confidence”
  statement. The page then opens five distinct checkpoints with structural
  whitespace between them.
- Terminal grammar is the identity motif: real commands, file paths, output,
  exit codes, and a ledger excerpt. There is no fake window chrome, blinking
  cursor, typing animation, generic dashboard, or decorative illustration.
- Section compositions intentionally vary: verdict-led hero, four-part core
  loop, vertical chain, terminal transcript, statute list, file excerpt, table,
  and install command.
- Navigation keeps one external destination, the real GitHub repository. The five
  concepts remain discoverable through the page's reading order. The logo and
  GitHub link share a centered navbar alignment, explicit matching line-height,
  and the same 44px interaction box. The skip link targets `#main`.

## Motion and accessibility

Motion stays at **MOTION 1**: smooth anchor scrolling, hover states, and visible
focus outlines only. There are no loops or scroll reveals. Interactive links are
real destinations, have visible focus, and use at least 44px of vertical target
space. Mobile uses a compact GitHub-only header, collapses actions to full-width
controls, and keeps tables inside a bounded horizontal scroller rather than
letting the page overflow.

## Content honesty (R-17, R-18, R-36, R-38, C-5)

Every number is cited from repo files: the 11-skills count and 0/3 self-trigger
figure from README and `docs/design.md`, the gate output from repository scripts,
and the memory model from README and `docs/design.md`. No user counts,
testimonials, uptime claims, customer logos, or “trusted by” language appear.
The limitations are stated through the distinction between structural proof and
product intent rather than inflated promises.

## Dials

ENERGY 2 / RHYTHM 2 / MOTION 1
