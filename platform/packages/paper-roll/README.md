# Paper Roll

A small TypeScript library for guided command-line tools. It has no ops imports or
runtime dependencies. It uses Node's terminal and stream APIs and runs under Node
or Bun. This is a private workspace package, not a published npm package; its
source can be moved to another TypeScript project without the rest of this repo.

## Interaction model

```text
Environment overview

…finished output…
────────────────────────────────────────────────

What would you like to do next?
› Investigate staging failure
  Monitor environments
```

Enter replaces the menu with the selected action. That action belongs to the
following output, so there is **no separator after the selection**:

```text
› Investigate staging failure

⠋ Loading deployment details…
```

The loading header is replaced with a named result. The result ends with a
separator; the next menu appears below it. Completed sections remain in terminal
scrollback. Follow-up questions can collect more choices before producing output;
they stay in the same section. Only the current loading/live section and menu
redraw. Back is a navigation result, not an instruction to erase history or undo
work.

## Use it

```ts
import { PaperRoll } from "@repo/paper-roll";

const roll = new PaperRoll();
roll.write({ title: "Workspace", lines: ["Choose a task to begin."] });

const choice = await roll.choose({
  prompt: "What would you like to do?",
  back: true,
  choices: [
    { id: "count", label: "Count records", value: "count" },
    { id: "quit", label: "Quit", value: "quit" },
  ],
});

if (choice.kind === "selected" && choice.value === "count") {
  await roll.task({
    title: "Record count",
    loading: "Counting records…",
    run: async signal => {
      signal.throwIfAborted();
      return 42; // Replace with your own domain operation.
    },
    render: count => [`${count} records`],
  });
}
```

Run a complete read-only example with `bun run --cwd packages/paper-roll demo`.
It browses the current directory and has no connection to ops or cloud providers.

## API boundaries

| Primitive | Responsibility |
| --- | --- |
| `choose<T>(options)` | Arrow/Enter navigation; returns `{ kind: "selected", value: T }`, `{ kind: "back" }`, or `{ kind: "complete" }`. Prints the selected label as the start of its output section. |
| `task<T>({ title, loading, run, render, signal })` | Shows a temporary progress header, runs domain work once, then commits its formatted result and separator. Prints failures and rethrows the original error. |
| `write({ title, lines })` | Appends a complete named result and its closing separator. |
| `append(lines)` / `finish()` | Builds a section incrementally; closes it when finished. |
| `wait(title, work, signal)` | Lower-level temporary progress for adapters that render results themselves with `write` or `choose`. It does not commit a result or swallow failures. |

`choose` accepts an optional `section: () => ({ title, lines, pending })` for
live observations above the menu. A pending section animates its header. When
the operator chooses, the latest snapshot is committed in full, followed by its
separator, then the selected action. `complete: () => boolean` can end a waiting
screen automatically without inventing a user choice.

For a passive progress screen, set `observe: true` with exactly one choice (for
example “Actions”), a live `section`, and an optional `complete` callback. The
renderer gives the section more room and shows only the Enter/Escape footer;
it does not display an arrow menu. Enter explicitly selects the action, Escape
returns Back, and automatic completion commits the final section without
printing a selected action. The caller owns polling and completion criteria.

Choices can also come from a callback. Each has a stable, unique `id`, a label,
and an arbitrary typed value. Updating labels or reordering choices preserves the
highlighted ID. If the selected choice disappears, selection moves to the first
remaining choice. Keep destructive choices static and require your own explicit
confirmation. The renderer never invokes an action from a label or string.

`onHighlight(choice)` reports the initial and subsequent highlighted choices.
Save its ID and pass it back as `initial` to restore a menu after cancelling a
navigation or exit confirmation. The caller owns the confirmation and exit policy.

The application owns routing, Back/Home destinations, data access, confirmations,
retries, authorization, persistence, and success criteria. Nothing in the library
knows about repositories, deployments, environments, or what a successful action
means. `packages/ops/src/prompts.ts` is an example domain adapter.

## Constraints

- One active prompt or task per instance, and one owner of a terminal. Await each
  operation. Concurrent writes to the same terminal would corrupt its active
  frame; the instance rejects overlapping operations with `BUSY`.
- Content is plain text, supplied as lines. Multiline committed output is
  supported. ANSI/control sequences in content are stripped. Use `sanitize` in
  the constructor for domain-specific secret redaction; the library does not know
  which strings are secrets.
- The visible frame fits the terminal; long lines and large live summaries may
  be abbreviated. The full result is retained when the section is committed.
  At most eight choices are visible at once; arrows, Home, and End reach the rest.
  A normal 80×24 terminal is recommended. Very small terminals prioritize choices.
  Unicode width depends on the terminal; ambiguous-width characters assume a
  Western-width terminal.
- Snapshot callbacks must be fast, synchronous, and free of side effects. Do
  asynchronous work outside them and replace their backing data when it arrives.
- Selection requires a TTY and rejects noninteractive use promptly. `write` and
  `task` also support plain output. Applications decide their piped/JSON behavior.
- Ctrl-C, Ctrl-D, EOF and SIGTERM interrupt interaction. Escape returns Back when
  enabled, otherwise interrupts. Input mode, listeners, timers and cursor visibility
  are restored. `PaperRollError.code` distinguishes interruption, invalid choices,
  noninteractive use, and overlapping operations.
- A task receives an AbortSignal and returns promptly on interruption even if its
  work ignores that signal. This does **not** undo remote work. The application
  must honor cancellation where appropriate and explain how to reconnect.
- Text entry and external programs are caller-owned. Invoke them after an awaited
  selection, while no frame is active; the terminal is no longer in raw mode.
- Source exports are TypeScript. Bun can import them directly; Node consumers
  should use their normal TypeScript compiler or bundler. No Bun APIs are used by
  the library itself. No fullscreen/alternate-screen mode is used.

## Development

```sh
bun run --cwd packages/paper-roll test
bun run --cwd packages/paper-roll typecheck
bun run --cwd packages/paper-roll lint
```

The ops test command also includes this package's transcript and interaction tests.
