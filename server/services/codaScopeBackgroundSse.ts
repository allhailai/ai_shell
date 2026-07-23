/* Start-only internal SSE consumers keep localhost pipelines connected without
   claiming that their long-running work has completed. */

export function startBackgroundSsePump(response: Response, label: string): boolean {
  if (!response.body) return false;
  const reader = response.body.getReader();
  void (async () => {
    try {
      while (!(await reader.read()).done) {
        // Pipeline state and logs are the durable observation channel.
      }
    } catch (err) {
      console.error(`[${label}] Background SSE reader failed:`, err);
    }
  })();
  return true;
}
