import { Button } from "@repo/design-system";

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-4xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">
          Your account has been suspended or you do not have permission to
          access this resource. If you believe this is an error, please contact
          your organization&apos;s administrator.
        </p>
        <Button asChild variant="outline">
          <a href="/api/auth/clear-session">Back to sign in</a>
        </Button>
      </div>
    </main>
  );
}
