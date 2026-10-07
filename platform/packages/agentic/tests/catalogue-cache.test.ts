import { expect, test } from "bun:test";
import { CatalogueCache } from "../src/catalogue-cache";
import { defaultCatalogue } from "../src/discovery";
test("structural catalogue caching never caches authorization and keys deployment identity", async () => {
  const cache = new CatalogueCache(); let allowed = true; let proofs = 0; let loads = 0;
  const authorize = async () => { proofs++; if (!allowed) throw new Error("INVALID_AGENT_TOKEN"); };
  const load = async () => { loads++; return defaultCatalogue; };
  await cache.get("deployment-a", authorize, load); await cache.get("deployment-a", authorize, load);
  expect(loads).toBe(1); expect(proofs).toBe(2);
  allowed = false; await expect(cache.get("deployment-a", authorize, load)).rejects.toThrow("INVALID_AGENT_TOKEN");
  expect(loads).toBe(1); allowed = true; await cache.get("deployment-b", authorize, load); expect(loads).toBe(2);
  const expired = new CatalogueCache(0); await expired.get("a", authorize, load); await expired.get("a", authorize, load); expect(loads).toBe(4);
});
