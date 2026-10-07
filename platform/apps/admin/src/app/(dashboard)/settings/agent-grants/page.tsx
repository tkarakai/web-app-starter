import { notFound } from "next/navigation";
import { agentConfig } from "@/lib/agentic/config";
import { AgentGrants } from "./agent-grants";
export default function AgentGrantsPage() {
  if (!agentConfig()) notFound();
  return <AgentGrants />;
}
