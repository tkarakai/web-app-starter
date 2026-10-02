import { rowSelectionFeature, rowSortingFeature, tableFeatures } from "@tanstack/react-table";

import { autoSortFns, baseTableFeatures, sortedRowModel } from "@/lib/table-features";

export const waitlistTableFeatures = tableFeatures({
  ...baseTableFeatures,
  rowSortingFeature,
  rowSelectionFeature,
  sortedRowModel,
  sortFns: autoSortFns,
});
