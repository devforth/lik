// Elevator / dead zone: connectivity vanishes while the phone still thinks it's online (no 'offline'/'online' events).
// Open sockets turn into black holes (no close, nothing delivered) and stay dead afterwards (NAT forgot them);
// new sockets fail during the outage and work after it.
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5391'
const OUTAGE_MS = Number(process.env.OUTAGE_MS || 20000)
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('console', (m) => { const t = m.text(); if (/publish error|reconnect|pingpong/.test(t)) log('console:', t.slice(0, 140)) })

let outage = false
const sockets = []
await page.routeWebSocket(/wss:\/\//, (ws) => {
  if (outage) { ws.close(); return }
  const server = ws.connectToServer()
  const s = { dead: false }
  sockets.push(s)
  ws.onMessage((m) => { if (!s.dead) server.send(m) })
  server.onMessage((m) => { if (!s.dead) ws.send(m) })
})

const indicator = () => page.getByRole('button', { name: /^(Synced|Sending…|Checking…|Not sent|On phone|\d+ on phone)/ })
async function waitIndicator(re, ms) {
  const start = Date.now(); let last = ''
  while (Date.now() - start < ms) {
    last = (await indicator().getAttribute('aria-label').catch(() => '')) || ''
    if (re.test(last)) return `${last} after ${((Date.now() - start) / 1000).toFixed(1)}s`
    await page.waitForTimeout(250)
  }
  throw new Error(`never ${re} within ${ms / 1000}s, last="${last}"`)
}

await page.goto(BASE + '/')
await page.getByPlaceholder('Enter name').fill('Elevator')
await page.getByRole('button', { name: 'Create' }).click()
await page.waitForURL(/\/scoreboard\//)
await page.getByRole('button', { name: 'Add category' }).click()
await page.getByPlaceholder('e.g., Bugs fixed').fill('Dishes')
await page.getByRole('button', { name: 'Create' }).click()
log('before:', await waitIndicator(/Synced/, 30000))

// Into the elevator
outage = true
for (const s of sockets) s.dead = true
log('outage starts,', sockets.length, 'sockets black-holed')
await page.getByRole('button', { name: '+1' }).first().click()
log('in outage:', await waitIndicator(/Not sent/, 30000))
await page.waitForTimeout(Math.max(0, OUTAGE_MS - 10000))

// Out of the elevator: new sockets work, old ones stay dead
outage = false
log('outage ends')
log('recovered:', await waitIndicator(/Synced/, 180000))
await browser.close()
