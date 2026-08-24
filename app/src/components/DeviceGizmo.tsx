import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { TransformControls } from '@react-three/drei'
import { rt } from '../lib/runtime'
import { useStudio } from '../store'

/**
 * Blender-style transform gizmo on the selected device: arrows to move, rings to
 * rotate, handles to scale. Reads the live device group out of the runtime
 * registry and writes changes back into the project on release, so the gizmo and
 * the numeric inspector fields stay in sync.
 */
export function DeviceGizmo() {
  const mode = useStudio((s) => s.gizmo)
  const selectedId = useStudio((s) => s.selectedDeviceId)
  const devices = useStudio((s) => s.project.scene.devices)
  const controls = useRef<THREE.Object3D>(null)

  // The gizmo shares the scene the exporter renders, so it has to be findable
  // and hideable from outside React (see `setEditorObjectsVisible`).
  useEffect(() => {
    const node = controls.current
    if (!node) return
    rt.editorOnly.add(node)
    return () => {
      rt.editorOnly.delete(node)
    }
  }, [mode, selectedId])

  const id = selectedId ?? devices[0]?.id
  const target = id ? rt.deviceGroups.get(id) : undefined

  // Keyframed properties are re-applied every frame by applyAtTime(), which would
  // fight the gizmo mid-drag. Warn once rather than silently snapping back.
  useEffect(() => {
    if (mode === 'off' || !id) return
    const tracked = useStudio
      .getState()
      .project.keyframes.some((k) => k.target.startsWith(`dev.${id}.`))
    if (tracked) {
      // eslint-disable-next-line no-console
      console.warn('[gizmo] this device has keyframed transforms; edits land on the base value')
    }
  }, [mode, id])

  if (mode === 'off' || !target || !id) return null

  const commit = () => {
    const g = target
    useStudio.getState().setDeviceTransform(id, {
      position: [g.position.x, g.position.y, g.position.z],
      rotation: [
        THREE.MathUtils.radToDeg(g.rotation.x),
        THREE.MathUtils.radToDeg(g.rotation.y),
        THREE.MathUtils.radToDeg(g.rotation.z),
      ],
      scale: (g.scale.x + g.scale.y + g.scale.z) / 3,
    })
  }

  return (
    <TransformControls
      ref={controls as never}
      object={target}
      mode={mode}
      size={1.25}
      // camera orbit listens on the canvas; suppress it while a handle is held
      onMouseDown={() => {
        rt.gizmoDragging = true
      }}
      onMouseUp={() => {
        rt.gizmoDragging = false
        commit()
      }}
      onObjectChange={commit}
    />
  )
}
