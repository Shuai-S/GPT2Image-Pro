function parseHeaderNumber(headers: Headers, name: string) {
  const value = headers.get(name);
  if (!value?.trim()) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function getCodexRetryAfterSeconds(headers: Headers) {
  // Codex reports multiple quota windows. A reset value is only a retry-after
  // signal when the matching window is already exhausted.
  const windows = [
    {
      usedPercent: parseHeaderNumber(headers, "x-codex-primary-used-percent"),
      resetAfterSeconds: parseHeaderNumber(
        headers,
        "x-codex-primary-reset-after-seconds"
      ),
      windowMinutes: parseHeaderNumber(
        headers,
        "x-codex-primary-window-minutes"
      ),
    },
    {
      usedPercent: parseHeaderNumber(headers, "x-codex-secondary-used-percent"),
      resetAfterSeconds: parseHeaderNumber(
        headers,
        "x-codex-secondary-reset-after-seconds"
      ),
      windowMinutes: parseHeaderNumber(
        headers,
        "x-codex-secondary-window-minutes"
      ),
    },
  ].filter(
    (item) =>
      item.resetAfterSeconds &&
      item.resetAfterSeconds > 0 &&
      item.windowMinutes &&
      item.windowMinutes > 0
  );

  const exhausted = windows.filter(
    (item) => item.usedPercent !== undefined && item.usedPercent >= 100
  );
  if (!exhausted.length) return undefined;

  return Math.max(...exhausted.map((item) => item.resetAfterSeconds || 0));
}
