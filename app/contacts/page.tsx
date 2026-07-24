import PortalPlaceholder from '../components/PortalPlaceholder';
import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  await requirePortalPageAccess('contacts');
  return <PortalPlaceholder page="contacts" labelKey="contacts" />;
}
