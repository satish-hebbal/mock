# Hyperframes Composition Brief: Ribbit

## Objective

Create a one minute launch-style product tour for Ribbit that shows all five of its tools holding real work.

## Output

- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape, 1920x1080
- Duration: 59.904 seconds (30 bars at 120.19 BPM)

## Source Material

- Project root: `C:\Users\satis\Downloads\mock\app`
- Primary files read: `index.html`, `src/index.css`, `src/lib/tools.ts`, `src/lib/routes.ts`, `src/components/Home.tsx`, `src/lib/sections.ts`, `package.json`
- Product name: Ribbit (the browser title still reads "Mockup Studio")
- Tagline: "A personal toolkit for visual work. Mock it up, dress it up, ship it."
- Key UI to show: all five tool screens, captured live from the running dev server with content seeded into each one. They are in `assets/media/`:
  - `launcher.png` the home screen, mascot plus five aurora-lit cards
  - `studio.png` an anime sky on a cosmic orange iPhone 17 Pro Max, camera panel visible
  - `shots.png` a framed screenshot on a generated blue backdrop, layout presets down the left
  - `draw.png` real ink on the whiteboard plus the drawn pen tray
  - `ascii.png` a wave redrawn as blue characters, "145 x 45 cells" readable
  - `signal.png` full frame Bayer dithered artwork with generator and dither panels
  - `frog-logo.svg` the app mark, taken from `public/frog-logo.svg`
- Copy that must appear verbatim (all of it is the product's own):
  - "A personal toolkit for visual work."
  - "3D Studio" / "Put a screen on a 3D device, light it, and export a video."
  - "Shots" / "Frame screens on a backdrop worth posting, in seconds."
  - "Draw" / "A hand-drawn whiteboard, and a tray of pens that behave like pens."
  - "ASCII" / "Redraw a picture as characters, tiles or dither, and keep the text."
  - "Signal" / "Dithered motion out of nothing. Take it away as a loop."
  - "/studio  /shots  /draw  /ascii  /signal"

## Creative Direction

- Tone preset: `app-store`
- Creative direction: a calm, confident product tour that lets five finished screens do the talking
- Interpretation: one idea per scene, clean slide transitions, generous holds. No hype words, no jokes. The rhythm comes from five segments landing on bar lines.
- Angle: the video proves a claim that is easy to make and rare to keep. Five tools, five real screens, each already holding work. Lit throughout by the product's own palette, with each tool's aurora colour as the glow behind its screenshot.
- Hook: the frog mark lands, "Ribbit" resolves, "Five tools." states the promise.
- Outro: the five names stack up, the wordmark returns, "Five tools. One frog." over the five real routes.
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Redesigning the product's look; use its own tokens
  - Em dashes anywhere in on-screen copy

## Visual Identity

- Background: `#08090a`
- Surface: `#0f1011`, `#141516`
- Hairline: `#23252a`
- Text: `#f7f8f8`, muted `#8a8f98`
- Accent: `#5e6ad2`
- Per-tool aurora (the glow behind each screenshot):
  - 3D Studio `#6C7EFF` with `#40C4FF`
  - Shots `#E87C3C` with `#FAC458`
  - Draw `#28B494`
  - ASCII `#A868F0`
  - Signal `#30ACDC`
- Display and body font: Inter, shipped locally as woff2 with an in-file `@font-face` so lint passes
- Visual references: the launcher's aurora cards, the near black Linear-style ground, hairline separated panels

## Storyboard

Use `brag-output/brag-plan.md` as the creative contract. Bar length is 1.9968s.

1. Hook, the mark — 3.994s — mascot, "Ribbit", "A personal toolkit for visual work.", "Five tools."
2. The launcher — 5.990s — the real home screen, five names counting in one per beat, then held
3. 3D Studio — 7.987s — screenshot, title, tagline, camera callout
4. Shots — 7.987s — screenshot, title, tagline, layout preset callout
5. Draw — 7.987s — screenshot, title, tagline, pen tray callout
6. ASCII — 7.987s — screenshot, title, tagline, "145 x 45 cells" callout
7. Signal — 7.987s — screenshot, title, tagline, "1024 x 1024" callout
8. Outro — 9.984s — five names stacking, wordmark, "Five tools. One frog.", the five routes

## Audio

- Audio role: warm bed with sparse, motion matched accents
- Audio arc: bed establishes under the hook, holds steady through the five tool segments, fades out across the last 1.5s under the closing line
- Music: `assets/music/happy-beats-business-moves-vol-1-by-ende-dot-app.mp3`
- Music treatment: `data-media-start="3.02"` so the detected beat grid starts at composition time zero. Steady level, no ducking, fade out over the final 1.5s.
- Music cue guidance: bundled preset at `~/.claude/plugins/marketplaces/brag/skills/brag/assets/music/cues/happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.json`. Tempo 120.19 BPM, beat interval 0.4992s, first beat 3.02s. After the 3.02s media offset the composition grid is `t = n * 0.4992` and a bar is 1.9968s. Every scene boundary is a bar line, so all seven transitions are beat locked by construction. Mark them `// beat-locked`. The five launcher name reveals and the five outro list rows use consecutive beats and should be marked `// beat-grid`.
- Audio-reactive treatment: subtle. Drive each tool's aurora glow opacity and blur from music RMS, and give the screenshot card a small scale or brightness lift on bass at its arrival. No waveform, equalizer, particle or strobe visuals.
- Audio-coupled moments:
  - Launcher row appearing — one warm accent
  - Each of the five tool screenshots arriving — one soft interface tick each, on the bar line
  - Final wordmark landing — one closing accent
- SFX selection guidance: prefer low high-frequency-risk files from `sfx-analysis.md`. The five tool ticks must be the same file at the same level so the tour reads as a cadence rather than five different noises. Nothing during a text hold, nothing stacked within 0.3s.
- SFX analysis guidance: `~/.claude/plugins/marketplaces/brag/skills/brag/assets/sfx/sfx-analysis.md`
- Exact SFX choice: Hyperframes picks filenames, timestamps and levels once the animation exists.
- Audio files: copy chosen music and SFX into `brag-output/composition/assets/`

## Hyperframes Instructions

Load `hyperframes-core`, `hyperframes-animation`, `hyperframes-creative`, `hyperframes-keyframes` and `hyperframes-cli`. This is the `/brag` workflow, so do not enter the `hyperframes` entry-point intent interview or its generic promo workflow. Prefer native Hyperframes conventions.

Requirements:

- Show real UI from the product in at least one scene. Here, six real screens are the spine of the whole video.
- Keep all text readable: a short label holds about 0.8s settled, a sentence about 0.3s per word.
- Total duration 59.904s. This deliberately overrides the 15 to 25 second creative law, at the user's explicit request for a one minute video covering five tools.
- Include the music bed and the sparse SFX layer.
- Beat lock the scene boundaries; use the beat grid for the two sequential reveals.
- Screenshots are 3024x1890 (aspect 1.6) against a 16:9 frame, so present them as a floating app window card with rounded corners, a hairline border and a shadow rather than full bleed. Do not crop the panels off.
- Use local assets only, no absolute paths, no network fonts.
- `npx hyperframes check` must pass with zero findings before render.
