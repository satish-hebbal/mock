// GLSL for the night frog pond (the frogs themselves are in frog-shader.ts). The water machinery (ripples, caustics, blur, koi) is borrowed from the
// koi pond experiment; everything new lives here. Everything draws straight into the canvas at a
// reduced resolution, so there is no full size offscreen scene: composite, then fish, pads, flowers and
// frogs blended on top, then one overlay pass for fireflies, vignette and grain.
//
// Coordinates are pond px (CSS px of the page, origin top left, y down). Light comes from a moon in the
// upper right, so shadows fall down and to the left.

import { FISH_FS as POND_FISH_FS, HEADER, NOISE, RIPPLE_FS as POND_RIPPLE_FS } from '../pond/shaders'

export { BLUR_FS, CAUSTIC_FS, CAUSTIC_VS, FISH_VS, FULLSCREEN_VS, SHADOW_FS, WEED_FS, WEED_VS } from '../pond/shaders'

// swap one exact piece of borrowed GLSL, loudly, so an edit to the koi pond can't silently break this
function patch(src: string, find: string, replace: string) {
  if (!src.includes(find)) throw new Error(`frog pond: shader patch target missing: ${find.slice(0, 60)}`)
  return src.replace(find, replace)
}

// the koi pond's wave sim, with room for twice the pushes: koi and swimming frogs both leave wakes
export const MAX_PUSHES = 32
export const RIPPLE_FS = patch(POND_RIPPLE_FS, 'uniform vec4 u_pushes[16];', `uniform vec4 u_pushes[${MAX_PUSHES}];`)

// shared by every pass that writes final colour, so pads, frogs, fish and water tonemap identically
export const TONE = `
uniform float u_exposure;
uniform vec4 u_grade;    // the weather's colour grade: rgb tint, a saturation
uniform vec3 u_lightDir; // toward the key light (moon or sun), pond coordinates: x right, y down, z up
#define LIGHT_DIR u_lightDir
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 display(vec3 c) {
  c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, u_grade.a) * u_grade.rgb;
  return pow(aces(c * u_exposure), vec3(1.0 / 2.2));
}
`

// ---------------------------------------------------------------------------------------------
// Surface: like the koi pond's, but the ripple sim runs at a quarter resolution, so it is sampled
// with filtering instead of fetched texel for texel.

export const SURFACE_FS = `${HEADER}${NOISE}
in vec2 v_uv;
uniform sampler2D u_state;
uniform vec2 u_size;
uniform float u_time;
uniform float u_scale;
uniform vec2 u_fine;
uniform vec2 u_wake;
out vec4 o;
void main() {
  vec2 ts = vec2(textureSize(u_state, 0));
  vec2 du = vec2(1.0 / ts.x, 0.0), dv = vec2(0.0, 1.0 / ts.y);
  vec2 texel = u_size / ts;
  vec4 h = texture(u_state, v_uv);
  vec4 hr = texture(u_state, v_uv + du);
  vec4 hl = texture(u_state, v_uv - du);
  vec4 hu = texture(u_state, v_uv + dv);
  vec4 hd = texture(u_state, v_uv - dv);
  vec2 fineSlope = vec2(hr.r - hl.r, hd.r - hu.r) / (2.0 * texel);
  vec2 wakeSlope = vec2(hr.b - hl.b, hd.b - hu.b) / (2.0 * texel);
  wakeSlope /= 1.0 + length(wakeSlope) * 1.5;
  vec4 lap = (hr + hl + hu + hd - 4.0 * h) / (texel.x * texel.y);

  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_size;
  float ca = cos(0.7), sa = sin(0.7);
  mat2 M = mat2(ca * 1.06, -sa / 1.06, sa * 1.06, ca / 1.06) * u_scale;
  vec2 q = M * p;
  float t = u_time;
  vec3 g;
  float swell = snoiseGrad(vec3(q + vec2(t * 0.05, t * 0.032), t * 0.3), g);
  vec2 slope = g.xy;
  swell += 0.42 * snoiseGrad(vec3(q * 1.97 + vec2(-t * 0.045, t * 0.07) + 11.3, t * 0.42), g);
  slope += 0.42 * 1.97 * g.xy;
  swell += 0.15 * snoiseGrad(vec3(q * 4.1 + vec2(t * 0.09, -t * 0.06) - 7.1, t * 0.6), g);
  slope += 0.15 * 4.1 * g.xy;
  slope = transpose(M) * slope;
  o = vec4(swell + h.r * u_fine.x + h.b * u_wake.x,
           slope + fineSlope * u_fine.x * u_fine.y + wakeSlope * u_wake.x * u_wake.y,
           lap.r * u_fine.x + lap.b * u_wake.x);
}`

// ---------------------------------------------------------------------------------------------
// Bed: dark silt, leaf litter and a few stones, painted once per resize. rgb albedo, a = moonlit / 1.5.

export const STONE_COUNT = 6

export const BED_FS = `${HEADER}${NOISE}
in vec2 v_uv;
uniform vec2 u_size;
uniform float u_unit;
uniform float u_pixel;
uniform vec4 u_stone[${STONE_COUNT}];    // centre x, y, angle, seed
uniform vec4 u_stoneDim[${STONE_COUNT}]; // half length, half width, height, tone
out vec4 o;
const int STONES = ${STONE_COUNT};
uniform vec3 u_sunDir;
vec3 SUN;
vec2 TO_SUN;
float RISE; // how far a ray toward the light climbs per px it travels sideways

vec3 voronoi(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0;
  vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + hash22(n + g) - f;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = n + g; } else if (d < f2) f2 = d;
  }
  return vec3(sqrt(f1), sqrt(f2), hash12(id * 7.13));
}
vec2 local(vec2 p, int i) {
  vec2 d = p - u_stone[i].xy;
  float a = u_stone[i].z;
  return vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y) / u_stoneDim[i].xy;
}
float reach(int i) { return max(u_stoneDim[i].x, u_stoneDim[i].y) * 1.3; }
float dome(vec2 p, int i, out float rho) {
  vec2 q = local(p, i);
  float seed = u_stone[i].w;
  float t = atan(q.y, q.x + 1e-6);
  float w = 1.0 + 0.06 * cos(t + seed * 41.0) + 0.07 * cos(2.0 * t + seed * 73.0) + 0.04 * cos(3.0 * t + seed * 29.0);
  rho = length(q) / w;
  if (rho >= 1.0) return 0.0;
  return u_stoneDim[i].z * pow(1.0 - rho * rho, 0.7);
}
float bedHeight(vec2 p, int skip) {
  float h = 0.0, rho;
  for (int i = 0; i < STONES; i++) {
    if (i == skip || distance(p, u_stone[i].xy) > reach(i)) continue;
    h = max(h, dome(p, i, rho));
  }
  return h;
}
float sunlight(vec2 p, float h0, int skip) {
  float blocked = -1.0;
  for (int k = 1; k <= 14; k++) {
    float d = float(k) * 1.8 * u_unit;
    blocked = max(blocked, (bedHeight(p + TO_SUN * d, skip) - h0 - d * RISE) / d);
  }
  return 1.0 - smoothstep(-0.4, 0.4, blocked);
}

void main() {
  SUN = normalize(u_sunDir);
  TO_SUN = normalize(SUN.xy + vec2(1e-4));
  RISE = min(SUN.z / max(length(SUN.xy), 1e-3), 12.0);
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_size;
  vec2 up = p / u_unit;
  // silt with darker hollows, a litter of sunken leaves, and grit
  float broad = snoise(vec3(up * 0.0025, 1.3)) * 0.6 + snoise(vec3(up * 0.007, 7.7)) * 0.3 + snoise(vec3(up * 0.02, 2.2)) * 0.15;
  vec3 c = mix(vec3(0.16, 0.21, 0.17), vec3(0.3, 0.35, 0.27), smoothstep(-0.6, 0.6, broad));
  vec3 leaf = voronoi(up / vec2(70.0, 40.0) + 3.0);
  float leaves = step(0.8, leaf.z) * (1.0 - smoothstep(0.3, 0.5, leaf.x));
  c = mix(c, vec3(0.2, 0.17, 0.11), leaves * 0.45);
  vec3 grit = voronoi(up / 2.2);
  c *= mix(0.85, 1.08, grit.z) * mix(0.8, 1.0, smoothstep(0.0, 0.25, grit.y - grit.x));
  c *= 0.9 + 0.2 * vnoise(up * 1.7);

  int top = -1;
  float topRho = 2.0, topH = 0.0;
  bool near = false;
  for (int i = 0; i < STONES; i++) {
    float d = distance(p, u_stone[i].xy);
    if (d > reach(i) + 28.0 * u_unit) continue;
    near = true;
    if (d > reach(i)) continue;
    float rho;
    float h = dome(p, i, rho);
    if (rho < 1.05 && (top < 0 || h > topH)) { top = i; topRho = rho; topH = h; }
  }
  float sun = 1.0;
  if (near) {
    float rho;
    for (int i = 0; i < STONES; i++) {
      dome(p, i, rho);
      float gap = max(rho - 1.0, 0.0) * (u_stoneDim[i].x + u_stoneDim[i].y) * 0.5;
      c *= 1.0 - 0.35 * exp(-gap / (0.5 * u_stoneDim[i].z + u_unit));
    }
    sun = sunlight(p, 0.0, -1);
  }
  if (top >= 0) {
    float e = 0.6, rho;
    vec2 gr = vec2(dome(p + vec2(e, 0.0), top, rho) - dome(p - vec2(e, 0.0), top, rho),
                   dome(p + vec2(0.0, e), top, rho) - dome(p - vec2(0.0, e), top, rho)) / (2.0 * e);
    vec3 n = normalize(vec3(-gr / max(1.0, length(gr) / 3.0), 1.0));
    float tone = u_stoneDim[top].w;
    vec3 stone = tone < 0.5 ? vec3(0.36, 0.4, 0.38) : tone < 1.5 ? vec3(0.44, 0.41, 0.32) : vec3(0.2, 0.23, 0.22);
    vec2 sp = up + u_stone[top].w * 97.0;
    stone *= 1.0 + 0.16 * snoise(vec3(sp * 0.04, u_stone[top].w * 5.0));
    stone = mix(stone, vec3(0.24, 0.32, 0.18), smoothstep(0.1, 0.8, snoise(vec3(sp * 0.05, 9.0))) * smoothstep(0.5, 0.9, n.z) * 0.35);
    stone *= mix(0.6, 1.0, smoothstep(1.0, 0.5, topRho));
    float edge = (topRho - 1.0) * (u_stoneDim[top].x + u_stoneDim[top].y) * 0.5;
    float cover = 1.0 - smoothstep(-0.75 * u_pixel, 0.75 * u_pixel, edge);
    float lambert = mix(max(dot(n, SUN), 0.0) / SUN.z, n.z, 0.2);
    c = mix(c, stone, cover);
    sun = mix(sun, lambert * sunlight(p, topH, top), cover);
  }
  o = vec4(c, clamp(sun / 1.5, 0.0, 1.0));
}`

// ---------------------------------------------------------------------------------------------
// Composite: the water, straight into the canvas.

export const COMPOSITE_FS = `${HEADER}${NOISE}${TONE}
in vec2 v_uv;
uniform sampler2D u_bed;
uniform sampler2D u_surface;
uniform sampler2D u_caustic;
uniform sampler2D u_shadow;
uniform vec2 u_size;
uniform float u_time;
uniform vec3 u_ambient;
uniform vec3 u_key;
uniform vec3 u_water;
uniform float u_clarity;       // how much of the bed shows through the water
uniform float u_causticGain;
uniform float u_shadowStrength;
uniform float u_refraction;
uniform float u_dispersion;
uniform float u_rings;
uniform vec3 u_sky;            // sky colour reflected on the side toward the light
uniform vec3 u_sky2;           // and on the far side
uniform vec3 u_glow;           // the moon or sun reflection: centre x, y and radius in pond px
uniform vec3 u_glowColor;
uniform float u_glowStrength;
uniform float u_glitter;       // sparks off ripples that tilt to mirror the sun
uniform float u_ringShine;     // ripple crests catching the sky, which is how raindrop rings read
uniform float u_reflect;
out vec4 o;
vec2 uvOf(vec2 p) { return vec2(p.x / u_size.x, 1.0 - p.y / u_size.y); }
void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_size;
  vec4 S = texture(u_surface, v_uv);
  vec2 pf = p - S.yz * u_refraction;
  vec4 bed = texture(u_bed, uvOf(pf));
  vec3 albedo = pow(bed.rgb, vec3(2.2));
  float lit = bed.a * 1.5;

  vec2 split = S.yz * u_dispersion;
  vec3 C = vec3(texture(u_caustic, uvOf(pf + split)).r, texture(u_caustic, uvOf(pf)).r, texture(u_caustic, uvOf(pf - split)).r);
  C = pow(max(C, 0.0), vec3(1.5)) * 0.8;
  C *= exp(1.2 * tanh(-u_rings * S.w / 1.2));

  float shadow = texture(u_shadow, uvOf(pf)).r * u_shadowStrength;
  vec3 light = u_ambient * (1.0 - 0.5 * shadow) + u_key * C * u_causticGain * lit * (1.0 - 0.92 * shadow);
  // the water column: the bed fades toward the water colour the murkier it is
  vec3 col = albedo * light * u_clarity + u_water;

  // the sky reflected in the surface, warmer on the side the light comes from
  float fresnel = 0.35 + 0.65 * pow(1.0 - clamp(1.0 - length(S.yz) * 6.0, 0.0, 1.0), 3.0);
  vec2 toward = normalize(LIGHT_DIR.xy + vec2(1e-4));
  float side = clamp(dot((p - u_size * 0.5) / max(u_size.x, u_size.y), toward) * 1.4 + 0.5, 0.0, 1.0);
  col += mix(u_sky2, u_sky, side) * fresnel;
  // the moon or sun reflected, broken up by the swell
  vec2 rp = p + S.yz * u_reflect;
  float md = length(rp - u_glow.xy) / u_glow.z;
  float core = exp(-md * md * 2.2);
  float glitter = smoothstep(0.15, 0.75, dot(S.yz, vec2(-0.7, 0.7)) * 45.0 + 0.35);
  float halo = exp(-md * 1.4) * 0.07 + exp(-md * 0.4) * 0.02;
  col += u_glowColor * (core * (0.08 + 0.4 * glitter) + halo) * u_glowStrength;
  // sun glitter: pinpoint sparks that twinkle where a ripple faces the sun, thickest around its reflection
  vec3 n = normalize(vec3(-S.yz * 7.0, 1.0));
  float facing = pow(max(dot(n, normalize(LIGHT_DIR + vec3(0.0, 0.0, 1.0))), 0.0), 400.0);
  float twinkle = smoothstep(0.78, 0.95, vnoise(p * 0.7 + vec2(u_time * 3.1, -u_time * 2.3)));
  col += u_glowColor * facing * twinkle * u_glitter * (0.6 + 3.0 * exp(-md * 0.6));
  // ripple crests catch the sky and troughs lose it: raindrop rings, taps and wakes read as rings of light
  float crest = clamp(-S.w * 160.0, -1.0, 1.0);
  col += (mix(u_sky2, u_sky, side) * 3.0 + vec3(0.02, 0.025, 0.03)) * crest * u_ringShine;

  col = display(col);
  col += (hash12(gl_FragCoord.xy + fract(u_time * 7.13) * 311.0) - 0.5) * 0.02;
  o = vec4(col, 1.0);
}`

// ---------------------------------------------------------------------------------------------
// Koi: the koi pond's fish, with the light moved to the moon and the result tonemapped in place,
// dimmed and tinted as if seen through a little murky water.

export const FISH_FS = patch(
  patch(
    patch(POND_FISH_FS, 'vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }', `${TONE}\nuniform vec3 u_water;`),
    'vec3 Ld = normalize(vec3(-0.42, -0.52, 0.74));',
    'vec3 Ld = normalize(LIGHT_DIR);',
  ),
  '  o = acc;\n}',
  `  if (acc.a <= 0.0) { o = vec4(0.0); return; }
  vec3 seen = (acc.rgb / acc.a) * 0.7 + u_water;
  o = vec4(display(seen) * acc.a, acc.a);
}`,
)

// ---------------------------------------------------------------------------------------------
// Lily pads and water lilies: one instanced quad each, shaped entirely in the fragment shader.
// They float on the surface, so they bob and drift with the water under their centre.

export const PAD_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec4 a_pad;  // centre x, y, radius, angle
in vec4 a_look; // seed, kind (0 pad, 1 flower), tint, 0
uniform sampler2D u_surface;
uniform vec2 u_size;
uniform float u_time;
uniform float u_bob;
uniform vec2 u_offset; // shadow pass
out vec2 v_q;
out vec4 v_look;
out vec3 v_tilt; // surface slope under the centre (pond coords) and radius in px
out vec2 v_rot;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
  float extent = a_look.y > 0.5 ? 1.5 : 1.12;
  vec4 S = texture(u_surface, vec2(a_pad.x / u_size.x, 1.0 - a_pad.y / u_size.y));
  float a = a_pad.w + 0.05 * sin(u_time * 0.13 + a_look.x * 20.0);
  vec2 rot = vec2(cos(a), sin(a));
  vec2 q = corner * extent;
  vec2 p = a_pad.xy - S.yz * u_bob + vec2(rot.x * q.x - rot.y * q.y, rot.y * q.x + rot.x * q.y) * a_pad.z + u_offset;
  v_q = q;
  v_look = a_look;
  v_tilt = vec3(S.yz, a_pad.z);
  v_rot = rot;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
}`

export const PAD_FS = `${HEADER}${NOISE}${TONE}
in vec2 v_q;
in vec4 v_look;
in vec3 v_tilt;
in vec2 v_rot;
uniform int u_mode; // 0 colour, 1 silhouette for the shadow map
uniform float u_scale; // canvas px per pond px
uniform vec3 u_ambient;
uniform vec3 u_key;
out vec4 o;

vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }

// light a surface colour: flat leaf tilted by the water, plus a waxy sheen
vec3 shade(vec3 albedo, vec3 n, float sheen) {
  vec3 L = normalize(LIGHT_DIR);
  float dif = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 24.0);
  return lin(albedo) * (u_ambient * 2.2 + u_key * (0.4 + 0.6 * dif)) + u_key * spec * sheen;
}

// the nearest petal of a ring. x: coverage, y: 0 base .. 1 tip, z: 0 midline .. 1 edge
vec3 petal(vec2 q, float n, float rot, float len, float wid, float aa) {
  float a = atan(q.y, q.x) - rot;
  float step_ = 6.2831853 / n;
  float da = a - floor(a / step_ + 0.5) * step_;
  vec2 pq = vec2(cos(da), sin(da)) * length(q) / len;
  float halfW = wid * pow(max(sin(3.14159 * clamp(pq.x, 0.0, 1.0)), 0.0), 0.75);
  float d = max(abs(pq.y) - halfW, max(-pq.x, pq.x - 1.0)) * len;
  return vec3(1.0 - smoothstep(-aa, aa, d), pq.x, abs(pq.y) / max(halfW, 1e-3));
}

void main() {
  float seed = v_look.x;
  float aa = 1.0 / (v_tilt.z * u_scale);
  vec2 q = v_q;
  float r = length(q);
  float a = atan(q.y, q.x);
  vec3 n = normalize(vec3(-v_tilt.xy * 5.0, 1.0));

  if (v_look.y > 0.5) {
    // a water lily: three rings of petals, the inner ones cupped up and paler, a gold centre
    vec3 outer = petal(q, 10.0, seed * 6.28, 1.0, 0.21, aa);
    vec3 mid = petal(q, 8.0, seed * 6.28 + 0.39, 0.74, 0.25, aa);
    vec3 inner = petal(q, 6.0, seed * 6.28 + 0.2, 0.5, 0.3, aa);
    float centre = 1.0 - smoothstep(0.17 - aa, 0.17 + aa, r);
    if (u_mode == 1) {
      float cover = max(max(outer.x, mid.x), max(inner.x, centre));
      o = vec4(cover, 0.0, 0.0, cover);
      return;
    }
    float pink = fract(seed * 7.7);
    vec3 tip = mix(vec3(0.96, 0.94, 0.95), vec3(0.96, 0.66, 0.8), pink);
    vec4 acc = vec4(0.0);
    vec3 c = mix(vec3(0.9, 0.9, 0.86), tip, smoothstep(0.45, 1.0, outer.y)) * (0.78 + 0.22 * (1.0 - outer.z * outer.z));
    c *= mix(0.7, 1.0, smoothstep(0.45, 0.8, r)); // shaded where the next ring overlaps
    acc = over(vec4(display(shade(c, n, 0.1) + lin(c) * 0.04) * outer.x, outer.x), acc);
    c = mix(vec3(0.95, 0.95, 0.92), tip, smoothstep(0.6, 1.0, mid.y) * 0.6) * (0.82 + 0.18 * (1.0 - mid.z * mid.z));
    c *= mix(0.75, 1.0, smoothstep(0.3, 0.55, r));
    acc = over(vec4(display(shade(c, n, 0.1) + lin(c) * 0.05) * mid.x, mid.x), acc);
    c = vec3(0.98, 0.97, 0.93) * (0.85 + 0.15 * (1.0 - inner.z * inner.z));
    acc = over(vec4(display(shade(c, n, 0.1) + lin(c) * 0.06) * inner.x, inner.x), acc);
    float stamen = 0.8 + 0.4 * step(0.5, fract(a * 3.8197 + r * 9.0));
    c = mix(vec3(0.96, 0.62, 0.1), vec3(1.0, 0.85, 0.3), smoothstep(0.17, 0.05, r)) * stamen;
    acc = over(vec4(display(shade(c, vec3(0.0, 0.0, 1.0), 0.0) + lin(c) * 0.08) * centre, centre), acc);
    // a faint glow around the bloom, added rather than blended (alpha stays put)
    acc.rgb += vec3(0.8, 0.85, 0.95) * 0.05 * exp(-r * r * 1.4) * (1.0 - acc.a);
    o = acc;
    return;
  }

  // the pad: a wobbly disc with a slit cut from the centre to the rim
  float tint = v_look.z;
  float wob = 1.0 + 0.022 * sin(a * 3.0 + seed * 40.0) + 0.012 * sin(a * 7.0 + seed * 13.0);
  float notch = 0.12 + 0.06 * fract(seed * 5.3);
  float d = max(r - wob, r * sin(clamp(notch - abs(a), -1.5, 1.5)));
  float cover = 1.0 - smoothstep(-aa, aa, d);
  float wet = (1.0 - smoothstep(0.0, 0.08, d)) * (1.0 - cover); // a dark meniscus hugging the rim
  if (u_mode == 1) {
    o = vec4(cover, 0.0, 0.0, cover);
    return;
  }
  vec3 c = mix(vec3(0.19, 0.4, 0.1), vec3(0.34, 0.42, 0.13), smoothstep(0.0, 0.6, tint));
  c *= 0.84 + 0.3 * (vnoise(q * 3.0 + seed * 20.0) * 0.6 + vnoise(q * 9.0 + seed * 7.0) * 0.4);
  // older pads go yellow and brown, spreading in from the rim
  float decay = smoothstep(0.55, 1.0, tint) * smoothstep(0.35, 0.75, vnoise(q * 2.5 + seed * 31.0) + r * 0.4 - 0.2);
  c = mix(c, vec3(0.52, 0.47, 0.16), decay * 0.8);
  // veins radiating from the centre
  float veins = 18.0 + floor(fract(seed * 3.1) * 8.0);
  float arc = abs(fract(a / 6.2831853 * veins + seed * 3.0) - 0.5) * 6.2831853 * r / veins;
  float vein = (1.0 - smoothstep(0.004, 0.012 + aa, arc)) * smoothstep(0.06, 0.2, r) * (1.0 - smoothstep(0.85, 0.97, r));
  c *= 1.0 + 0.2 * vein;
  c *= 1.0 + 0.18 * (1.0 - smoothstep(0.0, 0.07, r));
  // a raised lip, and on some pads a curled edge showing the red underside
  float lip = smoothstep(-0.07, -0.01, d) * cover;
  c = mix(c, c * 1.25 + vec3(0.03, 0.03, 0.0), lip * 0.5);
  float curl = step(0.72, fract(seed * 5.1)) * smoothstep(-0.18, -0.03, d) * smoothstep(0.3, 1.0, cos(a - seed * 17.0));
  c = mix(c, vec3(0.38, 0.2, 0.14), curl * 0.8);
  // beads of water
  vec2 cell = floor(q * 7.0 + seed * 9.0);
  vec2 f = fract(q * 7.0 + seed * 9.0) - 0.5 - (hash22(cell) - 0.5) * 0.5;
  float bead = step(0.965, hash12(cell + 3.7)) * (1.0 - smoothstep(0.05, 0.05 + aa * 7.0, length(f))) * smoothstep(0.9, 0.7, r);
  vec3 lit = shade(c, n, 0.14) + u_key * bead * 0.5;
  o = vec4(display(lit) * cover, max(cover, wet * 0.45));
}`

// ---------------------------------------------------------------------------------------------
// Overlay: one blended pass over everything. Alpha darkens (vignette, the dim patch behind the page
// content, the dark half of the grain) and rgb adds light (fireflies and their reflections, the
// bright half of the grain), so it never has to read the canvas back.

export const OVERLAY_FS = `${HEADER}${NOISE}
in vec2 v_uv;
uniform sampler2D u_surface;
uniform vec2 u_size;
uniform float u_unit;
uniform int u_flyCount;
uniform vec4 u_flies[16]; // x, y, brightness, size
uniform vec4 u_focus;     // centre x, y, radii x, y of the area behind the page content
uniform float u_focusDark;
uniform float u_edgeDark;
uniform float u_grain;
uniform float u_grainFrame;
uniform float u_grainSize;
uniform float u_flyGain;
uniform float u_rain;
uniform float u_time;
uniform vec3 u_haze;
uniform vec3 u_lightDir;
uniform int u_cardCount;
uniform vec4 u_cards[8];     // the page's cards: x, y, width, height in pond px
uniform float u_cardRadius;
uniform vec2 u_cardShift;    // where the cast shadow lands, away from the light
uniform float u_cardBlur;    // its penumbra: wider the further it falls and the softer the light
uniform float u_cardShadow;  // strength
uniform vec3 u_page;         // the page colour for the theme, so the pond hands over to it exactly
uniform float u_wobble;      // how far the water bends the shadow on the bed below it
uniform int u_sprayCount;
uniform vec4 u_sprays[8];    // splashes: x, y, age in seconds, size (the body length that hit the water)
out vec4 o;
float grainAt(vec2 x) { return (vnoise(x) * 0.65 + vnoise(x * 2.03 + 19.7) * 0.35 - 0.5) * 2.0; }
float sdRoundBox(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_size;
  vec2 c = (p - u_size * 0.5) / (u_size * 0.5);
  // wash: how far the pond gives way to the page colour, at the edges and behind the page content.
  // On the dark theme that reads as darkening, on the light one as the pond fading into the white.
  float wash = u_edgeDark * smoothstep(0.35, 1.25, length(c * vec2(1.0, 0.9)));
  wash = max(wash, u_focusDark * (1.0 - smoothstep(0.55, 1.0, length((p - u_focus.xy) / u_focus.zw))));
  float dark = 0.0; // shadows, which darken on either theme

  vec4 S = texture(u_surface, v_uv);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < u_flyCount; i++) {
    vec4 f = u_flies[i];
    float d = length(p - f.xy);
    float core = exp(-d * d / (f.w * f.w));
    float halo = exp(-d / (f.w * 5.0)) * 0.12;
    // its reflection sits just below it and wobbles with the water
    float dr = length(p + S.yz * 180.0 * u_unit - f.xy - vec2(-5.0, 12.0) * u_unit);
    float mirror = exp(-dr * dr / (f.w * f.w * 3.0)) * 0.3 + exp(-dr / (f.w * 4.0)) * 0.03;
    glow += vec3(0.82, 1.0, 0.42) * f.z * u_flyGain * (core + halo + mirror);
  }
  // air lit by a low sun, strongest on its side of the pond
  vec2 toward = normalize(u_lightDir.xy + vec2(1e-4));
  glow += u_haze * pow(clamp(dot(c, toward) * 0.5 + 0.5, 0.0, 1.0), 2.0);
  // rain: slanted streaks falling past the eye, a near layer and a finer far one
  if (u_rain > 0.0) {
    float streaks = 0.0;
    for (int k = 0; k < 2; k++) {
      float size = k == 0 ? 1.0 : 0.6;
      vec2 rp = mat2(0.97, 0.26, -0.26, 0.97) * (p / (u_unit * size));
      rp.y -= u_time * (k == 0 ? 1100.0 : 800.0);
      vec2 cell = floor(rp / vec2(9.0, 90.0));
      vec2 f = fract(rp / vec2(9.0, 90.0));
      float h = hash12(cell + float(k) * 17.0);
      float x0 = 0.2 + 0.6 * hash12(cell + 3.1);
      float len = 0.25 + 0.3 * h;
      float streak = step(1.0 - 0.5 * u_rain, h) * (1.0 - smoothstep(0.0, 0.12, abs(f.x - x0)))
                   * smoothstep(0.0, len * 0.3, f.y) * (1.0 - smoothstep(len * 0.7, len, f.y));
      streaks += streak * (k == 0 ? 0.07 : 0.04);
    }
    glow += vec3(0.75, 0.82, 0.9) * streaks * u_rain;
  }
  // the cards float above the pond and shade it: a tight, dark contact shadow right under each one,
  // and a softer cast shadow thrown away from the light. Both land on the bed seen through the water,
  // so the ripples bend them a little.
  if (u_cardCount > 0 && u_cardShadow > 0.0) {
    vec2 pw = p - S.yz * u_wobble;
    float shade = 0.0;
    for (int i = 0; i < u_cardCount; i++) {
      vec4 r = u_cards[i];
      vec2 centre = r.xy + r.zw * 0.5;
      float dContact = sdRoundBox(pw - centre - u_cardShift * 0.12, r.zw * 0.5, u_cardRadius);
      float contact = 1.0 - smoothstep(-3.0 * u_unit, 12.0 * u_unit, dContact);
      float dCast = sdRoundBox(pw - centre - u_cardShift, r.zw * 0.5 - 2.0 * u_unit, u_cardRadius + u_cardBlur * 0.3);
      float thrown = 1.0 - smoothstep(-u_cardBlur * 0.8, u_cardBlur * 1.4, dCast);
      shade = max(shade, max(contact * 0.45, thrown * 0.62));
    }
    dark = 1.0 - (1.0 - dark) * (1.0 - shade * u_cardShadow);
  }
  // splashes: a white crown flung up the instant a body hits, breaking apart as it spreads; droplets
  // arcing out (bigger at the top of their flight, nearer the eye); and a patch of foam that lingers
  for (int i = 0; i < u_sprayCount; i++) {
    vec4 sp = u_sprays[i];
    vec2 d = p - sp.xy;
    float dist = length(d);
    float R = sp.w;
    float t = sp.z;
    if (dist > R * 3.5 || t > 1.0) continue;
    float ang = atan(d.y, d.x);
    float ringR = R * (0.25 + 1.6 * t / (t + 0.25));
    float breakup = smoothstep(0.35, 0.75, vnoise(vec2(ang * 5.0 + sp.x, t * 6.0 + sp.y)));
    float crown = exp(-pow((dist - ringR) / (R * 0.14), 2.0)) * max(0.0, 1.0 - t / 0.55) * (0.35 + 0.65 * breakup);
    float burst = exp(-dist * dist / (R * R * 0.12)) * max(0.0, 1.0 - t / 0.18); // the white of the impact itself
    float foam = exp(-dist * dist / (R * R * 0.35)) * max(0.0, 1.0 - t / 0.95) * (0.45 + 0.55 * vnoise(d / (R * 0.1) + sp.xy));
    float drops = 0.0;
    for (int k = 0; k < 20; k++) {
      float h1 = hash12(sp.xy + float(k) * 7.31);
      float h2 = hash12(sp.xy + float(k) * 3.17 + 11.0);
      float flight = 0.35 + 0.35 * h2;
      if (t > flight) continue;
      float a = h1 * 6.2831853;
      vec2 at = sp.xy + vec2(cos(a), sin(a)) * R * (1.2 + 1.6 * h2) * (t / flight);
      float lift = sin(3.14159 * t / flight);
      float size = (1.6 + 3.0 * lift) * u_unit * (0.7 + 0.7 * h1);
      float dd = length(p - at);
      drops += exp(-dd * dd / (size * size)) * (0.6 + 0.4 * lift);
    }
    glow += vec3(0.85, 0.9, 0.95) * (crown * 1.1 + burst * 0.9 + foam * 0.3 + drops * 0.9);
  }
  float a = 1.0 - (1.0 - wash) * (1.0 - dark);
  float g = grainAt(gl_FragCoord.xy / u_grainSize + hash22(vec2(u_grainFrame, 7.0)) * 512.0) * u_grain * (1.0 - wash);
  o = vec4(u_page * wash + glow * (1.0 - a) + max(g, 0.0), clamp(a + max(-g, 0.0), 0.0, 1.0));
}`

// pass viewer
export const DEBUG_FS = `${HEADER}
in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_mode;
out vec4 o;
void main() {
  vec4 t = texture(u_tex, v_uv);
  vec3 c;
  if (u_mode == 1) c = vec3(t.r * 0.35);
  else if (u_mode == 2) c = vec3(0.5) + vec3(t.r * 1.2 + t.b * 0.4, t.b * 0.6, -t.r * 1.2 + t.b * 0.4);
  else if (u_mode == 3) c = t.rgb;
  else c = vec3(1.0 - t.r * 0.9);
  o = vec4(c, 1.0);
}`
