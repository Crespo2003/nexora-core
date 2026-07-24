import PortalPlaceholder from '../components/PortalPlaceholder';
import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';

export const dynamic = 'force-dynamic';

export default async function DealsPage() {
  await requirePortalPageAccess('deals');
  return <PortalPlaceholder page="deals" labelKey="deals" />;
}
