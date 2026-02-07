import { AlertCircle, Terminal } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@repo/ui";

import { ComponentPage } from "@/components/component-page";
import { DemoSection } from "@/components/demo-section";

export default function AlertPage() {
  return (
    <ComponentPage
      title="Alert"
      description="Display important messages and feedback to the user."
    >
      <DemoSection title="Default Alert">
        <Alert>
          <Terminal className="h-4 w-4" />
          <AlertTitle>Heads up!</AlertTitle>
          <AlertDescription>
            You can add components to your app using the CLI.
          </AlertDescription>
        </Alert>
      </DemoSection>

      <DemoSection title="Destructive Alert">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            Your session has expired. Please log in again to continue.
          </AlertDescription>
        </Alert>
      </DemoSection>
    </ComponentPage>
  );
}
