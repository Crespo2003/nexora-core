import PortalPlaceholder from '../components/PortalPlaceholder';
import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';

export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  await requirePortalPageAccess('crm');
  return <PortalPlaceholder page="crm" labelKey="crm" />;
}
