/**
 * App hooks the platform calls by name (`userData:deleteUserData`,
 * `organizationData:deleteOrganizationData`) are optional: an app without the module keeps its data.
 * Convex reports a missing hook in two shapes: a missing function names the full path, a missing
 * module names only the module (`Could not find module for: "userData"`). Anything else, including
 * an error thrown by the hook itself, is a real failure.
 */
export function isMissingAppFunction(error: unknown, path: string): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message;
  if (!/Couldn't resolve|Could not find|Couldn't find/i.test(message)) return false;
  if (message.includes(path)) return true;
  const module = path.split(":")[0];
  return new RegExp(`module[^"'\\n]*["'\`]${module.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?:\\.js)?["'\`]`, "i").test(message);
}
