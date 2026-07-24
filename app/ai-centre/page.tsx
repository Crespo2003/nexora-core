import PortalPlaceholder from '../components/PortalPlaceholder';
import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';

export const dynamic = 'force-dynamic';

export default async function AiCentrePage() {
  await requirePortalPageAccess('aiCentre');
  return <PortalPlaceholder page="aiCentre" labelKey="aiCentre" />;
}
