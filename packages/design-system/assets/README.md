# Shared Assets

This directory contains the starter's shared branding assets.

## App Icon

The SVG is the single source of truth for the shared brand icon assets.

| File | Format | Size | Purpose |
|------|--------|------|---------|
| `icon.svg` | SVG | 32×32 | Primary favicon (modern browsers) |
| `favicon.ico` | ICO | 32×32 | Legacy browser fallback |
| `apple-touch-icon.png` | PNG | 180×180 | iOS home screen bookmark |

### How It Works

1. **Source:** Assets are stored here in `packages/design-system/assets/`
2. **Distribution:** During build (and before dev), `scripts/copy-shared-assets.sh` copies assets to the `public/` directories selected by its `APPS` list. The demo is excluded to preserve its application-owned branding.
3. **Usage:** Apps reference them in their Next.js metadata configuration

### Updating the Icon

1. Edit `icon.svg` (the source of truth)
2. Regenerate the raster variants from the SVG (see below)
3. Run `bun run copy-assets` (or it will run automatically on next build/dev)

To regenerate raster variants from the SVG:

```bash
# apple-touch-icon.png (180×180)
npx @resvg/resvg-js-cli --fit-width 180 icon.svg apple-touch-icon.png

# favicon.ico — generate 32×32 PNG then wrap in ICO container
npx @resvg/resvg-js-cli --fit-width 32 icon.svg /tmp/favicon-32.png
node -e "
const fs = require('fs');
const png = fs.readFileSync('/tmp/favicon-32.png');
const h = Buffer.alloc(6); h.writeUInt16LE(1,2); h.writeUInt16LE(1,4);
const d = Buffer.alloc(16); d.writeUInt8(32,0); d.writeUInt8(32,1);
d.writeUInt16LE(1,4); d.writeUInt16LE(32,6);
d.writeUInt32LE(png.length,8); d.writeUInt32LE(22,12);
fs.writeFileSync('favicon.ico', Buffer.concat([h,d,png]));
"
```

### Build Integration

The copy script runs automatically:
- **Before dev:** `bun run dev` → `predev` hook → `copy-shared-assets.sh`
- **Before build:** `bun run build` → `prebuild` hook → `copy-shared-assets.sh`

The script skips copying files that are already up to date.

### Downstream app branding

For any app in the script's `APPS` list, put application-owned icon sources in
`apps/<app>/branding/`: `icon.svg`, `favicon.ico`, and `apple-touch-icon.png`.
Commit those files. The copy script chooses each app's override first and uses
the shared asset for each missing file. Existing apps without overrides keep
their current behavior; the demo remains excluded.

For example, `apps/web/branding/icon.svg` supplies only the web app's `/icon.svg`.
Shared starter icon changes still reach other apps and any files you have not
overridden. Removing an override deliberately restores the shared asset on the
next copy. Supply all three formats for consistent branding across browsers.

Do not edit the generated icons in `public/`: they remain ignored by Git and are
replaced during build/dev. Overrides must be regular files in a real directory;
symlinks and invalid override paths fail before copying. This mechanism covers
these three icons only, not product names, page metadata, email branding or theme
tokens. Keep other application assets in the app's `public/` directory.

### Where It's Used

These app layout files reference the shared icons:
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/admin/src/app/layout.tsx`
- `apps/landing/src/app/[locale]/layout.tsx`
- `apps/landing-static/src/app/[locale]/layout.tsx`
- `apps/storybook/src/app/layout.tsx`

### Showcase

View the icons at the Storybook app:
- **Local:** http://localhost:3003/foundations/icons
- **Section:** Foundations > Icons > App Icon

## Adding More Shared Assets

1. Add the file to this directory
2. Add the filename to the `ASSETS` array in `scripts/copy-shared-assets.sh`
3. Reference it in your apps as `/filename.ext`
