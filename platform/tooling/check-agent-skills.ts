// Verify the platform Agent Skills and the links agents discover them through.
// Usage: ./platform/tooling/node-ts.sh platform/tooling/check-agent-skills.ts [ROOT]
//
// Skills live once, in platform/agent-skills/<name>/SKILL.md, and are linked as
// .claude/skills/<name> (Claude Code) and .agents/skills/<name> (Codex), each a relative
// symlink to ../../platform/agent-skills/<name>. Every skill name starts with "platform-".
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const skillsDir = "platform/agent-skills";
export const linkDirs = [".claude/skills", ".agents/skills"] as const;
const prefix = "platform-";
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type Frontmatter = Record<string, string>;

// Parses the YAML frontmatter of a SKILL.md: single-line `key: value` pairs between two `---`
// lines. Values may be quoted. Nested or multi-line values are reported as errors by the caller.
export function parseFrontmatter(text: string): Frontmatter | string {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return "must start with a '---' frontmatter line";
  const end = lines.indexOf("---", 1);
  if (end === -1) return "frontmatter is not closed with a '---' line";
  const fields: Frontmatter = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!match) return `unsupported frontmatter line: "${line}" (use single-line key: value pairs)`;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[match[1]] = value;
  }
  if (lines.slice(end + 1).join("\n").trim() === "") return "has no instructions after the frontmatter";
  return fields;
}

function checkSkill(root: string, name: string): string[] {
  const errors: string[] = [];
  const where = `${skillsDir}/${name}`;
  if (!name.startsWith(prefix)) errors.push(`${where}: folder name must start with "${prefix}"`);
  if (!namePattern.test(name) || name.length > 64) {
    errors.push(`${where}: folder name must be 1-64 lowercase letters, digits and single hyphens`);
  }
  const file = path.join(root, where, "SKILL.md");
  if (!existsSync(file)) return [...errors, `${where}: SKILL.md is missing`];
  const parsed = parseFrontmatter(readFileSync(file, "utf8"));
  if (typeof parsed === "string") return [...errors, `${where}/SKILL.md: ${parsed}`];
  if (parsed.name !== name) {
    errors.push(`${where}/SKILL.md: frontmatter name is "${parsed.name ?? ""}", expected "${name}"`);
  }
  const description = parsed.description ?? "";
  if (description === "") errors.push(`${where}/SKILL.md: frontmatter description is missing`);
  if (description.length > 1024) errors.push(`${where}/SKILL.md: description is longer than 1024 characters`);
  return errors;
}

function isSymlink(file: string): boolean {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

function checkLinks(root: string, skills: string[]): string[] {
  const errors: string[] = [];
  for (const dir of linkDirs) {
    const abs = path.join(root, dir);
    for (const name of skills) {
      const link = path.join(abs, name);
      const expected = `../../${skillsDir}/${name}`;
      if (!isSymlink(link)) {
        errors.push(`${dir}/${name}: missing; link it with: ln -s ${expected} ${dir}/${name}`);
        continue;
      }
      const target = readlinkSync(link);
      if (target !== expected) errors.push(`${dir}/${name}: points to "${target}", expected "${expected}"`);
    }
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) {
      const link = path.join(abs, entry);
      if (!isSymlink(link)) continue;
      let resolves: boolean;
      try {
        resolves = statSync(link).isDirectory() && existsSync(path.join(link, "SKILL.md"));
      } catch {
        resolves = false;
      }
      if (!resolves) errors.push(`${dir}/${entry}: link does not resolve to a skill folder with SKILL.md`);
      else if (entry.startsWith(prefix) && !skills.includes(entry)) {
        errors.push(`${dir}/${entry}: no matching skill in ${skillsDir}/`);
      }
    }
  }
  return errors;
}

export function checkAgentSkills(root: string): string[] {
  const dir = path.join(root, skillsDir);
  if (!existsSync(dir)) return [`${skillsDir}/ is missing`];
  const skills = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (skills.length === 0) return [`${skillsDir}/ holds no skills`];
  return [...skills.flatMap((name) => checkSkill(root, name)), ...checkLinks(root, skills)];
}

export function main(args: string[]): number {
  const root = path.resolve(args[0] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."));
  const errors = checkAgentSkills(root);
  if (errors.length === 0) {
    process.stdout.write("Agent skills and their links are consistent.\n");
    return 0;
  }
  process.stderr.write(`Agent skill problems:\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
  return 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
