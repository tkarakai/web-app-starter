---
name: platform-patch
description: Use when an app has to change a file in the platform zone (platform/, convex/platform/, platform-* workflows or skills) before the platform ships the change. Records the edit as a PLATFORM-PATCH so the zone check passes and upgrades review it, and drafts the change request to the platform maintainers.
---

# Patch the platform (escape hatch)

The platform zone is replaced wholesale on every upgrade, and CI's zone check
(`bun run check:zone`) fails on any edit there that is not a recorded patch. A patch is the
exception, not the way to build features: most needs are met by a seam or `app.config.ts`
(`platform-configure`, `platform-add-table`, `platform-add-strings`, `platform-add-page`).

## First, rule out a patch

- Is the value configuration? Then it belongs in `app.config.ts`.
- Can the app do it in its own code, next to the platform (a wrapper, its own route, its own
  table, an override in `packages/messages/overrides.json`)? Then do that.
- Is this the product repo (no `.platform-base.json`)? Then it is platform work: change the
  platform properly. Reference apps never carry patches.

Only when none applies, patch.

## Record the patch

1. Make the smallest edit that works.
2. Mark it where it is made, in the file's comment syntax:
   `// PLATFORM-PATCH: <reason>` (`# PLATFORM-PATCH: <reason>` in YAML and shell). A file
   without comments (JSON, images) is recorded in step 3 only.
3. Add the file to `patches` in the root `.platform-base.json`, one entry per file:

   ```json
   { "path": "platform/packages/auth/src/cookies.ts", "reason": "Keep the v1 cookie prefix until users re-sign-in (ticket #12)" }
   ```

   The reason says why the app can't wait, and when the patch can go.
4. Run `bun run check:zone`. It must pass and list the patch.

## Draft the request

Write the change request for the platform maintainers, for the user to send: what the patch
changes, why the app needed it, the smallest platform change that would make it unnecessary
(a new `app.config.ts` value, a hook, a fix), and the diff (`git diff <commit> -- <path>`, with
`commit` from `.platform-base.json`). Don't send it yourself.

## On upgrade

The upgrade shows each recorded patch against the new platform files. If the release covers
it, drop the edit and its record. Otherwise re-apply and review it. The zone check warns about
a record whose file no longer differs from the platform: remove that record.
