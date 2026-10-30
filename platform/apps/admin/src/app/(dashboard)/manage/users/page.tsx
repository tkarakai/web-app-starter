import { AppOperatorsDataTable } from "@/components/users/users-data-table";

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">App operators</h1>
        <p className="text-sm text-muted-foreground">
          Manage app operator accounts and session access.
        </p>
      </div>
      <AppOperatorsDataTable />
    </div>
  );
}
