# Web App Starter

This starter project is a **fully functional Next.js + TypeScript** template that uses **Bun** for runtime/package management/testing, **Tailwind + shadcn/ui** for the design system, **Convex** for backend/data, and **BetterAuth** for authentication. It is intentionally documented to be easy to extend and follow.

## Why this template exists

- Provide a production-ready baseline with modern defaults.
- Remove “day zero” setup for Convex + BetterAuth + Next.js.
- Capture a repeatable development process and team conventions.

---

## Quick start

```bash
bun install
cp .env.example .env.local
bunx convex dev
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## What’s included

- **Next.js App Router** + TypeScript
- **Bun** runtime + package manager + test runner
- **Tailwind CSS** with a starter theme
- **shadcn/ui** primitives (Button + utility helpers)
- **Convex** schema and sample messages API
- **BetterAuth** scaffolding for auth routes
- **Sample tests** with Bun’s test runner

---

## Development process (documented)

This repo documents the entire setup so future projects can follow the same path:

1. **Initialize the base project**
   - Create a standard Next.js app structure (App Router + TypeScript).
   - Configure Bun scripts in `package.json`.

2. **Design system + CSS**
   - Add Tailwind + PostCSS configuration.
   - Add shadcn/ui utilities and a starter `Button` component.

3. **Backend + data layer**
   - Define Convex schema in `convex/schema.ts`.
   - Add sample query + mutation in `convex/messages.ts`.
   - Provide a React provider in `app/providers.tsx`.

4. **Authentication**
   - Scaffold BetterAuth config in `lib/auth.ts`.
   - Add the Next.js API route handler at `app/api/auth/[...better-auth]/route.ts`.

5. **Sample functionality**
   - The `MessageBoard` component shows how to write data to Convex.
   - It includes a lightweight form + list UI.

6. **Testing**
   - Add a sample unit test under `tests/`.
   - Use Bun’s built-in test runner.

7. **Documentation + conventions**
   - Include this README and inline comments explaining every setup step.
   - Capture coding/testing/documentation/devops conventions for teams.

---

## Project structure

```
app/                # Next.js App Router pages/layouts
components/         # UI + feature components
convex/             # Convex backend functions + schema
lib/                # Shared helpers + auth config
public/             # Static assets
tests/              # Bun unit tests
```

---

## Running the app locally

1. Install dependencies:
   ```bash
   bun install
   ```

2. Create environment variables:
   ```bash
   cp .env.example .env.local
   ```

3. Initialize Convex (this generates the real `convex/_generated` types):
   ```bash
   bunx convex dev
   ```

4. Start the Next.js dev server:
   ```bash
   bun run dev
   ```

---

## Sample functionality

The home page ships with a **Message board** widget that lets you create and list messages. It is backed by Convex queries and mutations in `convex/messages.ts`, and demonstrates how to wire a UI to your backend in minutes.

---

## Authentication with BetterAuth

This starter includes a **BetterAuth scaffold**, ready for provider configuration:

- Edit `lib/auth.ts` to add providers and connect Convex as the database adapter.
- Configure `.env.local` values for secrets and provider credentials.
- The Next.js API route handler is already wired at `/api/auth/*`.

---

## Testing

Run the test suite:

```bash
bun test
```

---

## Conventions

### Coding conventions
- Prefer function components + hooks in React.
- Keep Convex queries and mutations small and composable.
- Name files based on feature (`message-board.tsx`) not type (`components.tsx`).

### Testing conventions
- Use Bun’s built-in test runner.
- Place unit tests alongside `tests/` and name them `*.test.ts`.
- Test one behavior per test case.

### Documentation conventions
- Add inline comments for every setup or infrastructure decision.
- Document environment variables in `.env.example` and README.

### DevOps conventions
- Use `.env.local` for secrets and never commit it.
- Run `bunx convex dev` for local backend development.
- Deploy with your chosen platform (Vercel, Fly.io, etc.) once env vars are set.

---

## Next steps

- Replace the sample Message board with your product’s core features.
- Add file storage via Convex if you need uploads.
- Swap BetterAuth providers (GitHub, Google, etc.).
- Extend Tailwind theme tokens in `tailwind.config.ts`.

Happy building!
