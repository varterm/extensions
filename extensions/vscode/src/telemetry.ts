import * as https from 'node:https';
import * as os from 'node:os';
import * as vscode from 'vscode';

// Public ingest DSN (write-only). Restrict allowed origins in the Sentry project
// if you want a tighter lock. Do not put a Sentry auth token here.
const SENTRY_DSN =
  'https://0d355b6b4c757157da32d72378e1d46d@o4512069168594944.ingest.us.sentry.io/4512069236817920';

const SKIP_MESSAGES = [
  'Cancelled',
  'Operation cancelled',
  'Nothing is playing.',
  'Nothing is paused.',
  'No audio to replay yet.',
  'No agent reply captured yet',
  'No text available to read aloud',
  'Background playback currently uses macOS afplay',
];

// Set at the point of failure so a report explains itself. `voice` and `script`
// are what a read was attempted with, which is the context that turns a vague
// "no audio generated" into an obvious voice and language mismatch.
export type TelemetryContext = {
  area?: string;
  label?: string;
  voice?: string;
  script?: string;
};

type SentryDsn = {
  key: string;
  host: string;
  projectId: string;
};

let enabled = false;
let release = 'varterm-cursor@unknown';
let environment = 'unknown';
let log: (message: string) => void = () => undefined;

function parseDsn(dsn: string): SentryDsn | undefined {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, '');
    if (!url.username || !projectId) {
      return undefined;
    }
    return { key: url.username, host: url.host, projectId };
  } catch {
    return undefined;
  }
}

function telemetryAllowed(): boolean {
  if (!vscode.env.isTelemetryEnabled) {
    return false;
  }
  return vscode.workspace.getConfiguration('vartermCursor').get<boolean>('telemetry', true);
}

function shouldReport(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return !SKIP_MESSAGES.some((skip) => message.includes(skip));
}

function scrubText(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length > 180) {
    return `${trimmed.slice(0, 177)}…`;
  }
  return trimmed;
}

function scrubPath(file: string): string {
  const home = os.homedir();
  return file.replaceAll(home, '~').replace(/\/Users\/[^/]+/g, '~');
}

function stackFrames(error: Error): Array<Record<string, unknown>> {
  const stack = error.stack || '';
  const frames: Array<Record<string, unknown>> = [];
  for (const line of stack.split('\n').slice(1, 21)) {
    const match = line.match(/at (?:(.+?) )?\(?(.*?):(\d+):(\d+)\)?$/);
    if (!match) {
      continue;
    }
    frames.unshift({
      function: match[1] || '<anonymous>',
      filename: scrubPath(match[2] || ''),
      lineno: Number(match[3]),
      colno: Number(match[4]),
      in_app: /varterm-cursor|extensions\/vscode/.test(match[2] || ''),
    });
  }
  return frames;
}

async function postException(
  error: unknown,
  context?: TelemetryContext
): Promise<{ ok: boolean; status: number; eventId: string; detail: string }> {
  const parsed = parseDsn(SENTRY_DSN);
  if (!parsed) {
    return { ok: false, status: 0, eventId: '', detail: 'DSN could not be parsed' };
  }

  const err = error instanceof Error ? error : new Error(String(error));
  const eventId = crypto.randomUUID().replace(/-/g, '');
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    release,
    environment,
    tags: {
      app: vscode.env.appName,
      os: process.platform,
      area: context?.area || 'unknown',
      label: context?.label || '',
      voice: context?.voice || '',
      script: context?.script || '',
    },
    contexts: {
      runtime: {
        name: vscode.env.appName,
        version: vscode.version,
      },
      os: {
        name: process.platform,
        version: os.release(),
      },
    },
    exception: {
      values: [
        {
          type: err.name || 'Error',
          value: scrubText(err.message),
          stacktrace: { frames: stackFrames(err) },
        },
      ],
    },
  };

  const auth = `Sentry sentry_version=7, sentry_client=${release}, sentry_key=${parsed.key}`;
  const body = JSON.stringify(event);
  try {
    const result = await new Promise<{ status: number; detail: string }>((resolve, reject) => {
      const request = https.request(
        {
          hostname: parsed.host,
          path: `/api/${parsed.projectId}/store/`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'X-Sentry-Auth': auth,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            resolve({
              status: response.statusCode || 0,
              detail: Buffer.concat(chunks).toString('utf8').slice(0, 200),
            });
          });
        }
      );
      request.on('error', reject);
      request.end(body);
    });
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      eventId,
      detail: result.detail,
    };
  } catch (sendError) {
    const detail = sendError instanceof Error ? sendError.message : String(sendError);
    return { ok: false, status: 0, eventId, detail };
  }
}

export function initTelemetry(
  context: vscode.ExtensionContext,
  logger: (message: string) => void
): void {
  log = logger;
  enabled = telemetryAllowed();
  release = `varterm-cursor@${String(context.extension.packageJSON.version || 'unknown')}`;
  environment = vscode.env.appName || 'editor';
  log(
    `Sentry ${enabled ? 'on' : 'off'} release=${release} env=${environment} editorTelemetry=${vscode.env.isTelemetryEnabled}`
  );
  context.subscriptions.push(
    vscode.env.onDidChangeTelemetryEnabled((value) => {
      enabled = value && telemetryAllowed();
      log(`Sentry ${enabled ? 'on' : 'off'} (editor telemetry changed)`);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('vartermCursor.telemetry')) {
        enabled = telemetryAllowed();
        log(`Sentry ${enabled ? 'on' : 'off'} (setting changed)`);
      }
    })
  );
}

export function captureException(
  error: unknown,
  context?: TelemetryContext
): void {
  if (!enabled) {
    log('Sentry skipped: telemetry is off');
    return;
  }
  if (!shouldReport(error)) {
    return;
  }
  void postException(error, context).then((result) => {
    log(
      result.ok
        ? `Sentry sent ${result.eventId} area=${context?.area || 'unknown'}`
        : `Sentry failed status=${result.status} ${result.detail}`
    );
  });
}

export async function flushTelemetry(): Promise<void> {
  // Fire-and-forget posts; nothing to drain.
}
