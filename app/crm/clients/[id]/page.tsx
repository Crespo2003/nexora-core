import { requirePortalPageAccess } from '../../../../lib/auth/portalPageAccess';
import ClientRecord from './client-record';

export const dynamic = 'force-dynamic';

export default async function ClientRecordPage({ params }: { params: { id: string } }) {
  const membership = await requirePortalPageAccess('crm');
  return <ClientRecord clientId={params.id} initialRole={membership.role} />;
}
