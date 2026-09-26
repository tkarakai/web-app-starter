import { readdir } from "node:fs/promises";
import { PaperRoll, PaperRollError } from "../src/index";

// No ops imports, credentials, configuration or network calls.
const roll = new PaperRoll();
try {
  let files = await roll.task({ title: "Working directory", loading: "Reading directory…",
    run: () => readdir(process.cwd()), render: files => [`${process.cwd()}`, `${files.length} entries`] });
  for (;;) {
    const choice = await roll.choose({ prompt: "What would you like to do?", back: true, choices: [
      { id: "list", label: "List entries", value: "list" },
      { id: "refresh", label: "Read directory again", value: "refresh" },
      { id: "quit", label: "Quit", value: "quit" },
    ] });
    if (choice.kind !== "selected" || choice.value === "quit") break;
    if (choice.value === "refresh") files = await roll.task({ title: "Working directory", loading: "Reading directory…",
      run: () => readdir(process.cwd()), render: files => [`${files.length} entries`] });
    else roll.write({ title: "Directory entries", lines: files });
  }
  roll.append(["Finished."]); roll.finish();
} catch (error) {
  if (!(error instanceof PaperRollError && error.code === "INTERRUPTED")) throw error;
  process.exitCode = 130;
} finally { process.stdin.pause(); }
