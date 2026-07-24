import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';
import AppointmentsWorkspace from './appointments-workspace';

export const dynamic = 'force-dynamic';

export default async function AppointmentsPage() {
  const membership = await requirePortalPageAccess('viewings');
  return <AppointmentsWorkspace initialRole={membership.role} />;
}
