import {
  columnSizingFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
} from "@tanstack/react-table";

/**
 * The sort functions a column's default ("auto") sort resolves to: text, numbers and dates.
 * Register only these instead of every built-in function.
 */
export const autoSortFns = {
  alphanumeric: sortFn_alphanumeric,
  basic: sortFn_basic,
  datetime: sortFn_datetime,
  text: sortFn_text,
};

/**
 * Features every admin table needs: the visible-column and visible-cell APIs they render through
 * (and `enableHiding`), and the column `size` option their column definitions set.
 */
export const baseTableFeatures = { columnVisibilityFeature, columnSizingFeature };

/** Sorts rows in the browser; tables whose server owns the order do not register it. */
export const sortedRowModel = createSortedRowModel();
