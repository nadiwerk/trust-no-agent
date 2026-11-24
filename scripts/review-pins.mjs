/**
 * Single source for the compatibility live-proof review-by date.
 *
 * The coupling is deliberate, and now it has exactly one site:
 * docs/compatibility.md must carry this literal date, and the date may only
 * move forward with a written reason recorded in the doc (the AC5 contract).
 * Before this file, the same literal was pinned in three places
 * (the doc, eval.mjs, eval-adapter.test.mjs) and a move cost three edits —
 * with two of the three silently missable. A move is now one diff here plus
 * the doc's written reason, never a quiet drift.
 */
export const COMPAT_REVIEW_BY = '2026-12-08';
export const COMPAT_REVIEW_BY_RE = new RegExp(`review-by ${COMPAT_REVIEW_BY}`, 'i');
