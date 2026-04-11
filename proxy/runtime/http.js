function withTimeoutSignal(timeoutMs, existingSignal) {
  if (!timeoutMs || timeoutMs <= 0 || existingSignal) {
    return { signal: existingSignal, cancel: () => {} };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer)
  };
}

async function requestJson(url, options = {}, contextLabel = 'request') {
  const timeoutMs = options.timeoutMs;
  const timeout = withTimeoutSignal(timeoutMs, options.signal);
  const fetchOptions = {
    ...options,
    signal: timeout.signal
  };

  delete fetchOptions.timeoutMs;

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${contextLabel} failed (${response.status}): ${body.slice(0, 220)}`);
    }

    return response.json();
  } finally {
    timeout.cancel();
  }
}

module.exports = {
  requestJson
};
