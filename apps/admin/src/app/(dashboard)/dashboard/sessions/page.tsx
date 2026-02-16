import { SessionViewer } from "@/components/sessions/session-viewer";

export default function SessionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          View and manage user sessions across all devices.
        </p>
      </div>
      <SessionViewer />
    </div>
  );
}
