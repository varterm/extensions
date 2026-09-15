// Covers the two ways a read used to fail with "No audio generated. Please try
// different text." Both were reported from a real install, and both were
// reproduced against the live endpoint before being fixed here.
//
// Run with: npm run check && node tests/speech-text.test.mjs
// (the check step compiles src/ to dist/, which is what this imports)

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILT = join(ROOT, 'dist/speech-text.js');

if (!existsSync(BUILT)) {
  console.error('dist/speech-text.js is missing. Run: npx tsc -p .');
  process.exit(1);
}

const { splitTextIntoChunks, hasSpeakableText, voiceCannotSpeak } = await import(BUILT);

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });

// --- chunks with nothing to say ---------------------------------------------
//
// The voice service answers a chunk of pure punctuation with zero bytes rather
// than silence, and that surfaced as a failed read. A markdown rule between two
// long paragraphs is the shape that produced it: too long to merge with either
// neighbour, so it became a chunk of its own.

const words = (n) => 'word '.repeat(n).trim();
const around = (middle) => splitTextIntoChunks(`${words(40)}\n\n${middle}\n\n${words(40)}`, 450);

for (const rule of ['---', '***', '___', '...', '|---|---|']) {
  const chunks = around(rule);
  check(`a "${rule}" between long paragraphs yields no silent chunk`,
    chunks.every(hasSpeakableText), JSON.stringify(chunks.filter((c) => !hasSpeakableText(c))));
}

check('a rule on its own produces nothing to send',
  splitTextIntoChunks('---', 450).length === 0);
check('whitespace produces nothing to send',
  splitTextIntoChunks('   \n\t  ', 450).length === 0);
check('dropping silent chunks keeps the real ones',
  around('---').length === 2, String(around('---').length));

// Digits are spoken, so they must survive the filter.
check('a number is speakable', hasSpeakableText('42'));
check('punctuation is not', !hasSpeakableText('--- ... !!!'));
check('an emoji alone is not', !hasSpeakableText('\u{1F50A}'));

// The filter must not quietly eat words.
const prose = `${words(40)}\n\n---\n\n${words(40)}`;
const kept = around('---').join(' ').replace(/\s+/g, ' ');
check('no words are lost to the filter',
  kept === prose.replace(/\n\n---\n\n/, ' ').replace(/\s+/g, ' '), kept.slice(0, 60));

// --- voice that cannot speak the script --------------------------------------
//
// An English voice given Chinese, Cyrillic, Arabic, or Devanagari returns zero
// bytes and no error, so the user saw a message blaming their text. Verified
// against the live endpoint: Chinese, Hindi, Arabic, and Russian all came back
// empty with en-US-AriaNeural, while French and accented Latin were fine.

const mismatches = [
  ['Chinese', '这是一个测试文本，用来检查语音。', 'zh-CN-XiaoxiaoNeural'],
  ['Devanagari', 'यह एक परीक्षण है और यह लंबा है', 'hi-IN-SwaraNeural'],
  ['Cyrillic', 'Это тестовый текст для проверки', 'ru-RU-SvetlanaNeural'],
  ['Arabic', 'هذا اختبار طويل جدا للتحقق', 'ar-EG-SalmaNeural'],
  ['Japanese', 'これはテストです、よろしく', 'ja-JP-NanamiNeural'],
  ['Korean', '이것은 테스트입니다 그리고', 'ko-KR-SunHiNeural'],
];

for (const [script, text, suggested] of mismatches) {
  const message = voiceCannotSpeak(text, 'en-US-AriaNeural');
  check(`${script} with an English voice is explained`, !!message, 'no message');
  if (message) {
    check(`${script} message names the script`, message.includes(script));
    check(`${script} message suggests a usable voice`, message.includes(suggested), message);
    check(`${script} message names the setting to change`,
      message.includes('vartermCursor.readAloudVoice'));
  }
}

// The right voice must never be complained about.
for (const [, text, suggested] of mismatches) {
  check(`${suggested} is accepted for its own script`,
    voiceCannotSpeak(text, suggested) === undefined, voiceCannotSpeak(text, suggested));
}

// And the common cases must stay silent, or the warning becomes noise.
const quiet = [
  ['plain English', 'This is an ordinary sentence.'],
  ['accented Latin', 'café résumé naïve Straße'],
  ['French prose', 'Bonjour, ceci est un test de synthèse vocale.'],
  ['mostly English with a loanword', 'The kanji 漢字 appears once in this English sentence.'],
  ['code', 'const x = foo(bar); // returns 42'],
  ['too short to judge', 'ok'],
];
for (const [label, text] of quiet) {
  check(`${label} draws no complaint`, voiceCannotSpeak(text, 'en-US-AriaNeural') === undefined,
    String(voiceCannotSpeak(text, 'en-US-AriaNeural')));
}

let failed = 0;
for (const r of results) {
  console.log(`  ${r.pass ? 'pass' : 'FAIL'}  ${r.name}${r.pass ? '' : '  -> ' + r.detail}`);
  if (!r.pass) failed++;
}
console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
