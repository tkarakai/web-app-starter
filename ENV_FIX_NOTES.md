# Environment Configuration Fix (Historical)

> **Note**: This is a historical troubleshooting note from before the monorepo conversion. The web app now runs on port 3001 (not 3000). The general principles still apply.

## Issue
When attempting to sign up or log in, a 403 (Forbidden) error occurred in the browser console:
```
api/auth/sign-up/email:1  Failed to load resource: the server responded with a status of 403 (Forbidden)
```

## Root Cause
The `.env.local` file was configured with cloud deployment URLs instead of local development URLs:

**Incorrect (Cloud URLs):**
```bash
NEXT_PUBLIC_CONVEX_URL=https://first-heron-85.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=https://first-heron-85.convex.site
```

This caused authentication requests to be sent to the cloud deployment, which rejected them with a 403 error.

## Fix
Updated `.env.local` to use local Convex instance URLs for development:

**Correct (Local URLs):**
```bash
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211
```

## Verification
- ✅ Local Convex instance confirmed running on port 3210 (API endpoint)
- ✅ Local Convex instance confirmed running on port 3211 (site endpoint)
- ✅ Configuration now matches `.env.example` recommendations

## Next Steps
1. **Restart the Next.js development server** to pick up the new environment variables:
   ```bash
   # Stop the current server (Ctrl+C)
   # Then restart:
   bunx next dev
   ```

2. **Test authentication**:
   - Open http://localhost:3000 in your browser
   - Try to sign up or log in
   - The 403 error should be resolved

## Note
`.env.local` is gitignored (as it should be) since it contains environment-specific configuration. This fix has been applied to the worktree's `.env.local` file. For reference, the `.env.example` file documents the correct local development URLs.

---
**Fixed**: 2026-01-22
**QA Fix Session**: 1
