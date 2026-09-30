// Two phones: owner A invites B, B joins, both edit; then the original bug: B closed, A scores, B opens later.
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5391'
const OUT = process.env.OUT || `${import.meta.dirname}/out`
import('node:fs').then((fs) => fs.mkdirSync(OUT, { recursive: true }))
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)
const fails = []
const check = (ok, what) => { log(ok ? 'PASS' : 'FAIL', what); if (!ok) fails.push(what) }

const browser = await chromium.launch()
async function phone(name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => log(name, 'PAGEERROR', e.message))
  page.on('console', (m) => { const t = m.text(); if (/sb-join-req|publishProfileToRelays|\[user\]/.test(t)) log(name, 'console:', t.slice(0, 160)) })
  await page.goto(BASE + '/profile')
  await page.locator('main input').first().fill(name)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(8000) // profile publish (join requests need a name on relays)
  return { ctx, page }
}
const indicatorOf = (page) => page.getByRole('button', { name: /^(Synced|Sending…|Checking…|Not sent|On phone|\d+ on phone)/ })
async function waitFor(page, fn, what, ms = 45000) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    try { if (await fn()) return true } catch {}
    await page.waitForTimeout(300)
  }
  return false
}
const score = (page, i) => page.locator('main section .tabular-nums').nth(i).innerText().then((t) => t.replace(/\D+/g, ''))

// --- A creates the board
const A = await phone('Anna')
await A.page.goto(BASE + '/')
await A.page.getByPlaceholder('Enter name').fill('Family')
await A.page.getByRole('button', { name: 'Create' }).click()
await A.page.waitForURL(/\/scoreboard\//)
await A.page.getByRole('button', { name: 'Add category' }).click()
await A.page.getByPlaceholder('e.g., Bugs fixed').fill('Dishes')
await A.page.getByRole('button', { name: 'Create' }).click()
await A.page.getByRole('button', { name: 'Open menu' }).click()
await A.page.getByRole('menuitem', { name: 'Invite to board' }).click()
const code = await A.page.locator('[role=dialog] input').inputValue()
await A.page.keyboard.press('Escape')
check(/^lik::/.test(code), 'invite code shown')

// --- B joins with the code
const B = await phone('Boris')
await B.page.goto(BASE + '/join-board')
await B.page.getByRole('button', { name: /Enter manually/i }).click()
await B.page.getByPlaceholder(/Enter share code/).fill(code)
await B.page.getByRole('button', { name: 'Join' }).click()
await B.page.waitForURL(/\/scoreboard\//, { timeout: 30000 })
check(await waitFor(B.page, async () => (await B.page.getByText('Dishes').count()) > 0, ''), 'B sees board content before approval (read-only)')
check(await waitFor(B.page, async () => (await B.page.getByText('Read-only').count()) > 0, ''), 'B is read-only before approval')

// --- A approves the request
check(await waitFor(A.page, async () => (await A.page.getByRole('button', { name: 'Approve' }).count()) > 0, ''), 'A gets join request')
await A.page.getByRole('button', { name: 'Approve' }).click()
check(await waitFor(B.page, async () => (await B.page.getByText('Read-only').count()) === 0 && await B.page.getByRole('button', { name: '+1' }).first().isEnabled(), ''), 'B becomes editor after approval')

// --- B scores, A receives
await B.page.getByRole('button', { name: '+1' }).nth(1).click() // Alice +1
check(await waitFor(A.page, async () => (await score(A.page, 1)) === '1', ''), 'A receives B\'s +1')
check(await waitFor(B.page, async () => /Synced/.test(await indicatorOf(B.page).getAttribute('aria-label')), ''), 'B indicator Synced')

// --- A scores, B receives live
await A.page.getByRole('button', { name: '+1' }).first().click()
check(await waitFor(B.page, async () => (await score(B.page, 0)) === '1', ''), 'B receives A\'s +1 live')

// --- Original bug: B's app closed, A keeps scoring, B opens much later
await B.page.close()
log('B closed')
for (let i = 0; i < 3; i++) { await A.page.getByRole('button', { name: '+1' }).first().click(); await A.page.waitForTimeout(700) }
check(await waitFor(A.page, async () => /Synced/.test(await indicatorOf(A.page).getAttribute('aria-label')), ''), 'A indicator Synced after 3 more taps')
await A.page.waitForTimeout(3000)
const Bp = await B.ctx.newPage()
await Bp.goto(BASE + '/')
await Bp.waitForURL(/\/scoreboard\//)
const firstLabel = await indicatorOf(Bp).getAttribute('aria-label').catch(() => '')
log('B reopened, indicator:', firstLabel)
check(await waitFor(Bp, async () => (await score(Bp, 0)) === '4', ''), 'B reopened sees A\'s 4 (was 1)')
await Bp.waitForTimeout(600)
await Bp.screenshot({ path: `${OUT}/two-B-reopened.png` })
await indicatorOf(Bp).click()
await Bp.waitForTimeout(800)
const sheet = await Bp.locator('[role=dialog]').innerText()
check(/Latest from others[\s\S]*Anna/.test(sheet), 'B sheet shows latest from Anna')
await Bp.screenshot({ path: `${OUT}/two-B-sheet.png` })
await Bp.keyboard.press('Escape')
await A.page.screenshot({ path: `${OUT}/two-A.png` })

await browser.close()
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'ALL PASSED')
