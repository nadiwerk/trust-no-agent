/**
 * Ledger audit — Loaded:-gap, visual-gate, and context-confirmation checks for
 * the private ledger (.trust/progress.txt). Pure Node, zero dependencies.
 * Extracted into its own module so the fail-first test
 * (ledger-audit.test.mjs) can import it without running doctor's CLI.
 *
 * Contract (user-approved 2026-09-09, high-priority development items 1–3):
 * the `Loaded:` audit-trail rule (AGENTS.md §2) and the wrong-target rule
 * (AGENTS.md §6) are proven to fail silently — session 2026-09-09 found
 * 47 `Loaded: receipts` entries, 0 for root-cause/expect-fail despite
 * domain-relevant work, and site receipts verified CSS strings while the user
 * read the rendered page. A rule that relies on runtime initiative fails
 * silently; written artifacts work. So the ledger itself is audited:
 *
 *  M1 loaded-gap — a dated entry whose text touches a MANDATORY skill's
 *     domain (bug/test/done-claim triggers) without any `Loaded: <skill>` line.
 *  M2 visual-gate — a dated entry touching site/ without a rendered-evidence
 *     line (screenshot/browser/rendered): rendered-output claims need
 *     rendered-output evidence, not a string match on the deployed source.
 *  M3 context-gap — a dated entry fixing owner-supplied visual feedback
 *     (screenshot/mockup/reference) without a literal `Context confirmed:`
 *     restatement line (Iron Law 1: shared understanding before action).
 *
 * Entry model (writer/reader reconciliation, 2026-09-12). Entries are delimited
 * by `### <heading>` lines and inherit the nearest preceding `## YYYY-MM-DD`
 * date header. An entry with no preceding date header is unprovable: it is
 * returned as a coverage gap (never silently dropped, never a finding), so a
 * blind audit is distinguishable from a clean one. This is the fix for the
 * original blindness — the writer (ship-log) wrote no date headers while the
 * reader split on them, so real ledgers audited as vacuously clean.
 *
 * Grace/recency window and degrade doctrine mirror corrective-tier.mjs:
 * findings only from the last 14 days of dated entries, and an undated ledger
 * degrades to coverage gaps — never hard-fail on unprovable data.
 */

import { classifyTask, MANDATORY_DOMAINS } from './mandatory-gate.mjs';

export const RECENCY_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

// Literal markers (evals lesson: loose regex matched a cousin phrase and the
// RED test stayed green — checks use literal phrases, not loose patterns).
// Literal phrases that place an entry in a MANDATORY skill's domain.
const DOMAIN_MARKERS = [
  // receipts / done-claim domain
  'Committed ', 'committed ', 'pushed ', 'shipped ', 'deploy verified',
  // root-cause domain
  'root cause', 'Root cause', 'diagnos', 'test failure', 'failing test',
  // expect-fail domain
  'test-first', 'failing test', 'new test',
];

// Literal phrases that make an entry a site/ visual change.
const VISUAL_FIX_MARKER = 'site/';

// Literal phrases proving rendered-output evidence (not a CSS/source check).
const RENDERED_EVIDENCE = ['Rendered evidence:', 'screenshot', 'browser', 'rendered'];

// Owner visual feedback: the vocabulary lives in ONE place. It was three
// (a list, an ARTIFACT regex, and an inline alternation that had already
// drifted by missing `bukti visual`) — add a word, edit three regexes, miss one
// (roast finding 2026-09-19). ARTIFACT_WORDS is the source; the rest derive.
const ARTIFACT_WORDS = ['screenshot', 'mockup', 'diagram', 'wireframe', 'gambar', 'bukti visual'];
const ARTIFACT_ALT = ARTIFACT_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|');
const ARTIFACT = `(?:${ARTIFACT_ALT})`;
const VISUAL_FEEDBACK = ARTIFACT_WORDS;

const TITLE = '(?:owner|master)';
const DELIVERY = '(?:kirim|mengirim|kasih|memberi|melampirkan|attach(?:ed)?|showed|shows|sent|sends|shared)';
const OWNER_ATTRIBUTION = [
  // "owner screenshot", "owner's mockup", "Master mockup" — possessive form.
  // No hyphen allowed: `owner-viewable` is a compound adjective, not ownership.
  new RegExp(`\\b${TITLE}(?:'s)?\\s+${ARTIFACT}\\b`, 'i'),
  // "mockup Master", "screenshot dari Master", "gambar milik owner" — artifact
  // first, human after (the Indonesian word order this ledger actually uses).
  // The preposition is optional; the trailing lookahead is what keeps the
  // compound adjective `owner-viewable` out.
  new RegExp(`\\b${ARTIFACT}\\s+(?:dari|milik|oleh|punya|from)?\\s*${TITLE}(?![-\\w])`, 'i'),
  // "Master kirim screenshot", "owner sent a mockup" — a delivery verb bridges.
  new RegExp(`\\b${TITLE}\\s+${DELIVERY}\\b[^.\\n]{0,30}?\\b${ARTIFACT}\\b`, 'i'),
];

// A REQUEST for a visual artifact is not owner-supplied feedback — the entry is
// asking, not fixing. Load-bearing, not decorative: it removes exactly one real
// false positive ("butuh screenshot/lokasi persis … dari Master") from the
// adopter ledger (verified by neutralizing it: 2 context-gaps → 1).
const REQUEST_FOR_ARTIFACT = new RegExp(
  `\\b(?:butuh|perlu|minta|meminta|menunggu|need|needs|needed|requires?|waiting for)\\b[^.\\n]{0,30}?\\b${ARTIFACT}\\b`,
  'i',
);

const hasOwnerAttribution = (body) => OWNER_ATTRIBUTION.some((re) => re.test(stripQuoted(body)));

// Backticked text is QUOTED text — a fixture, a rule being discussed, a command.
// An entry that documents the M3 rule itself ("the canonical `Owner screenshot
// showed the collision` fixture still fires") is not reporting owner feedback,
// and the audit cannot tell quote from claim unless quoting is excluded. Found
// by dogfooding this repo's own ledger entry (2026-09-19). Prose that merely
// happens to be in backticks is rare in a ledger, so the exclusion is safe:
// a real report writes the phrase unquoted (regression-tested by I7).
const stripQuoted = (body) => body.replace(/`[^`\n]*`/g, ' ');

// The literal restatement line that satisfies the confirmation gate.
const CONTEXT_CONFIRMED = 'Context confirmed:';

// A line-start `Loaded:` bullet satisfies the M1 trail — PRESENCE is the bar,
// because choosing the right skill is judgment (the audit is the boundary, not
// the judge). An annotation-only bullet ("- Loaded: (tanpa skill MANDATORY —
// …)") therefore satisfies M1 by design (spec D3); the COUNT is what stays
// honest, and M4's blind-spot warning is the signal for a trail that never
// names a skill.
const LOADED_LINE = /^- Loaded:/m;

// A line-start `Next:` bullet satisfies M7's forward arrow — same presence bar
// and same literal-line doctrine as LOADED_LINE. `Next: none` is a VALUE
// (docs/chat-receipt.md rule 4: "Never empty unless it says none"); only
// silence is the gap. Origin: owner feedback 2026-09-23 — closes without a
// forward arrow strand the reader ("sebagai user kadang tidak tau harus apa").
const NEXT_LINE = /^- Next:/m;

// M7's ENTRY CLASS (audit 2026-09-29, measured on a real adopter ledger): 35 of
// 35 dated entries there lacked the arrow — 100% precise and 0% useful, because
// that ledger is a per-session lab notebook (its own header: "file ini menyimpan
// 40 entry terakhir"), so most of its entries legitimately close nothing. The
// arrow is a property of a UNIT CLOSING, so it is demanded from entries that
// carry a body of their own — not from index pointers (rotation lines, archive
// references) that exist to route the reader somewhere else. This narrows WHICH
// entries the rule applies to; it does not weaken the rule (K7 still fails a
// body-carrying entry with no arrow).
const isIndexPointerEntry = (body) => {
  const ls = body.split('\n').map((l) => l.trim()).filter(Boolean);
  // A real entry carries BULLETS (its report). A rotation pointer is a heading
  // plus at most one prose/quote line pointing at the archive — it has none.
  if (ls.some((l) => /^-\s/.test(l))) return false;
  return ls.length <= 2;
};

// M8 — lesson-gap (audit 2026-09-27 §7b). receipts (MANDATORY) demands the
// corrective tier be fed on EVERY repair ("Before accepting a fixed/done/repair
// claim, check the lesson exists" — receipts skill §Lesson capture), but nothing
// mechanically verified a lesson was written for the repair being closed: the
// only link was a free-text backfill tag applied inconsistently. M8 makes it a
// comparison — the entry carries a repair marker AND the lessons text carries a
// lesson dated with the entry's date — or the entry is a finding.
//
// The contract is PRESENCE, same doctrine as M1/M7: the writer chooses the
// wording; the audit counts the fact. The lesson needs the entry's date because
// that is what "the lesson for THIS repair" means without inventing incident
// keys — a lesson dated any other day cannot be this entry's by construction,
// which is the honest limit of a date-keyed match (two repairs of different
// bugs on one date share the satisfaction; the check is a floor, not a proof).
const REPAIR_MARKERS = [
  // root-cause domain (the repair verbs, not the diagnosis nouns)
  'root cause', 'Root cause',
  'test failure', 'failing test', 'failing tests',
  'fixed the bug', 'bug fixed', 'fixed by',
  'perbaikan', 'diperbaiki',
  // done-claim domain (a closed repair commits)
  'Committed ', 'committed the fix',
];

// A lesson line in .trust/lessons.md — the file's own documented format
// ("Lesson: root_cause = … | correction = …"). The date annotation is the
// established convention (29 of 30 existing lessons carry one); the bracketed
// date may sit anywhere after the marker. No date in the LESSONS text at all
// means the tier cannot prove any lesson corresponds to any entry — every
// repair entry inside the window then reads as a gap, which is the correct
// reading of a tier that records nothing.
// The whole line, not just the marker: the date annotation lives at the END of
// the lesson (`… | correction = … [2026-09-08]`), so a marker-only match would
// never carry it (bug caught by L2 during the M8 wiring, 2026-09-29).
const LESSON_LINE = /^Lesson:.*$/gm;
const LESSON_DATE = /\[(\d{4}-\d{2}-\d{2})/;

// L11 — lesson-format (audit 2026-09-29). Measured on a real adopter tier: 66
// lessons recorded, ZERO dated, ZERO in the framework's form — so M8 could not
// link one lesson to one repair and reported every repair in the window as a
// gap. That reading is correct and useless to the reader: the tier is not
// starving, it is UNMATCHABLE, and the honest report says so in one finding
// instead of leaving the reader with 15 gaps and no diagnosis. It fires only
// when the tier has lessons AND none of them is dated — an empty tier is C5's
// starvation report, and a partly-migrated tier is a gap list, not a defect.
const LESSON_FORM_LINE = /^Lesson:.*\[\d{4}-\d{2}-\d{2}\]/m;

// G7 — a third date source (audit 2026-09-29). The adopter writes the day inside
// the session heading ("### Ringkasan Sesi - … (27 Sep, lanjutan 3)") and puts no
// `## YYYY-MM-DD` header on most sections, so 16 entries whose date was present
// and unambiguous came back as unprovable coverage gaps. A heading label counts
// ONLY when the entry has no date header of its own: the header stays the
// authority, and the label is a fallback. The year is taken from the nearest
// preceding date header (a ledger runs chronologically, and a wrap to January is
// then one year later) or, when no header appeared yet, from the audit's own
// `today` — never guessed beyond that.
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6, agu: 7, aug: 7, sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11 };
const HEADING_DAY_LABEL = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|Mei|May|Jun|Jul|Agu|Aug|Sep|Okt|Oct|Nov|Des|Dec)\b/i;

// The COUNT (M4) parses the line as a list instead of reading one token. The
// first-token reader undercounted a real adopter ledger 5-8x (126 bullets
// containing `receipts` counted as 16) because the writer lists skills
// comma-separated. Tokens must look like skill names — a single lowercase
// hyphenated word — so annotation text ("tanpa skill MANDATORY", "n/a",
// "read-only Explore audit") adds no counts.
const LOADED_LIST_LINE = /^- Loaded:\s*(.*)$/gm;
const SKILL_TOKEN = /^[a-z][a-z0-9-]*$/;

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Resolve a `### … (27 Sep)` day label to a full ISO date.
 *
 * @param {string} heading the entry heading line
 * @param {string|null} prevDate nearest preceding `## YYYY-MM-DD` header, if any
 * @param {Date} today the audit's reference date (never the wall clock: the
 *   seam stays deterministic and the caller already injects it)
 * @returns {string|null} `YYYY-MM-DD`, or null when the label is absent
 */
function dateFromHeadingLabel(heading, prevDate, today) {
  const m = heading.match(HEADING_DAY_LABEL);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  if (!Number.isFinite(day) || day < 1 || day > 31 || month === undefined) return null;
  if (prevDate) {
    const [py, pm] = prevDate.split('-').map(Number);
    // A month earlier than the previous header's means the ledger wrapped a year.
    const year = month < pm - 1 ? py + 1 : py;
    return `${year}-${pad2(month + 1)}-${pad2(day)}`;
  }
  return `${today.getUTCFullYear()}-${pad2(month + 1)}-${pad2(day)}`;
}

/**
 * Parse every `- Loaded:` bullet into skill tokens.
 * Separators observed in the two real ledgers: `,` (adopter, 153 bullets),
 * `;` (upstream), `+` and ` / `. Annotation is dropped two ways: a
 * parenthetical is removed, and anything after a spaced em/en-dash is cut —
 * the annotation is a note about the load, never a skill name.
 */
export function parseLoadedTokens(text) {
  const tokens = [];
  for (const m of text.matchAll(LOADED_LIST_LINE)) {
    const body = m[1].split(/\s[—–]\s/)[0].replace(/\([^)]*\)/g, ' ');
    for (const seg of body.split(/[,;+]|\s\/\s/)) {
      const tok = seg.trim().toLowerCase();
      if (SKILL_TOKEN.test(tok)) tokens.push(tok);
    }
  }
  return tokens;
}

// A date header sets the date for the section that follows. Titled headers
// (`## 2026-09-19 — Rebrand X`) are a real writer shape — the adopter router
// emits them — and 131 of 144 headers in the adopter ledger carried a title,
// which the bare-only pattern could not see. `\r` is stripped before matching
// so CRLF ledgers behave the same.
const DATE_HEADER = /^##\s*(\d{4}-\d{2}-\d{2})\b/;

// Sub-sections that live INSIDE a parent entry and must not start a new one
// (otherwise they would register as spurious undated entries → fake gaps).
// Matched against the full `### <heading>` line.
const KNOWN_SUBSECTIONS = [/^###\s+Self-Review\b/i, /^###\s+Archive\b/i];

// Churn doctrine (development item #6): 3 reverts on one block in the
// green-border saga = Iron Law 1 failing repeatedly without a signal. Two
// reverts naming the same target within the window is the earliest mechanical
// trace of that pattern; the finding tells the next session to stop fixing
// and confirm context instead. Single reverts are normal maintenance.
const REVERT_LINE = /revert/i;
// A Self-Review checklist bullet ("- [x] **Maintainability**: ... (revert 3001)")
// is a template repeat, not revert evidence: KNOWN_SUBSECTIONS folds the
// `### Self-Review` head into the parent body before M5's bullet scan, so every
// session's checklist collides on the same fixed noun ("Maintainability") and
// reads as churn. Exclude checkbox lines (adopter regression F5, 2026-09-23);
// genuine `- Reverted ...` bullets inside the subsection still count (F6).
const CHECKBOX_LINE = /^- \[[ x]\]/;
const REVERT_STOPWORDS = ['commit', 'change', 'treatment', 'approach'];
const CHURN_THRESHOLD = 2;

/**
 * @param {object} input
 * @param {string} input.ledgerText full text of .trust/progress.txt
 * @param {Date} input.today reference "now" (injected for determinism)
 * @param {number} [input.recencyDays] audit window in days (default 14)
 * @returns {{findings: Array<{date: string, kind: string, message: string}>,
 * @param {string} [input.lessonsText] full text of .trust/lessons.md (M8).
 *   Omitted by callers that cannot read the tier — M8 then stays SILENT rather
 *   than inventing gaps out of missing data (same degrade doctrine as an
 *   undated entry: unprovable is never a finding). Tests and embedders that do
 *   not pass it keep their old verdicts (pinned by L7).
 * @returns {{findings: Array<{date: string, kind: string, message: string}>,
 *            gaps: Array<{date: null, kind: 'coverage-gap', reason: string}>,
 *            stats: object}}
 */
export function auditLedger({ ledgerText, today, recencyDays = RECENCY_DAYS, lessonsText = null }) {
  const findings = [];
  if (!ledgerText.trim()) return { findings, gaps: [], stats: emptyStats() };

  const entries = splitEntries(ledgerText, today);
  const windowStart = today.getTime() - recencyDays * DAY_MS;

  // M8's tier text, read ONCE and used by both the tier-level L11 check below
  // and the per-entry M8 comparison: the reader needs the same text for both,
  // and a second read would be a second chance to drift.
  const lessonsProvided = typeof lessonsText === 'string';

  // L11 — one tier-level finding, emitted at most once per audit (the defect is
  // a property of the FILE, not of each entry). Severity is informational in the
  // summary: it names the fix (date the lesson, use the documented form) instead
  // of leaving 15 entry-level gaps with no diagnosis.
  if (lessonsProvided) {
    // The tier's shape is measured on LINES THAT RECORD A LESSON, and a lesson
    // is not always prefixed with the framework's marker: the adopter measure
    // (2026-09-29) found 66 lessons written as plain bullets, which is why the
    // doc form is a guidance and the tier can be unmatchable in either shape.
    const lessonLines = lessonsText
      .split('\n')
      .filter((l) => /^\s*(?:-\s|\d+[.)]\s)/.test(l) || /^Lesson:/.test(l))
      .filter((l) => l.trim().length > 24);
    if (lessonLines.length && !LESSON_FORM_LINE.test(lessonsText))
      findings.push({
        date: 'tier',
        kind: 'lesson-format',
        message: `.trust/lessons.md holds ${lessonLines.length} lesson(s) but none carries a [YYYY-MM-DD] annotation in the documented \`Lesson: root_cause = … | correction = …\` form — the corrective tier cannot be MATCHED to any repair, so every repair in the window reads as an unattributed gap; date the lessons (or record new ones) in the documented form so the tier can be linked to what it taught (receipts §Lesson capture, audit 2026-09-27 §7b)`,
      });
  }

  // M8 needs the entry's own date to decide, so the tier is indexed ONCE by the
  // date annotation the format already carries (`[2026-09-19]`, see
  // .trust/lessons.md). A lesson with no bracketed date is deliberately not
  // indexed: it cannot be attributed to any single repair, and a date-less
  // index would let one lesson satisfy every repair in the window.
  const lessonDates = new Set();
  if (lessonsProvided) {
    // No `^` anchor in the line predicate: LESSON_LINE is a /gm regex whose
    // lastIndex persists, so `.test()` on successive matches would skip every
    // other lesson. matchAll resets it, and the predicate stays a plain check.
    for (const m of lessonsText.matchAll(LESSON_LINE)) {
      const d = m[0].match(LESSON_DATE);
      if (d) lessonDates.add(d[1]);
    }
  }

  // M4 — per-skill Loaded: counts, ledger-wide (not windowed): the historical
  // ratio IS the signal. A MANDATORY skill with zero Loaded: lines while the
  // ledger contains its domain markers is the 47-vs-0 blind spot made visible.
  const loadedCounts = {};
  const domainHits = {};
  const revertTargets = {}; // normalized target -> { count, label }
  const gaps = [];

  for (const { date, body } of entries) {
    // Coverage gap: an entry the audit cannot date. Reported, never dropped —
    // this is what makes "blind" distinguishable from "clean" (spec D7).
    if (!date) {
      gaps.push({ date: null, kind: 'coverage-gap', reason: 'entry has no preceding `## YYYY-MM-DD` date header — unprovable, not audited' });
      continue;
    }

    const start = new Date(`${date}T00:00:00Z`);
    const age = (today.getTime() - start.getTime()) / DAY_MS;
    if (!Number.isFinite(age) || age > recencyDays || start.getTime() < windowStart) continue;

    for (const skill of parseLoadedTokens(body)) {
      loadedCounts[skill] = (loadedCounts[skill] || 0) + 1;
    }
    for (const marker of DOMAIN_MARKERS) {
      if (body.includes(marker)) domainHits[marker] = (domainHits[marker] || 0) + 1;
    }

    // M5 — churn: collect revert targets within the window. Bullets only:
    // `### Session Summary - <title>` lines may contain "revert" as history
    // shorthand while the revert evidence itself lives in the entry's bullets.
    for (const line of body.split('\n')) {
      if (!line.startsWith('- ') || CHECKBOX_LINE.test(line) || !REVERT_LINE.test(line)) continue;
      const target = normalizeRevertTarget(line);
      if (!target) continue;
      if (!revertTargets[target]) revertTargets[target] = { count: 0, label: target };
      revertTargets[target].count++;
    }

    // M1 — domain-relevant entry without a Loaded: line
    const inDomain = DOMAIN_MARKERS.some((m) => body.includes(m));
    if (inDomain && !LOADED_LINE.test(body))
      findings.push({
        date,
        kind: 'loaded-gap',
        message: `entry ${date} touches a MANDATORY skill's domain (bug/test/done-claim triggers) but carries no "- Loaded: <skill>" line — either the skill was not loaded (discipline silently dropped) or the audit trail is incomplete; fix the gap, per AGENTS.md §2`,
      });

    // M6 — gate finding (docs/specs/mandatory-gate.md, ticket 02): the
    // mandatory-gate classifier runs on the same Summary text M4's reader
    // consumes, so no second parse. Additive to M1's literal markers — the
    // gate's bilingual keyword tables catch phrasing the literal list misses
    // ("please commit", "tulis test"), and vice versa (J5). Warn-level by
    // contract: a keyword matcher is a signal to verify, never proof, and
    // may not fail an audit by itself (spec §Constraints).
    const gateVerdict = classifyTask(body);
    // The gate and the literal audit report DIFFERENT populations, verified by
    // measurement rather than assumed (2026-09-29): on a real adopter ledger the
    // gate flagged 33 trail-less entries of which only 11 also tripped a literal
    // marker — the other 22 are entries M1 cannot see at all, which is the gate
    // earning its keep. A body carrying `- Loaded:` is out of the gate's scope by
    // construction (it is not missing a trail), so it is never double-reported.
    const hasLoadedTrail = LOADED_LINE.test(body);
    for (const skill of MANDATORY_DOMAINS) {
      if (gateVerdict[skill] && !hasLoadedTrail)
        findings.push({
          date,
          kind: 'gated-loaded-gap',
          message: `entry ${date} matches the mandatory-gate keyword pattern for "${skill}" but carries no "- Loaded:" line — this is a keyword-pattern signal to verify, not a proven violation; confirm the skill was loaded or add the Loaded: line (docs/specs/mandatory-gate.md, AGENTS.md §2)`,
        });
    }

    // M2 — site/ visual change without rendered-output evidence
    const siteFix = body.includes(VISUAL_FIX_MARKER);
    const hasRendered = RENDERED_EVIDENCE.some((m) => body.toLowerCase().includes(m.toLowerCase()));
    if (siteFix && !hasRendered)
      findings.push({
        date,
        kind: 'visual-gate',
        message: `entry ${date} touches site/ without rendered-output evidence (screenshot/browser/rendered) — verify the artifact the user reads: a live check of the rendered page, not a string match on the deployed source (AGENTS.md §6)`,
      });

    // M3 — owner-supplied visual feedback fixed without a context confirmation.
    // Both halves are required: a visual artifact word AND owner attribution to
    // it (proximity, not co-presence — see OWNER_ATTRIBUTION). The attribution
    // half is what makes the finding mean "you skipped Iron Law 1 on the
    // owner's input" instead of "this entry mentions a screenshot".
    const visualFeedback = VISUAL_FEEDBACK.some((m) => body.toLowerCase().includes(m.toLowerCase()));
    const ownerFeedback = visualFeedback && hasOwnerAttribution(body) && !REQUEST_FOR_ARTIFACT.test(body);
    if (ownerFeedback && !body.includes(CONTEXT_CONFIRMED))
      findings.push({
        date,
        kind: 'context-gap',
        message: `entry ${date} fixes owner-supplied visual feedback without a "Context confirmed:" restatement line — Iron Law 1: confirm shared understanding (desktop/mobile, which block, what symptom) before the fix, not after a revert (AGENTS.md §6)`,
      });

    // M8 — lesson-gap (audit 2026-09-27 §7b): the entry closes a REPAIR but
    // the corrective tier carries no lesson dated with the entry. Comparison,
    // not a word match, so an entry that merely mentions a lesson does not
    // satisfy it (L4). Silent when the caller supplied no tier text (L7) and
    // silent for entries with no repair marker at all (L3) — presence bar,
    // same doctrine as M1/M7: the writer chooses the wording, the audit counts
    // the fact. Warn-level in doctor like every other kind: the ledger is
    // private working memory, so a finding is a lead, never an install defect.
    if (lessonsProvided && REPAIR_MARKERS.some((m) => body.includes(m)) && !lessonDates.has(date))
      findings.push({
        date,
        kind: 'lesson-gap',
        message: `entry ${date} closes a repair (root-cause/done-claim markers) but .trust/lessons.md carries no lesson dated ${date} — the corrective tier was not fed for this repair; record the lesson (format: Lesson: root_cause = … | correction = … [${date}]) or the next session cannot learn from it (receipts §Lesson capture, audit 2026-09-27 §7b)`,
      });

    // M7 — forward arrow: an entry that closes with no Next: line at all.
    // Presence bar: "none" is a value, silence is not (docs/chat-receipt.md
    // rule 4). Mechanical twin of the §6 rule (encode-twice). Entry class is
    // narrowed (audit 2026-09-29): an index-pointer line routes the reader
    // elsewhere and closes nothing, so it is not asked for an arrow.
    if (!NEXT_LINE.test(body) && !isIndexPointerEntry(body))
      findings.push({
        date,
        kind: 'next-gap',
        message: `entry ${date} carries no "- Next:" line — every unit closes with one concrete forward arrow (a named action or the one decision the owner owns); "none" is a value, silence is not (docs/chat-receipt.md rule 4, AGENTS.md §6)`,
      });
  }

  // M5 — churn findings: 2+ reverts naming the same target in the window
  for (const { count, label } of Object.values(revertTargets)) {
    if (count >= CHURN_THRESHOLD)
      findings.push({
        date: 'window',
        kind: 'churn',
        message: `${count} reverts on "${label}" within the ${recencyDays}-day window — repeated fix-revert cycles on one target are the Iron Law 1 failure signature (guessing context instead of confirming it); STOP fixing and confirm the context with the owner first (AGENTS.md §6)`,
      });
  }

  // M4 — mandatoryMentions: per-MANDATORY-skill Loaded: count (0 = blind spot
  // when domain hits exist). Domain hits are counted on marker presence per
  // entry; a marker appearing at all means the domain was touched ledger-wide.
  const mandatoryMentions = MANDATORY_DOMAINS.map((skill) => ({
    skill,
    count: loadedCounts[skill] || 0,
    domainTouched: DOMAIN_MARKERS.some((m) => (domainHits[m] || 0) > 0),
  }));

  return { findings, gaps, stats: { loadedCounts, mandatoryMentions } };
}

// MANDATORY skills per the router — imported from the gate (one list, two
// consumers, or the domain vocabulary drifts: roast finding 2026-09-20).
// eval.mjs check 6 reads the router prose independently; keep that in sync.

/**
 * One reader-facing line per finding kind, produced HERE rather than in the
 * caller: the summary must be able to strip each message's own `entry <date>`
 * prefix, so a printer reaching in with a regex would break the moment the
 * message format moves (roast finding 2026-09-19 — the format belongs with the
 * messages it formats). The churn kind carries date `window` instead of a date,
 * so the entry list is labeled for what it actually holds.
 *
 * @param {string} kind finding kind (closed set)
 * @param {Array<{date: string, message: string}>} list findings of that kind
 * @returns {string}
 */
export function formatFindingGroup(kind, list) {
  const dates = [...new Set(list.map((f) => f.date))];
  const label = dates.includes('window') && dates.length === 1 ? 'scope' : 'entries';
  const shown = dates.slice(0, 3).join(', ');
  const more = dates.length > 3 ? ` (+${dates.length - 3} more)` : '';
  // The summary line carries the KIND's meaning; each message's per-entry
  // prefix is dropped because the date list above already names the entries.
  const summary = list[0].message.replace(/^entry \S+ /, '').replace(/^window /, '');
  return `${list.length} × ${kind} — ${label}: ${shown}${more}. ${summary}`;
}

/**
 * The doctor's ledger-audit verdict, extracted so it is testable without
 * running doctor's CLI side effects (same pattern as corrective-tier.mjs).
 *
 * Three values, because "no findings" and "could not look" must not print the
 * same thing: `clean` (0 findings, 0 gaps), `findings` (≥1 finding), or
 * `unprovable` (≥1 undated entry). All three are WARN-level for the caller —
 * the ledger is private working memory, so findings are leads for the next
 * session, never installation defects (constraint C4).
 *
 * @param {{findings: Array, gaps: Array}} input
 * @returns {{level: 'clean'|'findings'|'unprovable', warn: boolean, message: string}}
 */
export function ledgerVerdict({ findings = [], gaps = [] } = {}) {
  const gapNote = gaps.length
    ? `; ${gaps.length} undated entr${gaps.length === 1 ? 'y' : 'ies'} (unprovable)`
    : '';
  if (findings.length)
    return {
      level: 'findings',
      warn: true,
      // Name the kinds actually present: the old sentence listed three kinds
      // hardcoded and could not describe a next-gap, a churn finding, a gate
      // signal, or M8's lesson-gap (roast finding 2026-09-29).
      message: `ledger audit: ${findings.length} finding(s)${gapNote} — ${[...new Set(findings.map((f) => f.kind))].join('/')} gap(s); fix per AGENTS.md §2`,
    };
  if (gaps.length)
    return {
      level: 'unprovable',
      warn: true,
      message: `ledger audit: unprovable — ${gaps.length} undated entr${gaps.length === 1 ? 'y' : 'ies'} (no date header); the gate cannot audit undated entries, so "clean" would be a blind claim (give each entry a dated header; see ship-log Log Format)`,
    };
  return { level: 'clean', warn: false, message: 'ledger audit clean (Loaded: trail, visual gate, context confirmation)' };
}

const emptyStats = () => ({ loadedCounts: {}, mandatoryMentions: MANDATORY_DOMAINS.map((skill) => ({ skill, count: 0, domainTouched: false })) });

/**
 * Split ledger text into entries. Two writer shapes exist in production and
 * both are read here (spec D1, ticket 01):
 *
 *  - the upstream ship-log shape: `## YYYY-MM-DD` then `### Session Summary`
 *    then bullets;
 *  - the adopter router shape: `## YYYY-MM-DD — <title>` then FLAT bullets
 *    with no `###` heading at all (43 such sections in the real adopter
 *    ledger that exposed this).
 *
 * The model is therefore SECTION-based, not heading-based: a date header opens
 * a section, a non-subsection `###` heading inside it starts a new entry
 * carrying the same date, and a section with no heading is one entry itself.
 * A section opened by a date header but never filled is dropped (no phantom
 * entries, no phantom gaps). Every entry inherits the nearest preceding
 * `## YYYY-MM-DD` header, title text and all; null when none appeared yet.
 *
 * This mirrors the writer contract (spec D1/D4) — the reader no longer assumes
 * the date is embedded in a `## `-delimited section, which is what made the
 * old parser blind to real ledgers.
 *
 * @returns {Array<{date: string|null, body: string}>}
 */
function splitEntries(ledgerText, today) {
  // CRLF-safe: Windows ledgers are the norm for adopters, and a trailing `\r`
  // defeats every `$`-anchored pattern downstream.
  const lines = ledgerText.split(/\r?\n/);
  const entries = [];
  let currentDate = null;
  let current = null;

  const hasContent = (e) => e && e.body.trim() !== '';
  const close = () => {
    if (hasContent(current)) entries.push(current);
    current = null;
  };
  // G7: a heading's own day label dates the entry it opens, with the previous
  // header's year (or today's when none appeared yet). The header stays the
  // authority — this only fills entries the header left undated.
  const open = (date, body) => ({
    date: date ?? dateFromHeadingLabel(body, currentDate, today),
    body,
  });

  for (const line of lines) {
    const dateMatch = line.match(DATE_HEADER);
    if (dateMatch) {
      currentDate = dateMatch[1];
      // Open the section as an empty entry: a following `###` heading reuses
      // it, a following bullet fills it. Either way the date is attached to
      // what actually follows the header.
      close();
      current = { date: currentDate, body: '' };
      continue;
    }
    if (/^###\s+/.test(line)) {
      if (KNOWN_SUBSECTIONS.some((re) => re.test(line))) {
        // Sub-section: fold into the parent entry's body (no new entry).
        if (current) current.body += `\n${line}`;
        continue;
      }
      close();
      current = open(currentDate, line);
      continue;
    }
    if (current) current.body += `\n${line}`;
  }
  close();
  return entries;
}

// Normalize a revert line into a comparable target: strip the boilerplate
// (revert/reverted/the/spacers, commit hashes) and keep the noun phrase, so
// "Reverted the chain list spacing" and "revert chain list flex" collide on
// "chain list". Stopword-only lines return '' (nothing comparable).
function normalizeRevertTarget(line) {
  const words = line
    .toLowerCase()
    .replace(/\b[0-9a-f]{7,}\b/g, ' ') // commit hashes
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const content = words.filter(
    (w) => !REVERT_STOPWORDS.includes(w) && !['revert', 'reverted', 'reverts', 'the', 'a', 'of', 'on', 'to', 'and'].includes(w),
  );
  // Key on the noun-phrase head (first 2 content words): "chain list spacing"
  // and "chain list flex" are the SAME target wearing different symptoms —
  // keeping more words would hide exactly the collision churn detection
  // exists to find.
  return content.slice(0, 2).join(' ');
}
