import PortalPlaceholder from '../components/PortalPlaceholder';
import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';

export const dynamic = 'force-dynamic';

export default async function ViewingsPage() {
  await requirePortalPageAccess('viewings');
  return <PortalPlaceholder page="viewings" labelKey="viewingsAppointments" />;
}
