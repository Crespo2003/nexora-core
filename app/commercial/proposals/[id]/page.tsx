import ProposalWorkspace from './proposal-workspace';

export default function Page({ params }: { params: { id: string } }) {
  return <ProposalWorkspace proposalId={params.id} />;
}
