import { useEffect } from 'react'
import { activeShot, sequenceDuration } from './sequence'
import { globalTimeOf, useStudio } from '../store'

/**
 * rAF playback driver (PRD §5.4).
 *
 * Two clocks, one loop. In Shot it runs the take on screen and wraps at its
 * end, which is what you want while animating one move. In Film it runs the
 * compiled running time and hands the playhead from shot to shot as it crosses
 * each cut, so play is a preview of the file the exporter would write, blends
 * and all.
 */
export function usePlayback() {
  const playing = useStudio((s) => s.playing)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const s = useStudio.getState()
      const dt = now - last
      last = now

      const sequence = s.scrubMode === 'sequence' && s.project.shots.length > 1
      const span = sequence ? sequenceDuration(s.project) : activeShot(s.project).durationMs
      const at = sequence ? globalTimeOf(s) : s.timeMs

      let t = at + dt
      if (t >= span) {
        if (s.loop) t = span > 0 ? t % span : 0
        else {
          if (sequence) s.setGlobalTime(span)
          else s.setTime(span)
          s.setPlaying(false)
          return
        }
      }
      if (sequence) s.setGlobalTime(t)
      else s.setTime(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])
}
