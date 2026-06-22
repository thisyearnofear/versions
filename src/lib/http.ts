// MODULAR: HTTP helpers. Thin wrappers around fetch with timeout + JSON
// parsing. Replaces the original runtime/http.js.

function withTimeoutSignal(
  timeoutMs: number | undefined,
  existingSignal: AbortSignal | undefined,
): { signal: AbortSignal | undefined; cancel: () => void } {
  if (!timeoutMs || timeoutMs <= 0 || existingSignal) {
    return { signal: existingSignal, cancel: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

export interface RequestJsonOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function requestJson<T = unknown>(
  url: string,
  options: RequestJsonOptions = {},
  contextLabel = 'request',
): Promise<T> {
  const timeout = withTimeoutSignal(options.timeoutMs, options.signal);
  const { timeoutMs: _omit, ...rest } = options;
  const fetchOptions: RequestInit = {
    ...rest,
    signal: timeout.signal,
  };

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `${contextLabel} failed (${response.status}): ${body.slice(0, 220)}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    timeout.cancel();
  }
}
