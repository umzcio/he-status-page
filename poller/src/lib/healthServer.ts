import http from 'http';

interface HealthState {
  lastPollCompleted: Date | null;
  lastPollDurationMs: number;
  isPolling: boolean;
  intervalMinutes: number;
}

export function createHealthServer(getState: () => HealthState): http.Server {
  return http.createServer((req, res) => {
    if (req.url === '/health') {
      const state = getState();
      const healthy = state.lastPollCompleted !== null || state.isPolling;
      const status = healthy ? 200 : 503;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: healthy ? 'ok' : 'starting',
        polling: state.isPolling,
        last_poll_completed: state.lastPollCompleted?.toISOString() || null,
        last_poll_duration_ms: state.lastPollDurationMs,
        interval_minutes: state.intervalMinutes,
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
}
