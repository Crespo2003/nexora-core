const uploadWindows = new Map<string, number[]>();

export const uploadRateLimit = { maxRequests: 8, windowMs: 5 * 60_000 } as const;

export function checkUploadRateLimit(key: string, now = Date.now()) {
  const cutoff = now - uploadRateLimit.windowMs;
  const recent = (uploadWindows.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= uploadRateLimit.maxRequests) {
    return { allowed: false, retryAfterSeconds: Math.max(Math.ceil((recent[0] + uploadRateLimit.windowMs - now) / 1000), 1) };
  }
  recent.push(now);
  uploadWindows.set(key, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetUploadRateLimitsForTests() {
  uploadWindows.clear();
}
