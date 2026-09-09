// Long text is read as a sequence of parts, and the panel shows it as lines.
// A bug here silently drops words mid-video, or points a line at the wrong
// part so jumping lands in the wrong place. Run: node tests/chunking.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'content.js'),
  'utf8'
);

// Pull the real functions out of the shipped file rather than a copy of them.
const from = src.indexOf('function splitIntoChunks');
const to = src.indexOf('// Status goes to the panel');
if (from < 0 || to < 0) throw new Error('could not locate the splitting functions');

const PART_SIZE = 1500;
const ctx = { PART_SIZE, reader: { parts: [] } };
vm.createContext(ctx);
vm.runInContext(src.slice(from, to), ctx);
const { splitIntoChunks, buildLines, buildParts, partForLine } = ctx;

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'pass' : 'FAIL'}  ${name}${cond ? '' : '  ' + detail}`);
  if (!cond) failures++;
};
const words = (s) => s.split(/\s+/).filter(Boolean);

console.log('splitIntoChunks: short text');
check('stays whole', splitIntoChunks('Hello there.').length === 1);

console.log('\nsplitIntoChunks: no punctuation (auto-captions)');
const noPunct = Array(4000).fill('word').join(' ');
const np = splitIntoChunks(noPunct);
check('splits', np.length > 1, `got ${np.length}`);
check('respects the limit', np.every((c) => c.length <= PART_SIZE));
check('loses no word', words(np.join(' ')).length === words(noPunct).length);

console.log('\nsplitIntoChunks: one token longer than a part');
const giant = 'x'.repeat(5000);
const g = splitIntoChunks(giant);
check('terminates', g.length >= 2);
check('respects the limit', g.every((c) => c.length <= PART_SIZE));
check('loses nothing', g.join('').length === giant.length);

console.log('\nbuildLines: prose becomes sentence-ish lines');
const prose = 'First sentence here. Second one follows! Third one too? And a trailing bit';
const lines = buildLines(prose);
check('produces lines', lines.length >= 1);
check('keeps every word', words(lines.map((l) => l.text).join(' ')).length === words(prose).length,
  `${words(lines.map((l) => l.text).join(' ')).length} vs ${words(prose).length}`);
check('no line exceeds a part', lines.every((l) => l.text.length <= PART_SIZE));

console.log('\nbuildLines: a single enormous paragraph');
const huge = Array(3000).fill('blah').join(' ');
const hugeLines = buildLines(huge);
check('splits it up', hugeLines.length > 1, `got ${hugeLines.length}`);
check('no line exceeds a part', hugeLines.every((l) => l.text.length <= PART_SIZE),
  `max ${Math.max(...hugeLines.map((l) => l.text.length))}`);
check('keeps every word', words(hugeLines.map((l) => l.text).join(' ')).length === words(huge).length);

console.log('\nbuildParts: grouping lines');
const capLines = Array.from({ length: 500 }, (_, i) => ({ text: `caption line number ${i}`, ts: null }));
const parts = buildParts(capLines);
check('produces several parts', parts.length > 1, `got ${parts.length}`);
check('no part exceeds the limit', parts.every((p) => p.text.length <= PART_SIZE),
  `max ${Math.max(...parts.map((p) => p.text.length))}`);
check('parts cover every line exactly once',
  parts.reduce((n, p) => n + (p.lastLine - p.firstLine + 1), 0) === capLines.length);
check('parts are contiguous',
  parts.every((p, i) => (i === 0 ? p.firstLine === 0 : p.firstLine === parts[i - 1].lastLine + 1)));
check('last part ends on the last line', parts[parts.length - 1].lastLine === capLines.length - 1);
check('text survives grouping',
  words(parts.map((p) => p.text).join(' ')).length === words(capLines.map((l) => l.text).join(' ')).length);

console.log('\nbuildParts: a line larger than a part still gets its own part');
const oversized = [{ text: 'y'.repeat(4000), ts: null }];
const op = buildParts(oversized);
check('does not lose it', op.length === 1 && op[0].text.length === 4000);
check('maps to one line', op[0].firstLine === 0 && op[0].lastLine === 0);

console.log('\npartForLine: every line maps to the part containing it');
ctx.reader.parts = parts;
let mapped = true;
for (let i = 0; i < capLines.length; i++) {
  const p = partForLine(i);
  if (i < parts[p].firstLine || i > parts[p].lastLine) {
    mapped = false;
    console.log(`    line ${i} mapped to part ${p} (${parts[p].firstLine}-${parts[p].lastLine})`);
    break;
  }
}
check('all lines map correctly', mapped);
check('first line maps to first part', partForLine(0) === 0);
check('last line maps to last part', partForLine(capLines.length - 1) === parts.length - 1);

console.log('\nhour-long transcript, end to end');
const real = Array.from({ length: 900 }, (_, i) => ({ text: `spoken words go here number ${i}`, ts: `${Math.floor(i / 60)}:${String(i % 60).padStart(2, '0')}` }));
const realParts = buildParts(real);
check('a sane number of parts', realParts.length >= 15 && realParts.length <= 45, `got ${realParts.length}`);
check('covers every line', realParts.reduce((n, p) => n + (p.lastLine - p.firstLine + 1), 0) === real.length);
check('no part exceeds the limit', realParts.every((p) => p.text.length <= PART_SIZE));

console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
