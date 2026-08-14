import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import '@fontsource/bodoni-moda/400.css'
import '@fontsource/bodoni-moda/600.css'
import '@fontsource/bodoni-moda/700.css'
import '@fontsource/bodoni-moda/900.css'
import '@fontsource/bodoni-moda/400-italic.css'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/jetbrains-mono'

import './styles/tokens.css'
import './styles/base.css'
import './styles/parts.css'
import { App } from './App'

/* --------------------------------------------------------------------------
   Native-feel press states.

   A web button bound to `click` only reacts when the finger LIFTS. A native
   button depresses the instant the finger LANDS. That gap is most of what
   makes a web app feel like a web page, so we drive the visual state from
   pointerdown globally and let click keep handling the actual action.
   -------------------------------------------------------------------------- */

let pressed: HTMLElement | null = null

const release = () => {
  if (pressed) {
    pressed.removeAttribute('data-pressed')
    pressed = null
  }
}

document.addEventListener(
  'pointerdown',
  (e) => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-pressable]')
    if (!target || target.hasAttribute('disabled')) return
    release()
    pressed = target
    target.setAttribute('data-pressed', 'true')
  },
  { passive: true },
)

for (const evt of ['pointerup', 'pointercancel', 'pointerleave', 'scroll'] as const) {
  document.addEventListener(evt, release, { passive: true, capture: true })
}

// Belt-and-braces against iOS pinch/double-tap zoom inside the app shell.
document.addEventListener('gesturestart', (e) => e.preventDefault())

/* --------------------------------------------------------------------------
   Updates.

   The bare registration the plugin injects by default downloads a new
   version silently but never applies it — phones resume the PWA from memory
   for days, so a deploy could sit invisible indefinitely. This registration
   (auto-update mode) reloads the moment a new service worker takes control,
   and re-checks whenever the app comes back to the foreground, so a push
   lands on the phones the next time the app is opened.
   -------------------------------------------------------------------------- */

registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update()
    })
    setInterval(() => void reg.update(), 60 * 60 * 1000)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
