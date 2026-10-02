import { tableFeatures } from "@tanstack/react-table";

import { baseTableFeatures } from "@/lib/table-features";

/** The audit trail is read in the order the server returns it: no sorting or selection. */
export const auditTableFeatures = tableFeatures({ ...baseTableFeatures });
