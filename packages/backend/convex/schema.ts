import { defineSchema } from "convex/server";

import { platformTables } from "./platform/tables";
import { sampleTables } from "./sampleTables";

// A seam: the app's tables plus the platform hook. Add your tables below
// (`platform-add-table`); keep the `platformTables` spread.
export default defineSchema({
  // Platform hook: the platform's tables (auth profiles, settings, audit trail, ...).
  ...platformTables,

  // Sample domain (projects, tasks, uploads). Remove with the sample.
  ...sampleTables,

  // Your tables go here.
});
