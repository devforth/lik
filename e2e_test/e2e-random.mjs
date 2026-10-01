// Random pick in the real app: with crypto.getRandomValues fed known values, the panel must land
// exactly on value % n, and a value past the last full multiple of n must be redrawn.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:5391'
const OUT = process.env.OUT || `${import.meta.dirname}/out`
mkdirSync(OUT, { recursive: true })
const fails = []
const check = (ok, what) => { console.log(ok ? 'PASS' : 'FAIL', what); if (!ok) fails.push(what) }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
// Values queued in window.__rand go to the next Uint32Array(1) draws (only the pick uses that shape)
await ctx.addInitScript(() => {
  window.__rand = []
  const real = crypto.getRandomValues.bind(crypto)
  crypto.getRandomValues = (arr) => {
    if (arr instanceof Uint32Array && arr.length === 1 && window.__rand.length) { arr[0] = window.__rand.shift(); return arr }
    return real(arr)
  }
})
const page = await ctx.newPage()
const panel = page.getByRole('status').filter({ hasText: /Picked|Picking/ })

async function rollWith(values) {
  await page.evaluate((v) => { window.__rand = v }, values)
  await page.getByRole('button', { name: 'Pick someone at random' }).click()
  await panel.getByText('Picked').waitFor({ timeout: 3000 })
  const name = (await panel.innerText()).replace(/Picked/i, '').trim()
  const left = await page.evaluate(() => window.__rand.length)
  await page.getByRole('button', { name: 'Close' }).click()
  return { name, left }
}

await page.goto(BASE + '/')
await page.getByPlaceholder('Enter name').fill('Cards')
await page.getByRole('button', { name: 'Create' }).click()
await page.waitForURL(/\/scoreboard\//)
await page.getByRole('button', { name: 'Add category' }).click()
await page.getByPlaceholder('e.g., Bugs fixed').fill('Dishes')
await page.getByRole('button', { name: 'Create' }).click()

// Two participants (Bob, Alice): value % 2
for (const [v, want] of [[0, 'Bob'], [1, 'Alice'], [6, 'Bob'], [4294967295, 'Alice']]) {
  const r = await rollWith([v])
  check(r.name === want && r.left === 0, `n=2 value ${v} -> ${want} (got ${r.name})`)
}

// Third participant: limit is 4294967295, so 4294967295 must be redrawn
await page.getByRole('button', { name: 'Open menu' }).click()
await page.getByRole('menuitem', { name: 'Add participant' }).click()
await page.getByPlaceholder('e.g., Carol').fill('Carol')
await page.getByRole('button', { name: 'Add', exact: true }).click()
await page.waitForTimeout(500)
for (const [vals, want] of [[[9], 'Bob'], [[7], 'Alice'], [[5], 'Carol'], [[4294967295, 4], 'Alice']]) {
  const r = await rollWith(vals)
  check(r.name === want && r.left === 0, `n=3 values ${vals.join(',')} -> ${want} (got ${r.name}, unused ${r.left})`)
}

// Screens: star on Bob, panel mid-spin and landed
await page.getByRole('button', { name: 'Toggle priority' }).first().click()
await page.evaluate(() => { window.__rand = [2] })
await page.getByRole('button', { name: 'Pick someone at random' }).click()
await page.waitForTimeout(120)
await page.screenshot({ path: `${OUT}/random-spinning.png` })
await panel.getByText('Picked').waitFor()
await page.waitForTimeout(250)
await page.screenshot({ path: `${OUT}/random-landed.png` })
await page.getByRole('button', { name: 'Close' }).click()
await page.emulateMedia({ colorScheme: 'dark' })
await page.reload()
await page.getByText('Dishes').waitFor()
await page.waitForTimeout(800)
await page.screenshot({ path: `${OUT}/random-board-dark.png` })

await browser.close()
console.log(fails.length ? `FAILED: ${fails.join('; ')}` : 'ALL PASSED')
process.exit(fails.length ? 1 : 0)
