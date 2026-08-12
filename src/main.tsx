import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
