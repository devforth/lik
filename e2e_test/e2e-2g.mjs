import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:5391'
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('console', (m) => { const t = m.text(); if (/publish error|reconnect/.test(t)) log('console:', t.slice(0, 140)) })
const indicator = () => page.getByRole('button', { name: /^(Synced|Sending…|Checking…|Not sent|On phone|\d+ on phone)/ })
async function waitIndicator(re, ms) {
  const start = Date.now(); let last = ''
  while (Date.now() - start < ms) {
    last = (await indicator().getAttribute('aria-label').catch(() => '')) || ''
    if (re.test(last)) return `${last} after ${((Date.now() - start) / 1000).toFixed(1)}s`
    await page.waitForTimeout(250)
  }
  throw new Error(`never ${re}, last="${last}"`)
}
await page.goto(BASE + '/')
await page.getByPlaceholder('Enter name').fill('2G test')
await page.getByRole('button', { name: 'Create' }).click()
await page.waitForURL(/\/scoreboard\//)
await page.getByRole('button', { name: 'Add category' }).click()
await page.getByPlaceholder('e.g., Bugs fixed').fill('Dishes')
await page.getByRole('button', { name: 'Create' }).click()
log('fast net:', await waitIndicator(/Synced/, 30000))

// GPRS-like: 50 kbit/s down, 20 kbit/s up, 500 ms latency; fresh sockets so the handshake runs throttled
const cdp = await ctx.newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: Number(process.env.LATENCY || 500), downloadThroughput: Number(process.env.DOWN_KBIT || 50) * 1024 / 8, uploadThroughput: Number(process.env.UP_KBIT || 20) * 1024 / 8 })
await page.evaluate(() => window.dispatchEvent(new Event('online')))
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Increment' }).first().click()
log('2G tap ->', await waitIndicator(/Synced/, 120000))
await indicator().click(); await page.waitForTimeout(500)
log((await page.locator('[role=dialog]').innerText()).split('\n').filter(Boolean).slice(0, 20).join(' | '))
await browser.close()
