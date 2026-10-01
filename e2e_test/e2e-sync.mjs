import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5391'
const OUT = process.env.OUT || `${import.meta.dirname}/out`
import('node:fs').then((fs) => fs.mkdirSync(OUT, { recursive: true }))
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('console', (m) => { const t = m.text(); if (/\[sync\]|error/i.test(t) && !/devtools/i.test(t)) log('console:', t.slice(0, 200)) })
page.on('pageerror', (e) => log('PAGEERROR', e.message))

const indicator = () => page.getByRole('button', { name: /^(Synced|Sending…|Checking…|Not sent|On phone|\d+ on phone)/ })
async function indicatorText() { return (await indicator().getAttribute('aria-label')) || '' }
async function waitIndicator(re, ms = 30000) {
  const start = Date.now()
  let last = ''
  while (Date.now() - start < ms) {
    last = await indicatorText().catch(() => '')
    if (re.test(last)) return last
    await page.waitForTimeout(250)
  }
  throw new Error(`indicator never matched ${re}, last="${last}"`)
}

await page.goto(BASE + '/')
await page.getByPlaceholder('Enter name').fill('Sync test')
await page.getByRole('button', { name: 'Create' }).click()
await page.waitForURL(/scoreboard/)
log('board created', page.url())
await page.getByRole('button', { name: 'Add category' }).click()
await page.getByPlaceholder('e.g., Bugs fixed').fill('Dishes')
await page.getByRole('button', { name: 'Create' }).click()
log('after add category:', await waitIndicator(/Sending|Synced/, 5000))
log('then:', await waitIndicator(/Synced/, 30000))

// +1 for the first participant
await page.getByRole('button', { name: 'Increment' }).first().click()
log('after +1:', await waitIndicator(/Sending/, 3000))
log('then:', await waitIndicator(/Synced/, 30000))
await page.screenshot({ path: `${OUT}/e2e-1-synced.png` })

// Offline: change stays on phone
await ctx.setOffline(true)
await page.getByRole('button', { name: 'Increment' }).first().click()
await page.getByRole('button', { name: 'Increment' }).nth(1).click()
log('offline after taps:', await waitIndicator(/on phone/, 5000))
const dots = await page.locator('text=not sent yet').count()
log('unsent dots:', dots)
await page.screenshot({ path: `${OUT}/e2e-2-offline.png` })
await indicator().click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/e2e-3-offline-sheet.png` })
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

// Back online: automatic retry
await ctx.setOffline(false)
log('online:', await waitIndicator(/Synced/, 40000))
log('dots after sync:', await page.locator('text=not sent yet').count())
await indicator().click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/e2e-4-synced-sheet.png` })
const sheet = await page.locator('[role=dialog]').innerText().catch(() => '')
log('sheet:\n' + sheet)
await browser.close()
