# E2E Tests Directory

This directory contains Playwright end-to-end tests for the application.

## Test Files

| File | Purpose | Tag |
|------|---------|-----|
| `example.spec.ts` | Core functionality tests (navigation, content, errors) | - |
| `visual.spec.ts` | Visual regression tests (screenshot comparison) | `@visual` |
| `a11y.spec.ts` | Accessibility tests (axe-core validation) | `@a11y` |

## Running Tests

```bash
# Run all E2E tests
bun run test:e2e

# Run with interactive UI
bun run test:e2e:ui

# Run specific test file
bunx playwright test e2e/visual.spec.ts

# Run tests by tag
bunx playwright test --grep @visual
bunx playwright test --grep @a11y

# List all available tests
bunx playwright test --list
```

## Visual Regression Testing

Visual regression tests capture screenshots and compare them against baseline images to detect unintended UI changes.

### Configuration

Baselines are stored at: `e2e/__screenshots__/{browser}/{testFile}/{snapshotName}.png`

Key settings in `playwright.config.ts`:
- `updateSnapshots: "missing"` - Auto-creates new baselines, fails on differences
- `maxDiffPixelRatio: 0.01` - Allows 1% pixel difference (for anti-aliasing)
- `threshold: 0.2` - Color difference tolerance

### Updating Baselines When UI Changes

When you make intentional UI changes, visual tests will fail. Here's the process to update baselines:

#### Step 1: Run Tests Locally (Tests Will Fail)

```bash
bun run test:e2e
```

Tests fail because the new UI doesn't match existing baselines.

#### Step 2: Review the Diff

Playwright generates a comparison report with three images for each failure:
- **Expected** (current baseline)
- **Actual** (new screenshot)
- **Diff** (highlighted differences)

```bash
# Open the HTML report with visual diffs
bunx playwright show-report
```

#### Step 3: Update Baselines (After Confirming Changes Are Correct)

```bash
# Update ALL baselines
bunx playwright test --update-snapshots

# Or update specific test file only
bunx playwright test e2e/visual.spec.ts --update-snapshots

# Or update a single test by name
bunx playwright test -g "homepage - desktop view" --update-snapshots
```

#### Step 4: Review Updated Baselines

```bash
# See which files changed
git status

# Review the actual images (open in image viewer)
ls e2e/__screenshots__/chromium/visual.spec.ts/
```

#### Step 5: Commit the New Baselines

```bash
git add e2e/__screenshots__/
git commit -m "chore: update visual baselines for hero redesign"
```

### CI Workflow for Visual Regression

When a PR introduces visual changes:

```
Developer pushes PR
        |
        v
CI runs visual tests
        |
        v
Tests fail (expected)
        |
        v
CI uploads snapshots as artifacts
        |
        v
Reviewer downloads artifacts to compare
        |
        v
If changes are intentional:
   - Developer runs --update-snapshots locally
   - Commits new baselines
   - Pushes update
        |
        v
CI passes
```

### Commands Reference

| Task | Command |
|------|---------|
| Run visual tests | `bun run test:e2e` |
| View failure report | `bunx playwright show-report` |
| Update all baselines | `bunx playwright test --update-snapshots` |
| Update specific file | `bunx playwright test e2e/visual.spec.ts --update-snapshots` |
| Update single test | `bunx playwright test -g "test name" --update-snapshots` |
| List visual tests | `bunx playwright test --list --grep @visual` |

### Best Practices

1. **Always review diffs before updating** - Don't blindly run `--update-snapshots`

2. **Commit baselines with the code change** - Keep them in sync in the same PR

3. **Use descriptive commit messages** - Explain why baselines changed

4. **Consider masking dynamic content** - For timestamps, avatars, etc:
   ```typescript
   await expect(page).toHaveScreenshot("dashboard.png", {
     mask: [page.locator(".timestamp"), page.locator(".user-avatar")],
   });
   ```

5. **Run on consistent environment** - Fonts and rendering can differ between OS. CI uses Linux, so if you're on Mac, small differences may occur.

### Handling Cross-Platform Differences

If developers on Mac see different screenshots than CI (Linux):

**Option A:** Only update baselines from CI artifacts
```bash
# Download visual-snapshots artifact from CI
# Extract to e2e/__screenshots__/
# Commit
```

**Option B:** Use Docker for consistent rendering
```bash
docker run --rm -v $(pwd):/work -w /work mcr.microsoft.com/playwright:v1.40.0-jammy \
  npx playwright test --update-snapshots
```

## Accessibility Testing

Accessibility tests use [axe-core](https://github.com/dequelabs/axe-core) via `@axe-core/playwright` to automatically detect WCAG violations.

### What's Tested

- Color contrast ratios
- Missing alt text on images
- Missing form labels
- Keyboard navigation
- ARIA attributes
- Heading hierarchy

### Running Accessibility Tests

```bash
# Run only accessibility tests
bunx playwright test --grep @a11y

# Run with verbose output
bunx playwright test --grep @a11y --reporter=list
```

### Fixing Violations

When tests fail, the output includes:
- Rule ID (e.g., `color-contrast`)
- Impact level (critical, serious, moderate, minor)
- Affected elements
- How to fix

Example output:
```
color-contrast (serious): Elements must have sufficient color contrast
  Fix: Ensure the contrast ratio between foreground and background colors meets WCAG 2 AA requirements
  Affected: .hero-text, .nav-link
```

## Tooling Requirements

**Local development:**
```bash
# Install Playwright browsers (if not already installed)
npx playwright install chromium

# For all browsers (optional)
npx playwright install
```

**Dependencies (already in package.json):**
- `@playwright/test` - Test framework with screenshot comparison
- `@axe-core/playwright` - Accessibility testing

## Directory Structure

```
e2e/
├── README.md              # This file
├── example.spec.ts        # Core E2E tests
├── visual.spec.ts         # Visual regression tests
├── a11y.spec.ts           # Accessibility tests
└── __screenshots__/       # Visual regression baselines (git-tracked)
    └── chromium/
        └── visual.spec.ts/
            ├── homepage-desktop.png
            ├── homepage-mobile.png
            └── ...
```

## Debugging Failed Tests

### View Test Report
```bash
bunx playwright show-report
```

### Run in Debug Mode
```bash
bunx playwright test --debug
```

### Run in UI Mode (Interactive)
```bash
bun run test:e2e:ui
```

### View Traces
When tests fail on CI, traces are collected. Download the `playwright-report` artifact and:
```bash
bunx playwright show-trace path/to/trace.zip
```
