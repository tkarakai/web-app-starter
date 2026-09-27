import * as fs from "node:fs";
import * as path from "node:path";
import { gitText } from "./git.ts";
import { demand } from "./metadata.ts";

/** Inspect and read the same open regular file; never follow a replacement symlink. */
export function readRegular(file: string, maximum = 128 * 1024 * 1024): { content: Buffer; stat: fs.Stats } {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd); demand(stat.isFile() && stat.size <= maximum, "Invalid or oversized regular file: " + file);
    const content = fs.readFileSync(fd); demand(content.length <= maximum, "File grew beyond its allowed size: " + file);
    return { content, stat };
  } finally { fs.closeSync(fd); }
}
/** Atomic replacement also avoids following a destination symlink during baseline recovery. */
export function writeAtomic(file: string, content: string): void {
  const root = path.dirname(file), directory = path.resolve(root, gitText(root, ["rev-parse", "--git-path", "platform-upgrade-writes"]));
  fs.mkdirSync(directory, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(directory, "record-"));
  try {
    const from = path.join(temporary, "content"); fs.writeFileSync(from, content, { flag: "wx", mode: 0o600 }); fs.renameSync(from, file);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
