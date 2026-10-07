import { notFound } from "next/navigation";
import { agentConfig } from "@/lib/agentic/config";
import { AgentAccess } from "./agent-access";
export default function AgentAccessPage() {
  if (!agentConfig()) notFound();
  return <AgentAccess />;
}
