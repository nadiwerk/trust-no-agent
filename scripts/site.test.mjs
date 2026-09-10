import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');

const requiredIds = ['core', 'chain', 'gates', 'laws', 'ledger'];
for (const id of requiredIds) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `site has #${id}`);
}

for (const heading of ['the core', 'the chain', 'the verification gates', 'the iron laws', 'the ledger']) {
  assert.match(html.toLowerCase(), new RegExp(heading), `site names ${heading}`);
}

for (const kicker of ['01 / OPERATING IDEA', '02 / ROUTE', '03 / PROOF', '04 / BOUNDARY', '05 / MEMORY', 'DIFFERENCES']) {
  assert.match(html, new RegExp(kicker), `site uses ${kicker}`);
}


const nav = html.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0] ?? '';
const navLinks = [...nav.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
assert.deepEqual(navLinks, ['https://github.com/nadiwerk/trust-no-agent'], 'navigation keeps only GitHub');

assert.match(html, /<a[^>]+href=["']#main["'][^>]*>skip to content<\/a>/i, 'site has a skip link');
assert.match(html, /<main[^>]+id=["']main["']/i, 'main landmark has an id');

const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
for (const href of hrefs.filter((href) => href.startsWith('#'))) {
  assert.match(html, new RegExp(`id=["']${href.slice(1)}["']`), `local link ${href} resolves`);
}

for (const command of [
  'node scripts/validate.mjs',
  'node scripts/eval.mjs',
  'node scripts/tickets.test.mjs',
  'node scripts/doctor.test.mjs',
]) {
  assert.ok(html.includes(command), `site keeps real gate command ${command}`);
}

for (const phrase of ['fail-first', 'root cause', 'receipt', 'sign-off']) {
  assert.match(html.toLowerCase(), new RegExp(phrase), `site explains ${phrase}`);
}

assert.doesNotMatch(html, /\u2014/, 'site copy contains no em dash');
for (const buzzword of ['AI powered', 'next generation', 'revolutionary', 'seamless', 'cutting edge', 'intelligent', 'ultimate', 'effortless']) {
  assert.doesNotMatch(html.toLowerCase(), new RegExp(buzzword), `site avoids ${buzzword}`);
}
assert.doesNotMatch(html.toLowerCase(), /trusted by|customer logos|testimonials?/, 'site has no invented social proof');
assert.match(html, /min-height:\s*44px/i, 'interactive targets are at least 44px tall');
assert.match(html, /max-width:\s*100%|min-width:\s*0|overflow-x:\s*auto/i, 'fluid overflow protection exists');
assert.doesNotMatch(html, /100vh/, 'site does not use a fixed viewport slab');

console.log('site acceptance checks passed');
