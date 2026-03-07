export function getWaitingInfo(updatedAt: string | null | undefined, now: Date = new Date()): { label: string, colorClass: string } | null {
  if (!updatedAt) return null;
  const date = new Date(updatedAt);
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  let colorClass = 'linear-badge-green';
  if (diffHours >= 24) {
    colorClass = 'linear-badge-red';
  } else if (diffHours >= 4) {
    colorClass = 'linear-badge-yellow';
  }

  let label = '';
  if (diffHours < 1) {
    const mins = Math.max(0, Math.floor(diffMs / (1000 * 60)));
    label = `${mins}m`;
  } else if (diffHours < 24) {
    label = `${Math.floor(diffHours)}h`;
  } else {
    label = `${Math.floor(diffHours / 24)}d`;
  }

  return { label: `waiting ${label}`, colorClass };
}
