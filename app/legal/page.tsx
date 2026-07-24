import PortalPlaceholder from '../components/PortalPlaceholder';
import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';

export const dynamic = 'force-dynamic';

export default async function LegalPage() {
  await requirePortalPageAccess('legal');
  return <PortalPlaceholder page="legal" labelKey="legal" />;
}
