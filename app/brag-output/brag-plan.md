# Brag Plan: Ribbit

## What is this app?

Ribbit is a personal toolkit for visual work: five separate visual tools behind one shell, each with its own URL, covering 3D device mockups, posted screenshots, hand-drawn whiteboarding, ASCII art conversion, and generative dithered motion.

## The angle

Most "toolkit" videos claim breadth and show one screen. Ribbit actually has five distinct, finished tools, so the video's job is simply to prove it: five tools, five real screens, no mockups of mockups. The launcher shows five cards, then the video walks all five and shows each one holding real work. The premise is "count them yourself."

Every frame uses the product's own design language: the near black ground, and each tool's own aurora colour as the light behind its screenshot. The video is lit by the app's palette rather than a generic template.

## Hook (first 2-3 seconds)

The frog mascot lands on the black ground and the wordmark "Ribbit" resolves under it, then the tagline "A personal toolkit for visual work." The hook is the mark plus one number: **five tools**, stated immediately so the rest of the video is a promise being kept.

## Key moments (the middle)

- The launcher itself: five aurora-lit cards in one row, each card's glow a different hue, names arriving one at a time so the viewer counts to five.
- 3D Studio holding a real render: an anime sky on a cosmic orange iPhone 17 Pro Max, with the camera panel of tilt, lens and zoom values visible beside it.
- Signal's dithered Bayer artwork, which is the most visually arresting screen in the app and needs no explanation.
- ASCII turning a photograph of a wave into blue characters, with the cell count "145 x 45 cells" readable as proof it is real text.
- Draw's pen tray: eight physically drawn pencils, pens and an eraser, which is the detail that says somebody cared.

## Outro / punchline

The five tool names stack up as a list, the wordmark returns, and the closing line lands: "Five tools. One frog." Under it, the five URLs the app actually serves (/studio, /shots, /draw, /ascii, /signal), which is the proof that each tool is a real place and not a tab.

## User flow worth showing

Entry is the launcher (five cards, pick one). The key action differs per tool but is the same shape in each: bring in source material, turn a dial, and the canvas answers immediately. The result is the Export button, which is present in four of the five tools and is the thing every session ends on.

The centrepiece scenes are therefore the five working screens, each already holding real output, not the empty states. Every screenshot in this video was captured from the running app with content seeded in it.

## Tone

- Preset: `app-store`
- Creative direction: a calm, confident product tour that lets five finished screens do the talking
- Interpretation: clean slide and wipe transitions, one idea per scene, generous holds on each screenshot, no jokes and no hype words. The energy comes from the cadence of five segments arriving on the beat, not from fast cutting.

## Format: landscape, 1920x1080
## Duration: 59.9 seconds

**Note on duration:** the `/brag` creative law asks for 15 to 25 seconds. The user explicitly asked for a one minute video showcasing all five tools, so this plan overrides that law deliberately. Five tools at a readable pace cannot fit in 25 seconds. The structure below keeps each segment tight (about 8 seconds) so the length is spent on coverage, not on padding.

## Visual identity (from the project)

- Background: `#08090a` (the `--canvas` token)
- Surface: `#0f1011` / `#141516` (`--surface-1` / `--surface-2`)
- Hairline: `#23252a` (`--hairline`)
- Accent: `#5e6ad2` (`--primary`), hover step `#828fff`
- Text: `#f7f8f8` (`--ink`), muted `#8a8f98` (`--ink-subtle`)
- Display font: Inter (the app ships Inter via Google Fonts for its text overlays; its UI font is "Linear Display" with an SF Pro fallback, which is not redistributable, so Inter is the honest stand in)
- Body font: Inter
- Strongest visual element: the per-tool aurora, four colour stops thrown from the bottom edge of each launcher card. Each tool's `aurora.mid` becomes the glow behind its screenshot:
  - 3D Studio `#6C7EFF`, accent `#40C4FF`
  - Shots `#E87C3C`, accent `#FAC458`
  - Draw `#28B494`
  - ASCII `#A868F0`
  - Signal `#30ACDC`

## Share copy (draft)

Five tools, one frog. Ribbit does 3D device mockups, posted screenshots, hand drawing, ASCII conversion and generative dithered loops, each at its own URL.

## Audio direction

- Role: warm bed with clean, sparse accents on each tool arrival
- Music: `happy-beats-business-moves-vol-1-by-ende-dot-app.mp3` (120.19 BPM)
- Music treatment: enters at full from frame zero, offset into the track by 3.02s so the detected beat grid starts exactly at composition time zero and every bar line falls on a 1.9968s multiple. Holds a steady level under the whole tour, then fades out across the last 1.5 seconds under the closing line.
- Music cue guidance: bundled preset read from `assets/music/cues/happy-beats-business-moves-vol-1-by-ende-dot-app.music-cues.json`. Tempo 120.19 BPM, beat interval 0.4992s, first detected beat 3.02s. With the 3.02s media offset the composition's own grid is `t = n * 0.4992` and a bar is `1.9968s`. Every scene boundary in the storyboard is a bar line, so all six major transitions are beat locked by construction. The preset's planning window stops at 25s; beyond that the grid is extrapolated from the tempo, which is safe because the track is 163.96s of steady tempo.
- Audio-reactive treatment: subtle. Use music RMS to make each tool's aurora glow breathe behind its screenshot, and bass to give the screenshot card a small presence lift on arrival. No waveform bars, no equalizer, no strobing.
- SFX posture: sparse and motion matched. One soft interface tick per tool arrival (five total), one warmer accent on the launcher reveal, one closing accent on the final wordmark. Nothing under the text holds.
- Audio-coupled moments: the five card names counting in on the launcher; each tool screenshot sliding in on a bar line; the final wordmark landing.
- Restraint rule: no sound during a text hold, and no SFX stacked within 0.3s of another. The tour should sound composed, not clicky.

## Storyboard

Bar length is 1.9968s. All times are bar lines.

### Scene 1 — Hook: the mark — 3.99s (0.000 to 3.994)
Black ground. The frog mascot scales up and settles, the wordmark "Ribbit" resolves beneath it, then the tagline "A personal toolkit for visual work." A small accent line reads "Five tools." and holds.
Sequential/interaction: yes, three text beats arriving one bar apart (mascot, wordmark, tagline plus count).
Audio intent: the bed establishes, nothing competes with it.
Audio-coupled idea: none, let the music carry the open.
Music: warm, establishing.
Transition mood: clean wipe → Scene 2

### Scene 2 — The launcher — 5.99s (3.994 to 9.984)
The real launcher screenshot, all five aurora-lit cards in one row. The five tool names count in one at a time over the card row, each landing on a beat, and the full set holds on screen afterwards. Overlay line: "Five tools. One shell."
Sequential/interaction: yes, five name labels revealed one per beat then held together for a full bar.
Audio intent: a warmer accent marks the reveal of the row.
Audio-coupled idea: beat aligned name reveals, one soft tick on the row appearing.
Music: steady, the groove settles in.
Transition mood: slide → Scene 3

### Scene 3 — 3D Studio — 7.99s (9.984 to 17.971)
The Studio screenshot slides in on an indigo aurora glow. An anime sky sits on a cosmic orange iPhone 17 Pro Max, the device list on the left and the camera panel on the right. Title "3D Studio", line "Put a screen on a 3D device, light it, and export a video." A small callout points at the camera values (tilt, lens 48mm, zoom).
Sequential/interaction: yes, title then tagline then callout, one per bar.
Audio intent: a single clean tick on arrival, then let it breathe.
Audio-coupled idea: the card arrival tick.
Transition mood: slide → Scene 4

### Scene 4 — Shots — 7.99s (17.971 to 25.958)
The Shots screenshot on a warm amber aurora. The framed screenshot sits on a blue backdrop the tool generated from the image itself, layout presets stacked down the left. Title "Shots", line "Frame screens on a backdrop worth posting, in seconds." Callout on the layout preset column.
Sequential/interaction: yes, title then tagline then callout.
Audio intent: same tick, one hue warmer in placement, not in volume.
Audio-coupled idea: the card arrival tick.
Transition mood: slide → Scene 5

### Scene 5 — Draw — 7.99s (25.958 to 33.946)
The Draw screenshot on a teal aurora. White board, real ink strokes, and the pen tray of eight drawn pencils and pens along the bottom. Title "Draw", line "A hand-drawn whiteboard, and a tray of pens that behave like pens." Callout on the pen tray.
Sequential/interaction: yes, title then tagline then callout.
Audio intent: the tick, then quiet under the hold.
Audio-coupled idea: the card arrival tick.
Transition mood: slide → Scene 6

### Scene 6 — ASCII — 7.99s (33.946 to 41.933)
The ASCII screenshot on a violet aurora. A photographed wave redrawn as blue characters, the Looks grid (Terminal, Noir, Vaporwave, Game Boy, Newsprint, Blueprint) on the left. Title "ASCII", line "Redraw a picture as characters, tiles or dither, and keep the text." Callout on the readable "145 x 45 cells" readout, which proves the output is really text.
Sequential/interaction: yes, title then tagline then callout.
Audio intent: the tick.
Audio-coupled idea: the card arrival tick.
Transition mood: slide → Scene 7

### Scene 7 — Signal — 7.99s (41.933 to 49.920)
The Signal screenshot on a cyan aurora. Full frame Bayer dithered artwork, the generator list (Warp, Quasicrystal, Chladni, Worley) on the left and the dither controls on the right. Title "Signal", line "Dithered motion out of nothing. Take it away as a loop." Callout on "1024 x 1024 · 13 fps".
Sequential/interaction: yes, title then tagline then callout.
Audio intent: the tick, slightly brighter, since this is the last tool.
Audio-coupled idea: the card arrival tick.
Transition mood: clean wipe → Scene 8

### Scene 8 — Outro — 9.98s (49.920 to 59.904)
The five tool names stack as a centred list, each with its own accent dot in that tool's colour, arriving one per beat. They hold, then collapse toward the wordmark. "Ribbit" returns with the closing line "Five tools. One frog." Under it, the five real routes in mono: `/studio  /shots  /draw  /ascii  /signal`.
Sequential/interaction: yes, five list rows one per beat, then the wordmark landing.
Audio intent: one closing accent on the wordmark, then the bed fades out over the final 1.5s.
Audio-coupled idea: the wordmark landing accent.
Music: fades to silence under the last line.
Transition mood: end.

**Music mood for this video:** upbeat but composed, a steady product-tour bed rather than a hype track.
**Audio summary:** a warm 120 BPM bed runs the whole length at a steady level, punctuated by six sparse interface accents (the launcher reveal and five tool arrivals) that all land on bar lines, closing with one accent on the final wordmark as the music fades out.
