#!/usr/bin/env node
/**
 * Fail-first test for scripts/secrets-scan.mjs — the prose-to-gate secrets check.
 * Zero dependencies. Run: node scripts/secrets-scan.test.mjs
 *
 * Seam: scanText(text, label) — finds real secret material (private-key
 * blocks, provider tokens, literal credential assignments) and stays quiet on
 * placeholders. Fixture strings are built by concatenation so this test file
 * itself never trips the scanner.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanText } from './secrets-scan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`ok - ${label}`);
  else { failures++; console.log(`FAIL - ${label}${detail ? ` :: ${detail}` : ''}`); }
};

// Build every fixture by concatenation — the scanner must never find its own test file.
const GHP = 'ghp_' + 'A'.repeat(36);
const SK = 'sk-' + 'B'.repeat(24);
const AKIA = 'AKIA' + 'C'.repeat(16);
const PEM = '-----BEGIN ' + 'PRIVATE KEY-----';
const ASSIGN = 'api_key = "' + 'D'.repeat(24) + '"';

// ---- A. Real secret shapes are found ----
{
  const hits = scanText(`token = "${GHP}"\n`, 'a.js');
  check('A1 GitHub PAT found', hits.length > 0 && hits[0].includes('a.js'), JSON.stringify(hits));
}
{
  const hits = scanText(`const k = "${SK}";\n${PEM}\nrest\n`, 'b.js');
  check('A2 sk- token and PEM block found', hits.length >= 2, JSON.stringify(hits));
}
{
  const hits = scanText(`aws = "${AKIA}"\n${ASSIGN}\n`, 'c.js');
  check('A3 AWS key + literal credential assignment found', hits.length >= 2, JSON.stringify(hits));
}

// ---- B. Placeholders and non-secrets stay quiet ----
{
  const quiet = [
    'api_key = "your-api-key-here"',
    'password = "<redacted>"',
    'token = process.env.MY_TOKEN',
    'apiKey: "$API_KEY"',
    'secret = "changeme"',
    'const ref = "ghp_..." — placeholder',
    'OPENAI_API_KEY= (empty)',
  ];
  const hits = scanText(quiet.join('\n'), 'd.md');
  check('B placeholders produce no findings', hits.length === 0, JSON.stringify(hits));
}

// ---- C. Findings carry the label + line ----
{
  const hits = scanText(`line1\nx = "${GHP}"\nline3\n`, 'myfile.txt');
  check('C finding names file and line number',
    hits.length === 1 && /myfile\.txt:2/.test(hits[0]), JSON.stringify(hits));
}

// ---- D. Self-scan: the scanner's own pattern table must never trip it ----
{
  const src = readFileSync(join(ROOT, 'scripts', 'secrets-scan.mjs'), 'utf8');
  const hits = scanText(src, 'secrets-scan.mjs');
  check('D scanner pattern table survives its own scan', hits.length === 0, JSON.stringify(hits));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
