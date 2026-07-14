export type FollowupInput = { dueAt: string; status: string; updatedAt?: string; kind?: string };

export function followupBucket(item: FollowupInput, now = new Date()) {
  if (item.status === 'completed' || item.status === 'cancelled') return 'completed';
  const due = new Date(item.dueAt);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const days = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 7) return 'this_week';
  return 'upcoming';
}

export function inactivityDays(updatedAt: string, now = new Date()) {
  return Math.max(Math.floor((now.getTime() - new Date(updatedAt).getTime()) / 86_400_000), 0);
}

