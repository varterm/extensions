// Generates assets/varterm-icons.ttf: the logo waveform as a set of animation
// frames, one glyph per frame, contributed to VS Code via `contributes.icons`.
//
// Text glyphs cannot do this. Braille varies height but is dotted, and the
// block elements are solid but fill the whole cell. A font glyph draws the
// actual mark: five solid capsules that grow out from a shared centre line.
//
// Metrics mirror codicon.ttf (300 units/em, ascent 300, descent 0, artwork
// sitting between the baseline and the top of the em box) so the icon lands on
// the same optical line as every built-in status bar icon.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import svg2ttf from 'svg2ttf';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(HERE, '..');
const OUT_TTF = join(EXT_DIR, 'assets', 'varterm-icons.ttf');
const OUT_SVG = join(EXT_DIR, 'assets', 'varterm-icons.svg');

const UNITS_PER_EM = 300;
const ASCENT = 300;
const DESCENT = 0;

// Vertical middle of the em box: every bar is centred here and grows both ways,
// which is what makes the mark read as expanding from the centre line.
//
// The artwork fills the em box as far as it can. VS Code renders status bar
// icons at a fixed 16px, so the em box is the ceiling on apparent size: the
// tallest bar peaks at 288 of 300 units, spanning y 6-294. Drawing past 300
// would render larger but risks clipping against the status bar row.
const CENTER_Y = 150;
const BAR_WIDTH = 37;
const BAR_PITCH = 55;
const BAR_COUNT = 5;
const MARK_WIDTH = (BAR_COUNT - 1) * BAR_PITCH + BAR_WIDTH;
const SIDE_PADDING = 10;
const ADVANCE = MARK_WIDTH + SIDE_PADDING * 2;

// Per-bar oscillation. The travel bands deliberately do not overlap between
// neighbours (outer 55-113, middle 114-186, centre 192-288), so the tall-middle
// logo silhouette survives every frame instead of flattening into a uniform
// wave at some phases. Phases run centre-outwards, rippling from the middle bar
// to the edges.
const BARS = [
  { mid: 84, amp: 29, phase: -(4 * Math.PI) / 6 },
  { mid: 150, amp: 36, phase: -(2 * Math.PI) / 6 },
  { mid: 240, amp: 48, phase: 0 },
  { mid: 150, amp: 36, phase: -(2 * Math.PI) / 6 },
  { mid: 84, amp: 29, phase: -(4 * Math.PI) / 6 },
];

// Exact logo silhouette (icon.svg heights 143/225/317 scaled to this em box),
// used for the paused state.
const IDLE_HEIGHTS = [130, 204, 288, 204, 130];

const FRAME_COUNT = 8;
const PUA_START = 0xe000;

// Circular-arc approximation constant for a quarter circle in cubic Beziers.
const KAPPA = 0.5522847498;

const round = (n) => Math.round(n * 100) / 100;

// One solid capsule: straight sides with semicircular caps, drawn y-up in font
// coordinates. Heights below the bar width collapse to a dot.
function capsulePath(x, height) {
  const w = BAR_WIDTH;
  const r = w / 2;
  const h = Math.max(height, w);
  const x0 = x;
  const x1 = x + w;
  const xc = x + r;
  const yb = CENTER_Y - h / 2;
  const yt = CENTER_Y + h / 2;
  const k = KAPPA * r;

  return [
    `M${round(x0)} ${round(yb + r)}`,
    `L${round(x0)} ${round(yt - r)}`,
    `C${round(x0)} ${round(yt - r + k)} ${round(xc - k)} ${round(yt)} ${round(xc)} ${round(yt)}`,
    `C${round(xc + k)} ${round(yt)} ${round(x1)} ${round(yt - r + k)} ${round(x1)} ${round(yt - r)}`,
    `L${round(x1)} ${round(yb + r)}`,
    `C${round(x1)} ${round(yb + r - k)} ${round(xc + k)} ${round(yb)} ${round(xc)} ${round(yb)}`,
    `C${round(xc - k)} ${round(yb)} ${round(x0)} ${round(yb + r - k)} ${round(x0)} ${round(yb + r)}`,
    'Z',
  ].join('');
}

function markPath(heights) {
  return heights
    .map((height, index) => capsulePath(SIDE_PADDING + index * BAR_PITCH, height))
    .join('');
}

function frameHeights(frame) {
  const t = (2 * Math.PI * frame) / FRAME_COUNT;
  return BARS.map((bar) => Math.round(bar.mid + bar.amp * Math.sin(t + bar.phase)));
}

const glyphs = [];
for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
  glyphs.push({
    id: `varterm-bars-${frame}`,
    name: `bars${frame}`,
    code: PUA_START + frame,
    path: markPath(frameHeights(frame)),
  });
}
glyphs.push({
  id: 'varterm-bars-idle',
  name: 'barsIdle',
  code: PUA_START + FRAME_COUNT,
  path: markPath(IDLE_HEIGHTS),
});

const svgFont = `<?xml version="1.0" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg">
<defs>
<font id="varterm-icons" horiz-adv-x="${ADVANCE}">
<font-face font-family="varterm-icons" font-weight="400" font-stretch="normal" units-per-em="${UNITS_PER_EM}" ascent="${ASCENT}" descent="${DESCENT}" />
<missing-glyph horiz-adv-x="${ADVANCE}" />
${glyphs
  .map(
    (glyph) =>
      `<glyph glyph-name="${glyph.name}" unicode="&#x${glyph.code.toString(16)};" horiz-adv-x="${ADVANCE}" d="${glyph.path}" />`,
  )
  .join('\n')}
</font>
</defs>
</svg>
`;

mkdirSync(dirname(OUT_TTF), { recursive: true });
writeFileSync(OUT_SVG, svgFont);

const ttf = svg2ttf(svgFont, { description: 'Varterm status bar icons', url: 'https://varterm.com' });
writeFileSync(OUT_TTF, Buffer.from(ttf.buffer));

// Keep contributes.icons in lockstep with the glyphs that actually exist.
const contributes = Object.fromEntries(
  glyphs.map((glyph) => [
    glyph.id,
    {
      description:
        glyph.id === 'varterm-bars-idle'
          ? 'Varterm waveform, paused'
          : `Varterm waveform, playing frame ${glyph.name.replace('bars', '')}`,
      default: {
        fontPath: 'assets/varterm-icons.ttf',
        fontCharacter: `\\${glyph.code.toString(16).toUpperCase()}`,
      },
    },
  ]),
);

const pkgPath = join(EXT_DIR, 'package.json');
const pkgSource = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(pkgSource);
pkg.contributes.icons = contributes;
const nextPkgSource = `${JSON.stringify(pkg, null, 2)}\n`;

console.log(`Wrote ${OUT_TTF} (${glyphs.length} glyphs, advance ${ADVANCE}/${UNITS_PER_EM} em)`);

if (nextPkgSource === pkgSource) {
  console.log('contributes.icons already in sync');
} else {
  writeFileSync(pkgPath, nextPkgSource);
  console.log(`Updated contributes.icons in ${pkgPath}`);
}
