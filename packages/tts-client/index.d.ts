export type CancellationSubscription = {
  dispose: () => void;
};

export type CancellationTokenLike = {
  isCancellationRequested?: boolean;
  onCancellationRequested?: (handler: () => void) => CancellationSubscription;
};

export type ClientHeaders = Record<string, string>;

export type CreateTtsHttpClientOptions = {
  baseUrl: string;
  retries: number;
  timeoutMs: number;
  getHeaders: (includeJsonContentType: boolean) => Promise<ClientHeaders>;
};

export type RequestOptions = {
  retries?: number;
  timeoutMs?: number;
  cancellationToken?: CancellationTokenLike;
};

export class HttpError extends Error {
  status: number;
  retryAfterMs?: number;
  constructor(message: string, status: number, retryAfterMs?: number);
}

export function createTtsHttpClient(options: CreateTtsHttpClientOptions): {
  postJson: <T>(path: string, payload: unknown, options?: RequestOptions) => Promise<T>;
  postBinary: (path: string, payload: unknown, options?: RequestOptions) => Promise<Uint8Array>;
  getJson: <T>(path: string, options?: Omit<RequestOptions, "cancellationToken">) => Promise<T>;
};
