import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: register the offline app-shell service worker (production only, so it
// never interferes with the Vite dev HMR loop). PRD §12.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline support is best-effort */
    })
  })
}

// Dev auto-heal: a cache-first service worker left over from a production build
// (or `vite preview`) on this origin would keep serving a stale bundle that even
// a hard refresh can't bypass. In dev, tear any such worker + its caches down.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    if (regs.length === 0) return
    Promise.all(regs.map((r) => r.unregister()))
      .then(() => (self.caches ? caches.keys() : Promise.resolve([])))
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => location.reload())
  })
}
