#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, requireThat } from "./upgrade.ts";
export const DOCUMENTS = ["AGENTS.md", "UPGRADING.md", "VERSIONING.md", "CHANGELOG.md", "docs/starter-upgrades.md", "docs/starter-versioning-strategy.md", "docs/claude/ci.md", "apps/demo/README.md", "apps/demo/qa/fixtures/starter-releases/README.md", "packages/starter-sidebar-policy/README.md"];
function anchors(text: string): string[] {
  return [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => m[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-"));
}
export function checkDocs(root = ROOT): void {
  for (const document of DOCUMENTS) {
    const content = fs.readFileSync(path.join(root, document), "utf8").replace(/```[^]*?```/g, "");
    for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const url = match[1]; if (/^[a-z]+:/i.test(url)) continue;
      const [relative, anchor] = url.split("#");
      const target = relative ? path.resolve(root, path.dirname(document), relative) : path.join(root, document);
      requireThat(fs.existsSync(target), `Broken documentation link: ${document} -> ${url}`);
      if (anchor && target.endsWith(".md")) requireThat(anchors(fs.readFileSync(target, "utf8")).includes(anchor), `Broken documentation anchor: ${document} -> ${url}`);
    }
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) { checkDocs(); process.stdout.write("Starter documentation links verified\n"); }
