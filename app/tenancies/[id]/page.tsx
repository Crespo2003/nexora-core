import TenancyWorkspace from './tenancy-workspace';

export default function TenancyWorkspacePage({ params }: { params: { id: string } }) {
  return <TenancyWorkspace tenancyId={params.id} />;
}
