import type { CapabilityInput, CapabilityName } from "./catalogue";
/** Authentication is resolved by the host; adapters preserve native execution and policy. */
export interface CapabilityAdapter {
  execute<K extends CapabilityName>(name: K, input: CapabilityInput<K>, signal?: AbortSignal): Promise<unknown>;
}
