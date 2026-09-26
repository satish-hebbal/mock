// Fireflies drifting over the water: each wanders on a few slow sine waves and glows in pulses,
// dark most of the time. Written as (x, y, brightness, size) for the overlay pass.

export function createFlies(count: number, seed: number) {
  let s = seed
  const rand = () => (s = (s * 16807) % 0x7fffffff) / 0x7fffffff
  const flies = Array.from({ length: count }, () => ({
    x: rand(),
    y: rand(),
    fx: 0.05 + rand() * 0.08,
    fy: 0.05 + rand() * 0.08,
    phase: rand() * 100,
    period: 3 + rand() * 4,
    glow: 0.4 + rand() * 0.6,
  }))
  const out = new Float32Array(16 * 4)

  function update(now: number, width: number, height: number, unit: number) {
    flies.forEach((f, i) => {
      const t = now + f.phase
      const x = f.x + Math.sin(t * f.fx) * 0.08 + Math.sin(t * f.fx * 2.7 + 1.3) * 0.02
      const y = f.y + Math.sin(t * f.fy + 2.1) * 0.06 + Math.sin(t * f.fy * 3.1) * 0.015
      // pulse: a soft rise and fall, then a longer dark spell
      const cycle = (t % f.period) / f.period
      const pulse = cycle < 0.35 ? Math.sin((cycle / 0.35) * Math.PI) ** 2 : 0
      out.set([(((x % 1) + 1) % 1) * width, (((y % 1) + 1) % 1) * height, pulse * f.glow, 2.6 * unit], i * 4)
    })
    return out
  }

  return { count, update }
}
