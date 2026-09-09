// Varterm TTS Chrome Extension - claude.ai reading
//
// Claude puts a Read Aloud button under each reply. This reads the same replies
// in a Varterm voice instead, and can do it automatically as each one lands.
//
// The selectors below are not guesses. They are the ones several independent
// open-source claude.ai integrations converged on, which is the best evidence
// available that they survive a redeploy:
//
//   [data-is-streaming]      wraps a turn and flips "true" -> "false" when the
//                            reply finishes. This is the completion signal;
//                            everything else here is a fallback.
//   .font-claude-response    the reply body (current)
//   .font-claude-message     the same thing on older builds
//   .standard-markdown       the prose blocks inside a reply. Reading the whole
//                            reply node instead drags in extended-thinking
//                            summaries and tool-use chrome, which then get
//                            spoken aloud.
//
// claude.ai also virtualises the transcript - only the last dozen or so turns
// exist in the DOM - so this reads replies as they arrive rather than trying to
// hold a whole conversation.
//
// Re-injected on every invocation, so no top-level const/let, and the state
// below is written to survive being declared a second time.

var VARTERM_CLAUDE_BODY =
  '.font-claude-response, .font-claude-message, [data-testid="assistant-message"]';
var VARTERM_CLAUDE_PROSE = '.standard-markdown';

// Chrome that must never be spoken: code, and the controls Claude renders
// inside the reply.
var VARTERM_CLAUDE_DROP = [
  'pre',
  'button',
  '[role="button"]',
  '[aria-hidden="true"]',
  '.code-block__code',
];

var VARTERM_CLAUDE_SEEN = VARTERM_CLAUDE_SEEN || new WeakSet();
var VARTERM_CLAUDE_OBSERVER = VARTERM_CLAUDE_OBSERVER || null;
var VARTERM_CLAUDE_LAST = VARTERM_CLAUDE_LAST || '';

function vartermIsClaude() {
  return /(^|\.)claude\.ai$/.test(location.hostname);
}

function vartermClaudeBodies() {
  return Array.from(document.querySelectorAll(VARTERM_CLAUDE_BODY));
}

// The streaming flag lives on an ancestor of the reply body.
function vartermClaudeTurn(body) {
  return body.closest('[data-is-streaming]');
}

function vartermClaudeIsStreaming(body) {
  const turn = vartermClaudeTurn(body);
  if (turn) return turn.getAttribute('data-is-streaming') === 'true';

  // No flag on this build: fall back to the send button turning into a stop
  // control while a reply is being written.
  return !!document.querySelector(
    'button[aria-label*="stop response" i], button[aria-label*="stop generating" i]'
  );
}

// Block elements that must not run into the next one when flattened to text.
var VARTERM_CLAUDE_BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, tr, br, div';

// Reads a reply as text. Works on a clone so the page is never modified, and
// prefers the prose blocks so thinking summaries and tool chrome stay out.
function vartermClaudeText(body) {
  const blocks = body.querySelectorAll(VARTERM_CLAUDE_PROSE);
  const sources = blocks.length ? Array.from(blocks) : [body];

  const parts = [];
  for (const source of sources) {
    const copy = source.cloneNode(true);
    for (const selector of VARTERM_CLAUDE_DROP) {
      for (const junk of copy.querySelectorAll(selector)) junk.remove();
    }

    // A detached clone is not rendered, so innerText silently degrades to
    // textContent and glues "First para." to "Second para.". Mark the block
    // boundaries before flattening.
    for (const block of copy.querySelectorAll(VARTERM_CLAUDE_BLOCKS)) {
      block.after(document.createTextNode('\n'));
    }

    const text = (copy.textContent || '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (text) parts.push(text);
  }

  let text = parts.join('\n\n');

  // Older builds leak the collapsed thinking summary in as a first paragraph.
  const paragraphs = text.split(/\n{2,}/);
  while (paragraphs.length > 1 && /^(Thought|Thinking|View)\b/i.test(paragraphs[0])) {
    paragraphs.shift();
  }
  return paragraphs.join('\n\n').trim();
}

function vartermClaudeTitle() {
  return document.title.replace(/\s*[-|]\s*Claude\s*$/i, '').trim() || 'Claude';
}

// The most recent finished reply, for reading on demand.
function vartermClaudeLatest() {
  const bodies = vartermClaudeBodies();
  for (let i = bodies.length - 1; i >= 0; i--) {
    if (vartermClaudeIsStreaming(bodies[i])) continue;
    const text = vartermClaudeText(bodies[i]);
    if (text) return { ok: true, text, title: vartermClaudeTitle() };
  }
  return {
    ok: false,
    reason: 'empty',
    message: bodies.length ? 'That reply is still being written.' : 'No Claude reply on this page yet.',
  };
}

function vartermClaudeDeliver(body, onMessage) {
  if (!body || VARTERM_CLAUDE_SEEN.has(body)) return;
  if (vartermClaudeIsStreaming(body)) return;

  const text = vartermClaudeText(body);
  if (!text || text.length < 8) return;

  // A re-render can hand back a node we have not seen holding text we have
  // already spoken, so the text is checked as well as the node.
  if (text === VARTERM_CLAUDE_LAST) {
    VARTERM_CLAUDE_SEEN.add(body);
    return;
  }

  VARTERM_CLAUDE_SEEN.add(body);
  VARTERM_CLAUDE_LAST = text;
  onMessage(text, vartermClaudeTitle());
}

// Marks everything already on screen as seen without speaking it, so switching
// the feature on mid-conversation does not read the backlog aloud.
function vartermClaudePrime() {
  for (const body of vartermClaudeBodies()) {
    if (!vartermClaudeIsStreaming(body)) {
      VARTERM_CLAUDE_SEEN.add(body);
      VARTERM_CLAUDE_LAST = vartermClaudeText(body) || VARTERM_CLAUDE_LAST;
    }
  }
}

function vartermClaudeWatch(onMessage) {
  vartermClaudeUnwatch();
  vartermClaudePrime();

  VARTERM_CLAUDE_OBSERVER = new MutationObserver(() => {
    for (const body of vartermClaudeBodies()) {
      vartermClaudeDeliver(body, onMessage);
    }
  });

  VARTERM_CLAUDE_OBSERVER.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-is-streaming'],
  });

  return true;
}

function vartermClaudeUnwatch() {
  if (VARTERM_CLAUDE_OBSERVER) {
    VARTERM_CLAUDE_OBSERVER.disconnect();
    VARTERM_CLAUDE_OBSERVER = null;
  }
}

// Puts a Varterm control in the row of buttons under a reply, beside Claude's
// own. The row has no stable name, so it is found by locating the copy button
// and using its parent; failing that the button is appended to the reply.
function vartermClaudeActionBar(body) {
  const turn = vartermClaudeTurn(body) || body.parentElement || body;
  const copy = turn.querySelector('button[aria-label*="copy" i]');
  if (copy && copy.parentElement) return copy.parentElement;
  return null;
}

function vartermClaudeAddButtons(onRead) {
  for (const body of vartermClaudeBodies()) {
    const bar = vartermClaudeActionBar(body);
    const host = bar || body;
    if (host.querySelector('.varterm-claude-btn')) continue;
    if (vartermClaudeIsStreaming(body)) continue;

    const button = document.createElement('button');
    button.className = 'varterm-claude-btn';
    button.type = 'button';
    button.title = 'Read with Varterm';
    button.setAttribute('aria-label', 'Read with Varterm');
    button.textContent = '\uD83D\uDD0A';
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = vartermClaudeText(body);
      if (text) onRead(text, vartermClaudeTitle());
    });

    host.appendChild(button);
  }
}
