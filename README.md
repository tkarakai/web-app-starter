# Web App Starter

A modern starter project for building full-stack web applications with **Next.js + TypeScript**, **Bun**, **Tailwind + shadcn/ui**, **Convex**, and **BetterAuth**. This repository provides a clean, documented base with sample functionality, tests, and clear conventions.

---

## Table of Contents

- [Goals](#goals)
- [Stack](#stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Convex Setup](#convex-setup)
- [BetterAuth Setup](#betterauth-setup)
- [Development Process (Documented)](#development-process-documented)
- [Sample Functionality](#sample-functionality)
- [Testing](#testing)
- [Coding / Testing / Documentation / DevOps Conventions](#coding--testing--documentation--devops-conventions)

---

## Goals

- Provide a **full-stack** template that is easy to read, maintain, and extend.
- Use **latest stable versions** by default (installed via `latest` tags).
- Keep the initial app **fully functional** with a working Convex-powered feature and authentication wiring.
- Document the **why** and **how** in code and in this README.

---

## Stack

- **Framework:** Next.js (App Router) + TypeScript
- **Runtime / Package Manager / Test Runner / Bundler:** Bun
- **Styling:** Tailwind CSS + shadcn/ui
- **Backend & Database:** Convex (queries, mutations, file storage, scheduled jobs)
- **Authentication:** BetterAuth

---

## Project Structure

```
.
├── convex/                  # Convex backend functions + schema
├── src/
│   ├── app/                 # Next.js App Router entry points
│   ├── components/          # UI components
│   ├── lib/                 # Shared utilities
│   └── styles/              # Styling helpers (if needed)
├── .env.example             # Example environment configuration
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## Quick Start

> **Prerequisites:**
> - [Bun](https://bun.sh/) installed.
> - A Convex account and project.
> - BetterAuth credentials (see below).

```bash
bun install
bun run dev
```

The app will start on [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

Create a local `.env.local` file based on `.env.example`:

```bash
cp .env.example .env.local
```

You will need:

- **Next.js**
  - `NEXT_PUBLIC_CONVEX_URL`
- **Convex**
  - `CONVEX_DEPLOYMENT`
- **BetterAuth**
  - `BETTER_AUTH_SECRET`
  - `BETTER_AUTH_URL`
  - Provider credentials (example included)

---

## Convex Setup

1. Install the Convex CLI (using Bun):
   ```bash
   bunx convex dev
   ```
2. Follow the prompts to create or connect a Convex project.
3. Convex will generate the `convex/_generated` files used by the UI.

The sample functionality uses a `messages` table with a simple list/add flow.

---

## BetterAuth Setup

This starter includes a minimal BetterAuth configuration with support for:
- Email + password
- OAuth (GitHub example)

Steps:
1. Create OAuth credentials for your provider(s).
2. Add the credentials to `.env.local`.
3. Visit `/auth` in the app to sign in.

> **Note:** The BetterAuth handler is wired to `/api/auth/[...better-auth]` for use with App Router.
> The adapter is configured to use Convex so all auth data lives in the same backend.

---

## Development Process (Documented)

This starter was built using a deliberate, repeatable process. The details below are included so teams can follow the same approach when extending or recreating this stack.

1. **Project Scaffolding**
   - Chose Next.js App Router with TypeScript.
   - Configured Bun for scripts, installs, and testing.

2. **Styling and UI**
   - Tailwind base configuration created manually for clarity.
   - shadcn/ui primitives added to establish patterns for new components.

3. **Backend & Data**
   - Convex schema and functions created in `convex/`.
   - Frontend hooks use `convex/react` for real-time data.

4. **Authentication**
   - BetterAuth handler wired to Next.js API route.
   - Helper utilities documented in `src/lib/auth.ts`.

5. **Testing**
   - Added Bun unit test as a sample pattern.
   - Tests live alongside the logic they validate.

6. **Documentation**
   - README covers setup, structure, and conventions.
   - Inline comments explain core architectural decisions.

---

## Sample Functionality

The starter includes two small features to prove out the stack:

- **Message Board**
  - Users can add messages.
  - Messages are stored in Convex.
  - The list updates in real time.
- **File Storage**
  - Uploads are stored in Convex file storage.
  - Metadata is persisted in the Convex database.

---

## Testing

```bash
bun test
```

---

## Coding / Testing / Documentation / DevOps Conventions

### Coding Conventions
- Use **TypeScript** for all source files.
- Prefer **functional components** and **server actions** where appropriate.
- Keep modules small and focused; create new files when a module grows >200 lines.
- Add short comments explaining *why* decisions were made (not just what).

### Testing Conventions
- Use **Bun** as the test runner.
- Name tests `*.test.ts` and place near the modules they cover.
- Include at least one test per new utility or feature.

### Documentation Conventions
- Update README for new features or setup changes.
- Use JSDoc or inline comments for non-obvious logic.
- Provide sample usage in comments for reusable utilities.

### DevOps Conventions
- Keep environment variables documented in `.env.example`.
- Use `bun run build` in CI for production validation.
- Keep Convex schemas backward-compatible when possible.

---

## License

MIT
