export function formatDuration(startedAt: string | null | undefined): string {
  if (!startedAt) return '';
  const started = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - started);
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  if (days < 7) return hrs > 0 ? `${days}d ${hrs}h` : `${days}d`;
  return `${days}d`;
}
