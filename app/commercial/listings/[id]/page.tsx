import CommercialWorkspace from '../../commercial-workspace';
export default function Page({ params }: { params: { id: string } }) { return <CommercialWorkspace view="listings" detailId={params.id} />; }
