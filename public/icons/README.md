# PWA Icons

Place the following PNG icons in this folder:

- `192.png` — 192×192
- `512.png` — 512×512
- `512-maskable.png` — 512×512 (safe-zone masked)
- `apple-touch-icon.png` — 180×180 (iOS)

You can generate them from a single SVG with:

```bash
npx pwa-asset-generator ./logo.svg ./public/icons \
  --background "#0b0b0c" --theme-color "#0b0b0c" --manifest ./public/manifest.webmanifest
```

Until icons are provided the manifest will still load — the OS will fall back to a default tile.
