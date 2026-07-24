import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';
import ContactsWorkspace from './contacts-workspace';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const membership = await requirePortalPageAccess('contacts');
  return <ContactsWorkspace initialRole={membership.role} />;
}
