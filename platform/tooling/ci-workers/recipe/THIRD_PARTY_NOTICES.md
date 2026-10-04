`seccomp.json` is the Playwright Docker seccomp profile from Microsoft Playwright
v1.63.0, distributed under Apache License 2.0. The upstream license and notice
are included as `PLAYWRIGHT-LICENSE` and `PLAYWRIGHT-NOTICE`.

Modification: the shipped profile adds `chroot` to the syscall allowlist for
Chromium's unprivileged user-namespace sandbox.

Source: https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json
