import assert from 'node:assert/strict';
import test from 'node:test';

import {
  autoReadClaimDelayMs,
  cacheIsCurrent,
  chooseFocusedComposerId,
  dropBelongsToRoots,
  dropForConversation,
  lastAssistantTextFromTranscript,
  newestOwnedDrop,
} from '../dist/agent-drop.js';

const SEP = '/';
const ROOT = '/Users/dev/src/varterm';

test('a reply from the window root belongs to it', () => {
  assert.equal(dropBelongsToRoots({ workspace: ROOT }, [ROOT], SEP), true);
  assert.equal(dropBelongsToRoots({ cwd: ROOT }, [ROOT], SEP), true);
});

test('a reply from a subdirectory belongs to it', () => {
  assert.equal(dropBelongsToRoots({ cwd: `${ROOT}/extensions/vscode` }, [ROOT], SEP), true);
});

test('a sibling folder sharing a name prefix does not', () => {
  // The bug this guards: /src/varterm must not claim /src/varterm-plat.
  assert.equal(dropBelongsToRoots({ cwd: '/Users/dev/src/varterm-plat' }, [ROOT], SEP), false);
  assert.equal(dropBelongsToRoots({ workspace: '/Users/dev/src/varterm2' }, [ROOT], SEP), false);
});

test('an unrelated project does not', () => {
  assert.equal(dropBelongsToRoots({ cwd: '/Users/dev/src/other' }, [ROOT], SEP), false);
});

test('a parent of the root does not', () => {
  assert.equal(dropBelongsToRoots({ cwd: '/Users/dev/src' }, [ROOT], SEP), false);
});

test('a window with no folder open owns nothing', () => {
  assert.equal(dropBelongsToRoots({ cwd: ROOT }, [], SEP), false);
});

test('a drop with no origin recorded belongs to nobody', () => {
  assert.equal(dropBelongsToRoots({}, [ROOT], SEP), false);
  assert.equal(dropBelongsToRoots({ cwd: '', workspace: '' }, [ROOT], SEP), false);
});

test('any root in a multi-root window can match', () => {
  const roots = ['/Users/dev/src/a', '/Users/dev/src/b'];
  assert.equal(dropBelongsToRoots({ cwd: '/Users/dev/src/b/pkg' }, roots, SEP), true);
  assert.equal(dropBelongsToRoots({ cwd: '/Users/dev/src/c' }, roots, SEP), false);
});

test('either cwd or workspace is enough', () => {
  assert.equal(dropBelongsToRoots({ workspace: '/elsewhere', cwd: ROOT }, [ROOT], SEP), true);
  assert.equal(dropBelongsToRoots({ workspace: ROOT, cwd: '/elsewhere' }, [ROOT], SEP), true);
  assert.equal(
    dropBelongsToRoots({ workspace: '/elsewhere', cwd: '/also-elsewhere' }, [ROOT], SEP),
    false
  );
});

test('windows separators work the same way', () => {
  const win = 'C:\\Users\\dev\\src\\varterm';
  assert.equal(dropBelongsToRoots({ cwd: win }, [win], '\\'), true);
  assert.equal(dropBelongsToRoots({ cwd: `${win}\\extensions` }, [win], '\\'), true);
  assert.equal(dropBelongsToRoots({ cwd: 'C:\\Users\\dev\\src\\varterm-plat' }, [win], '\\'), false);
});

const A = { workspace: '/Users/dev/src/alpha', ts: 100, text: 'alpha' };
const B = { workspace: '/Users/dev/src/beta', ts: 200, text: 'beta' };
const C = { workspace: '/Users/dev/src/alpha/pkg', ts: 300, text: 'alpha sub' };

test('a window gets its own reply, not the newest one on the machine', () => {
  // The whole point of the per-project files: beta is newer, alpha must still
  // get alpha back.
  assert.equal(newestOwnedDrop([A, B], ['/Users/dev/src/alpha'], SEP)?.text, 'alpha');
  assert.equal(newestOwnedDrop([A, B], ['/Users/dev/src/beta'], SEP)?.text, 'beta');
});

test('the newest owned reply wins when several belong to the window', () => {
  assert.equal(newestOwnedDrop([A, C, B], ['/Users/dev/src/alpha'], SEP)?.text, 'alpha sub');
});

test('a multi-root window can own replies from more than one project', () => {
  const roots = ['/Users/dev/src/alpha', '/Users/dev/src/beta'];
  assert.equal(newestOwnedDrop([A, B], roots, SEP)?.text, 'beta');
});

test('a window owning none of them gets nothing', () => {
  assert.equal(newestOwnedDrop([A, B], ['/Users/dev/src/gamma'], SEP), undefined);
  assert.equal(newestOwnedDrop([], ['/Users/dev/src/alpha'], SEP), undefined);
});

test('equal timestamps do not throw or pick a foreign reply', () => {
  const tie = newestOwnedDrop(
    [{ workspace: '/Users/dev/src/alpha', ts: 5, text: 'x' }, { workspace: '/Users/dev/src/beta', ts: 5, text: 'y' }],
    ['/Users/dev/src/alpha'],
    SEP
  );
  assert.equal(tie?.text, 'x');
});

test('cached audio is replayed only while it is still the newest reply', () => {
  assert.equal(cacheIsCurrent('reply two', 'reply two'), true);
});

test('a newer reply on disk beats what the window is holding', () => {
  // The bug this guards: a window that missed a reply replayed the one before
  // last, because holding audio was treated as proof of holding the latest.
  assert.equal(cacheIsCurrent('reply one', 'reply two'), false);
});

test('with nothing on disk the cache is the only answer there is', () => {
  assert.equal(cacheIsCurrent('reply one', ''), true);
});

test('an empty cache never looks current against a real reply', () => {
  assert.equal(cacheIsCurrent('', 'reply two'), false);
});

test('the front window reads the Agents window selection', () => {
  assert.equal(
    chooseFocusedComposerId({
      windowFocused: true,
      sidebarFocusedId: 'sidebar-tab',
      glassSelectedId: 'agents-window',
      glassOwned: true,
    }),
    'agents-window'
  );
});

test('a background window keeps its own sidebar tab', () => {
  assert.equal(
    chooseFocusedComposerId({
      windowFocused: false,
      sidebarFocusedId: 'sidebar-tab',
      glassSelectedId: 'agents-window',
      glassOwned: true,
    }),
    'sidebar-tab'
  );
});

test('an Agents window selection from another project is ignored', () => {
  assert.equal(
    chooseFocusedComposerId({
      windowFocused: true,
      sidebarFocusedId: 'sidebar-tab',
      glassSelectedId: 'other-project',
      glassOwned: false,
    }),
    'sidebar-tab'
  );
});

test('with no sidebar record the front window still has its chat', () => {
  assert.equal(
    chooseFocusedComposerId({
      windowFocused: true,
      glassSelectedId: 'this-tab',
      glassOwned: true,
    }),
    'this-tab'
  );
});

test('a reply is chosen by chat id, not by which file is newest', () => {
  const older = { conversationId: 'tab-a', ts: 1, text: 'first tab' };
  const newer = { conversationId: 'tab-b', ts: 9, text: 'other tab' };
  assert.equal(dropForConversation([newer, older], 'tab-a')?.text, 'first tab');
  assert.equal(dropForConversation([newer, older], 'missing'), undefined);
});

test('the Agents window switch reads every reply there', () => {
  assert.equal(
    autoReadClaimDelayMs({
      isAgentsWindow: true,
      editorAutoRead: false,
      agentsWindowAutoRead: true,
      ownsWorkspace: false,
      focused: true,
    }),
    0
  );
});

test('the Agents window stays quiet when its switch is off', () => {
  assert.equal(
    autoReadClaimDelayMs({
      isAgentsWindow: true,
      editorAutoRead: true,
      agentsWindowAutoRead: false,
      ownsWorkspace: true,
      focused: true,
    }),
    -1
  );
});

test('an editor does not read a reply from another project', () => {
  assert.equal(
    autoReadClaimDelayMs({
      isAgentsWindow: false,
      editorAutoRead: true,
      agentsWindowAutoRead: false,
      ownsWorkspace: false,
      focused: true,
    }),
    -1
  );
});

test('an editor reads its own project', () => {
  assert.equal(
    autoReadClaimDelayMs({
      isAgentsWindow: false,
      editorAutoRead: true,
      agentsWindowAutoRead: false,
      ownsWorkspace: true,
      focused: true,
    }),
    0
  );
});

test('an editor reads every Agents window reply when that switch is on', () => {
  assert.equal(
    autoReadClaimDelayMs({
      isAgentsWindow: false,
      editorAutoRead: false,
      agentsWindowAutoRead: true,
      ownsWorkspace: false,
      focused: false,
    }),
    80
  );
  assert.equal(
    autoReadClaimDelayMs({
      isAgentsWindow: false,
      editorAutoRead: true,
      agentsWindowAutoRead: true,
      ownsWorkspace: true,
      focused: true,
    }),
    40
  );
});

test('the transcript reader keeps the last assistant message with text', () => {
  const jsonl = [
    '{"role":"user","message":{"content":[{"type":"text","text":"look at the bugs"}]}}',
    '{"role":"assistant","message":{"content":[{"type":"text","text":"First bug is the clipboard."}]}}',
    'not json',
    '{"role":"assistant","message":{"content":[{"type":"tool_use","name":"read"}]}}',
    '{"role":"assistant","message":{"content":[{"type":"text","text":"Second bug is the wrong tab."}]}}',
  ].join('\n');
  assert.equal(lastAssistantTextFromTranscript(jsonl), 'Second bug is the wrong tab.');
});
