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

assert.match(html, /header \.wrap\s*\{[^}]*align-items:\s*center/i, 'navbar items share a centered alignment');
assert.match(html, /\.brand\s*\{[^}]*line-height:\s*1\.2/i, 'brand has explicit navbar line-height');
assert.match(html, /nav a\s*\{[^}]*display:\s*inline-flex/i, 'GitHub link uses a matching flex box');
assert.match(html, /nav a\s*\{[^}]*padding:\s*0(?:;|\s)/i, 'GitHub link has no extra vertical padding');
assert.doesNotMatch(html, /nav a\s*\{[^}]*min-height:\s*44px/i, 'GitHub link does not force a taller navbar');


const nav = html.match(/<nav\b[\s\S]*?<\/nav>/i)?.[0] ?? '';
const navLinks = [...nav.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
assert.deepEqual(navLinks, ['https://github.com/nadiwerk/trust-no-agent'], 'navigation keeps only GitHub');

assert.match(html, /<a[^>]+href=["']#main["'][^>]*>skip to content<\/a>/i, 'site has a skip link');
assert.match(html, /<main[^>]+id=["']main["']/i, 'main landmark has an id');

const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
for (const href of hrefs.filter((href) => href.startsWith('#'))) {
  assert.match(html, new RegExp(`id=["']${href.slice(1)}["']`), `local link ${href} resolves`);
}

assert.doesNotMatch(html, /\.term \.cmd\s*, \.term \.out\s*\{[^}]*display:\s*block/i, 'verification lines are not forced into blocks');

assert.doesNotMatch(html, /\.term \.cmd\s*, \.term \.out\s*\{[^}]*display:\s*block/i, 'verification lines are not forced into blocks');


assert.match(html, /#core \.prose\s*\{[^}]*max-width:\s*none/i, 'core prose fills the available line');
assert.match(html, /#core \.prose\s*\{[^}]*margin-inline:\s*0/i, 'core prose stays flush with its section');


assert.doesNotMatch(html, /\.chain li::before/, 'chain has no generated bullet or counter marker');




assert.match(html, /\.chain b\s*\{[^}]*margin-right:\s*0/i, 'chain text starts directly after its number');


assert.match(html, /\.chain b\s*\{[^}]*margin-right:\s*0(?:;|\s)/i, 'chain text starts directly after its number');




assert.doesNotMatch(html, /<li><b>breakpoint<\/b><span>/, 'chain first item has no forced line break');

assert.match(html, /\.install-command\s*\{[^}]*display:\s*flex/i, 'install command keeps a horizontal control row');
assert.match(html, /\.install-command \.cmd\s*\{[^}]*overflow-x:\s*auto/i, 'install command scrolls horizontally inside its box');
assert.match(html, /\.install-command \.copy-button\s*\{[^}]*margin:\s*0/i, 'copy icon stays at the command row edge');
assert.match(html, /@media \(max-width:\s*40rem\)[\s\S]*?\.install-command\s*\{[^}]*display:\s*flex/i, 'mobile command row remains responsive');



assert.match(html, /@media \(max-width:\s*40rem\)[\s\S]*?\.install-command \.cmd\s*\{[^}]*white-space:\s*pre/i, 'mobile command preserves one-line scrollable text');
assert.match(html, /@media \(max-width:\s*40rem\)[\s\S]*?\.install-command \.copy-button\s*\{[^}]*margin:\s*0(?:;|\s)/i, 'copy button stays reachable on mobile');
assert.match(html, /@media \(max-width:\s*40rem\)[\s\S]*?\.install-grid > \.prose\s*\{[^}]*width:\s*100%/i, 'install explanation fits mobile width');


assert.match(html, /\.copy-button\s*\{[^}]*border:\s*0/i, 'copy control is icon-only without a box');
assert.match(html, /\.copy-button\s*\{[^}]*background:\s*transparent/i, 'copy control keeps transparent icon treatment');


assert.match(html, /data-copy=["']npx skills add nadiwerk\/trust-no-agent && cp AGENTS\.md WORKFLOW\.md \.["']/, 'copy control targets the full install command');

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
