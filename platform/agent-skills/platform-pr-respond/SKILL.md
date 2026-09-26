---
name: platform-pr-respond
description: Use to address the open review comments on a pull request - fix what needs fixing, push, and reply in each comment's thread. Takes a PR number, or the current branch's PR.
---

# Respond to review comments

Run this in a separate worktree with a clean context.

Address every open review comment on the pull request the user named (a PR number), or the
current branch's PR if they named none. For each comment:

1. **Decide** whether it needs a code change. The PR author's own replies to the reviewer may
   already be posted; read them first and treat them as the decision.
2. **Change** the code if it needs one. Commit separately per comment, or per coherent group of
   comments. Follow `platform/AGENTS.md`; never edit anything under `platform/` to satisfy a
   comment.
3. **Push.** Ordinary commits only: no rebase, no force-push.
4. **Reply** in that comment's own GitHub thread with the fix that was made (if any) and a short
   explanation of why:

   ```bash
   gh api repos/{owner}/{repo}/pulls/<n>/comments/<comment-id>/replies -f body='...'
   ```

Find the comments with `gh api repos/{owner}/{repo}/pulls/<n>/comments` (inline) and
`gh pr view <n> --comments` (conversation). Skip threads that are resolved or already answered.

When done, tell the user what landed and what was declined, and remind them to pull on the
original worktree, because the branch has moved.
