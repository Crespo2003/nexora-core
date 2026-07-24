import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';
import CrmWorkspace from './crm-workspace';

export const dynamic = 'force-dynamic';

export default async function CrmPage() {
  const membership = await requirePortalPageAccess('crm');
  return <CrmWorkspace initialRole={membership.role} />;
}
