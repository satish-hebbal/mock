# Mockup Studio

A browser-based, cinematic 3D device mockup & motion tool — turn a screenshot or
screen recording into a photoreal still or an animated promo video, entirely
client-side. See [`Mockup-Studio-PRD.md`](Mockup-Studio-PRD.md) for the full
product spec this build implements.

## Run it

```bash
cd app
npm install   # first time only
npm run dev
```

Open the printed local URL (usually http://localhost:5173).

## Two editors, one app

A **mode switch** in the top bar toggles between:

- **3D Studio** — the cinematic, camera-driven 3D mockup + motion tool (below).
- **Shots** — a fast, flat **2D mockup editor** (shots.so-class): drop a
  screenshot onto a curated wallpaper/gradient/mesh background, add padding
  (balance), rounded corners, a window frame (macOS / browser, light + dark),
  soft/colored shadow, glow, border, reflection, and a pseudo-3D tilt — then
  export a crisp PNG/JPG/WEBP. The live preview uses CSS transforms; export
  renders to canvas with a **perspective-warp** so the tilted result matches the
  preview. Its own document autosaves to IndexedDB and has undo/redo.

## What's implemented

- **3D viewport** (Three.js / React Three Fiber) with drag-to-orbit,
  scroll-to-zoom, right-drag-to-pan, and a manual + preset camera rig
  (Tilt X/Y, Roll, FOV, Zoom, Pan X/Y, Rotate X/Y).
- **Device library**: phones (incl. prior-gen + Pixel), tablets (incl. Android),
  laptops (incl. Windows), iMac / monitors, a 16:9 TV, two watches (square +
  round), browser frames, and a flat card — procedurally modeled, with color
  variants, orientation, and multi-device scenes (row/fan/stack arrange). Plus a
  "request a device" capture for anything missing.
- **Backgrounds**: solid, linear/radial gradient, procedural mesh gradient,
  image, or transparent — plus HDRI-style key/fill/rim lighting controls.
- **Depth of field & effects**: lens blur, tilt-shift, bloom, grain, vignette,
  chromatic aberration, and a **color grade** (exposure / contrast / saturation /
  temperature) applied with preview↔export parity.
- **Always-on animation timeline**: keyframe any camera or device property,
  per-keyframe easing, animation presets (orbit, push-in, fly-in, parallax…),
  loop-friendly helper, and optional **export-time motion blur**.
- **Media import**: click-to-upload, drag & drop, paste, or **from a URL**.
- **Text / logo / shape overlays** with a curated set of **Google Fonts**,
  composited at full export resolution.
- **Export**: PNG/JPG/WEBP stills, MP4/WebM video, and **batch export** (one
  scene across several social sizes at once) — video rendered offline
  frame-by-frame via WebCodecs + Mediabunny for deterministic, constant-FPS
  output, with a progress dialog and cancel.
- **Templates**, social/App-Store size presets, project autosave to
  IndexedDB, undo/redo, and project import/export as `.mockup.json`.
- **PWA-installable** with an offline app-shell service worker, keyboard-
  accessible controls (`aria-*` on sliders/toggles), and light/dark editor theme.
- A stubbed Free/Pro gate (watermark, resolution/duration caps) — no real
  billing is wired up.

### Still deferred (vs. the PRD)

- **Multi-shot sequences** — cutting/crossfading between different
  scenes/sources in one video (a large data-model change; the engine renders a
  single scene today).
- **True HDRI environment maps** — lighting is a fake key/fill/rim rig, not
  image-based reflections.
- **GIF export** and **real accounts/billing** (Stripe + OAuth) — the Pro gate
  is a local demo toggle.

## Project layout

```
app/                     Vite + React + TypeScript app
  src/
    components/          Viewport, DeviceMesh, Inspector, Timeline, dialogs…
    lib/                 keyframe evaluator, runtime bridge, export engine,
                          device registry, presets, mesh-gradient generator
    store.ts              Zustand store (project state, undo/redo, persistence)
    types.ts              Project document schema
```
