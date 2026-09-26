// Shared GLSL from the koi pond experiment (exp/pond): noise, the ripple wave equation, caustics, blur,
// the koi, and seaweed. The frog pond builds on these in shaders.ts.
//
// Coordinates inside the shaders are "pond px": origin top left, y down, one unit per CSS pixel of the
// pond. Render targets are stored the GL way (row 0 at the bottom), which is why pond px turn into
// texture uv through uvOf().

export const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`

// A single triangle that covers the whole viewport, positioned from gl_VertexID so no buffer is needed.
export const FULLSCREEN_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export const NOISE = `
// hashes by Dave Hoskins (MIT)
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), w.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), w.x), w.y);
}
// 3D simplex noise with its analytic gradient (Ashima Arts / Stefan Gustavson, MIT)
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoiseGrad(vec3 v, out vec3 grad) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 temp = m2 * m * pdotx;
  grad = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  grad += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  grad *= 105.0;
  return 105.0 * dot(m4, pdotx);
}
float snoise(vec3 v) { vec3 g; return snoiseGrad(v, g); }
`

// ---------------------------------------------------------------------------------------------
// Ripples: a wave equation stepped on the GPU, ping-ponging between two RGBA16F textures.
//    r/g = height/velocity of fine ripples (taps, tail flicks) that die out quickly,
//    b/a = height/velocity of a slower "wake" field the fish shove along as they swim.

export const RIPPLE_FS = `${HEADER}
in vec2 v_uv;
uniform sampler2D u_state;
uniform vec2 u_size;
uniform float u_dt;
uniform float u_c2;
uniform vec2 u_damp;
uniform float u_diffuse;
uniform int u_dropCount;
uniform vec4 u_drops[32];
uniform int u_splashCount;
uniform vec4 u_splashes[32];
uniform int u_pushCount;
uniform vec4 u_pushes[16];
out vec4 o;

// a smooth cosine bump: x, y centre, z radius, w amount
float bump(vec2 p, vec4 b) {
  float r = length(p - b.xy) / b.z;
  return r < 1.0 ? b.w * (0.5 + 0.5 * cos(3.14159265 * r)) : 0.0;
}
vec4 tap(ivec2 c, ivec2 hi) { return texelFetch(u_state, clamp(c, ivec2(0), hi), 0); }

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 hi = textureSize(u_state, 0) - 1;
  vec4 s = texelFetch(u_state, c, 0);
  vec4 edges = tap(c + ivec2(1, 0), hi) + tap(c - ivec2(1, 0), hi) + tap(c + ivec2(0, 1), hi) + tap(c - ivec2(0, 1), hi);
  vec4 corners = tap(c + ivec2(1, 1), hi) + tap(c + ivec2(-1, 1), hi) + tap(c + ivec2(1, -1), hi) + tap(c + ivec2(-1, -1), hi);
  // 9 point laplacian: rounder wavefronts than the plain 4 neighbour one
  vec2 lap = (4.0 * edges.rb + corners.rb - 20.0 * s.rb) / 6.0;
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_size;

  vec2 vel = (s.ga + u_c2 * u_dt * lap) * u_damp;
  for (int i = 0; i < u_pushCount; i++) vel.y += u_dt * bump(p, u_pushes[i]);
  // a pinch of diffusion keeps grid sized noise from building up
  vec2 h = s.rb + u_dt * vel + u_diffuse * lap;

  // soak waves up near the border so they don't bounce off a hard wall
  float edge = min(min(p.x, u_size.x - p.x), min(p.y, u_size.y - p.y));
  float keep = mix(0.94, 1.0, smoothstep(0.0, 36.0, edge));
  h *= keep;
  vel *= keep;

  for (int i = 0; i < u_dropCount; i++) h.x += bump(p, u_drops[i]);
  for (int i = 0; i < u_splashCount; i++) h.y += bump(p, u_splashes[i]);
  o = vec4(clamp(h.x, -4.0, 4.0), vel.x, clamp(h.y, -6.0, 6.0), vel.y);
}`

// ---------------------------------------------------------------------------------------------
// Caustics (the Evan Wallace trick): a fine grid of triangles is pushed along the surface slope,
//    as if each vertex were a ray bent by the water. Where triangles squash together the light is
//    concentrated, so brightness = original area / bent area. Additive blending sums the overlaps.

export const CAUSTIC_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 a_pos;
uniform sampler2D u_surface;
uniform vec2 u_size;
uniform float u_depth;
out vec2 v_before;
out vec2 v_after;
void main() {
  vec4 s = texture(u_surface, vec2(a_pos.x / u_size.x, 1.0 - a_pos.y / u_size.y));
  vec2 bent = a_pos + u_depth * s.yz;
  v_before = a_pos;
  v_after = bent;
  gl_Position = vec4(bent.x / u_size.x * 2.0 - 1.0, 1.0 - bent.y / u_size.y * 2.0, 0.0, 1.0);
}`

export const CAUSTIC_FS = `${HEADER}
in vec2 v_before;
in vec2 v_after;
out vec4 o;
void main() {
  // screen space derivatives give each triangle's area before and after bending
  vec2 bx = dFdx(v_before), by = dFdy(v_before);
  vec2 ax = dFdx(v_after), ay = dFdy(v_after);
  float before = abs(bx.x * by.y - bx.y * by.x);
  float after = abs(ax.x * ay.y - ax.y * ay.x);
  float I = min(before / max(after, 1e-6), 30.0);
  o = vec4(I, I, I, 1.0);
}`

// 9 tap gaussian done as 5 linear samples, run once across and once down
export const BLUR_FS = `${HEADER}
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;
out vec4 o;
void main() {
  vec4 s = texture(u_tex, v_uv) * 0.2270270270;
  s += (texture(u_tex, v_uv + u_dir * 1.3846153846) + texture(u_tex, v_uv - u_dir * 1.3846153846)) * 0.3162162162;
  s += (texture(u_tex, v_uv + u_dir * 3.2307692308) + texture(u_tex, v_uv - u_dir * 3.2307692308)) * 0.0702702703;
  o = s;
}`

// ---------------------------------------------------------------------------------------------
// Koi. Each fish is a ribbon of 64 rows x 9 columns laid along its spine on the CPU. The fragment
//    shader gets (u, s) fish coordinates: u runs 0 at the snout to 1 at the tail root (past 1 is the
//    tail fin), s is the sideways offset, both in body lengths. Everything is drawn analytically.

export const FISH_VS = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec2 a_local;
in vec2 a_tan;
in vec4 a_fish;   // kind + seed, length px, tail beat phase, lift (height above the bed)
in vec2 a_motion; // pectoral fold 0..1, fin paddle phase
uniform vec2 u_size;
uniform vec2 u_offset; // shadow pass: shifts each fish away from the sun by its lift
out vec2 v_local;
out vec2 v_tan;
out vec4 v_fish;
out vec2 v_motion;
out vec2 v_p;
void main() {
  vec2 p = a_pos + u_offset * a_fish.w;
  v_local = a_local;
  v_tan = a_tan;
  v_fish = a_fish;
  v_motion = a_motion;
  v_p = p;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
}`

export const KOI_SHAPE = `
uniform float u_time;

// blunt round head, widest just behind the gills, then a long taper
float bodyHW(float u) {
  float nose = sqrt(max(0.0, 1.0 - pow(max(0.3 - u, 0.0) / 0.3, 2.0)));
  float t = clamp((u - 0.3) / 0.7, 0.0, 1.0);
  return (0.05 + 0.085 * (1.0 - pow(t, 1.4))) * nose * step(0.0, u);
}

// A fan of fin rays from one base point. x: membrane coverage, y: on a ray, z: 0..1 along the fin.
// The membrane stops a little short between rays, so the edge frays into strands.
vec3 fan(vec2 q, vec2 base, float dir, float spread, float len, float rays, float fork, float lead, float L) {
  vec2 d = q - base;
  float r = length(d);
  float rn = r / len;
  if (rn > 1.2 || r < 1e-5) return vec3(0.0);
  float a = atan(d.y, d.x) - dir;
  a = atan(sin(a), cos(a));
  float x = a / spread + 0.5;
  if (x < -0.06 || x > 1.06) return vec3(0.0);
  float c = abs(2.0 * x - 1.0);
  // fork dips the middle, lead makes one side longer, the outer corners round off
  float reach = (1.0 - fork * (1.0 - pow(c, 0.9))) * (1.0 + lead * (x - 0.5)) * (1.0 - 0.2 * pow(c, 10.0));
  float k = clamp(x, 0.0, 1.0) * (rays - 1.0);
  float fk = fract(k);
  float soft = 2.5 / (len * L);
  float sides = smoothstep(-0.06, 0.0, x) * (1.0 - smoothstep(1.0, 1.06, x));
  float webReach = reach * (1.0 - 0.05 * sin(3.14159 * fk));
  float web = (1.0 - smoothstep(webReach - soft * 2.0, webReach + soft, rn)) * sides;
  float gapPx = max(r * L * spread / (rays - 1.0), 1e-3);
  float offPx = min(fk, 1.0 - fk) * gapPx;
  float ray = (1.0 - smoothstep(0.4, 1.6, offPx)) * (1.0 - smoothstep(reach - soft, reach + soft * 0.5, rn)) * sides;
  return vec3(web, ray, rn / max(reach, 0.1));
}

vec3 tailFin(vec2 q, float beat, float seed, float L) {
  float rn = length(q - vec2(0.955, 0.0)) / 0.5;
  float flutter = sin(beat * 1.6 - rn * 4.0 + seed * 9.0) * 0.12 * rn; // ripples like cloth
  return fan(q, vec2(0.955, 0.0), flutter, 1.2, 0.5, 28.0, 0.4, 0.0, L);
}

// i: 0/1 pectorals, 2/3 pelvics. Pectorals fold back against the body when the fish bolts.
vec3 pairedFin(vec2 q, int i, float fold, float phase, float L) {
  float sg = (i % 2 == 0) ? 1.0 : -1.0;
  bool pect = i < 2;
  float flap = sin(phase + (pect ? 0.0 : 1.3) + sg * 0.4);
  float au = pect ? 0.22 : 0.53;
  vec2 base = vec2(au, sg * bodyHW(au) * (pect ? 0.78 : 0.55));
  float dir = sg * (pect ? 0.98 + 0.14 * flap : 0.55 + 0.06 * flap) * (1.0 - (pect ? 0.55 : 0.4) * fold);
  float spread = (pect ? 0.84 + 0.1 * flap : 0.46) * (1.0 - 0.45 * fold);
  // leading rays (nearest the head) are the longest
  return fan(q, base, dir, spread, pect ? 0.25 : 0.16, pect ? 13.0 : 9.0, 0.0, sg * 0.35, L);
}

// the dorsal fin lies mostly folded along the back, leaning slowly from side to side
vec3 dorsalFin(vec2 q, float seed, float L) {
  float lean = sin(u_time * 0.45 + seed * 12.0) * 0.8 + sin(u_time * 1.3 + seed * 3.0) * 0.2;
  float sg = lean >= 0.0 ? 1.0 : -1.0;
  float front = 0.1 + 0.4 * abs(lean);
  return fan(q, vec2(0.33, 0.0), sg * (0.04 + front) * 0.5, max(front - 0.04, 0.02), 0.44, 14.0, 0.0, -sg * 0.6, L);
}

vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }
`

export const FISH_FS = `${HEADER}${NOISE}${KOI_SHAPE}
in vec2 v_local;
in vec2 v_tan;
in vec4 v_fish;
in vec2 v_motion;
in vec2 v_p;
uniform sampler2D u_caustic;
uniform vec2 u_size;
uniform vec3 u_ambient;
uniform vec3 u_sun;
uniform float u_fishLight;
uniform float u_pixel;
out vec4 o;
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

const float SCALES = 26.0; // scales per body length

// overlapping scales in staggered rows; of the ones covering a point, the one nearest the head is on top.
// x: 0 centre .. 1 rim, y: > 0 on the exposed (tailward) half, z: random per scale, w: another
vec4 scale(vec2 q, out vec2 centre) {
  const vec2 cell = vec2(0.78, 0.9);
  vec2 pp = q * SCALES;
  vec2 base = floor(pp / cell);
  vec4 best = vec4(1.0, 0.0, 0.0, 0.0);
  centre = q;
  float bestX = 1e9;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 id = base + vec2(float(i), float(j));
    vec2 c = vec2((id.x + mod(id.y, 2.0) * 0.5 + 0.5) * cell.x, (id.y + 0.5) * cell.y)
           + (hash22(id * 3.1 + 1.7) - 0.5) * vec2(0.14, 0.1);
    vec2 d = pp - c;
    float r = length(d) / (0.62 * (0.94 + 0.12 * hash12(id + 9.1)));
    if (r < 1.0 && c.x < bestX) {
      bestX = c.x;
      best = vec4(r, d.x / 0.6, hash12(id + 0.37), hash12(id * 1.91 + 5.3));
      centre = c / SCALES;
    }
  }
  return best;
}

float patchField(vec2 q, float seed) {
  return vnoise(q * vec2(6.0, 14.0) + seed * 37.0) * 0.65 + vnoise(q * vec2(13.0, 30.0) + seed * 11.0 + 4.1) * 0.35;
}

struct Skin { vec3 color; vec3 sheen; float metal; vec3 finBase; vec3 finTip; };

// 0 orange, 1 metallic gold with black spots, 2 red and white, 3 pale calico
Skin skin(int kind, vec2 q, float nz, float seed, vec4 sc, vec2 centre, float L) {
  float u = q.x;
  float back = smoothstep(0.0, 0.85, nz);
  float scaled = smoothstep(0.23, 0.3, u) * (1.0 - smoothstep(0.92, 1.0, u));
  float field = mix(patchField(q, seed), patchField(centre, seed), scaled * 0.22);
  float head = 1.0 - smoothstep(0.1, 0.3, u);
  float aa = SCALES * u_pixel / (0.6 * L);
  float visible = scaled * (0.45 + 0.55 * smoothstep(0.25, 0.7, vnoise(q * vec2(7.0, 18.0) + seed * 13.0)));
  float rim = smoothstep(0.4 - aa, 0.85 + aa, sc.x) * smoothstep(-0.4, 0.3, sc.y) * visible;
  float edge = smoothstep(0.8 - aa, 1.0 + aa, sc.x) * smoothstep(-0.25, 0.35, sc.y) * visible;
  float grain = vnoise(q * vec2(60.0, 110.0) + seed * 5.0);
  Skin k;
  if (kind == 1) {
    // gold leans orange on purpose: the green water pulls yellows toward olive
    vec3 gold = mix(lin(vec3(0.4, 0.17, 0.02)), lin(vec3(0.98, 0.6, 0.13)), back);
    gold = mix(gold, lin(vec3(1.0, 0.7, 0.24)), head * 0.4 * back);
    float spotField = mix(patchField(q + 5.7, seed), patchField(centre + 5.7, seed), scaled * 0.45);
    float spot = smoothstep(0.52, 0.58, spotField - head * 0.12);
    vec3 c = mix(gold, lin(vec3(0.05, 0.05, 0.06)), spot);
    c = mix(c, c * vec3(1.18, 1.12, 1.05), rim * 0.45);
    k.color = c * (1.0 - edge * 0.12) * (0.95 + 0.1 * grain);
    k.sheen = mix(lin(vec3(1.0, 0.88, 0.62)), lin(vec3(0.4, 0.42, 0.46)), spot);
    k.metal = 2.2;
    k.finBase = vec3(0.96, 0.66, 0.24);
    k.finTip = vec3(1.0, 0.9, 0.7);
  } else if (kind == 3) {
    vec3 blue = mix(lin(vec3(0.5, 0.58, 0.72)), lin(vec3(0.72, 0.78, 0.88)), back);
    vec3 white = mix(lin(vec3(0.82, 0.8, 0.78)), lin(vec3(0.97, 0.95, 0.92)), back);
    vec3 orange = mix(lin(vec3(0.82, 0.28, 0.08)), lin(vec3(0.98, 0.5, 0.18)), back);
    float whiteMask = smoothstep(0.46, 0.6, patchField(q + 7.3, seed));
    float orangeMask = smoothstep(0.52, 0.64, field);
    vec3 c = mix(mix(blue, white, whiteMask), orange, orangeMask);
    float speck = smoothstep(0.78, 0.86, vnoise(q * vec2(40.0, 90.0) + seed * 31.0)) * (1.0 - orangeMask * 0.6);
    c = mix(c, lin(vec3(0.12, 0.12, 0.18)), speck * 0.7);
    c = mix(c, c * 1.1, rim * 0.3);
    k.color = c * (1.0 - edge * 0.1) * (0.94 + 0.12 * grain);
    k.sheen = lin(vec3(0.9, 0.94, 1.0));
    k.metal = 0.5;
    k.finBase = vec3(0.78, 0.8, 0.88);
    k.finTip = vec3(0.96, 0.95, 0.94);
  } else {
    bool red = kind == 2;
    vec3 orange = red ? mix(lin(vec3(0.72, 0.16, 0.06)), lin(vec3(0.93, 0.32, 0.12)), back)
                      : mix(lin(vec3(0.8, 0.3, 0.1)), lin(vec3(0.97, 0.5, 0.22)), back);
    orange *= 0.84 + 0.26 * grain;
    vec3 cream = mix(lin(vec3(0.84, 0.66, 0.58)), lin(vec3(0.97, 0.9, 0.84)), back);
    float white = smoothstep(red ? 0.44 : 0.64, red ? 0.58 : 0.78, field + head * 0.08);
    vec3 c = mix(orange, cream, white);
    c = mix(c, c * vec3(1.12, 1.06, 1.0), rim * 0.35);
    c *= 1.0 - edge * 0.08;
    float dark = step(0.95, sc.z) * smoothstep(0.9, 0.3, sc.x) * scaled * (1.0 - smoothstep(0.5, 0.7, u)) * (1.0 - white);
    k.color = mix(c, lin(vec3(0.2, 0.1, 0.07)), dark * 0.7);
    k.sheen = lin(vec3(1.0, 0.76, 0.42));
    k.metal = 0.8;
    k.finBase = red ? vec3(0.95, 0.72, 0.62) : vec3(0.96, 0.54, 0.34);
    k.finTip = vec3(1.0, 0.9, 0.84);
  }
  return k;
}

// fins are translucent veils: colour lives in the membrane, the rays only show as faint streaks
vec4 shadeFin(Skin k, vec3 f, float seed, vec3 sunC, float opacity) {
  if (f.x + f.y <= 0.0) return vec4(0.0);
  float veil = 0.9 + 0.1 * vnoise(vec2(f.z * 9.0, seed * 14.0));
  float a = f.x * mix(0.66, 0.2, smoothstep(0.0, 1.0, f.z)) * veil;
  a += f.y * f.x * 0.1 * (1.0 - f.z * 0.6);
  vec3 c = mix(k.finBase, k.finTip, smoothstep(0.05, 1.0, f.z)) * (1.0 - f.y * 0.08);
  a = clamp(a, 0.0, 1.0) * opacity;
  return vec4(lin(c) * (u_ambient * 1.3 + sunC * 1.05) * a, a);
}

void main() {
  float u = v_local.x;
  float s = v_local.y;
  int kind = int(floor(v_fish.x));
  float seed = fract(v_fish.x);
  float L = v_fish.y;
  float aa = 1.3 / L;
  vec2 q = vec2(u, s);
  vec2 lat = vec2(-v_tan.y, v_tan.x);

  // the caustics light the fish too, blurred because it swims well above the bed
  vec2 cuv = vec2(v_p.x / u_size.x, 1.0 - v_p.y / u_size.y);
  vec2 px = 2.5 / u_size;
  float C = texture(u_caustic, cuv).r * 0.4
    + (texture(u_caustic, cuv + vec2(px.x, 0.0)).r + texture(u_caustic, cuv - vec2(px.x, 0.0)).r
     + texture(u_caustic, cuv + vec2(0.0, px.y)).r + texture(u_caustic, cuv - vec2(0.0, px.y)).r) * 0.15;
  vec3 sunC = u_sun * u_fishLight * mix(0.55, 1.35, clamp(C * 0.45, 0.0, 1.0));

  float hw = bodyHW(u);
  float nx = clamp(s / max(hw, 1e-4), -1.0, 1.0);
  float nz = sqrt(max(0.0, 1.0 - nx * nx));
  vec2 centre;
  vec4 sc = scale(q, centre);
  Skin k = skin(kind, q, nz, seed, sc, centre, L);

  vec4 acc = shadeFin(k, tailFin(q, v_fish.z, seed, L), seed, sunC, 1.0);
  for (int i = 3; i >= 0; i--) acc = over(shadeFin(k, pairedFin(q, i, v_motion.x, v_motion.y, L), seed + float(i), sunC, 1.0), acc);

  vec2 eyeC = vec2(0.115, sign(s) * (bodyHW(0.115) + 0.002));
  float eyeD = length(q - eyeC) - 0.02;
  float bodyD = min(max(abs(s) - hw, -u), eyeD);
  float bodyA = (1.0 - smoothstep(-aa, aa, bodyD)) * (1.0 - smoothstep(0.96, 1.03, u));
  if (bodyA > 0.0) {
    float snout = 1.0 - smoothstep(0.0, 0.14, u);
    float tailward = smoothstep(0.5, 1.0, u);
    vec3 N = normalize(vec3(lat * nx * 0.95 + v_tan * (snout * 0.8 - tailward * 0.15) * nz, nz + 0.12));
    vec3 Ld = normalize(vec3(-0.42, -0.52, 0.74));
    vec3 H = normalize(Ld + vec3(0.0, 0.0, 1.0));
    float dif = max(dot(N, Ld), 0.0);
    float nh = max(dot(N, H), 0.0);

    vec3 col = k.color * (u_ambient * 1.25 + sunC * (0.3 + 0.7 * dif));
    col *= mix(0.7, 1.0, smoothstep(0.0, 0.55, nz));        // flanks roll into shadow
    col += k.color * sunC * 0.12 * pow(1.0 - nz, 2.0);       // but light glows through thin edges
    col += mix(k.color, k.sheen, 0.6) * sunC * pow(nh, 7.0) * 0.16 * max(1.0, k.metal * 0.65);
    col += mix(k.color, k.sheen, 0.5) * sunC * pow(nh, 3.0) * 0.35 * max(k.metal - 1.2, 0.0);

    // every scale is a tiny tilted mirror, so glints shift as the fish turns
    float scaleRegion = smoothstep(0.22, 0.3, u) * (1.0 - smoothstep(0.9, 1.0, u)) * smoothstep(0.0, 0.35, nz);
    vec2 tilt = (v_tan * -(0.35 + 0.35 * sc.w) + lat * (sc.z - 0.5) * 0.9) * 0.55;
    float glint = pow(max(dot(normalize(N + vec3(tilt, 0.0)), H), 0.0), 24.0);
    float patchN = smoothstep(0.25, 0.75, vnoise(vec2(u * 7.0, s * 22.0) + seed * 7.0 + vec2(u_time * 0.02, 0.0)));
    float rimGlow = smoothstep(0.5, 0.85, sc.x) * step(0.0, sc.y);
    col += k.sheen * scaleRegion * glint * (0.4 + 0.6 * patchN) * (0.45 + 0.9 * rimGlow) * sunC * 0.6 * k.metal;

    // gill covers, a glossy crown, a ridge down the spine, one sharp highlight
    float gill = exp(-pow((u - 0.265 - 0.07 * nx * nx) / 0.006, 2.0)) * smoothstep(0.15, 0.6, abs(nx));
    col *= 1.0 - gill * 0.22;
    float crown = exp(-pow(s / (hw * 0.5 + 1e-4), 2.0)) * exp(-pow((u - 0.12) / 0.07, 2.0));
    col += mix(k.color, k.sheen, 0.5) * crown * 0.28 * sunC;
    float ridge = exp(-pow(s / max(hw * 0.22, 1e-4), 2.0)) * smoothstep(0.25, 0.45, u) * (1.0 - smoothstep(0.8, 1.0, u));
    col += k.sheen * ridge * 0.1 * sunC * k.metal;
    col += vec3(1.0, 0.92, 0.8) * pow(nh, 36.0) * 0.24 * u_fishLight;

    vec3 headLight = u_ambient * 1.3 + sunC;
    float front = 1.0 - smoothstep(0.03, 0.08, u);
    float inside = -max(abs(s) - hw, -u);
    col = mix(col, lin(vec3(0.97, 0.9, 0.82)) * headLight, (1.0 - smoothstep(0.0, 0.01, inside)) * front * 0.45); // lips
    float nostril = 1.0 - smoothstep(0.0, 1.0, length((q - vec2(0.062, sign(s) * 0.03)) / vec2(0.012, 0.009)));
    col *= 1.0 - nostril * 0.55;

    float eye = 1.0 - smoothstep(-aa, aa, eyeD);
    vec2 pupilC = eyeC + vec2(-0.002, sign(s) * 0.006);
    float pupil = 1.0 - smoothstep(-aa, aa, length(q - pupilC) - 0.012);
    vec3 eyeRim = mix(k.color, lin(vec3(0.9, 0.86, 0.78)), 0.55) * headLight;
    col = mix(col, mix(eyeRim, lin(vec3(0.03, 0.025, 0.02)) * headLight, pupil), eye);
    float wet = 1.0 - smoothstep(0.0, 0.0045, length(q - pupilC - vec2(-0.004, -sign(s) * 0.004)));
    col += vec3(0.5, 0.48, 0.44) * wet * pupil * u_fishLight;

    acc = over(vec4(col * bodyA, bodyA), acc);
  }

  // barbels: two short whiskers at the corners of the mouth
  float whisker = 0.0;
  for (int i = 0; i < 2; i++) {
    float sg = i == 0 ? 1.0 : -1.0;
    vec2 root = vec2(0.03, sg * bodyHW(0.03) * 0.92);
    vec2 dir = normalize(vec2(0.45, sg));
    vec2 d = q - root;
    float along = clamp(dot(d, dir), 0.0, 0.05);
    float offPx = length(d - dir * along) * L;
    float width = mix(0.9, 0.35, along / 0.05);
    whisker = max(whisker, (1.0 - smoothstep(width * 0.5, width * 0.5 + 0.6, offPx)) * (1.0 - smoothstep(0.035, 0.05, along)));
  }
  if (whisker > 0.0) {
    float wa = whisker * 0.65;
    acc = over(vec4(lin(vec3(0.95, 0.9, 0.82)) * (u_ambient * 1.3 + sunC) * wa, wa), acc);
  }

  acc = over(shadeFin(k, dorsalFin(q, seed, L), seed + 9.0, sunC, 0.9), acc);
  o = acc;
}`

// the same ribbon, drawn as a flat silhouette for the shadow on the bed
export const SHADOW_FS = `${HEADER}${KOI_SHAPE}
in vec2 v_local;
in vec2 v_tan;
in vec4 v_fish;
in vec2 v_motion;
in vec2 v_p;
out vec4 o;
float finShadow(vec3 f, float web, float ray) {
  return max(f.x * web * mix(1.0, 0.4, clamp(f.z, 0.0, 1.0)), f.y * ray);
}
void main() {
  vec2 q = v_local;
  float L = v_fish.y;
  float seed = fract(v_fish.x);
  float aa = 1.2 / L;
  float a = (1.0 - smoothstep(-aa, aa, max(abs(q.y) - bodyHW(q.x), -q.x))) * (1.0 - smoothstep(0.95, 1.04, q.x));
  a = max(a, finShadow(tailFin(q, v_fish.z, seed, L), 0.6, 0.5));
  for (int i = 0; i < 4; i++) a = max(a, finShadow(pairedFin(q, i, v_motion.x, v_motion.y, L), 0.35, 0.45));
  a = max(a, finShadow(dorsalFin(q, seed, L), 0.3, 0.4));
  o = vec4(a, 0.0, 0.0, a);
}`

// ---------------------------------------------------------------------------------------------
// Seaweed: tapered strips built on the CPU each frame, swaying. Drawn into their own layer that
//    sits on the bed, so caustics and fish shadows fall across them.

export const WEED_VS = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec3 a_leaf; // along 0..1, across -1..1, seed
uniform vec2 u_size;
out vec3 v_leaf;
void main() {
  v_leaf = a_leaf;
  gl_Position = vec4(a_pos.x / u_size.x * 2.0 - 1.0, 1.0 - a_pos.y / u_size.y * 2.0, 0.0, 1.0);
}`

export const WEED_FS = `${HEADER}${NOISE}
in vec3 v_leaf;
out vec4 o;
void main() {
  float t = v_leaf.x, side = v_leaf.y, seed = v_leaf.z;
  vec3 c = mix(vec3(0.05, 0.15, 0.08), vec3(0.2, 0.32, 0.12), smoothstep(0.05, 1.0, t));
  c *= 0.85 + 0.3 * hash12(vec2(seed * 91.0, 3.7));
  c = mix(c, c * 1.4, exp(-pow(side / 0.2, 2.0)) * 0.35); // pale midrib
  c *= 0.92 + 0.08 * sin(side * 14.0 + seed * 20.0);      // fine veins
  float a = (1.0 - smoothstep(0.7, 1.0, abs(side))) * mix(0.97, 0.8, t);
  o = vec4(c * a, a);
}`

