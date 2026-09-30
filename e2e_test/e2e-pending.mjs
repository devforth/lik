import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5391'
const OUT = process.env.OUT || `${import.meta.dirname}/out`
import('node:fs').then((fs) => fs.mkdirSync(OUT, { recursive: true }))
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
page.on('console', (m) => { const t = m.text(); if (/reconnect|publish error|closed subscription/.test(t)) log('console:', t.slice(0, 140)) })
page.on('pageerror', (e) => log('PAGEERROR', e.message))
const indicator = () => page.getByRole('button', { name: /^(Synced|Sending…|Checking…|Not sent|On phone|\d+ on phone)/ })
async function waitIndicator(re, ms = 30000) {
  const start = Date.now(); let last = ''
  while (Date.now() - start < ms) {
    last = (await indicator().getAttribute('aria-label').catch(() => '')) || ''
    if (re.test(last)) return last
    await page.waitForTimeout(250)
  }
  throw new Error(`indicator never matched ${re}, last="${last}"`)
}

let blocked = false
await page.routeWebSocket(/wss:\/\//, (ws) => { if (blocked) ws.close(); else ws.connectToServer() })
await page.goto(BASE + '/')
await page.getByPlaceholder('Enter name').fill('Pending test')
await page.getByRole('button', { name: 'Create' }).click()
await page.waitForURL(/\/scoreboard\//)
await page.getByRole('button', { name: 'Add category' }).click()
await page.getByPlaceholder('e.g., Bugs fixed').fill('Dishes')
await page.getByRole('button', { name: 'Create' }).click()
log('start:', await waitIndicator(/Synced/, 30000))

// Relays unreachable while the phone thinks it's online: every relay socket closes immediately
blocked = true
await page.evaluate(() => window.dispatchEvent(new Event('online'))) // drop current sockets
await page.waitForTimeout(3500)
await page.getByRole('button', { name: '+1' }).first().click()
log('after tap:', await waitIndicator(/Sending/, 3000))
log('stale:', await waitIndicator(/Not sent/, 20000))
log('dots:', await page.locator('text=not sent yet').count())
await page.screenshot({ path: `${OUT}/e2e-5-pending.png` })
await indicator().click()
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/e2e-6-pending-sheet.png` })
log('sheet:\n' + (await page.locator('[role=dialog]').innerText()))
await page.keyboard.press('Escape') // an open sheet hides the page (and the indicator) from the accessibility tree
await page.waitForTimeout(500)

// Relays come back; the automatic retry (every 15 s) should confirm without touching anything
blocked = false
log('unblocked')
log('recovered:', await waitIndicator(/Synced/, 40000))
await indicator().click()
await page.waitForTimeout(600)
log('sheet after:\n' + (await page.locator('[role=dialog]').innerText().catch(() => '(closed)')))
await browser.close()
