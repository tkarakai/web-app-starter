import { UsersDataTable } from "@/components/users/users-data-table";

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">
          Manage user accounts, ban or remove users.
        </p>
      </div>
      <UsersDataTable />
    </div>
  );
}
