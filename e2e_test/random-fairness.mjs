// Fairness of secureRandomIndex (the random pick): exact 1/n by construction + chi-square on real CSPRNG draws.
// node e2e_test/random-fairness.mjs   (Node 24+ runs the TypeScript source directly)
import { secureRandomIndex } from '../src/lib/utils.ts'

// 1) Exactness: every residue owns the same number of accepted 32-bit values
for (const n of [1, 2, 3, 5, 6, 7, 10, 13]) {
  const limit = Math.floor(2 ** 32 / n) * n
  const perResult = limit / n
  console.log(`n=${n}: accepted values ${limit} of 2^32 (${2 ** 32 - limit} redrawn), each result owns exactly ${perResult} -> probability exactly 1/${n}`)
}

// 2) Chi-square on real draws; critical values at alpha = 0.001
const CRITICAL = { 1: 10.828, 2: 13.816, 4: 18.467, 5: 20.515, 6: 22.458, 9: 27.877, 12: 32.909 }
const DRAWS = 1_200_000
let failed = false
for (const n of [2, 3, 5, 6, 7, 10, 13]) {
  const counts = new Array(n).fill(0)
  for (let i = 0; i < DRAWS; i++) counts[secureRandomIndex(n)]++
  const expected = DRAWS / n
  const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0)
  const crit = CRITICAL[n - 1]
  const share = counts.map((c) => (c / DRAWS * 100).toFixed(3) + '%').join(' ')
  const ok = chi2 < crit
  if (!ok) failed = true
  console.log(`n=${n}: chi2=${chi2.toFixed(2)} (critical ${crit}) ${ok ? 'PASS' : 'FAIL'}  shares: ${share}`)
}
console.log(failed ? 'FAILED' : 'ALL PASSED')
process.exit(failed ? 1 : 0)
