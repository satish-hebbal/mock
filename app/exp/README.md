# exp

Scratch space for experiments. Each folder is a standalone page that the dev server serves as is
(`npm run dev`, then open `/exp/<folder>/`). None of it is part of the app build.

## pond

`/exp/pond/`: an interactive koi pond, rebuilt after the one on shwn.design. It uses raw WebGL2 with
no libraries. The pass buttons under the pond show each intermediate texture on its own.

How a frame is made:

1. **Ripples** (`RIPPLE_FS`): a wave equation stepped on the GPU, ping-ponging two float textures.
   It holds two fields: fine ripples (taps, tail flicks) that fade fast, and a slower wake that the
   fish push along. The equation is only stable for small steps, so each frame runs up to 12
   substeps of at most 1/300 s.
2. **Surface** (`SURFACE_FS`): three octaves of drifting simplex noise for the calm swell, plus the
   ripple fields. It writes height, slope and curvature.
3. **Caustics** (`CAUSTIC_VS/FS`): the technique from Evan Wallace's
   [WebGL Water](https://madebyevan.com/webgl-water/). A grid of triangles every 2 px is pushed
   along the surface slope. Where triangles get squeezed, light is concentrated, so
   brightness = area before / area after (from `dFdx`/`dFdy`). The result is blended additively,
   then blurred.
4. **Pond bed** (`BED_FS`): sand, pebbles and three stones with ray-marched sun shadows. It is
   painted once per resize, not every frame.
5. **Koi** (`koi.ts` + `FISH_FS`): the CPU steers each head (wander goals, avoid the banks and the
   other fish, bolt when scared). The body just follows the head's own trail, with a travelling
   sine wave on top. That is why turns bend like a real fish. Each fish is a 64 x 9 ribbon mesh.
   The fragment shader draws the body, scales, markings, eyes and ray-veined fins analytically.
   The same mesh, offset away from the sun, gives the blurred shadow.
6. **Seaweed**: tapered strips rebuilt on the CPU each frame and drawn onto the bed layer, so
   caustics and shadows fall across them.
7. **Composite** (`COMPOSITE_FS`): refracts the bed through the surface slope, splits the caustics
   per colour channel, uses surface curvature to turn ripples into bright and dark rings, lays
   the fish over the top, then applies ACES tonemapping.
8. **Finish** (`FINISH_FS`): a feathered, wandering rounded edge so the pond fades into the page,
   plus film grain.

Good knobs to play with are in `renderer.ts` (`u_depth` for caustic sharpness, `u_refraction`,
`u_rings`, `AMBIENT`/`SUN`, the stone and seaweed layouts) and `koi.ts` (`START`, cruise speed,
fear).

## frog-pond

> Shipped: the pond now runs on the real home page (`src/pond`, mounted by
> `src/components/PondBackground.tsx`), half pond only, with the weather toggle in its corner. This
> folder is the prototype it came from, kept for its corner readout and URL flags; the home page is
> the version to change.

`/exp/frog-pond/`: a prototype of a full-screen night pond meant as the home page background.
It has lily pads, water lilies, 3 koi, fireflies, and 5 frogs in 5 colours (green, olive
bullfrog, leopard, golden, wood frog). Frogs blink, croak, hop between pads, dive in, swim with
a proper frog kick that leaves a V wake like the koi, and climb back out onto free pads. Click a
sitting frog and it leaps in with a real splash (white crown, droplets, a train of rings, the
droplets rippling where they land), then dives and swims off along the bottom before surfacing;
click a swimmer and it dives the same way. The page cards cast shadows into the pond from the
current light. There is a
mock of the home UI on top so readability can be judged. The corner readout shows fps, GPU ms
(where the browser reports it), the quality tier and the current state. Press H to hide it.

It reuses the koi pond's water pipeline but is built not to cost much:

- The ripple sim runs at 1/2 resolution on the top tiers (crisp rings) and 1/4 below, and the
  shadow map at the sim size. Coarse texels also let each ripple step be longer, so it takes 1 to 3
  steps a frame instead of the koi pond's 12.
- The surface and caustics render at up to half resolution, with a sparser caustic grid.
- The canvas renders at full resolution by default (0.35x to 0.85x on the lower tiers, stretched up). It is opaque, and everything draws
  straight into it, so there is no full-size offscreen scene.
- The bed and the underwater weed are baked once. The pads, flowers and frogs are one
  instanced quad each.
- The frame rate is capped at 60 fps on the top tier and 30 or lower below it, drops to 12 fps after 20 s without input, and stops when
  the tab is hidden. With reduced motion it only runs for 4 s after each input.
- `quality.ts` starts at the top tier (data saver and 2-core devices get the still background), then steps
  down if GPU time goes over 7 ms or frames arrive late, and freezes on the last frame as a last
  resort. Weak devices get a painted still background and nothing runs.

URL flags: `?tier=0-5` or `?tier=poster` to force a tier, `?koi=0`, `?seed=n` for a fixed layout.

Weather (`environments.ts`), switched with the 1-4 buttons in the corner readout, the 1-4 keys, or
`?env=`. Switching blends every setting over 2.5 s, and the bed's stone shadows are repainted
halfway through and at the end:

1. **overcast**: grey, moonlit, the calm before the rain (the original look)
2. **rain**: raindrops ripple the whole surface, ripple crests catch the grey sky so the rings
   read, slanted streaks, flat light, murky water, frogs croak 3x as often
3. **sunset**: a low sun off the left edge, long shadows to the right, warm key light over violet
   ambient, an orange glare and glitter on the water, a warm haze, a few early fireflies
4. **midday**: the sun nearly overhead, clear water down to the bed, crisp short shadows, strong
   caustics, twinkling sun glitter

Layout, switched from the corner readout or `?frame=half`:

- **full pond**: the pond fills the page behind the content
- **half pond**: the pond is only the top of the page. A solid shape in the page colour rises
  from a flat shelf just below the cards to frame the card row, with rounded top corners and
  concave curves into the shelf. It is an SVG over the canvas, so its edge is crisp at any render
  scale. Pads,
  frogs and koi are laid out again to live above the shoreline, and nothing below it is drawn at
  all (the canvas is scissored), which roughly halves the frame on a typical screen.

Theme follows the app: it starts from `ms-theme` in localStorage (the key the app saves), can be
switched from the corner readout or `?theme=light`, and sets the same `.light` class on `<html>`,
so the real cards restyle themselves. The half layout's shore is filled with the theme's page colour
(`var(--panel2)`). The water itself is only ever darkened at its edges and behind the title (washing it
toward a light page read as a white glare), and the title and tagline keep light ink on both themes,
since they always sit on the water; the hint does too whenever the pond runs under it.