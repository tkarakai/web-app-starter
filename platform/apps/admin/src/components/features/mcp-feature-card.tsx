import { AgentSurfaceCard } from "./agent-surface-card";
export function McpFeatureCard({ deploymentReady }: { deploymentReady: boolean }) { return <AgentSurfaceCard surface="mcp" deploymentReady={deploymentReady} />; }
