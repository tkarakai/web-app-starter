# Convex Backend

This directory (`packages/backend/convex/`) contains all Convex backend functions (queries, mutations, actions) and the database schema. This is part of the `@repo/backend` shared package in the monorepo.

Apps import the Convex API via `import { api } from "@repo/backend"`.

## CLI Operations

### Check Version

```bash
bunx convex --version
```

### Update

```bash
bun update convex
```

To specific version:

```bash
bun add convex@1.31.7
```

### Upgrade Convex Backend

When you see this error:
```
This deployment is using an older version of the Convex backend. Upgrade now?
✖ Cannot prompt for input in non-interactive terminals.
```

Run the upgrade explicitly:

```bash
bunx convex dev --once
```

### Common Commands

| Command | Description |
|---------|-------------|
| `bunx convex dev` | Start dev server (watches for changes) |
| `bunx convex dev --once` | One-time push without watching |
| `bunx convex dev --clear` | Clear all data and restart |
| `bunx convex deploy` | Push to production |
| `bunx convex dashboard` | Open web dashboard |
| `bunx convex logs` | View function logs |
| `bunx convex run module:fn '{}'` | Run a function from CLI |
| `bunx convex import --table name data.json` | Import data |
| `bunx convex export --path ./backup` | Export data |

### Authentication

```bash
bunx convex login      # Log in to Convex
bunx convex logout     # Log out
bunx convex switch     # Switch deployment
bunx convex env        # View current deployment info
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Backend version mismatch | `bunx convex dev --once` |
| Cannot prompt in non-interactive | Run upgrade command manually first |
| Schema validation errors | Check `convex/schema.ts` for issues |
| Functions not updating | Restart with `bunx convex dev` |
| Authentication issues | `bunx convex logout && bunx convex login` |

---

## Writing Convex Functions

Write your Convex functions here. See https://docs.convex.dev/functions for more.

A query function that takes two arguments looks like:

```ts
// convex/myFunctions.ts
import { query } from "./_generated/server";
import { v } from "convex/values";

export const myQueryFunction = query({
  // Validators for arguments.
  args: {
    first: v.number(),
    second: v.string(),
  },

  // Function implementation.
  handler: async (ctx, args) => {
    // Read the database as many times as you need here.
    // See https://docs.convex.dev/database/reading-data.
    const documents = await ctx.db.query("tablename").collect();

    // Arguments passed from the client are properties of the args object.
    console.log(args.first, args.second);

    // Write arbitrary JavaScript here: filter, aggregate, build derived data,
    // remove non-public properties, or create new objects.
    return documents;
  },
});
```

Using this query function in a React component looks like:

```ts
const data = useQuery(api.myFunctions.myQueryFunction, {
  first: 10,
  second: "hello",
});
```

A mutation function looks like:

```ts
// convex/myFunctions.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const myMutationFunction = mutation({
  // Validators for arguments.
  args: {
    first: v.string(),
    second: v.string(),
  },

  // Function implementation.
  handler: async (ctx, args) => {
    // Insert or modify documents in the database here.
    // Mutations can also read from the database like queries.
    // See https://docs.convex.dev/database/writing-data.
    const message = { body: args.first, author: args.second };
    const id = await ctx.db.insert("messages", message);

    // Optionally, return a value from your mutation.
    return await ctx.db.get("messages", id);
  },
});
```

Using this mutation function in a React component looks like:

```ts
const mutation = useMutation(api.myFunctions.myMutationFunction);
function handleButtonPress() {
  // fire and forget, the most common way to use mutations
  mutation({ first: "Hello!", second: "me" });
  // OR
  // use the result once the mutation has completed
  mutation({ first: "Hello!", second: "me" }).then((result) =>
    console.log(result),
  );
}
```

Use the Convex CLI to push your functions to a deployment. See everything
the Convex CLI can do by running `bunx convex -h` in your project root
directory. To learn more, launch the docs with `bunx convex docs`.
