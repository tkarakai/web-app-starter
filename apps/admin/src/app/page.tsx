import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/design-system";

export default function AdminHomePage() {
  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-3xl font-semibold">Admin Dashboard</h1>
        <Card>
          <CardHeader>
            <CardTitle>Welcome to the Admin Panel</CardTitle>
            <CardDescription>
              This is a placeholder admin interface. Add admin-specific views here.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              The admin app shares the same Convex backend and auth system as the main web
              app. Add admin-only queries and mutations in{" "}
              <code className="font-semibold">packages/backend/convex/admin/</code>.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
