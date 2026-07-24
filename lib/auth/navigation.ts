export const DEFAULT_AUTH_DESTINATION = '/onboarding/workspace';

export function getSafeNextPath(value: string | null | undefined, fallback = DEFAULT_AUTH_DESTINATION) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    const parsed = new URL(value, 'https://nexora.invalid');
    if (parsed.origin !== 'https://nexora.invalid') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export type MembershipDestination = {
  workspaceId?: string;
  workspace_id?: string;
  status: string;
};

export function destinationForMemberships(memberships: MembershipDestination[], requestedNext?: string | null) {
  const active = memberships.filter((membership) => membership.status === 'active');
  if (active.length === 0) {
    return memberships.some((membership) => ['disabled', 'suspended'].includes(membership.status))
      ? '/access-denied?reason=membership-suspended'
      : '/onboarding/workspace';
  }
  if (active.length > 1) return '/workspace/select';
  return getSafeNextPath(requestedNext, '/home');
}
