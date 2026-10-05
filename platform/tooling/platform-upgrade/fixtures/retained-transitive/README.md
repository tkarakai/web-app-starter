# Retained transitive lockfile fixture

`minimatch@3.1.2` allows `brace-expansion@1.1.12`. Bun 1.4.2 keeps those old
resolutions on an ordinary install even after the temporary seeding override is
removed. The fixture `package.json` has no override. `repaired.bun.lock` was
generated from the same manifest with `bun install --minimum-release-age=864000`
after removing the old lockfile. It resolves patched `minimatch@3.1.5` and
`brace-expansion@1.1.21` without changing the app's dependency declaration.

These lockfiles exercise resolution retention and refresh. Registry advisory
responses remain the responsibility of `dependency-audit.ts` and its tests.
