---
default: minor
---

# Redesign with Tailwind CSS v4 and dark/light theme toggle

Complete frontend redesign using Tailwind CSS v4 (CSS-first configuration via
`@tailwindcss/vite` plugin). Replaces all hand-written CSS with Tailwind utility
classes and a custom theme built on oklch colours.

### Visual design
- **Typography**: DM Sans body, Instrument Sans display headings, JetBrains Mono
  for monospace fields — loaded from Google Fonts
- **Colour palette**: oklch-based surface scale with purple accent tones, semantic
  positive/caution/negative colours
- **Layout**: Glass-morphism cards with backdrop blur, gradient orb on the login
  screen, refined spacing and rounded corners
- **Animations**: Fade-in and slide-up entrance animations, smooth hover states

### Dark / Light mode
- Dark mode is the default; detects OS preference via `prefers-color-scheme`
- Sun/moon toggle button on both login and dashboard screens
- Preference persists in `localStorage` and survives page reloads
- All UI elements have explicit light-mode variants

### New E2E tests
- 4 new theme toggle tests covering OS preference detection, toggle switching,
  and persistence across reloads (using isolated browser contexts with
  `colorScheme` set explicitly)
