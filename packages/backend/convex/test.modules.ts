/// <reference types="vite/client" />
// Every Convex module, keyed relative to this directory, for `convexTest(schema, modules)`.
// Tests in subdirectories (such as `platform/`) import this instead of calling
// `import.meta.glob` themselves: a glob from a subdirectory keys that directory's own
// files as `./x.ts`, and convex-test then cannot find them. Convex skips this file
// (its name has two dots), so it is test-only.
export const modules = import.meta.glob("./**/*.*s");
