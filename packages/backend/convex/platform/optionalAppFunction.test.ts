import { describe, expect, it } from "vitest";
import { isMissingAppFunction } from "./optionalAppFunction";

describe("isMissingAppFunction", () => {
  const path = "userData:deleteUserData";
  it("recognizes a missing module or function", () => {
    expect(isMissingAppFunction(new Error('Could not find module for: "userData"'), path)).toBe(true);
    expect(isMissingAppFunction(new Error("Could not find module for: 'userData.js'"), path)).toBe(true);
    expect(isMissingAppFunction(new Error(`Couldn't resolve ${path}`), path)).toBe(true);
    expect(isMissingAppFunction(new Error(`Could not find public function for '${path}'`), path)).toBe(true);
  });
  it("treats every other error as a real failure", () => {
    expect(isMissingAppFunction(new Error("Something broke in deleteUserData"), path)).toBe(false);
    expect(isMissingAppFunction(new Error('Could not find module for: "userDataExtra"'), path)).toBe(false);
    expect(isMissingAppFunction(new Error('Could not find document "userData"'), path)).toBe(false);
    expect(isMissingAppFunction("Could not find module for: \"userData\"", path)).toBe(false);
  });
});
