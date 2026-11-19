/** Container health check: exit 0 when /healthz answers 200 within 3 s. */
const port = process.env.PORT || '8080';
try {
  const res = await fetch(`http://127.0.0.1:${port}/healthz`, {
    signal: AbortSignal.timeout(3000),
  });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}

export {};
