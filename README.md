# Pretext playground

This repo is an **example of using [PreText](https://github.com/chenglou/pretext)** (`@chenglou/pretext` by Chen Lou): a library for **multiline text measurement and layout in JavaScript/TypeScript** without relying on DOM sizing (no `getBoundingClientRect`-style reflow). You **prepare** text once (segmentation, font-accurate widths), then **layout** with pure arithmetic—line breaks, line lists, and heights you can drive yourself in canvas, DOM, or other renderers.

The demo here applies that to something playful: an animated GIF is sampled into a grid, and lyrics flow through the dark and light regions as a “text silhouette.”

**Demo:** [Twitter / X](https://twitter.com/okovaliukk/status/2038241694701834416)

## Run

```bash
bun install
bun run dev
```

Open http://localhost:3000
