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

## What's implemented

- **3D viewport** (Three.js / React Three Fiber) with drag-to-orbit,
  scroll-to-zoom, right-drag-to-pan, and a manual + preset camera rig
  (Tilt X/Y, Roll, FOV, Zoom, Pan X/Y, Rotate X/Y).
- **Device library**: phones, tablets, laptops, monitors, a watch, browser
  frames, and a flat card — procedurally modeled, with color variants,
  orientation, and multi-device scenes (row/fan/stack arrange).
- **Backgrounds**: solid, linear/radial gradient, procedural mesh gradient,
  image, or transparent — plus HDRI-style key/fill/rim lighting controls.
- **Depth of field & effects**: lens blur, tilt-shift, bloom, grain, vignette,
  chromatic aberration.
- **Always-on animation timeline**: keyframe any camera or device property,
  per-keyframe easing, animation presets (orbit, push-in, fly-in, parallax…),
  loop-friendly helper.
- **Text / logo / shape overlays**, composited at full export resolution.
- **Export**: PNG/JPG/WEBP stills and MP4/WebM video, rendered offline
  frame-by-frame via WebCodecs + Mediabunny for deterministic, constant-FPS
  output — with a progress dialog and cancel.
- **Templates**, social/App-Store size presets, project autosave to
  IndexedDB, undo/redo, and project import/export as `.mockup.json`.
- A stubbed Free/Pro gate (watermark, resolution/duration caps) — no real
  billing is wired up.

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
