import PortalPlaceholder from '../components/PortalPlaceholder';
import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';

export const dynamic = 'force-dynamic';

export default async function ContractorsPage() {
  await requirePortalPageAccess('contractors');
  return <PortalPlaceholder page="contractors" labelKey="contractors" />;
}
