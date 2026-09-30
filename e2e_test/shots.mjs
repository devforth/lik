// Screenshot suite of key screens + a core-feature walk-through. Usage: node shots.mjs <outDir>
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:5391'
const OUT = process.argv[2]
mkdirSync(OUT, { recursive: true })
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)
const errors = []

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' })
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/Time sync failed|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)) })

const indicator = () => page.locator('main > div').first().locator('button').last()
async function waitIndicator(re, ms = 30000) {
  const start = Date.now(); let last = ''
  while (Date.now() - start < ms) {
    last = (await indicator().getAttribute('aria-label').catch(() => '')) || ''
    if (re.test(last)) return last
    await page.waitForTimeout(250)
  }
  throw new Error(`indicator never matched ${re}, last="${last}"`)
}
// Random per run: avatars, generated nicknames, keys, QR codes, clock times
const dynamic = () => [page.locator('img'), page.locator('canvas'), page.locator('svg[height="200"]'), page.getByText(/\d{1,2}:\d{2}/), page.getByText(/\d+[smhd] ago/)]
async function snap(name, extraMasks = []) {
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled', mask: [...dynamic(), ...extraMasks], maskColor: '#ff00ff' })
  log('shot', name)
}
async function closeDrawer() { await page.keyboard.press('Escape'); await page.waitForTimeout(600) }
async function scoreText(i) { return (await page.locator('td .tabular-nums').nth(i).innerText()).replace(/\s+/g, '') }

// Fixed nickname so names are the same in every run
await page.goto(BASE + '/profile')
await page.locator('main input').first().fill('Tester')
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
await page.goto(BASE + '/')
await page.getByPlaceholder('Enter name').waitFor()
await snap('01-new-scoreboard')

await page.getByPlaceholder('Enter name').fill('Home league')
await page.getByRole('button', { name: 'Create' }).click()
await page.waitForURL(/\/scoreboard\//)
await snap('02-empty-board')

for (const name of ['Dishes', 'Homework']) {
  await page.getByRole('button', { name: 'Add category' }).click()
  await page.getByPlaceholder('e.g., Bugs fixed').fill(name)
  await page.getByRole('button', { name: 'Create' }).click()
  await page.waitForTimeout(400)
}
// Homework is newest -> on top. Scores: Bob +3/-1 in Homework, Alice +2, Dishes Bob +1
const inc = (i) => page.getByRole('button', { name: 'Increment' }).nth(i).click()
const dec = (i) => page.getByRole('button', { name: 'Decrement' }).nth(i).click()
await inc(0); await inc(0); await inc(0); await dec(0)
await inc(1); await inc(1)
await inc(2)
await page.getByRole('button', { name: 'Toggle priority' }).nth(1).click()
await waitIndicator(/Synced/, 40000)
const scores = [await scoreText(0), await scoreText(1), await scoreText(2), await scoreText(3)]
log('scores', scores.join(','))
if (scores.join(',') !== '2,2,1,0') errors.push('unexpected scores ' + scores.join(','))
await snap('03-board')

// Category menu -> rename
await page.getByRole('button', { name: 'Open category menu' }).first().click()
await snap('04-category-menu')
await page.getByRole('menuitem', { name: 'Rename' }).click()
await snap('05-rename-category')
await page.getByPlaceholder('Category name').fill('Homework done')
await page.getByRole('button', { name: 'Save' }).click()
await page.waitForTimeout(500)
if (!(await page.getByText('Homework done').count())) errors.push('rename failed')

// Board menu + drawers
await waitIndicator(/Synced/, 40000)
await page.getByRole('button', { name: 'Open menu' }).click()
await snap('06-board-menu')
await page.getByRole('menuitem', { name: 'Log' }).click()
await snap('07-log-drawer')
await closeDrawer()
await page.getByRole('button', { name: 'Open menu' }).click()
await page.getByRole('menuitem', { name: 'Settings' }).click()
await snap('08-settings-drawer')
await closeDrawer()
await page.getByRole('button', { name: 'Open menu' }).click()
await page.getByRole('menuitem', { name: 'Invite to board' }).click()
await snap('09-invite-drawer', [page.locator('[role=dialog] input'), page.locator('[role=dialog] .font-mono')])
await closeDrawer()

// Sync details
await waitIndicator(/Synced/, 40000)
await indicator().click()
await snap('10-sync-details')
await closeDrawer()

// Delete category confirm (cancel)
await page.getByRole('button', { name: 'Open category menu' }).nth(1).click()
await page.getByRole('menuitem', { name: 'Delete' }).click()
await snap('11-delete-category')
await page.getByRole('button', { name: 'Cancel' }).click()

// Sidebar
await page.getByRole('button', { name: 'Toggle Sidebar' }).click()
await snap('12-sidebar', [page.locator('[data-sidebar=footer] button').last()])
await closeDrawer()

// Profile + join pages
await page.goto(BASE + '/profile')
await snap('13-profile', [page.locator('input')])
await page.goto(BASE + '/join-board')
await page.waitForTimeout(1200)
await snap('14-join', [page.locator('video')])

// Dark mode board (reload keeps data in IndexedDB)
await page.emulateMedia({ colorScheme: 'dark' })
await page.goto(BASE + '/')
await page.waitForURL(/\/scoreboard\//)
await waitIndicator(/Synced|Checking/, 40000)
const afterReload = [await scoreText(0), await scoreText(1)]
if (afterReload.join(',') !== '2,2') errors.push('scores lost after reload ' + afterReload.join(','))
await waitIndicator(/Synced/, 40000)
await snap('15-board-dark')

await browser.close()
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS')
