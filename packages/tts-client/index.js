class HttpError extends Error {
  constructor(message, status, retryAfterMs) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfterMs(headers) {
  const retryAfterHeader = headers.get('retry-after');
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  return Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : undefined;
}

function parseJsonText(textBody) {
  if (!textBody) {
    return {};
  }

  try {
    return JSON.parse(textBody);
  } catch {
    return { error: textBody };
  }
}

function getBackoffMs(attempt, ceilingMs) {
  return Math.min(1000 * 2 ** attempt, ceilingMs);
}

function createTtsHttpClient(options) {
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  async function postJson(path, payload, requestOptions = {}) {
    const retries = requestOptions.retries ?? options.retries;
    const timeoutMs = requestOptions.timeoutMs ?? options.timeoutMs;
    const cancellationToken = requestOptions.cancellationToken;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const timeoutController = new AbortController();
      const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);
      const cancelSubscription = cancellationToken?.onCancellationRequested?.(() => {
        timeoutController.abort();
      });

      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: await options.getHeaders(true),
          body: JSON.stringify(payload),
          signal: timeoutController.signal,
        });

        const textBody = await response.text();
        const parsedBody = parseJsonText(textBody);

        if (!response.ok) {
          const retryAfterMs = parseRetryAfterMs(response.headers);
          const message = parsedBody?.error || `Request failed with status ${response.status}`;
          const err = new HttpError(message, response.status, retryAfterMs);
          const shouldRetry = attempt < retries && (response.status === 429 || response.status >= 500);
          if (!shouldRetry) {
            throw err;
          }

          const waitMs = err.retryAfterMs ?? getBackoffMs(attempt, 6000);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        return parsedBody;
      } catch (error) {
        if (cancellationToken?.isCancellationRequested) {
          throw new Error('Operation cancelled');
        }

        const isTimeout = error instanceof DOMException && error.name === 'AbortError';
        if (isTimeout && attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, getBackoffMs(attempt, 4000)));
          continue;
        }
        if (isTimeout) {
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timeoutHandle);
        cancelSubscription?.dispose?.();
      }
    }

    throw new Error('Request failed');
  }

  async function postBinary(path, payload, requestOptions = {}) {
    const retries = requestOptions.retries ?? options.retries;
    const timeoutMs = requestOptions.timeoutMs ?? options.timeoutMs;
    const cancellationToken = requestOptions.cancellationToken;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const timeoutController = new AbortController();
      const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);
      const cancelSubscription = cancellationToken?.onCancellationRequested?.(() => {
        timeoutController.abort();
      });

      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: await options.getHeaders(true),
          body: JSON.stringify(payload),
          signal: timeoutController.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          const parsed = parseJsonText(text);
          const retryAfterMs = parseRetryAfterMs(response.headers);
          const message = parsed?.error || parsed?.message || text || `Request failed with status ${response.status}`;
          const err = new HttpError(message, response.status, retryAfterMs);
          const shouldRetry = attempt < retries && (response.status === 429 || response.status >= 500);
          if (!shouldRetry) {
            throw err;
          }

          const waitMs = err.retryAfterMs ?? getBackoffMs(attempt, 6000);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
      } catch (error) {
        if (cancellationToken?.isCancellationRequested) {
          throw new Error('Operation cancelled');
        }
        const isTimeout = error instanceof DOMException && error.name === 'AbortError';
        if (isTimeout && attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, getBackoffMs(attempt, 4000)));
          continue;
        }
        if (isTimeout) {
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timeoutHandle);
        cancelSubscription?.dispose?.();
      }
    }

    throw new Error('Request failed');
  }

  async function getJson(path, requestOptions = {}) {
    const retries = requestOptions.retries ?? options.retries;
    const timeoutMs = requestOptions.timeoutMs ?? options.timeoutMs;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const timeoutController = new AbortController();
      const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);

      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method: 'GET',
          headers: await options.getHeaders(false),
          signal: timeoutController.signal,
        });

        const textBody = await response.text();
        const parsedBody = parseJsonText(textBody);

        if (!response.ok) {
          const message = parsedBody?.error || `Request failed with status ${response.status}`;
          const shouldRetry = attempt < retries && (response.status === 429 || response.status >= 500);
          if (!shouldRetry) {
            throw new Error(message);
          }

          await new Promise((resolve) => setTimeout(resolve, getBackoffMs(attempt, 6000)));
          continue;
        }

        return parsedBody;
      } catch (error) {
        const isTimeout = error instanceof DOMException && error.name === 'AbortError';
        if (isTimeout && attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, getBackoffMs(attempt, 4000)));
          continue;
        }
        if (isTimeout) {
          throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    throw new Error('Request failed');
  }

  return { postJson, postBinary, getJson };
}

module.exports = {
  HttpError,
  createTtsHttpClient,
};
