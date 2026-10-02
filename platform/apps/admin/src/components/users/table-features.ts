import { rowSelectionFeature, rowSortingFeature, tableFeatures } from "@tanstack/react-table";

import { baseTableFeatures } from "@/lib/table-features";

/** Sorting is done by the server (and in the browser for status), so there is no sorted row model. */
export const usersTableFeatures = tableFeatures({ ...baseTableFeatures, rowSortingFeature, rowSelectionFeature });
