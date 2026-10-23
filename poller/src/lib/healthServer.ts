import http from 'http';

interface HealthState {
  lastPollCompleted: Date | null;
  lastPollDurationMs: number;
  isPolling: boolean;
  pollStartedAt?: Date | null;
  intervalMinutes: number;
}

// A cycle running longer than this is treated as stuck.
function maxCycleMs(intervalMinutes: number): number {
  return Math.max(3 * intervalMinutes, 15) * 60 * 1000;
}

export function isHealthy(state: HealthState, now = Date.now()): boolean {
  if (state.isPolling) {
    const started = state.pollStartedAt?.getTime();
    return started === undefined || now - started <= maxCycleMs(state.intervalMinutes);
  }
  return state.lastPollCompleted !== null;
}

export function createHealthServer(getState: () => HealthState): http.Server {
  return http.createServer((req, res) => {
    if (req.url === '/health') {
      const state = getState();
      const healthy = isHealthy(state);
      const status = healthy ? 200 : 503;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: healthy ? 'ok' : state.isPolling ? 'stuck' : 'starting',
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
