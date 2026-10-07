import { expect, test } from "bun:test";
import { gatewayContracts } from "../src/gateway-contract";
import { browserContracts } from "../src/browser-contract";
import { gatewayToolDefinitions, describeCapabilities } from "../src/discovery";
import { browserCatalogue } from "../src/browser-catalogue";
test("browser JSON contracts match executable server schema output", () => {
  expect(gatewayContracts as unknown).toEqual(gatewayToolDefinitions());
  expect(browserContracts as unknown).toEqual(Object.keys(browserCatalogue).flatMap(name => describeCapabilities(browserCatalogue, { names: [name] })));
});
