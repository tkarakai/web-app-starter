import { OrganizationDetails } from "@/components/organizations/organization-detail";
export default async function OrganizationPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  return <OrganizationDetails organizationId={organizationId} />;
}
