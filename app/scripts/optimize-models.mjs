/**
 * Device .glb optimizer.
 *
 * Source models (Sketchfab-style exports) ship multi-MB baked textures — including
 * a wallpaper on the screen itself, which the app always replaces with the user's
 * screenshot. So we:
 *   1. strip the screen material's textures (pure waste, we override them),
 *   2. downscale remaining textures and re-encode to WebP,
 *   3. Draco-compress geometry.
 *
 * Deliberately NOT using the `optimize` preset: its `join`/`simplify` passes merge
 * primitives, which would destroy the separate screen mesh we need to target.
 *
 * Usage: node scripts/optimize-models.mjs [file.glb ...]   (default: all)
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { draco, textureCompress, prune, dedup } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, '..', 'public', 'models')
const OUT = path.join(HERE, '..', 'public', 'models', 'optimized')

/** Manifest tells us which mesh/material is the display, per model. */
const MANIFEST = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'src', 'lib', 'deviceModels.json'), 'utf8')).models

/** Generic fallback for models whose names aren't obfuscated. */
const SCREEN_MATERIAL = /screen|display|glass/i

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  })

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(SRC).filter((f) => f.endsWith('.glb'))

fs.mkdirSync(OUT, { recursive: true })

for (const file of files) {
  const inPath = path.join(SRC, file)
  const outPath = path.join(OUT, file)
  const before = fs.statSync(inPath).size

  const doc = await io.read(inPath)
  const entry = MANIFEST.find((m) => m.file === file)

  // Which material does the manifest's screen mesh actually use? Node names and
  // material names differ, so resolve through the mesh the node points at.
  const screenMats = new Set()
  if (entry) {
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh()
      if (!mesh) continue
      if (node.getName() === entry.screenMesh || mesh.getName() === entry.screenMesh) {
        for (const prim of mesh.listPrimitives()) {
          const m = prim.getMaterial()
          if (m) screenMats.add(m)
        }
      }
    }
  }

  // 1. Drop textures from screen materials — we always paint over them.
  let stripped = 0
  for (const mat of doc.getRoot().listMaterials()) {
    if (!screenMats.has(mat) && !SCREEN_MATERIAL.test(mat.getName())) continue
    if (mat.getBaseColorTexture()) {
      mat.setBaseColorTexture(null)
      stripped++
    }
    if (mat.getEmissiveTexture()) {
      mat.setEmissiveTexture(null)
      mat.setEmissiveFactor([0, 0, 0])
      stripped++
    }
    // a plain dark base so an un-textured screen still reads as "off", not white
    mat.setBaseColorFactor([0.04, 0.04, 0.05, 1])
  }

  await doc.transform(
    dedup(),
    prune(), // removes textures orphaned by the step above
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024] }),
    draco(),
  )

  await io.write(outPath, doc)
  const after = fs.statSync(outPath).size
  const pct = (100 * (1 - after / before)).toFixed(0)
  console.log(
    `${file.padEnd(42)} ${(before / 1048576).toFixed(1)}MB → ${(after / 1048576).toFixed(2)}MB  (-${pct}%, ${stripped} screen textures stripped)`,
  )
}
