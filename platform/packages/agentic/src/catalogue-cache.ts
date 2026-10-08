import type { CapabilityCatalogue } from "./discovery";
/** Cache only structural metadata, identical for blanket admin scope; authenticate every access. */
export class CatalogueCache {
  private value?: { key: string; expiresAt: number; catalogue: CapabilityCatalogue };
  constructor(private readonly ttlMs = 30_000) {}
  async get(key: string, authorize: () => Promise<void>, load: () => Promise<CapabilityCatalogue>) {
    await authorize();
    if (this.value?.key === key && this.value.expiresAt > Date.now()) return this.value.catalogue;
    const catalogue = await load(); this.value = { key, expiresAt: Date.now() + this.ttlMs, catalogue }; return catalogue;
  }
}
