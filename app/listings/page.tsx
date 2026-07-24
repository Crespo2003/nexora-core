import PortalPlaceholder from '../components/PortalPlaceholder';
import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';

export const dynamic = 'force-dynamic';

export default async function ListingsPage() {
  await requirePortalPageAccess('listings');
  return <PortalPlaceholder page="listings" labelKey="listings" />;
}
