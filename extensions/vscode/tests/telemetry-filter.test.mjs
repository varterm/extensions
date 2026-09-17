import assert from 'node:assert/strict';
import test from 'node:test';

import { isExpectedRefusal, shouldReportError } from '../dist/telemetry-filter.js';

/** Mirrors HttpError from @varterm/tts-client, which carries the response status. */
function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

test('the service refusing on purpose is not reported', () => {
  assert.equal(shouldReportError(httpError('That text has nothing to read aloud.', 422)), false);
  assert.equal(shouldReportError(httpError('Pick a voice that reads Chinese.', 422)), false);
  assert.equal(shouldReportError(httpError('Too many requests', 429)), false);
});

test('a bad request is ours and is reported', () => {
  // The extension chunks to 450 chars and builds its own payload, so a 400 is a
  // defect in this code rather than anything the user typed.
  assert.equal(shouldReportError(httpError('Text is required', 400)), true);
});

test('auth and routing failures are still reported', () => {
  assert.equal(shouldReportError(httpError('Unauthorized', 401)), true);
  assert.equal(shouldReportError(httpError('Forbidden', 403)), true);
  assert.equal(shouldReportError(httpError('Not Found', 404)), true);
});

test('server failures are reported', () => {
  assert.equal(shouldReportError(httpError('Internal Server Error', 500)), true);
  assert.equal(shouldReportError(httpError('Bad Gateway', 502)), true);
});

test('an error with no status falls through to the message list', () => {
  assert.equal(shouldReportError(new Error('Something genuinely broke')), true);
  assert.equal(shouldReportError(new Error('Operation cancelled')), false);
  assert.equal(shouldReportError(new Error('No audio to replay yet.')), false);
});

test('the local no-op message is skipped even without a status', () => {
  assert.equal(shouldReportError(new Error('That text has nothing to read aloud.')), false);
});

test('substring matching still applies to skipped messages', () => {
  assert.equal(shouldReportError(new Error('Varterm: Operation cancelled by user')), false);
});

test('non-Error values do not throw', () => {
  assert.equal(shouldReportError('plain string'), true);
  assert.equal(shouldReportError(undefined), true);
  assert.equal(shouldReportError(null), true);
  assert.equal(shouldReportError(42), true);
});

test('isExpectedRefusal only matches the two refusal codes', () => {
  for (const status of [400, 401, 403, 404, 408, 418, 500, 503]) {
    assert.equal(isExpectedRefusal(httpError('x', status)), false, `status ${status}`);
  }
  for (const status of [422, 429]) {
    assert.equal(isExpectedRefusal(httpError('x', status)), true, `status ${status}`);
  }
});

test('a status that is a string is not mistaken for a refusal', () => {
  assert.equal(isExpectedRefusal(httpError('x', '422')), false);
});
