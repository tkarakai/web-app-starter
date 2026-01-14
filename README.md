# Web App Starter

A fully functional starter template for building modern web applications with
Next.js, Bun, Tailwind, shadcn/ui, Convex, and BetterAuth. The project ships
with a working UI, Convex-backed task workflow, and Bun-based tests so you can
start building immediately.

## ✅ What you get

- **Next.js + TypeScript** application using the `/app` directory.
- **Bun** as runtime, package manager, bundler, and test runner.
- **Tailwind + shadcn/ui** base styles and UI primitives.
- **Convex** for the database, backend functions, and realtime API.
- **BetterAuth** scaffolded for authentication with Convex-backed storage.

## Project structure

```
app/                # Next.js routes (App Router)
components/         # Shared UI components
convex/             # Convex schema + functions
lib/                # Helpers, shared clients, auth wrappers
tests/              # Bun tests
```

## Quick start

1. **Install dependencies**

   ```bash
   bun install
   ```

2. **Set environment variables**

   Create a `.env.local` file at the repo root:

   ```bash
   NEXT_PUBLIC_CONVEX_URL=<your Convex URL>
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   BETTER_AUTH_SECRET=replace-with-a-strong-secret
   CONVEX_AUTH_URL=<optional Convex auth URL>
   ```

3. **Run Convex locally**

   ```bash
   bun run convex:dev
   ```

   This generates the strongly typed API bindings in `convex/_generated`.

4. **Start the Next.js dev server**

   ```bash
   bun run dev
   ```

5. **Run tests**

   ```bash
   bun test
   ```

## Sample functionality

- The homepage ships with a **task list** powered by Convex.
- Add a task using the input and verify realtime updates.
- The `/api/auth/[...betterauth]` route is scaffolded for BetterAuth.

## Development process (documented template)

1. **Scaffold the base app**: We created the Next.js App Router layout and
   defined a clear `app/`, `components/`, `lib/`, and `convex/` structure.
2. **Configure styling**: Tailwind is wired through `tailwind.config.ts` and
   `app/globals.css`, plus a reusable shadcn-style `Button` component.
3. **Add sample data flow**: Convex schema + functions power a task list with
   query/mutation wiring in `app/page.tsx`.
4. **Authentication scaffold**: BetterAuth integration is routed through
   `lib/auth.ts` and the Next.js API route for a clean, documented extension
   point.
5. **Testing and conventions**: A Bun test suite exercises shared utilities and
   establishes testing patterns for future features.

## BetterAuth notes

- The starter uses a minimal wrapper (`lib/auth.ts`) that attempts to load
  BetterAuth at runtime and forwards requests to its handler.
- Use the BetterAuth docs to wire providers (GitHub, Google, etc.) and confirm
  the API adapter settings.

## Convex notes

- Run `bunx convex dev` to generate `convex/_generated` bindings.
- The task list uses `tasks.list` and `tasks.create` in `convex/tasks.ts`.

## Coding conventions

- **TypeScript strict mode** is enabled. Prefer explicit types for public APIs.
- Keep components small and colocated; shared UI belongs in `components/ui`.
- Use `lib/` for shared helpers and client initializers.
- Document non-obvious logic with short, actionable comments.

## Testing conventions

- Use **Bun test** (`bun test`) with `describe`/`it` blocks.
- Test file names match `*.test.ts`.
- Favor AAA (Arrange → Act → Assert) structure in new tests.

## Documentation conventions

- Update this README whenever you add a major feature or workflow.
- Add inline comments in core setup files to explain intent, not mechanics.
- Document required environment variables and deployment steps.

## DevOps conventions

- Store secrets in environment variables (`.env.local`, CI secrets).
- Use Convex deployment targets (`bun run convex:deploy`) for production.
- Prefer immutable infrastructure and scriptable deploy steps.

## Scripts

- `bun run dev` - start Next.js dev server
- `bun run build` - build the Next.js app
- `bun run start` - start the production server
- `bun run lint` - run Next.js linting
- `bun test` - run Bun tests
- `bun run convex:dev` - run Convex locally
- `bun run convex:deploy` - deploy Convex

## Next steps

- Replace the sample task workflow with your domain logic.
- Connect BetterAuth providers and session storage.
- Add additional Convex functions and expand the UI.
