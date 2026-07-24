import { requirePortalPageAccess } from '../../lib/auth/portalPageAccess';
import HomePortal from './home-portal';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const membership = await requirePortalPageAccess('home');
  return <HomePortal initialRole={membership.role} />;
}
