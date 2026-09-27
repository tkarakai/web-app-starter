# Discover platform releases and advisories

Run `bun run platform:check-updates` from an adopted app to see the installed version,
newest allowed update, major release available for review, and advisories affecting the
installed version. It reads `.platform-base.json` and published releases without changing
app files, branches, dependencies or the installed baseline.

```sh
bun run platform:check-updates --policy patch
bun run platform:check-updates --to v2.1.3 --report update-check.json
bun run check:advisories
```

`patch` stays within the installed minor; `minor` (the default) allows the current major.
`major` still reports a new major for human review: it never automatically selects a major
for an upgrade PR. An explicit `--to` must name a published stable release and respect the
policy. Drafts, prereleases and deployment tags are ignored. Reports are schema-versioned
JSON; `target` is the allowed update and `major` is a separate review candidate. The report
file must not already exist.

The contracts CI job runs the advisory check on every PR, independently of scheduled
updates. An affected `high` or `critical` advisory fails it. `low` and `medium` advisories
produce warnings. Update to a fixed release using [the upgrade procedure](../UPGRADING.md),
then run the check again. Successful discovery itself exits zero so the update workflow can
propose a fix; the `--advisories` mode used by `check:advisories` supplies the failure status.

Advisory data comes from the most recently **published** stable release's cumulative
`advisories.json`, which may be an LTS patch below the highest available version. The report
identifies that release and the metadata digest. Unknown schema/range syntax, missing assets,
or failed network lookups fail explicitly. A source with no published releases reports
`no-releases` and cannot pass the advisory check; the unadopted product checkout reports
`not-adopted` without a network request.

The trusted source defaults to `tkarakai/web-app-starter`. `--repo OWNER/NAME` explicitly
selects another public source for a fork or rehearsal. Set the optional GitHub repository
variable `PLATFORM_SOURCE_REPOSITORY` to use that source in contracts CI too. Only the repository identifier goes
to GitHub; app source and local environment values are not uploaded. `GH_TOKEN` (or
`GITHUB_TOKEN`) is optional for API rate limits and sent only to `api.github.com`, never the
release download URL. Use a read-only token; release discovery does not need write access.
