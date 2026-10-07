import { notFound } from "next/navigation";
import { validateAuthorization } from "@web-app-starter/agentic/oauth";
import { headers } from "next/headers";
import { agentConfig, isAuthorizationHost } from "@/lib/agentic/config";
import { AgentAccess } from "./agent-access";

export default async function AgentAccessPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const config = agentConfig();
  if (!config || !isAuthorizationHost((await headers()).get("host"))) notFound();
  const values = await searchParams;
  if (Object.keys(values).length === 0) notFound();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string") notFound();
    params.set(key, value);
  }
  let request;
  try {
    request = validateAuthorization(params);
    if (params.get("resource") !== config.resource) notFound();
  } catch { notFound(); }
  return <AgentAccess request={{ ...request, resource: config.resource }} />;
}
