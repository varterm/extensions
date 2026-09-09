// Varterm TTS Chrome Extension - YouTube transcript reading
//
// Captions cannot be fetched from YouTube's timedtext API. That endpoint now
// requires a proof-of-origin token minted by the player itself and answers an
// unsigned request with an empty HTTP 200 - no error, just nothing - so the
// rendered transcript panel is the only place the text can still be read.
//
// YouTube serves two different transcript panels and which one a session gets
// varies, so both shapes are handled here. Content scripts run in an isolated
// world and cannot see the page's own variables, so everything below is DOM only.

// The worker re-injects this file on each invocation, so nothing here may use a
// top-level binding that throws when declared twice in the same isolated world.
var VARTERM_YT_SEGMENTS = [
  {
    // Newer panel: target-id="PAmodern_transcript_view". Each segment also holds a
    // screen-reader label spelling the timestamp out ("18 seconds"), which has to
    // be left behind or it gets read aloud between every line.
    segment: 'transcript-segment-view-model',
    timestamp: '.ytwTranscriptSegmentViewModelTimestamp',
    text: 'span.ytAttributedStringHost, [role="text"]',
    drop: [
      '.ytwTranscriptSegmentViewModelTimestamp',
      '.ytwTranscriptSegmentViewModelTimestampA11yLabel',
    ],
  },
  {
    // Older panel: target-id="engagement-panel-searchable-transcript"
    segment: 'ytd-transcript-segment-renderer',
    timestamp: '.segment-timestamp',
    text: '.segment-text',
    drop: ['.segment-timestamp'],
  },
];

function vartermSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function vartermIsYouTubeWatch() {
  return /(^|\.)youtube\.com$/.test(location.hostname) && /[?&]v=/.test(location.search);
}

function vartermFindSegments() {
  for (const shape of VARTERM_YT_SEGMENTS) {
    const nodes = document.querySelectorAll(shape.segment);
    if (nodes.length) return { shape, nodes: Array.from(nodes) };
  }
  return null;
}

function vartermFindTranscriptButton() {
  const byLabel = document.querySelector('button[aria-label*="show transcript" i]');
  if (byLabel) return byLabel;

  const inDescription = document.querySelector(
    'ytd-video-description-transcript-section-renderer button'
  );
  if (inDescription) return inDescription;

  const controls = document.querySelectorAll('button, tp-yt-paper-button, [role="button"]');
  for (const el of controls) {
    const label = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`;
    if (/show transcript/i.test(label)) return el;
  }
  return null;
}

async function vartermOpenTranscriptPanel() {
  if (vartermFindSegments()) return true;

  // The transcript button lives inside the collapsed description on most layouts.
  const expander = document.querySelector(
    '#description-inline-expander #expand, ytd-text-inline-expander #expand'
  );
  if (expander) {
    expander.click();
    await vartermSleep(900);
  }

  const button = vartermFindTranscriptButton();
  if (!button) return false;

  button.scrollIntoView({ block: 'center' });
  await vartermSleep(250);
  button.click();

  for (let i = 0; i < 60; i++) {
    await vartermSleep(400);
    if (vartermFindSegments()) return true;
  }
  return false;
}

function vartermScrollParent(node) {
  let el = node && node.parentElement;
  while (el && el !== document.body) {
    const style = getComputedStyle(el);
    const scrollable = style.overflowY === 'auto' || style.overflowY === 'scroll';
    if (scrollable && el.scrollHeight > el.clientHeight + 40) return el;
    el = el.parentElement;
  }
  return null;
}

// The panel renders every segment today, but it has been virtualized before and
// a partial transcript would be silently wrong, so drive it to the bottom until
// the count stops growing.
async function vartermLoadAllSegments() {
  let found = vartermFindSegments();
  if (!found) return null;

  const scroller = vartermScrollParent(found.nodes[0]);
  if (!scroller) return found;

  let previous = found.nodes.length;
  let stable = 0;
  for (let i = 0; i < 200; i++) {
    scroller.scrollTop = scroller.scrollHeight;
    await vartermSleep(200);
    const count = document.querySelectorAll(found.shape.segment).length;
    if (count === previous) {
      if (++stable >= 5) break;
    } else {
      stable = 0;
    }
    previous = count;
  }

  return vartermFindSegments();
}

function vartermReadSegment(el, shape) {
  const node = el.querySelector(shape.text);
  if (node) return node.textContent.replace(/\s+/g, ' ').trim();

  // Layouts get renamed, so fall back to taking the whole segment minus the
  // parts known to be timing rather than returning nothing.
  const clone = el.cloneNode(true);
  for (const selector of shape.drop) {
    clone.querySelectorAll(selector).forEach((child) => child.remove());
  }
  return (clone.textContent || '').replace(/\s+/g, ' ').trim();
}

// Caption tracks carry cues that mean nothing out loud, and auto-generated
// tracks repeat a line while the speaker finishes it. Lines are kept separate
// rather than joined, because the reader panel shows them and lets you jump to
// one.
// "1:05" or "1:02:30" as a number of seconds, so a caption can be turned into
// a position in the video.
function vartermParseTimestamp(ts) {
  if (!ts) return null;
  const parts = ts.split(':').map((p) => Number(p.trim()));
  if (parts.some((p) => !isFinite(p))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function vartermCleanTranscript(rows) {
  const cleaned = [];
  for (const row of rows) {
    const line = row.text
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*(?:music|applause|laughter|inaudible)[^)]*\)/gi, ' ')
      .replace(/[♪♫]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;

    const previous = cleaned[cleaned.length - 1];
    if (previous && previous.text.toLowerCase() === line.toLowerCase()) continue;
    cleaned.push({ text: line, ts: row.ts || null, sec: vartermParseTimestamp(row.ts) });
  }
  return cleaned;
}

function vartermVideoTitle() {
  const heading = document.querySelector(
    'h1.ytd-watch-metadata yt-formatted-string, h1.ytd-watch-metadata, #title h1'
  );
  const text = heading && heading.textContent.trim();
  return text || document.title.replace(/\s*-\s*YouTube\s*$/, '').trim();
}

async function vartermGetYouTubeTranscript() {
  if (!vartermIsYouTubeWatch()) {
    return { ok: false, reason: 'not-a-video', message: 'Open a YouTube video first.' };
  }

  const opened = await vartermOpenTranscriptPanel();
  if (!opened) {
    return {
      ok: false,
      reason: 'no-transcript',
      message: 'This video has no transcript. YouTube only offers one when the video has captions.',
    };
  }

  const found = await vartermLoadAllSegments();
  if (!found || !found.nodes.length) {
    return { ok: false, reason: 'empty', message: 'The transcript panel opened but stayed empty.' };
  }

  const rows = found.nodes.map((el) => {
    const stamp = el.querySelector(found.shape.timestamp);
    return {
      text: vartermReadSegment(el, found.shape),
      ts: stamp ? stamp.textContent.trim() : null,
    };
  });

  const lines = vartermCleanTranscript(rows);
  if (!lines.length) {
    return { ok: false, reason: 'empty', message: 'This transcript has no spoken words in it.' };
  }

  return {
    ok: true,
    title: vartermVideoTitle(),
    lines,
    text: lines.map((l) => l.text).join(' '),
    segmentCount: found.nodes.length,
    lastTimestamp: lines[lines.length - 1].ts,
  };
}
