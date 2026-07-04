# PRD — "Mockup Studio" (Ultramock-class 3D device mockup & motion tool)

> A browser-based tool that turns any screenshot, image, or screen-recording into a **cinematic 3D device mockup** — as a still image **or** an animated video. Think Apple-keynote-style renders: real depth-of-field, tilt/perspective, curated backgrounds and lighting, keyframed camera moves, exported to PNG/JPG/WEBP/MP4/WEBM entirely client-side.
>
> This document is written to be handed directly to a frontier coding model (or a build team) as the single source of truth. It defines every feature, sub-feature, the UI, the data model, the rendering/export pipeline, the device library, and the asset sources.

---

## 0. How to read this document

- **Sections 1–4** = product framing (what/why/who + competitor teardown).
- **Sections 5–7** = the build: architecture, the full feature spec, and the UI spec.
- **Sections 8–11** = the "hard parts": data model, device specs, asset sourcing, and the algorithms (screen mapping, keyframe interpolation, video export).
- **Sections 12–15** = non-functional requirements, licensing/legal, phased roadmap, open questions.

Terminology is defined in **§5.1**. When a feature is Pro-gated, it is tagged `[PRO]`.

---

## 1. Product overview

### 1.1 One-liner
Upload a screen → drop it into a photoreal 3D device → frame it with a background, lighting and depth-of-field → export a stunning still or a short animated promo video. All in the browser, no install, no server render farm.

### 1.2 Problem
Making a flat screenshot look "cinematic" today requires either (a) heavy tools (Photoshop mockup templates, Blender, After Effects) plus a photography eye, or (b) stitching several single-purpose web tools together. That is slow and gate-kept by skill. The job-to-be-done is: **"turn the screen I just built into a share-worthy visual in under a minute."**

### 1.3 Solution
A single browser workspace with a real-time WebGL 3D viewport, a library of accurate device models, curated scene/background/lighting presets, a camera-and-device keyframe timeline for motion, and a fully client-side export pipeline for both images and video.

### 1.4 Primary outputs
1. **Still image** — hero shots for landing pages, App Store / Play Store listings, Product Hunt, decks, social.
2. **Animated video** — app promo clips, "device intro" reveals, scroll/zoom showcases, social reels.
3. **Transparent exports** — PNG with alpha (stills) and WEBM with alpha channel (video) for compositing.

### 1.5 Positioning vs. category
This is the **shots.so / Ultramock / deviceframes / BrandBird / Previewed** category. Ultramock's specific angle (and ours) is **"cinematic, camera-driven, real depth-of-field, in-browser, with a motion timeline"** rather than a flat 2D frame-slapper. We aim to combine Ultramock's cinematic camera model, shots.so's breadth of devices/backgrounds/effects and one-click ease, and deviceframes/Previewed's keyframe animation depth.

---

## 2. Goals, non-goals, success metrics

### 2.1 Goals
- G1. Produce a publishable still in **< 60 seconds** from a cold start (upload → export).
- G2. Support **static and animated** mockups from the same scene (no separate "video mode" mental model — the timeline is always there).
- G3. Ship a **broad, accurate, current device library** (phones, tablets, laptops, desktops/monitors, watches, TVs, and browser/flat frames), with correct screen aspect ratios and bezels.
- G4. **100% client-side rendering and export** — no server render dependency for the core loop (keeps costs near-zero and privacy high; user media never leaves the browser unless they opt into cloud save).
- G5. Feel like a **design tool, not a form** — direct manipulation in the viewport (drag to rotate, scroll to zoom, space-drag to pan) mirrored by numeric controls.

### 2.2 Non-goals (v1)
- Not a general vector/raster editor (no freeform illustration, no Photoshop layers on the media itself).
- Not a full video editor (no multi-clip timeline editing of arbitrary footage; the "video" is a rendered camera/device animation of the scene).
- Not a collaboration/multiplayer tool in v1 (single-user projects; real-time collab is a later phase).
- No native/desktop app in v1 (PWA-installable is enough).
- No AI image generation of the UI itself in v1 (we composite the user's real screen).

### 2.3 Success metrics
- **Activation:** % of new sessions that reach a first export.
- **Time-to-first-export** (median).
- **Video adoption:** % of exports that are video vs image.
- **Return usage:** weekly active creators; projects saved per user.
- **Pro conversion:** free→Pro rate; most common gating trigger before purchase (watermark removal, 4K, video length, premium devices/backgrounds).

---

## 3. Target users & use cases

| Persona | Need | Typical output |
|---|---|---|
| Indie hacker / founder | Launch assets fast, no designer | PH gallery image, landing hero, promo reel |
| Product / UI-UX designer | Portfolio + case-study shots | Angled device stills, Dribbble shots |
| App developer | App Store / Play Store screenshots & preview video | Framed portrait shots, App Preview video |
| Marketer / growth | Ad creatives, social posts | Square/vertical stills, short reels |
| Agency / studio | Client deliverables at brand-consistent look | Templated batches |

**Key use cases**
1. Single hero still of one device, angled, blurred background.
2. Multi-device scene (phone + laptop, or 3 phones fanned).
3. App Store screenshot set (fixed frame sizes, portrait, text overlays).
4. Animated "camera fly-in" reveal of a device.
5. Screen-recording played *inside* the device screen, with a slow orbit.
6. Scroll-showcase: the screen media scrolls while the camera holds.

---

## 4. Competitive teardown (feature parity map)

We pull the union of features across the leaders and mark what's table-stakes vs. differentiator.

- **Ultramock (ultramock.io):** cinematic in-browser 3D device mockups; drag-to-rotate; **real depth-of-field** blur with styles (tilt-shift, radial, lens, directional); camera angle + FOV; **manual vs preset camera**; **keyframe timeline** ("sequences", "shots", "captures"); high-res image export; **video export (beta)**; templates; save project; free daily + one-time Pro (~$29.99). This is our closest reference — the uploaded screenshot's right-panel structure (Source, Camera Manual/Presets, Blur, Scene, 3D Devices, 3D Model, keyframable Tilt X/Tilt Y/Zoom) is the baseline UI to match/improve.
- **shots.so:** huge device breadth (iPhone incl. latest, Android, iPad, desktop, watch); one-click templates; **backgrounds** (gradients, mesh, image, solid); **effects** (noise, VHS, glitch); logo/branding; social frame presets; **animated presets + video/zoom**; pixel-perfect exports. Reference for *breadth + ease + effects library*.
- **deviceframes.com:** 3D editor in browser; positioning/scale/colour tweaks; **keyframe device animation**; upload **video** to map into a device screen; template gallery; export **PNG/JPG/WEBM/MP4 up to 4K**; DoF + lighting + environment for photoreal renders; **transparent .webm (alpha)**. Reference for *animation depth + transparent video*.
- **BrandBird 3D mockups:** photoreal 3D devices; **HDR environment lighting** + adjustable **key/fill/rim lights**; camera focal length + real DoF; gradient/mesh/solid/image backgrounds; **keyframe camera + devices on a timeline**; export animated MP4 or PNG up to 4K, **rendered fully in-browser, no servers**. Reference for *lighting model + browser-only render*.
- **Previewed.app:** hundreds of ready mockups; 3D animation scenes for app promo videos; custom camera + environment controls; tiered pricing (free single-project → one-time → subscription). Reference for *template economy + pricing tiers*.

**Table-stakes (must have):** device frames (2D + 3D), backgrounds (solid/gradient/mesh/image), shadows, DoF blur, camera angle/FOV, one-click templates, PNG/JPG export, social/app-store size presets, watermark on free.

**Differentiators to win on:** genuinely cinematic camera + DoF; a first-class **motion timeline** (multi-shot sequences, easing, presets) that is *always present*; **transparent video (alpha WEBM)**; **multi-device scenes**; **screen-recording/video-in-screen**; broad + *current* device library kept up to date; fully client-side 4K video export via WebCodecs.

---

## 5. Core concepts, architecture & tech stack

### 5.1 Domain model / glossary
- **Project** — the saved document. Contains one or more Sequences, global settings, and asset references.
- **Sequence** — a timeline. A project can have multiple sequences (e.g. "Sequence 1", "Sequence 2" in the reference UI). Each renders to one export.
- **Shot** — a segment within a sequence with its own **Source** media assignment (the reference UI shows "Captures 3/3", "Shot 1", and "+ Add Shot"). Multiple shots let a single video cut between different screens/devices.
- **Scene** — the 3D world for a shot/sequence: devices, background, lighting, environment, ground/shadow.
- **Device instance** — one placed device (a 3D model or a 2D frame) with transform, screen-media binding, colour/material variant.
- **Source / Media** — the user's uploaded screenshot, image, or video that is mapped onto a device screen (or used as a raw layer / background).
- **Camera** — the viewport camera: position/target expressed via Tilt X, Tilt Y, Roll, FOV, Zoom, Pan X, Pan Y, plus device Rotate X/Y. Has **Manual** and **Preset** modes.
- **Keyframe (KF)** — an animatable value at a point in time on the timeline. Any "animatable" property (marked with the KF diamond) can be keyframed.
- **Template** — a saved starting scene (devices + camera + background + lighting + optional animation).
- **Preset** — a smaller reusable chunk: camera preset, animation preset, background preset, blur preset, easing preset.
- **Export** — render of a sequence to an image or video file.

### 5.2 Rendering approach — decision
Use **true WebGL 3D** (not CSS 3D transforms). Rationale: real depth-of-field, FOV/perspective, HDR lighting, orbit, and physically-plausible reflections require a real 3D pipeline. CSS-transform "fake 3D" (which some flat tools use) cannot deliver the cinematic look that defines this category.

**Stack:**
- **React 18 + TypeScript + Vite.**
- **Three.js** via **@react-three/fiber** (R3F) for the scene graph.
- **@react-three/drei** helpers (Environment/HDRI, useGLTF, OrbitControls-derived custom controls, Bounds, ContactShadows, AccumulativeShadows).
- **@react-three/postprocessing** (EffectComposer) for **Depth of Field (bokeh)**, Bloom, Noise, Vignette, Chromatic Aberration, tilt-shift, tone mapping.
- **GLTF/GLB** device models (Draco/meshopt compressed), loaded on demand and cached.
- **Zustand** for app state (project/scene/timeline), with an **immer** middleware; state is fully serializable to JSON (= the project file).
- **Tailwind CSS** + a small component library (Radix primitives) for the editor chrome (panels, sliders, tabs, popovers). The 3D canvas is separate from the DOM UI.
- **Framer Motion** for editor-chrome micro-interactions (not scene animation).

**Export stack (client-side):**
- **Images:** render to an offscreen/high-res canvas → `canvas.toBlob` (PNG/JPG/WEBP). For >canvas-size outputs, render at target resolution using a resized renderer + tiled render if needed.
- **Video:** **WebCodecs `VideoEncoder`** (hardware-accelerated H.264/AVC for MP4, VP9/AV1 for WEBM) + a muxer. Recommended muxer: **Mediabunny** (actively maintained; supersedes the same author's `mp4-muxer`/`webm-muxer`). Render **offline, frame-by-frame** on a fixed timeline for perfect constant-FPS output (never `MediaRecorder`/`captureStream`, which drops frames and can't hit constant FPS). Encode inside a **Web Worker** with an **OffscreenCanvas** to keep the UI responsive. Provide **ffmpeg.wasm** only as a fallback/transcode for browsers lacking WebCodecs.
- **Transparent video:** VP9/VP8 in WEBM with alpha for `.webm` alpha export (deviceframes-style). MP4 has no alpha; if transparency is requested, force WEBM.

### 5.3 High-level architecture
```
┌───────────────────────────── App shell (React) ─────────────────────────────┐
│  Top bar · Left rail · Right inspector · Bottom timeline · Modals             │
│                                                                              │
│   ┌──────────────── Viewport (R3F <Canvas>) ─────────────────┐               │
│   │  Scene graph: Environment, Lights, Devices[], Camera rig  │               │
│   │  EffectComposer: DoF, Bloom, Noise, Vignette, ...         │               │
│   └───────────────────────────────────────────────────────────┘              │
│                                                                              │
│   State (Zustand + immer)  ⇆  Project JSON  ⇆  Persistence (IndexedDB/cloud) │
│                                                                              │
│   Animation engine (keyframe interpolation → drives scene each frame)        │
│                                                                              │
│   Export engine ── Worker(OffscreenCanvas) ── WebCodecs ── Muxer ── File     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.4 Rendering/animation loop
- A central **animation clock** owns `currentTime` (seconds) within the active sequence.
- Each frame, the **evaluator** samples every keyframed property at `currentTime` (with easing) and writes resolved values into the scene (camera rig, device transforms, material params, effect params, screen-media scroll offset, etc.).
- In **edit mode** the loop is `requestAnimationFrame`-driven at display refresh; in **export mode** it is driven deterministically by the export loop at the chosen FPS.

---

## 6. Feature specification (exhaustive)

Each feature lists sub-features, controls, defaults, and acceptance criteria (AC).

### 6.1 Media / Source import
**Purpose:** get the user's content into the scene.

- **Import methods:** click-to-upload, **drag & drop** anywhere on canvas, **paste from clipboard** (Cmd/Ctrl+V), and import-from-URL `[PRO]` (optionally screenshot a URL server-side — later phase).
- **Accepted image types:** PNG, JPG/JPEG, WEBP, GIF (animated), SVG. **Video types:** MP4 (H.264), WEBM, MOV (best-effort). Max file size (config, e.g. 50 MB free / 250 MB Pro).
- **Auto-fit onto screen:** on import, media is mapped to the selected device's **screen UV region** (see §11.1), auto-scaled to fill, respecting the device's screen aspect ratio; letterbox/crop toggle.
- **Media adjustments (per source):** scale, offset X/Y within screen, corner rounding to match device, screen brightness/contrast, and **"screen glow"** (emissive contribution so the UI lights the scene subtly).
- **Screen scroll:** for tall screenshots, an animatable **scroll offset** so the content can scroll during a video.
- **Multiple sources:** one source per device screen; a shot can bind different sources to different device instances. "+ Add Shot" creates a new source binding on the same scene (reference UI: "Captures 3/3").
- **Raw layer mode:** place media as a flat plane/floating layer (no device) for pure image compositions.
- **AC:** Dropping a PNG onto an empty canvas places it into the default device's screen within 1 frame; aspect ratio preserved; no stretching by default.

### 6.2 Device library
**Purpose:** accurate frames/models for every relevant device.

- **Two representations:**
  1. **3D models** (GLB) — for cinematic/animated scenes (primary). `[PRO]` for premium/latest models is an option.
  2. **2D frames** (high-res PNG/SVG bezel with screen cutout) — for fast flat mockups and App-Store-style exports. Cheaper, sharper for straight-on shots.
- **Categories & required coverage (v1):**
  - **Phones:** latest iPhone lineup (Pro / Pro Max / Air / base), 2–3 prior generations; Google Pixel (latest + 1), Samsung Galaxy S (latest + 1), a generic Android.
  - **Tablets:** iPad Pro (11"/13"), iPad Air, iPad mini; one Android tablet.
  - **Laptops:** MacBook Pro (14"/16"), MacBook Air (13"/15"); a generic Windows laptop.
  - **Desktops / monitors:** iMac, Studio Display / generic monitor; **browser window frame** (light/dark, with URL bar) as a "device."
  - **Wearables:** Apple Watch (two sizes/cases), one Android/Wear watch.
  - **TV / large display:** Apple TV context (TV screen), generic 16:9 TV.
  - **Flat / no-device:** rounded-rect "card" frame, plain screen plane, phone/browser minimal outlines (shots.so-style minimal scenes).
- **Per-device attributes:** display name, category, **screen resolution + aspect ratio**, **screen safe area / notch / Dynamic Island / punch-hole** mask, bezel geometry, available **colour/material variants** (e.g. Titanium, Black, Silver, etc.), default orientation (portrait/landscape), and **screen UV rect** for media mapping (§11.1). See device spec table in **§9**.
- **Device controls in UI:** add device, choose model, colour variant, orientation (portrait/landscape) toggle, position/scale/rotation, "snap straight-on", duplicate, delete, z-order.
- **Multi-device scenes:** add multiple device instances; arrange (fan, grid, side-by-side presets); each keyframable.
- **Search & "request a device":** searchable list; a "my device isn't here" request capture (deviceframes has this) feeding a backlog.
- **AC:** Switching device preserves the bound source and re-maps it to the new screen aspect ratio without distortion; notch/Island mask renders correctly.

### 6.3 Camera
**Purpose:** the cinematic control surface (this is the heart of Ultramock).

Two modes via tabs: **Manual** and **Presets** (matches reference UI).

**Manual controls (all with direct-manipulation + numeric input; ★ = animatable/keyframable):**
- **Tilt X** ★ — pitch (drag). Reference default shown ≈ −19.
- **Tilt Y** ★ — yaw (drag). Reference default shown ≈ 42.
- **Roll** — camera roll/bank.
- **FOV** — field of view / focal length (reference ≈ 18; low FOV = flatter/tele, high = wider/more perspective).
- **Zoom** ★ — dolly/zoom (scroll). Reference ≈ 2.90.
- **Pan X** ★ — horizontal pan (space+drag). Reference ≈ 0.30.
- **Pan Y** ★ — vertical pan (space+drag). Reference ≈ −0.32.
- **Rotate Y** — device/scene yaw (turntable) as distinct from camera yaw.
- **Rotate X** — device/scene pitch.
- **Direct manipulation mapping (viewport gestures):** drag = orbit (Tilt X/Y); scroll = zoom; **space+drag = pan**; shift+drag = roll (optional). Numeric fields stay in sync live.
- **Reset** per-property and reset-all (undo affordance top-right of Camera panel in reference).

**Presets mode:**
- Curated camera angles: Front, Slight Left/Right, Hero (low 3/4), Top-down, Isometric, Over-shoulder, Flat lay, Dutch angle, etc. Clicking applies instantly (optionally animates the transition).
- **Animation presets** (for video): Fly-in, Orbit, Push-in, Pull-out, Parallax pan, Rotate reveal, Tilt-shift focus pull. Applying a preset drops the appropriate keyframes onto the timeline.

**AC:** Every ★ property, when its KF diamond is toggled on, records a keyframe at `currentTime`; interpolates smoothly with the selected easing.

### 6.4 Scene, background & environment
**Purpose:** the world behind and around the device.

- **Background types:**
  - **Solid colour** (picker + hex + eyedropper).
  - **Gradient** (linear/radial/conic; multi-stop; angle; presets library).
  - **Mesh gradient** (multi-point blurred gradient, shots.so/BrandBird-style; generator with randomize + seed).
  - **Image** — upload, or pick from a **built-in background library** (see §10) — abstract, studio, desk/lifestyle, textured. Blur/scale/position controls.
  - **Transparent** — alpha background for PNG/WEBM export.
  - **HDRI/environment as background** — show the lighting environment itself.
- **Background effects:** blur amount, brightness, vignette, grain/noise overlay, overlay colour/tint.
- **Ground & shadow:** contact shadow (soft), drop shadow, reflection/floor plane with roughness; shadow softness, opacity, colour, distance; toggle floor on/off.
- **Environment / lighting (BrandBird-class):**
  - **HDRI environment presets** (studio, city, sunset, warehouse, softbox, etc.) driving reflections + ambient. Intensity + rotation controls.
  - **Manual 3-point lighting** `[PRO]`: **key / fill / rim** lights, each with intensity, colour, position/direction, softness. Toggle each.
  - Exposure / tone mapping (ACES filmic default), white balance.
- **AC:** Switching background type is instant; mesh-gradient randomize produces a new pleasing background each click; transparent background yields true alpha in export.

### 6.5 Blur / Depth of Field
**Purpose:** the "real depth-of-field" that defines the cinematic look (Ultramock headline feature).

- **DoF (bokeh) via postprocessing:** focus distance (with **"click subject to focus"** in viewport), aperture/f-stop, max blur, bokeh scale. Focus can be **animatable** (focus pull).
- **Blur styles** (match Ultramock's four): **tilt-shift**, **radial**, **lens (bokeh)**, **directional/motion**. Each is a selectable mode with its own params.
- **Background-only blur** vs **full-scene DoF** toggle (fast path: blur just the background plane; quality path: true depth-based DoF).
- **AC:** With DoF on and focus on the device screen, foreground/background falls off smoothly; tilt-shift produces a horizontal in-focus band.

### 6.6 Effects & overlays
- **Film/texture effects:** noise/grain, VHS, glitch, scanlines, chromatic aberration, bloom/glow, vignette (shots.so parity). Each with intensity.
- **Overlays:** logo/watermark (user's own brand — upload, position, scale, opacity), text layers (see 6.7).
- **Color grading** `[PRO]`: LUT presets, exposure/contrast/saturation/temperature.

### 6.7 Text, logo & annotation layers (2D overlay compositor)
- Add **text** layers: font family (curated web-safe + Google Fonts subset), size, weight, colour, alignment, letter/line spacing, shadow. Draggable/resizable/rotatable in an overlay layer above the 3D render (screen-space, not in 3D) — like deviceshots/shots.
- Add **shapes** (rect, ellipse, line, arrow) and **badges** (App Store / Play Store badges, "New", ratings).
- **Logo/brand** placement.
- Layer ordering, lock, hide, opacity.
- These overlays are composited on top of the 3D canvas at export time (both image and video).
- **AC:** Text stays crisp at 4K export (rendered at export resolution, not upscaled from preview).

### 6.8 Templates & presets library
- **Template gallery** (modal + "Templates ▾" top-bar menu): categorized starting scenes — Hero, App Store set, Social square/vertical/story, Multi-device, Minimal/flat, Animated promo. Click to load into editor.
- **Social / platform frame presets** (fixed output sizes): App Store (6.7"/6.5"/5.5" portrait & iPad), Play Store, Product Hunt gallery, Twitter/X, LinkedIn, Instagram post/story/reel, YouTube thumb, Open Graph 1200×630, Dribbble 4:3, custom.
- **User presets:** save current camera/background/blur/animation as a reusable preset.
- **AC:** Selecting an App Store portrait preset sets the export canvas to the exact required pixel dimensions and orientation.

### 6.9 Animation & timeline (the motion system)
**Purpose:** turn a static scene into a video via keyframes. Present *always* (bottom bar in reference UI).

- **Timeline UI (bottom bar, matches reference):**
  - **Sequence tabs** ("Sequence 1", "2", "+ Add Shot").
  - **Playhead/time display:** `00:00.00 / 00:03.00` (current / duration).
  - **Duration control** (e.g. 3 s default; editable; per-sequence).
  - **Transport:** play/pause, step, **loop** toggle.
  - **Presets ▾** (animation presets), **Easing** editor, **Select all** (KFs), **+ Add KF**, **Clear all KF**.
  - **Keyframe track / ruler:** 0s → duration ruler with tick marks; keyframes shown as diamonds; scrub by dragging; snap to KFs.
- **Keyframable properties:** camera Tilt X/Y, Roll, FOV, Zoom, Pan X/Y, Rotate X/Y; device transforms (position/rotation/scale, per instance); DoF focus + aperture; background params; screen scroll offset; light intensities; effect intensities; media opacity. (In the reference, Tilt X, Tilt Y, and Zoom show the orange KF diamond — every ★ property behaves this way.)
- **Per-property KF toggle:** the diamond next to a property enables/disables animation for it and adds a KF at playhead.
- **Easing:** per-keyframe or per-segment easing — Linear, Ease, Ease-in/out/in-out, and named curves (e.g. cinematic "smooth"), plus custom cubic-bézier editor. **Spring** option for physical feel.
- **Multi-shot sequences:** a sequence can contain multiple **shots** (different source/device focus), with cuts or crossfades between them, enabling a mini promo edit. Shot duration + transition type.
- **Playback:** real-time preview; loop; onion-skin optional.
- **Motion blur** `[PRO]`: accumulation-based motion blur on export for smoother fast moves.
- **AC:** Applying "Orbit" preset over a 3 s duration produces a smooth 360°/partial turntable on export at chosen FPS with no jitter.

### 6.10 Export
**Purpose:** get the file out, high quality, client-side.

- **Formats:**
  - **Image:** PNG (alpha), JPG, WEBP.
  - **Video:** MP4 (H.264), WEBM (VP9/AV1), **WEBM with alpha** (transparent) `[PRO]` `.
  - **GIF** (via frames → gif encoder) for short loops.
- **Resolution / quality:** 1×/2×/3× or explicit presets 720p/1080p/1440p/**4K** `[PRO]`; DPR-aware; anti-aliasing (MSAA/SMAA) at export.
- **Video settings:** FPS (24/30/60), duration (from sequence), bitrate/quality slider, loop-friendly (first frame == last frame helper).
- **Social size presets** applied to export canvas (see 6.8).
- **Batch export** `[PRO]`: export all shots/sequences, or one scene across several social sizes at once.
- **Watermark:** applied to **free** exports (removable on Pro). Subtle brand mark, corner.
- **Export pipeline (video):** offline frame-by-frame render → WebCodecs encode in Worker/OffscreenCanvas → mux → download. Progress bar with % + ETA; cancelable; memory-safe streaming (never hold all frames in RAM). See §11.3.
- **Copy to clipboard** (image) and **direct download**; optional "save to cloud / shareable link" `[PRO]` (later phase).
- **AC:** A 3 s, 1080p, 30 FPS MP4 exports in the browser with constant frame rate, no dropped frames, and finishes with a progress indicator; a transparent WEBM shows true alpha when overlaid.

### 6.11 Project management & persistence
- **Save project** (top bar): serialize state to JSON; store in **IndexedDB** locally by default; cloud sync `[PRO]` (later).
- **Autosave** + version/undo history.
- **Undo/redo** (Cmd/Ctrl+Z / Shift+Z) across all edits; the reference shows an undo affordance top-right of the inspector.
- **Duplicate / rename / delete** projects; project thumbnails on a dashboard/home.
- **Import/export project file** (`.mockup.json`) for portability/backup.
- **Recent captures / shots** management ("Captures 3/3").
- **AC:** Reloading the page restores the last project exactly (devices, media refs, camera, keyframes).

### 6.12 Onboarding, help & templates entry
- Empty-state prompt on canvas: **"Upload media to get started — or paste / drop"** with an **Upload** button (matches reference).
- **Info** and **Help** menus (top bar): shortcuts, docs, changelog, "request device."
- First-run interactive tips (dismissible).
- Keyboard shortcuts overlay (`?`).

### 6.13 Accounts, plans & gating
- **Auth:** email + OAuth (Google) `[optional v1]`; anonymous local use allowed (projects in IndexedDB) with export watermark.
- **Plans (mirror category norms):**
  - **Free:** daily use, watermark on export, up to 1080p, limited premium devices/backgrounds, short video cap (e.g. ≤ 5 s), core features.
  - **Pro (one-time, ~$29–30, à la Ultramock/shots):** no watermark, 4K, all devices/backgrounds/effects, long video, transparent WEBM, batch export, cloud save. Grandfather lifetime buyers if pricing later shifts to subscription.
- **Billing:** Stripe (one-time + optional subscription).
- **AC:** Hitting a gated action shows an inline upgrade prompt naming the exact benefit; purchase unlocks instantly without reload.

### 6.14 Dark / light editor theme
- Editor UI supports light/dark (reference shows a dark-mode toggle top-right of inspector). Independent of scene background.

---

## 7. UI / UX specification

Layout mirrors and refines the reference screenshot.

### 7.1 Global layout
```
┌───────────────────────────────── TOP BAR ─────────────────────────────────┐
│ ☰  logo   INFO   TEMPLATES▾   HELP   │ CAPTURES 3/3      SAVE  UPGRADE 📷 EXPORT▾ │
├──────────────────────────────────────────────┬────────────────────────────┤
│                                              │  ↺   (dark/light) ◐        │
│                                              │  SOURCE            SHOT 1  │
│                                              │  [ click to upload / drop ]│
│                 3D VIEWPORT                  │  CAMERA   [MANUAL][PRESETS]│
│        (device + background + DoF)           │   Tilt X ◆ ───────  -19    │
│                                              │   Tilt Y ◆ ───────   42    │
│     "Upload media to get started —           │   Roll   ─────────    0    │
│         or paste / drop"  [UPLOAD]           │   FOV    ─────────   18    │
│                                              │   Zoom   ◆ ───────  2.90   │
│                                              │   Pan X  ◆ ───────  0.30   │
│                                              │   Pan Y  ◆ ───────ᐨ0.32    │
│                                              │   Rotate Y ───────    0    │
│                                              │   Rotate X ───────    0    │
│                                              │  ▸ BLUR                    │
│                                              │  ▸ SCENE                   │
│                                              │  ▸ 3D DEVICES              │
│                                              │  ▸ 3D MODEL          [PRO] │
├──────────────────────────────────────────────┴────────────────────────────┤
│ ‹ SEQUENCE [1][2] +ADD SHOT                                                │
│ 00:00.00/00:03.00  3s  ◁ ▷ ⟲  PRESETS▾  EASING  SELECT ALL  +ADD KF  CLEAR │
│ 0s├────────────◆───────────1s───────────────2s───────────────◆──────3s┤    │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar (left):** menu (☰), logo, **Info**, **Templates ▾**, **Help**. **(center/right):** **Captures N/N** counter, **Save project**, **Upgrade**, **screenshot/capture** icon, **Export ▾**.
- **Right inspector (scrollable, collapsible sections):** undo + theme toggle; **Source** (with active Shot indicator); **Camera** (Manual/Presets tabs + the 9 controls, each row = label + optional KF diamond + slider/drag + numeric field + reset); **Blur**; **Scene**; **3D Devices**; **3D Model** `[PRO]`. Each section header has a reset + collapse chevron.
- **Bottom timeline:** sequence tabs + add shot; transport + time; duration; **Presets / Easing / Select all / Add KF / Clear all KF**; ruler with keyframe diamonds and draggable playhead; collapse toggle.
- **Viewport:** full-bleed 3D canvas; empty-state upload prompt; fullscreen expander (top-right of canvas in reference); on-canvas gizmos for direct manipulation.

### 7.2 Interaction rules
- **Numeric field ⇄ slider ⇄ viewport gesture** are always three-way synced.
- **KF diamond** states: empty (not animated), filled at playhead (KF here), filled hollow (animated but no KF at this exact time). Clicking adds/removes a KF at playhead.
- **Direct manipulation:** drag orbit, scroll zoom, **space+drag pan**, click-to-focus (DoF). Show subtle helper hints ("DRAG", "SCROLL", "SPACE DRAG") on the relevant rows (reference shows these tags).
- **Snapping:** angle snap (15°) with modifier; straight-on snap button.
- **Responsiveness:** desktop-first; on narrow/mobile, collapse inspector into a bottom sheet and timeline into a compact strip (editing on mobile is best-effort; export still works).
- **Accessibility:** all controls keyboard-operable; slider arrow-key nudge; focus states; sufficient contrast in both themes; sliders expose `aria-valuenow`.

### 7.3 Empty, loading, error states
- Empty canvas → upload prompt.
- Device model loading → skeleton/spinner with progress.
- Export → modal with progress %, ETA, cancel.
- WebCodecs unsupported → fallback notice + ffmpeg.wasm path or "download frames as sequence."
- Large media / memory warning before 4K video export.

---

## 8. Data model (project JSON schema — normative)

```jsonc
{
  "version": 1,
  "id": "proj_...",
  "name": "My Mockup",
  "theme": "dark",
  "activeSequenceId": "seq_1",
  "sequences": [
    {
      "id": "seq_1",
      "name": "Sequence 1",
      "durationMs": 3000,
      "fps": 30,
      "activeShotId": "shot_1",
      "exportPreset": { "type": "custom", "width": 1920, "height": 1080 },
      "shots": [
        {
          "id": "shot_1",
          "startMs": 0,
          "endMs": 3000,
          "transitionIn": { "type": "none", "durationMs": 0 },
          "sourceBindings": { "dev_1": "asset_screenshot_1" }
        }
      ],
      "scene": {
        "devices": [
          {
            "id": "dev_1",
            "modelId": "iphone_17_pro",       // or "frame2d:iphone_17_pro"
            "colorVariant": "natural_titanium",
            "orientation": "portrait",
            "transform": { "position": [0,0,0], "rotationEuler": [0,0,0], "scale": 1 },
            "screen": {
              "sourceAssetId": "asset_screenshot_1",
              "fit": "cover", "offset": [0,0], "scale": 1,
              "cornerRadius": "auto", "brightness": 1, "emissive": 0.15,
              "scrollOffset": 0
            }
          }
        ],
        "camera": {
          "mode": "manual",
          "tiltX": -19, "tiltY": 42, "roll": 0, "fov": 18,
          "zoom": 2.90, "panX": 0.30, "panY": -0.32,
          "rotateX": 0, "rotateY": 0
        },
        "background": {
          "type": "gradient",            // solid|gradient|mesh|image|hdri|transparent
          "gradient": { "kind": "linear", "angle": 135, "stops": [["#eef",0],["#cde",1]] },
          "blur": 0, "brightness": 1, "vignette": 0, "noise": 0
        },
        "environment": {
          "hdri": "studio_soft", "intensity": 1, "rotation": 0,
          "toneMapping": "aces", "exposure": 1,
          "lights": { "key": {...}, "fill": {...}, "rim": {...} }   // [PRO] manual
        },
        "ground": { "enabled": true, "shadow": { "opacity": 0.4, "softness": 0.6 }, "reflection": 0 },
        "blur": { "dofEnabled": true, "style": "lens", "focusDistance": 5, "aperture": 2.8, "maxBlur": 0.01, "backgroundOnly": false },
        "effects": { "bloom": 0, "grain": 0, "vhs": 0, "glitch": 0, "chromatic": 0 }
      },
      "overlays": [
        { "id":"ovl_1","type":"text","text":"Ship faster","x":0.1,"y":0.85,"w":0.4,"font":"Inter","size":48,"weight":700,"color":"#fff" }
      ],
      "keyframes": [
        { "target":"camera.tiltY","timeMs":0,"value":42,"easing":"easeInOut" },
        { "target":"camera.tiltY","timeMs":3000,"value":-30,"easing":"easeInOut" },
        { "target":"camera.zoom","timeMs":0,"value":2.9 },
        { "target":"camera.zoom","timeMs":3000,"value":2.2 }
      ]
    }
  ],
  "assets": [
    { "id":"asset_screenshot_1","kind":"image","mime":"image/png","ref":"idb://blob_abc","w":1290,"h":2796 }
  ]
}
```
- **Keyframe `target`** is a dotted path into the scene/overlay/device model, enabling a generic evaluator (§11.2).
- **Assets** are stored as blobs in IndexedDB (local) and referenced by id; cloud sync uploads blobs and rewrites `ref`.
- Schema is **versioned** with migrations.

---

## 9. Device specification table (screen mapping data)

The builder must maintain a **device registry** (a JSON/TS file) that is the source of truth for every device. Required fields per device:

`id, displayName, category, releaseYear, modelSource(3d GLB url | 2d frame url), colorVariants[], screen: { widthPx, heightPx, aspectRatio, cornerRadiusPx, maskType(none|notch|dynamicIsland|punchHole), safeAreaInsets }, uvRect (screen quad in model UV/local space), defaultOrientation, defaultScale`.

**Reference screen resolutions & aspect ratios** (verify latest models against a live spec source before shipping — newest-year devices in particular; these are the values to encode):

| Device | Logical/Native screen | Aspect | Screen mask |
|---|---|---|---|
| iPhone 17 Pro Max / Pro / Air / base | ~1290×2796 / 1179×2556 class (per model) | ~19.5:9 | Dynamic Island |
| iPhone 15/16 (Pro/Plus/base) | 1179×2556 / 1290×2796 / 1170×2532 | ~19.5:9 | Dynamic Island / notch (older) |
| iPhone SE (flat) | 750×1334 | 16:9 | none |
| Google Pixel (latest) | ~1080×2400 class | ~20:9 | punch-hole |
| Samsung Galaxy S (latest) | ~1080×2340–1440×3088 | ~19.5–20:9 | punch-hole |
| iPad Pro 13" / 11" | 2064×2752 / 1668×2420 class | ~4:3 | none |
| iPad Air / mini | 1640×2360 / 1488×2266 class | ~4:3 | none |
| MacBook Pro 14"/16" | 3024×1964 / 3456×2234 | ~16:10 (notch) | menu-bar notch |
| MacBook Air 13"/15" | 2560×1664 / 2880×1864 | ~16:10 | notch |
| iMac 24" | 4480×2520 | 16:9 | none |
| Studio Display / generic monitor | 5120×2880 / 1920×1080 | 16:9 | none |
| Browser window frame | user-defined (e.g. 1440×900 content) | flexible | chrome + URL bar |
| Apple Watch (2 sizes) | ~396×484 / 416×496 class | ~ tall rounded | rounded corners |
| Apple TV / generic TV | 3840×2160 | 16:9 | none |

> **Note on accuracy:** exact pixel dimensions for the current-year phones/tablets/laptops shift each release. Encode from a maintained reference (e.g. the device's official spec page or a community device-metrics dataset) and add a lightweight update process. The tool's value depends on this staying current — treat the device registry as a living, versioned dataset.

---

## 10. Asset requirements & sourcing

### 10.1 3D device models (GLB)
- **Format:** glTF 2.0 **.glb**, **Draco or meshopt** compressed, PBR materials, **≤ ~150k tris** each for smooth real-time, with a clearly separated **screen mesh** (its own material) so screen media can be swapped and the screen UV rect derived. Provide colour variants via material swaps or separate GLBs.
- **Screen mesh convention:** every device model must expose a named node/material (e.g. `Screen`, `Display`) that is a flat quad or near-quad for UV-mapping the source; store its UV/local rect in the registry.
- **Sourcing options (in order of preference):**
  1. **Commission / model in-house (Blender)** for the flagship devices → cleanest topology, correct screen quads, consistent scale, licensing you control. Recommended for the core set.
  2. **Purchased packs / marketplace models** (Sketchfab Store, CGTrader, TurboSquid) — verify **commercial/royalty-free license** and that redistribution inside a rendered product is permitted. Many "Apple pack" style bundles exist (phones/tablets/laptops/watch/airpods) but licenses vary (some are *Editorial only* — **not** usable commercially). **Check every license.**
  3. **CC0 / free** models (some Sketchfab CC0, Poly Haven-style, AI-generated CC0 like Meshy) — free to use commercially; quality varies and often needs cleanup + a proper screen quad.
- **Trademark/IP caution:** device *shapes and brands* (iPhone, Galaxy, Pixel, MacBook) are trademarked. The category norm is to render generic-but-recognizable devices and **avoid using Apple/Samsung/Google logos, exact branding, or "Apple/iPhone" as product names in a way that implies endorsement.** Name device presets descriptively (e.g. "Pro Phone (2025)") if legal review requires; many competitors do use the common names — get legal sign-off on naming. **This is an explicit open question for legal (see §15).**
- **Pipeline:** run all GLBs through `gltf-transform` (dedupe, prune, Draco), validate with the glTF validator, and generate JSX/registry entries. Lazy-load per device; cache in IndexedDB.

### 10.2 2D device frames
- High-res transparent **PNG** (and/or **SVG** for scalable bezels) with a defined screen cutout rect + corner radius + mask. Cheaper and razor-sharp for straight-on App-Store shots. Maintain alongside 3D models.

### 10.3 Backgrounds library
- **Gradient presets** (curated JSON — dozens of tasteful linear/radial/conic).
- **Mesh gradient generator** (procedural; no assets needed).
- **Image backgrounds:** curate a bundled set (abstract, studio sweeps, desk/lifestyle, textures). Source from **CC0/royalty-free** libraries (Unsplash under its license, Pexels, or self-produced) — **store licenses**; prefer CC0 to avoid attribution burdens in exports. Offer categories + search.
- **HDRIs (environment lighting):** **Poly Haven** (CC0) HDRIs are ideal — studio, sunset, city, warehouse, softbox. Use low-res (1–2k) for real-time, optionally higher for export. Ship a curated subset.

### 10.4 Fonts, icons, badges
- Curated **Google Fonts** subset for text overlays (self-host for privacy/perf).
- **Icon set** for the editor UI (e.g. Lucide).
- **Store badges** (App Store / Google Play) — use official badge assets under their brand guidelines; keep as optional overlay assets.

---

## 11. Key algorithms & implementation notes

### 11.1 Screen-media UV mapping
- Each device's screen mesh has a known quad in local/UV space. Bind the source as a **texture** on the screen material (emissive + base color mix for the "screen glow").
- Compute a UV transform (scale/offset) from `fit` (cover/contain), source aspect ratio, and device screen aspect ratio so media fills without distortion. Apply corner radius via an alpha mask or rounded-quad geometry; apply notch/Island mask by punching the mask texture.
- For **video sources**, use a `THREE.VideoTexture` (edit mode) and, for export, **seek the video frame-by-frame** to the export timeline (don't rely on real-time playback) so the encoded output is deterministic.
- For **scrolling screenshots**, animate the UV offset via a keyframed `scrollOffset`.

### 11.2 Keyframe evaluation engine
- Keyframes are `{ target: dottedPath, timeMs, value, easing }`.
- Group by `target`; on each frame, for the active sequence at `currentTime`, find the surrounding two KFs per target, apply easing (`t' = ease(t)`), interpolate (lerp for scalars, slerp/quaternion for rotations, per-channel for colors/vectors), and write into the scene via a setter map (path → setter).
- Support **spring** and custom cubic-bézier easings. Precompute per-segment for performance.
- The **same evaluator** drives edit-mode preview and export (guarantees WYSIWYG).

### 11.3 Video export pipeline (client-side, deterministic)
1. Determine `fps`, `durationMs`, output `width×height`, codec/container, bitrate, alpha.
2. Configure `VideoEncoder` (`avc1.*` for MP4 H.264; `vp09.*`/`av01.*` for WEBM; VP9/VP8 for alpha WEBM) inside a **Web Worker** with an **OffscreenCanvas** clone of the R3F renderer (or render on main thread and `transferToImageBitmap` per frame — benchmark both).
3. For frame `i` in `0..numFrames`: set `currentTime = i/fps`, run the evaluator, render the scene at export resolution, composite 2D overlays (text/logo) at export resolution, build a `VideoFrame(canvas, { timestamp })`, `encoder.encode(frame, { keyFrame: i % gop === 0 })`, then `frame.close()`. **Never buffer all frames** — encode-as-you-go and let the muxer stream chunks.
4. Muxer (**Mediabunny**, or `mp4-muxer`/`webm-muxer`) writes chunks to an `ArrayBufferTarget`/stream; `fastStart:"in-memory"` for MP4 seekability.
5. On flush: finalize container → `Blob` → download (or upload for cloud). Emit progress each frame; allow cancel (close encoder, discard).
6. **Fallbacks:** if WebCodecs unsupported (older Safari/Firefox), offer **ffmpeg.wasm** encode from frame PNGs, or "export frame sequence (ZIP)". Feature-detect with `VideoEncoder.isConfigSupported`.
7. **Memory safety:** cap resolution×duration on low-memory devices; warn before 4K×long clips; process in the Worker to avoid main-thread jank.

### 11.4 Image export
- Render at `targetWidth×targetHeight` (set renderer size + camera aspect), enable SMAA/MSAA, render one frame at `currentTime`, composite overlays at full res, `toBlob`. For very large outputs beyond max canvas/GPU limits, tile-render and stitch.

### 11.5 Depth of field
- Prefer **`@react-three/postprocessing` `DepthOfField`** (bokeh) driven by the scene depth buffer for true DoF; expose focusDistance/focalLength/bokehScale.
- Provide a **fast path** (blur only the background plane) for weak GPUs and instant preview, and the **quality path** (full depth-based DoF) at export.
- **Tilt-shift** = DoF with a gradient focus mask; **radial/directional** = separate blur passes.

### 11.6 Performance
- Lazy-load device GLBs; cache in IndexedDB; preload only the active device.
- Cap DPR in edit mode (e.g. 1.5×); render full DPR/target res only on export.
- Suspend the RAF loop when idle; only re-render on change.
- Compress textures; downscale huge uploaded screenshots for the live texture, keep original for export.
- Web Workers for export; avoid GC churn (reuse buffers, close `VideoFrame`s).

---

## 12. Non-functional requirements

- **Browsers:** latest Chrome/Edge (full WebCodecs), Safari 16+/Firefox (graceful fallback for video). WebGL2 required.
- **Performance targets:** ≥ 30 FPS interactive on mid laptops for single-device scenes; export a 3 s 1080p30 clip in ≤ ~2× realtime on such hardware.
- **Privacy:** media processed locally; nothing uploaded unless the user opts into cloud save; state privacy-preserving by default.
- **Reliability:** autosave; export cancelable and memory-guarded.
- **Offline:** PWA-installable; core editor works offline once assets cached (except cloud features).
- **Internationalization:** UI copy externalized; RTL-aware layout (nice-to-have).
- **Analytics:** privacy-friendly product analytics (activation, time-to-export, video-vs-image, gating triggers) — e.g. PostHog, self-hostable.
- **Testing:** unit tests for the evaluator + UV math + export config; visual regression on a set of reference scenes; export determinism test (same project → identical frames).

---

## 13. Licensing & legal checklist (must resolve before public launch)
- **3D/2D device assets:** confirm each asset's license permits **commercial use + redistribution inside a rendered SaaS output**; avoid "Editorial only" packs. Keep a license ledger.
- **Device trademarks/branding:** avoid brand logos on models; get legal sign-off on how devices are named/marketed (generic vs. common names). Competitors vary here.
- **Backgrounds/HDRIs/fonts:** prefer **CC0** (Poly Haven, CC0 image sets, self-produced); comply with Unsplash/Pexels license if used; self-host Google Fonts.
- **Store badges:** follow Apple/Google badge brand guidelines.
- **User content:** ToS clarifying users own their uploads; we don't claim rights; local-first processing.

---

## 14. Phased roadmap

**Phase 0 — Skeleton (foundations)**
- R3F canvas, one 3D phone model with swappable screen texture, orbit/zoom/pan controls, solid/gradient background, contact shadow, PNG export, project state + IndexedDB save. *Ship internal.*

**Phase 1 — Cinematic still (MVP, matches Ultramock still-mode)**
- Full camera panel (Manual + Presets: Tilt X/Y, Roll, FOV, Zoom, Pan X/Y, Rotate X/Y), real **DoF + blur styles**, HDRI environments, mesh/image backgrounds, 3–5 flagship devices (phone/laptop/tablet/browser), templates + social size presets, text/logo overlays, image export (PNG/JPG/WEBP, up to 4K), watermark + Free/Pro gating. *Public beta.*

**Phase 2 — Motion (video)**
- Always-on **timeline**, keyframes on all ★ properties, easing editor, animation presets (orbit/fly-in/push/parallax/focus-pull), **video export** (MP4/WEBM via WebCodecs + muxer, offline frame-accurate, progress/cancel), video-in-screen (screen recordings), loop helper.

**Phase 3 — Breadth & depth**
- Full device library (watches, TV, monitors, more Android + generations), multi-device scenes + arrange presets, multi-shot sequences with transitions, manual 3-point lighting `[PRO]`, color grading/LUTs, transparent WEBM, batch export, GIF.

**Phase 4 — Platform**
- Accounts + cloud save + shareable links, template marketplace, "request a device" pipeline, collaboration, browser-extension capture (Ultramock's stated v2 direction: add cinematic animation to any site/app), API/embeds.

---

## 15. Open questions / decisions to make
1. **Device naming/branding** — use common names (iPhone/MacBook) like competitors, or generic descriptors? (Legal.)
2. **3D asset strategy** — commission the core set in-house vs. license packs? (Quality/licensing trade-off; in-house recommended for flagships.)
3. **Pricing** — one-time Pro (Ultramock/shots norm) vs. subscription (deviceframes/Previewed)? Grandfathering policy if switching.
4. **Cloud vs local-only v1** — ship purely local-first (cheapest, most private) and add cloud in Phase 4?
5. **Video codec defaults** — MP4/H.264 for compatibility vs. WEBM/VP9 for quality/alpha; how aggressively to rely on WebCodecs vs. ffmpeg.wasm fallback.
6. **How current must the device library be** — commit to a cadence (e.g. new flagships within N weeks of release) since freshness is a core value prop.
7. **Screen-recording sync** — real-time preview of video-in-screen vs. seek-based export accuracy; UX for trimming the recording to the clip length.

---

### Appendix A — Quick-reference: exact right-panel controls to replicate (from reference UI)
- **Source** (with active **Shot** label) — upload/drag/paste.
- **Camera → Manual:** Tilt X ◆, Tilt Y ◆, Roll, FOV, Zoom ◆, Pan X ◆, Pan Y ◆, Rotate Y, Rotate X (◆ = keyframable; helper tags: DRAG / SCROLL / SPACE DRAG).
- **Camera → Presets:** angle + animation presets.
- **Blur:** DoF + styles (tilt-shift / radial / lens / directional), focus, aperture, max blur, background-only.
- **Scene:** background type, environment/HDRI, ground/shadow, effects.
- **3D Devices:** add/select device, colour, orientation, transform, multi-device.
- **3D Model:** advanced model/material options `[PRO]`.
- **Top bar:** Info · Templates ▾ · Help · Captures N/N · Save · Upgrade · Capture · Export ▾.
- **Timeline:** Sequence tabs · +Add Shot · time/duration · transport · loop · Presets ▾ · Easing · Select all · +Add KF · Clear all KF · ruler with KF diamonds.

### Appendix B — Recommended libraries
- 3D: `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `three-stdlib`.
- Asset pipeline: `gltf-transform`, Draco/meshopt, glTF validator, `gltfjsx`.
- State: `zustand` + `immer`.
- Video export: **WebCodecs** + **Mediabunny** (or `mp4-muxer` / `webm-muxer`); `ffmpeg.wasm` fallback; `gif.js`/`gifenc` for GIF.
- UI: React + TypeScript + Vite + Tailwind + Radix + Lucide + Framer Motion.
- Storage: IndexedDB (`idb`); Stripe for billing; PostHog for analytics.
- HDRIs/backgrounds: Poly Haven (CC0); curated CC0 image sets.
```
