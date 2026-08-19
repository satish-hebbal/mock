import { useEffect, useState } from 'react'

/**
 * Is there room for the editor?
 *
 * Below Linear's tablet step (1024px): phones in both orientations, and
 * portrait tablets. Lives apart from the component it gates so that file stays
 * a component-only module and keeps fast refresh.
 */
const DESKTOP = '(min-width: 1024px)'

export function useIsDesktop() {
  const [ok, setOk] = useState(() => window.matchMedia(DESKTOP).matches)
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP)
    const onChange = () => setOk(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return ok
}
