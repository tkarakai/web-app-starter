/** Generate browser-safe JSON contracts from the server schemas. */
import { writeFile } from "node:fs/promises";
import { gatewayToolDefinitions, describeCapabilities } from "./discovery";
import { browserCatalogue } from "./browser-catalogue";
const heading = '/** Generated JSON contract. Run this package\'s generate:contracts script after schema changes. */\n';
await writeFile(new URL("./gateway-contract.ts", import.meta.url), heading + 'export const gatewayContracts = ' + JSON.stringify(gatewayToolDefinitions(), null, 2) + ' as const;\n');
await writeFile(new URL("./browser-contract.ts", import.meta.url), heading + 'export const browserContracts = ' + JSON.stringify(Object.keys(browserCatalogue).flatMap(name => describeCapabilities(browserCatalogue, { names: [name] })), null, 2) + ' as const;\n');
