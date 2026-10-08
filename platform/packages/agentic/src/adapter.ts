/** Authentication is resolved by the host; adapters preserve native execution and policy. */
export interface CapabilityAdapter {
  execute(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}
