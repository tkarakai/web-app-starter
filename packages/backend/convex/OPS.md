## Convex CLI Operations

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
