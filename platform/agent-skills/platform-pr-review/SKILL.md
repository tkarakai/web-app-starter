---
name: platform-pr-review
description: Use to review a pull request and post review comments, security first, with no summaries or praise. Takes a PR number, or the current branch's PR.
---

# Review a pull request

Review the pull request the user named (a PR number), or the current branch's PR if they named
none (`gh pr view --json number`). Add comments where they are warranted, inline where that makes
sense.

## Rules

- Do not summarize the change. Do not praise anything that is good. No small talk.
- Focus only on what needs to change.
- If there are no issues, add a thumbs-up reaction to the PR and post no comment
  (`gh api repos/{owner}/{repo}/issues/<n>/reactions -f content=+1`).
- Never approve. Comment or react only.
- If review comments already exist on the PR, do not duplicate them. Read them first
  (`gh pr view <n> --comments`, `gh api repos/{owner}/{repo}/pulls/<n>/comments`).
- Check the diff against `platform/AGENTS.md`: a change to anything under `platform/` in an app
  is a finding in itself, because upgrades replace that directory.

## Priority, highest first

1. Security and data safety
2. Robustness
3. Usability
4. Maintainability
5. Performance

## Posting

Post inline comments as one review with `event: "COMMENT"`:

```bash
gh api repos/{owner}/{repo}/pulls/<n>/reviews --input review.json
```

where `review.json` holds `{"event": "COMMENT", "body": "", "comments": [{"path": ..., "line": ...,
"side": "RIGHT", "body": ...}]}`. Use a top-level comment only for findings that have no line.
