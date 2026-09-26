// Frogs, seen from above, built from distance fields. The same shader draws a frog sitting on a pad,
// mid leap, or swimming. `wet` blends between them: a swimmer draws its knees out wide between kicks,
// holds its arms back along its body, and sits low in the water, so only the top of the head and the
// eyes stay crisp above the waterline.

import { HEADER, NOISE } from '../pond/shaders'
import { TONE } from './shaders'

// kinds: 0 green frog, 1 olive bullfrog, 2 leopard frog, 3 golden (the mascot's colours), 4 wood frog
export const FROG_KINDS = 5

export const FROG_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec4 a_body;   // x, y, heading, length px
in vec4 a_pose;   // blink, throat puff, leg stretch, hop height 0..1
in vec4 a_anchor; // the point it bobs with (its pad's centre, or itself when swimming), seed, kind
in vec4 a_extra;  // wet: 0 on a pad .. 1 swimming; depth: 0 at the surface .. 1 dived to the bed
uniform sampler2D u_surface;
uniform vec2 u_size;
uniform float u_bob;
uniform vec2 u_offset;
out vec2 v_q;
out vec4 v_pose;
out vec4 v_info; // length px, seed, kind, wet
out vec2 v_dir;
out float v_depth;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 q = mix(vec2(-1.04, -0.6), vec2(0.66, 0.6), corner);
  vec4 S = texture(u_surface, vec2(a_anchor.x / u_size.x, 1.0 - a_anchor.y / u_size.y));
  float wet = a_extra.x;
  float depth = a_extra.y;
  float L = a_body.w * (1.0 + 0.35 * a_pose.w) * (1.0 - 0.15 * depth); // nearer the eye mid leap, further when dived
  vec2 h = vec2(cos(a_body.z), sin(a_body.z));
  // a swimmer is lower than a pad, so its shadow lands closer; a leap throws it further
  float lift = (1.0 - 0.45 * wet) * (1.0 + 2.5 * a_pose.w) * (1.0 - 0.7 * depth);
  vec2 p = a_body.xy - S.yz * u_bob + vec2(h.x * q.x - h.y * q.y, h.y * q.x + h.x * q.y) * L + u_offset * lift;
  v_q = q;
  v_pose = a_pose;
  v_info = vec4(L, a_anchor.z, a_anchor.w, wet);
  v_dir = h;
  v_depth = depth;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
}`

export const FROG_FS = `${HEADER}${NOISE}${TONE}
in vec2 v_q;
in vec4 v_pose;
in vec4 v_info;
in vec2 v_dir;
in float v_depth;
uniform int u_mode; // 0 colour, 1 silhouette for the shadow map
uniform float u_scale;
uniform float u_time;
uniform vec3 u_ambient;
uniform vec3 u_key;
uniform vec3 u_water;
out vec4 o;

float sdEllipse(vec2 p, vec2 r) { return (length(p / r) - 1.0) * min(r.x, r.y); }
float sdSeg(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - r;
}
// exact triangle distance (Inigo Quilez, MIT)
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a, e1 = c - b, e2 = a - c;
  vec2 v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }
vec2 turn(vec2 v, float a) { return vec2(cos(a) * v.x - sin(a) * v.y, sin(a) * v.x + cos(a) * v.y); }

// four long toes fanned from the ankle; with webbing stretched between them on the hind feet
void foot(vec2 s, vec2 from, vec2 to, float spread, float r, bool webbed, out float toes, out float web) {
  vec2 dir = to - from;
  toes = 1e3;
  web = 1e3;
  vec2 prev = from;
  for (int i = 0; i < 4; i++) {
    float k = float(i) / 1.5 - 1.0;
    vec2 tip = from + turn(dir, k * spread) * (1.0 - 0.26 * abs(k) - 0.08 * k);
    toes = min(toes, min(sdSeg(s, from, tip, r), length(s - tip) - r * 1.6));
    if (webbed && i > 0) web = min(web, sdTri(s, from, mix(prev, from, 0.14), mix(tip, from, 0.14)));
    prev = tip;
  }
}

struct Parts { float legs; float web; float body; float head; float eye; float sac; };

Parts parts(vec2 q, float st, float puff, float breath, float wet) {
  vec2 s = vec2(q.x, abs(q.y)); // mirror: build the left side, get the right for free
  Parts p;
  // hind legs: folded (knees forward on a pad, knees out wide between kicks in the water),
  // or stretched straight back (mid leap, or the end of a kick)
  vec2 hip = vec2(-0.16, 0.12);
  vec2 knee = mix(mix(vec2(0.06, 0.33), vec2(-0.1, 0.38), wet), mix(vec2(-0.4, 0.24), vec2(-0.42, 0.19), wet), st);
  vec2 ankle = mix(mix(vec2(-0.24, 0.36), vec2(-0.36, 0.3), wet), mix(vec2(-0.68, 0.2), vec2(-0.72, 0.14), wet), st);
  vec2 toe = mix(mix(vec2(-0.05, 0.43), vec2(-0.3, 0.46), wet), mix(vec2(-0.93, 0.19), vec2(-0.99, 0.15), wet), st);
  float hind = smin(sdSeg(s, hip, knee, 0.07), sdSeg(s, knee, ankle, 0.046), 0.03);
  float toes, web;
  foot(s, ankle, toe, mix(0.34, 0.5, st * wet), 0.016, true, toes, web); // feet fan open on the kick
  hind = min(hind, toes);
  // arms: out front on a pad, tucked back along the body in a leap or in the water
  float tuck = max(st, wet * 0.85);
  vec2 shoulder = vec2(0.13, 0.13);
  vec2 elbow = mix(vec2(0.2, 0.27), vec2(0.02, 0.21), tuck);
  vec2 wrist = mix(vec2(0.34, 0.27), vec2(-0.06, 0.23), tuck);
  float front = min(sdSeg(s, shoulder, elbow, 0.042), sdSeg(s, elbow, wrist, 0.035));
  float fingers, none;
  foot(s, wrist, wrist + normalize(wrist - elbow) * 0.075, 0.5, 0.012, false, fingers, none);
  p.legs = min(hind, min(front, fingers));
  p.web = web;
  // body: hips, torso, a broad head and a rounded snout melted together, breathing a little
  vec2 b = vec2(s.x, s.y / breath);
  p.head = smin(sdEllipse(b - vec2(0.25, 0.0), vec2(0.17, 0.18)), sdEllipse(b - vec2(0.36, 0.0), vec2(0.1, 0.12)), 0.05);
  p.body = smin(smin(sdEllipse(b - vec2(-0.12, 0.0), vec2(0.2, 0.2)), sdEllipse(b - vec2(0.05, 0.0), vec2(0.25, 0.18)), 0.08), p.head, 0.06);
  p.eye = length(s - vec2(0.275, 0.135)) - 0.068;
  float sacR = 0.015 + 0.11 * puff;
  p.sac = puff > 0.02 ? sdEllipse(q - vec2(0.44, 0.0), vec2(sacR * 0.8, sacR * 1.25)) : 1.0;
  return p;
}

// a rounded height for each part, plus fine warty bumps on the back; the eyes sit up on top
float height(Parts p, vec2 q, float puff, float seed, float warts) {
  float h = sqrt(clamp(-p.legs / 0.05, 0.0, 1.0)) * 0.04;
  h = max(h, step(p.web, 0.0) * 0.012);
  float hb = sqrt(clamp(-p.body / 0.16, 0.0, 1.0)) * 0.12;
  hb += step(p.body, 0.0) * warts * (vnoise(q * 34.0 + seed * 7.0) - 0.5) * 0.012;
  h = max(h, hb);
  h = max(h, step(p.eye, 0.0) * (0.08 + sqrt(clamp(-p.eye / 0.068, 0.0, 1.0)) * 0.06));
  float sacR = 0.015 + 0.11 * puff;
  return max(h, step(p.sac, 0.0) * (0.05 + sqrt(clamp(-p.sac / sacR, 0.0, 1.0)) * sacR));
}

struct Look { vec3 back; vec3 side; vec3 spot; vec3 ridge; vec3 iris; float blotch; };

Look look(float kind) {
  if (kind < 0.5) return Look(vec3(0.36, 0.5, 0.12), vec3(0.17, 0.27, 0.06), vec3(0.08, 0.13, 0.03), vec3(0.58, 0.64, 0.28), vec3(0.95, 0.74, 0.14), 0.6);
  if (kind < 1.5) return Look(vec3(0.33, 0.36, 0.15), vec3(0.19, 0.2, 0.08), vec3(0.11, 0.11, 0.05), vec3(0.42, 0.43, 0.2), vec3(0.82, 0.5, 0.2), 0.56);
  if (kind < 2.5) return Look(vec3(0.34, 0.52, 0.22), vec3(0.25, 0.37, 0.15), vec3(0.06, 0.09, 0.04), vec3(0.74, 0.74, 0.46), vec3(0.95, 0.76, 0.2), 2.0);
  if (kind < 3.5) return Look(vec3(0.86, 0.62, 0.12), vec3(0.6, 0.38, 0.07), vec3(0.45, 0.25, 0.05), vec3(0.92, 0.8, 0.4), vec3(0.98, 0.82, 0.28), 0.66);
  return Look(vec3(0.52, 0.37, 0.2), vec3(0.31, 0.2, 0.1), vec3(0.2, 0.12, 0.06), vec3(0.72, 0.56, 0.36), vec3(0.85, 0.52, 0.24), 0.64);
}

// leopard frog spots: round, dark, rimmed with pale skin, at most one per cell. x: spot, y: rim
vec2 leopard(vec2 q, float seed) {
  vec2 g = q * vec2(7.5, 9.0) + seed * 13.0;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5 - (hash22(cell) - 0.5) * 0.3;
  float r = 0.16 + 0.14 * hash12(cell + 1.3);
  float on = step(0.35, hash12(cell + 7.1));
  float d = length(f * vec2(1.0, 1.25));
  return on * vec2(1.0 - smoothstep(r - 0.05, r, d), smoothstep(r - 0.02, r + 0.02, d) - smoothstep(r + 0.04, r + 0.1, d));
}

void main() {
  float L = v_info.x, seed = v_info.y, kind = v_info.z, wet = v_info.w;
  float blink = v_pose.x, puff = v_pose.y, st = v_pose.z, hop = v_pose.w;
  float aa = 1.2 / (L * u_scale);
  vec2 q = v_q;
  vec2 s = vec2(q.x, abs(q.y));
  float breath = 1.0 + 0.025 * sin(u_time * 2.2 + seed * 9.0) * (1.0 - 0.6 * wet);
  Parts pt = parts(q, st, puff, breath, wet);

  float legA = 1.0 - smoothstep(-aa, aa, pt.legs);
  float webA = (1.0 - smoothstep(-aa, aa, pt.web)) * 0.62;
  float bodyA = 1.0 - smoothstep(-aa, aa, pt.body);
  float eyeA = 1.0 - smoothstep(-aa, aa, pt.eye);
  float sacA = (1.0 - smoothstep(-aa, aa, pt.sac)) * 0.88;
  if (u_mode == 1) {
    float cover = max(max(max(legA, webA * 0.8), bodyA), max(eyeA, sacA)) * (1.0 - 0.3 * v_depth);
    o = vec4(cover, 0.0, 0.0, cover);
    return;
  }

  Look k = look(kind);
  float warts = (kind > 0.5 && kind < 1.5) || kind > 3.5 ? 1.0 : 0.45;

  // shade from the height field's own gradient (two extra samples), turned from frog to pond space
  float eps = 0.006;
  float h0 = height(pt, q, puff, seed, warts);
  vec2 g = vec2(height(parts(q + vec2(eps, 0.0), st, puff, breath, wet), q + vec2(eps, 0.0), puff, seed, warts) - h0,
                height(parts(q + vec2(0.0, eps), st, puff, breath, wet), q + vec2(0.0, eps), puff, seed, warts) - h0) / eps;
  g = vec2(v_dir.x * g.x - v_dir.y * g.y, v_dir.y * g.x + v_dir.x * g.y);
  vec3 n = normalize(vec3(-g / max(1.0, length(g) / 4.0), 1.0));
  vec3 Ld = normalize(LIGHT_DIR);
  float dif = max(dot(n, Ld), 0.0);
  // wet skin shines in patches rather than as one plastic highlight
  float film = 0.45 + 0.55 * smoothstep(0.3, 0.7, vnoise(q * 18.0 + seed * 3.0));
  float spec = pow(max(dot(n, normalize(Ld + vec3(0.0, 0.0, 1.0))), 0.0), 22.0) * film;
  vec3 light = u_ambient * 1.8 + u_key * (0.3 + 0.7 * dif);
  vec3 shine = u_key * spec * (0.22 + 0.2 * wet);

  // in the water, everything below the waterline is dimmed and tinted; a bright line where skin breaks it
  float under = max(wet * (1.0 - smoothstep(0.055, 0.1, h0)), v_depth);
  float waterline = wet * exp(-pow((h0 - 0.075) / 0.004, 2.0)) * (1.0 - v_depth);
  #define LIT(albedo, boost) mix(lin(albedo) * light + shine * (boost), (lin(albedo) * light) * 0.45 + u_water * 1.5, under * 0.7) + u_key * waterline * 0.08

  vec4 acc = vec4(0.0);
  // soft contact shadow on the pad while sitting
  float contact = (1.0 - hop) * (1.0 - wet) * 0.55 * exp(-max(min(pt.body, pt.legs), 0.0) / 0.05);
  acc = vec4(0.0, 0.0, 0.0, contact);

  vec3 legC = mix(k.side, k.back, 0.4);
  legC = mix(legC, k.spot, smoothstep(0.55, 0.65, vnoise(s * 14.0 + seed * 5.0)) * 0.7);
  // webbing is thin: darker, and the moon glows through it a little
  float webOnly = webA * (1.0 - legA);
  acc = over(vec4(display(LIT(legC * 0.8, 0.5) + u_key * lin(legC) * 0.25) * webOnly * (1.0 - 0.3 * under), webOnly * (1.0 - 0.3 * under)), acc);
  float legShow = legA * (1.0 - 0.12 * under);
  acc = over(vec4(display(LIT(legC, 1.0)) * legShow, legShow), acc);

  float hBody = sqrt(clamp(-pt.body / 0.16, 0.0, 1.0)) * 0.12;
  vec3 skin = mix(k.side, k.back, smoothstep(0.02, 0.1, hBody));
  skin = mix(skin, k.spot, smoothstep(k.blotch, k.blotch + 0.08, vnoise(q * vec2(8.0, 10.0) + seed * 13.0)) * 0.85);
  if (kind > 1.5 && kind < 2.5) {
    vec2 lp = leopard(q, seed);
    skin = mix(skin, k.ridge * 0.9, lp.y * 0.6);
    skin = mix(skin, k.spot, lp.x * 0.9);
  }
  // pale folds running down either side of the back
  float ridge = exp(-pow((s.y - 0.11) / 0.016, 2.0)) * smoothstep(-0.28, -0.12, q.x) * (1.0 - smoothstep(0.12, 0.24, q.x));
  skin = mix(skin, k.ridge, ridge * 0.55);
  skin *= 0.9 + 0.2 * vnoise(q * 40.0 + seed * 3.0); // granular skin
  if (kind > 3.5) {
    // the wood frog's dark mask, snout through the eye to the eardrum
    float mask = 1.0 - smoothstep(0.0, 0.02 + aa, sdSeg(s, vec2(0.45, 0.035), vec2(0.13, 0.16), 0.03));
    skin = mix(skin, vec3(0.12, 0.07, 0.04), mask * 0.9);
  }
  // the eardrum, a flat disc behind each eye
  float ear = length(s - vec2(0.185, 0.155));
  skin = mix(skin, skin * 0.72 + vec3(0.03, 0.02, 0.0), 1.0 - smoothstep(0.034, 0.034 + aa, ear));
  skin = mix(skin, skin * 1.15, smoothstep(0.03, 0.036, ear) * (1.0 - smoothstep(0.036, 0.044 + aa, ear)));
  float mouth = (1.0 - smoothstep(0.004, 0.009 + aa, abs(pt.head + 0.018))) * smoothstep(0.3, 0.38, q.x);
  skin *= 1.0 - mouth * 0.55;
  skin *= 1.0 - (1.0 - smoothstep(0.008, 0.014, length(s - vec2(0.43, 0.035)))) * 0.6; // nostrils
  acc = over(vec4(display(LIT(skin, 1.0)) * bodyA, bodyA), acc);

  if (sacA > 0.0) {
    vec3 sacC = vec3(0.95, 0.9, 0.62);
    acc = over(vec4(display(LIT(sacC, 1.5)) * sacA, sacA), acc);
  }

  // eyes: coloured iris with fine streaks, a horizontal pupil, a wet glint, and a lid for blinking
  vec2 e = s - vec2(0.275, 0.135);
  float er = length(e) / 0.068;
  vec3 iris = mix(k.iris, k.iris * 0.72, smoothstep(0.3, 0.8, er)) * (0.85 + 0.15 * sin(atan(e.y, e.x) * 14.0));
  vec3 eyeC = mix(iris, mix(k.iris * 1.05, skin, 0.5), smoothstep(0.8, 0.95, er));
  float pupil = 1.0 - smoothstep(-aa, aa, sdEllipse(e, vec2(0.042, 0.024)));
  eyeC = mix(eyeC, vec3(0.02), pupil);
  eyeC = mix(eyeC, skin * 0.9, smoothstep(0.1, 0.9, blink));
  float glint = (1.0 - smoothstep(0.0, 0.012, length(e - vec2(0.012, -0.02)))) * (1.0 - blink);
  vec3 eyeLit = lin(eyeC) * light + shine * 1.4 + u_key * glint * 1.5 + lin(eyeC) * 0.03;
  eyeLit = mix(eyeLit, eyeLit * 0.45 + u_water * 1.5, v_depth * 0.7);
  acc = over(vec4(display(eyeLit) * eyeA, eyeA), acc);
  o = acc * (1.0 - 0.5 * v_depth); // seen through more water, it fades into the murk
}`
