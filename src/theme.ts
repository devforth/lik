import { ref } from 'vue'

// Simple theme manager that respects OS by default and persists user choice.
// It toggles the `dark` class on the document root so Tailwind/shadcn tokens apply.

type Pref = 'light' | 'dark' | null

const STORAGE_KEY = 'lik.theme'
const isDark = ref(false)
const userPref = ref<Pref>(null)
let mql: MediaQueryList | null = null
let mqlHandler: ((e: MediaQueryListEvent) => void) | null = null

function apply(dark: boolean) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (dark) root.classList.add('dark')
  else root.classList.remove('dark')
}

function stopSystemListener() {
  if (mql && mqlHandler) {
    try { mql.removeEventListener('change', mqlHandler) } catch {}
  }
  mqlHandler = null
}

function startSystemListener() {
  if (!mql) return
  stopSystemListener()
  mqlHandler = (e: MediaQueryListEvent) => {
    // Only react to OS changes when there's no explicit user preference.
    if (userPref.value == null) {
      isDark.value = e.matches
      apply(isDark.value)
    }
  }
  try { mql.addEventListener('change', mqlHandler) } catch {}
}

export function initTheme() {
  if (typeof window === 'undefined') return

  // Load user preference
  const stored = (localStorage.getItem(STORAGE_KEY) || '').toLowerCase()
  userPref.value = stored === 'dark' || stored === 'light' ? (stored as Pref) : null

  // Observe OS preference
  mql = window.matchMedia('(prefers-color-scheme: dark)')
  startSystemListener()

  // Effective theme
  const dark = userPref.value ? userPref.value === 'dark' : !!mql?.matches
  isDark.value = dark
  apply(dark)
}

function setDark(dark: boolean) {
  isDark.value = dark
  userPref.value = dark ? 'dark' : 'light'
  try { localStorage.setItem(STORAGE_KEY, userPref.value) } catch {}
  apply(dark)
}

export function toggleTheme(value?: boolean) {
  if (typeof value === 'boolean') setDark(value)
  else setDark(!isDark.value)
}

export function useTheme() {
  return { isDark, toggleTheme }
}
