/**
 * Rank each model's meshes by "how much does this look like the display?".
 *
 * Sketchfab exports usually mangle names (Object_47, aAftszMZbNEMhoe), so name
 * matching alone is not enough. A display surface is: flat (one axis ~0), large
 * in area, UV-mapped, and — unlike a camera lens or a logo inlay — one of the
 * biggest flat things in the model. We score on that and print the top few for
 * visual confirmation.
 *
 * Usage: node scripts/detect-screens.mjs [file.glb ...]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'public', 'models')

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(SRC).filter((f) => f.endsWith('.glb'))

for (const file of files) {
  const buf = fs.readFileSync(path.join(SRC, file))
  const jsonLen = buf.readUInt32LE(12)
  const j = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'))

  // node name per mesh index — three.js names Object3D from the *node*
  const nodeOfMesh = new Map()
  ;(j.nodes || []).forEach((n) => {
    if (n.mesh !== undefined && !nodeOfMesh.has(n.mesh)) nodeOfMesh.set(n.mesh, n.name)
  })

  const rows = []
  ;(j.meshes || []).forEach((m, mi) => {
    for (const p of m.primitives || []) {
      const acc = j.accessors[p.attributes.POSITION]
      if (!acc?.min || !acc?.max) continue
      const d = [acc.max[0] - acc.min[0], acc.max[1] - acc.min[1], acc.max[2] - acc.min[2]]
      const sorted = [...d].sort((a, b) => b - a)
      const [big, mid, thin] = sorted
      const flat = thin / (big || 1)
      const area = big * mid
      const matName = p.material !== undefined ? j.materials[p.material]?.name : undefined
      rows.push({
        node: nodeOfMesh.get(mi) ?? m.name,
        mesh: m.name,
        mat: matName,
        area,
        flat,
        uv: p.attributes.TEXCOORD_0 !== undefined,
      })
    }
  })

  const maxArea = Math.max(...rows.map((r) => r.area), 1)
  const scored = rows
    .filter((r) => r.uv && r.flat < 0.08)
    .map((r) => ({
      ...r,
      // favour big + very flat; a name hit is a strong tiebreaker
      score:
        (r.area / maxArea) * (1 - r.flat * 6) +
        (/screen|display|glass|lcd|oled/i.test(`${r.node} ${r.mat}`) ? 0.5 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)

  console.log(`\n=== ${file}`)
  for (const s of scored) {
    console.log(
      `  score=${s.score.toFixed(3)} area=${s.area.toFixed(2)} flat=${s.flat.toFixed(4)}  node="${s.node}" mat="${s.mat}"`,
    )
  }
}
