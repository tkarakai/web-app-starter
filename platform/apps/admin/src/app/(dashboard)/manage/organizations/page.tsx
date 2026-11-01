import { OrganizationCleanups } from "@/components/organizations/organization-cleanups";
import { OrganizationsDataTable } from "@/components/organizations/organizations-data-table";

export default function OrganizationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
        <p className="text-sm text-muted-foreground">
          Every organization, its members and invitations. Administrators never see an organization&apos;s app data.
        </p>
      </div>
      <OrganizationCleanups />
      <OrganizationsDataTable />
    </div>
  );
}
