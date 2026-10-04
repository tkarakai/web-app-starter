import * as fs from "node:fs";
import * as path from "node:path";

/** Open first, then verify containment and identity before any reads or writes. */
export function openMigrationFile(root: string, relative: string, check: boolean): number | undefined {
  const file = path.join(root, relative);
  let fd: number;
  try {
    fd = fs.openSync(file, (check ? fs.constants.O_RDONLY : fs.constants.O_RDWR) | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const opened = fs.fstatSync(fd);
    const resolved = fs.realpathSync(file);
    if (!opened.isFile() || !resolved.startsWith(fs.realpathSync(root) + path.sep)) {
      throw Error("Migration target must be a regular file inside the app root");
    }
    const current = fs.statSync(resolved);
    if (current.dev !== opened.dev || current.ino !== opened.ino) {
      throw Error("Migration target changed while opening");
    }
    return fd;
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}
