import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';
import DealsWorkspace from './deals-workspace';

export const dynamic = 'force-dynamic';

export default async function DealsPage() {
  const membership = await requirePortalPageAccess('deals');
  return <DealsWorkspace initialRole={membership.role} />;
}
