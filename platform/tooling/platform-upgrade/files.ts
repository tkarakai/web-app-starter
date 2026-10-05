import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { canonical, demand, digest, hasControl, safeRelative } from "./metadata.ts";
import { git, gitText } from "./git.ts";
import { workingFiles, type Payload, type Planned } from "./plan.ts";
import { reportAppRoot, decisionFor, type Report } from "./report.ts";

function stat(file: string): fs.Stats | undefined { try { return fs.lstatSync(file); } catch (error) { if ((error as { code?: string }).code === "ENOENT") return undefined; throw error; } }
export function changedFiles(before: Record<string, string>, after: Record<string, string>): string[] { return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]).sort(); }
export function payloadHash(payload: Payload): string | undefined { return "remove" in payload ? undefined : payload.mode + ":" + digest(payload.content); }
function expectedPayload(current: string | undefined, payload: Payload): boolean { return "remove" in payload ? current === undefined || current === "deleted" : current === payloadHash(payload); }
/** No source byte is written until every destination and ancestor has been audited. */
export function preflight(root: string, payloads: Payload[]): void {
  const removed = new Set(payloads.filter(row => "remove" in row).map(row => row.path));
  const destinations = new Set<string>();
  for (const payload of payloads) {
    safeRelative(payload.path); demand(payload.path.toLowerCase() !== ".platform-base.json", "Only record may update the installed baseline");
    const folded = payload.path.normalize("NFC").toLowerCase(); demand(!destinations.has(folded), "Duplicate/colliding write destination: " + payload.path); destinations.add(folded);
    const parts = payload.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/"), existing = stat(path.join(root, parent));
      demand(!existing || existing.isDirectory() || removed.has(parent), "Destination traverses a file or symlink: " + parent);
    }
    const destination = path.join(root, payload.path), current = stat(destination);
    if (current?.isDirectory()) {
      const inspect = (directory: string): void => {
        for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
          const file = directory + "/" + item.name;
          if (item.isDirectory()) inspect(file);
          else demand(removed.has(file), "File/directory collision would remove unplanned content: " + file);
        }
      };
      inspect(payload.path);
    }
    if (!("remove" in payload) && payload.mode === "120000") {
      const target = payload.content.toString("utf8");
      demand(!path.posix.isAbsolute(target) && !/[\\:]/.test(target) && !hasControl(target), "Unsupported link destination");
      let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(payload.path), target)); const seen = new Set([payload.path]);
      for (;;) {
        safeRelative(resolved); demand(!seen.has(resolved), "Destination link cycle: " + payload.path); seen.add(resolved);
        const parents = resolved.split("/");
        for (let i = 1; i < parents.length; i++) {
          const parent = parents.slice(0, i).join("/"), planned = payloads.find(row => row.path === parent);
          demand(planned ? "remove" in planned : !stat(path.join(root, parent))?.isSymbolicLink(), "Link target traverses a linked directory: " + parent);
        }
        const planned = payloads.find(row => row.path === resolved);
        const link = planned ? !("remove" in planned) && planned.mode === "120000" ? planned.content.toString("utf8") : undefined : stat(path.join(root, resolved))?.isSymbolicLink() ? fs.readlinkSync(path.join(root, resolved)) : undefined;
        if (link === undefined) break;
        demand(!path.posix.isAbsolute(link) && !/[\\:]/.test(link) && !hasControl(link), "Unsafe destination link chain");
        resolved = path.posix.normalize(path.posix.join(path.posix.dirname(resolved), link));
      }
    }
  }
}
function removeEmpty(directory: string): void {
  if (!stat(directory)?.isDirectory()) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) removeEmpty(path.join(directory, entry.name));
  demand(fs.readdirSync(directory).length === 0, "Directory still contains unplanned files: " + directory);
  fs.rmdirSync(directory);
}
export function materializePayloads(root: string, payloads: Payload[]): void {
  preflight(root, payloads);
  // Remove leaves before directories can become regular files (or vice versa).
  for (const payload of payloads.filter(row => "remove" in row).sort((a, b) => b.path.length - a.path.length)) {
    const destination = path.join(root, payload.path), existing = stat(destination);
    if (existing?.isDirectory()) removeEmpty(destination); else if (existing) fs.unlinkSync(destination);
  }
  for (const payload of payloads) {
    if ("remove" in payload) continue;
    const destination = path.join(root, payload.path), existing = stat(destination);
    if (existing?.isDirectory()) removeEmpty(destination); else if (existing?.isSymbolicLink()) fs.unlinkSync(destination);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (payload.mode === "120000") {
      if (stat(destination)) fs.unlinkSync(destination);
      fs.symlinkSync(payload.content.toString("utf8"), destination);
    } else {
      const temporaryRoot = path.resolve(root, gitText(root, ["rev-parse", "--git-path", "platform-upgrade-writes"]));
      fs.mkdirSync(temporaryRoot, { recursive: true });
      const temporaryDirectory = fs.mkdtempSync(path.join(temporaryRoot, "write-"));
      const temporary = path.join(temporaryDirectory, "content");
      const fd = fs.openSync(temporary, "wx", payload.mode === "100755" ? 0o755 : 0o644);
      try { fs.writeFileSync(fd, payload.content); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, destination);
      fs.chmodSync(destination, payload.mode === "100755" ? 0o755 : 0o644);
      fs.rmdirSync(temporaryDirectory);
    }
  }
}
export function stage(root: string, files: string[], temporaryDirectory: string): void {
  const indexed = new Set(git(root, ["ls-files", "-z"]).toString("utf8").split("\0"));
  const selected = [...new Set(files)].filter(file => stat(path.join(root, file)) || indexed.has(file));
  if (!selected.length) return;
  const list = path.join(temporaryDirectory, "stage-paths-" + process.pid);
  fs.writeFileSync(list, selected.map(file => safeRelative(file) + "\0").join(""), { flag: "wx", mode: 0o600 });
  try { git(root, ["--literal-pathspecs", "add", "--all", "--pathspec-from-file=" + list, "--pathspec-file-nul"]); }
  finally { fs.unlinkSync(list); }
}
export function ensureUpdateBranch(root: string, target: string): string {
  const branch = "platform-update/v" + target, current = gitText(root, ["branch", "--show-current"]);
  if (current === branch) return branch;
  // An existing branch is never moved, reset, or silently reused.
  let exists = false; try { gitText(root, ["show-ref", "--verify", "refs/heads/" + branch]); exists = true; } catch { /* Absent branch is expected. */ }
  demand(!exists, "Update branch already exists; resume it: " + branch);
  git(root, ["switch", "--quiet", "-c", branch]); return branch;
}
/** Permit only byte-exact interrupted writes before repeating the apply step. */
export function assertBeforeApply(report: Report, planned: Planned, excluded: string[]): void {
  const root = reportAppRoot(report);
  const head = gitText(root, ["rev-parse", "HEAD"]);
  if (head !== report.plan.app.head) {
    demand(spawnSync("git", ["merge-base", "--is-ancestor", report.plan.app.head, head], { cwd: root }).status === 0, "App HEAD changed before apply; create a new plan");
    const committed = git(root, ["diff", "--name-only", "-z", report.plan.app.head, head]).toString("utf8").split("\0").filter(Boolean);
    demand(committed.every(file => excluded.includes(file)), "App source changed before apply; create a new plan");
  }
  const indexed = git(root, ["diff", "--cached", "--name-only", "-z", "HEAD"]).toString("utf8").split("\0").filter(Boolean);
  demand(indexed.every(file => excluded.includes(file) || planned.payloads.some(row => row.path === file)), "Unexpected staged edit before apply; preserve the index and create a new plan");
  demand(digest(fs.readFileSync(path.join(root, ".platform-base.json"))) === report.plan.previousBaseHash, "Installed baseline changed before apply");
  const current = workingFiles(root, excluded);
  if (digest(canonical(current)) === report.plan.app.fingerprint) return;
  for (const file of changedFiles(report.state.expectedFiles, current)) {
    const payload = planned.payloads.find(row => row.path === file);
    demand(payload && expectedPayload(current[file], payload), "Unexpected edit before apply: " + file);
  }
}
/** Manual conflict/patch/env/dependency resolutions are scoped to the plan's named files. */
export function acceptReviewedEdits(report: Report, excluded: string[]): string[] {
  const root = reportAppRoot(report);
  demand(digest(fs.readFileSync(path.join(root, ".platform-base.json"))) === report.plan.previousBaseHash, "Installed baseline changed during the pending upgrade");
  const allowed = new Set(report.plan.gates.flatMap(gate => {
    const decision = decisionFor(report, gate);
    if (!decision || decision.action === "accept-release") return [];
    return gate.files;
  }));
  const current = workingFiles(root, excluded), changed = changedFiles(report.state.expectedFiles, current);
  const auditFailed = report.state.steps.some(step => step.id === "verify:check:dependencies" && step.status === "failed");
  for (const file of changed) demand(allowed.has(file) || (file === "bun.lock" && auditFailed), "Unexpected edit during upgrade: " + file + ". Preserve your work and create a new plan if its scope changed.");
  const unstaged = git(root, ["diff", "--name-only", "-z"]).toString("utf8").split("\0").filter(file => file && !excluded.includes(file));
  const audited = new Set([...report.plan.changes.map(row => row.path), ...report.state.steps.flatMap(row => row.changedFiles), ...allowed, ...(auditFailed ? ["bun.lock"] : [])]);
  for (const file of unstaged) demand(audited.has(file), "Unexpected index/worktree difference: " + file);
  report.state.expectedFiles = current; return [...new Set([...changed, ...unstaged])];
}
