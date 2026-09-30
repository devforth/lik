// Shortlist stress: repeated rounds of connect -> 8 rapid PRE publishes (monotonic created_at) -> fresh-connection readback.
import { Relay } from 'nostr-tools/relay'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { randomBytes } from 'node:crypto'

const RELAYS = process.argv.slice(2)
const ROUNDS = 3
const BURST = 8
const withTimeout = (p, ms, l) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(l + ' timeout')), ms))])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect(url) {
  const t0 = Date.now()
  const r = new Relay(url); r.connectionTimeout = 6000; r.publishTimeout = 6000
  await withTimeout(r.connect(), 7000, 'connect')
  return { r, ms: Date.now() - t0 }
}
function getLatest(r, filter, ms = 6000) {
  return new Promise((resolve) => {
    let best = null, done = false
    const t0 = Date.now()
    const fin = () => { if (done) return; done = true; try { sub.close() } catch {}; resolve({ best, ms: Date.now() - t0 }) }
    const sub = r.subscribe([filter], { onevent: (e) => { if (!best || e.created_at > best.created_at) best = e }, oneose: fin, onclose: fin, eoseTimeout: ms })
    setTimeout(fin, ms + 500)
  })
}

async function run(url) {
  const sk = generateSecretKey()
  const stats = { url, connect: [], okPublishes: 0, rejects: [], reads: 0, readMs: [] }
  for (let round = 0; round < ROUNDS; round++) {
    const d = `lik::crdt::burst-${randomBytes(5).toString('hex')}`
    let last = null
    try {
      const { r, ms } = await connect(url)
      stats.connect.push(ms)
      let ts = Math.floor(Date.now() / 1000)
      const pubs = []
      for (let i = 0; i < BURST; i++) {
        const evt = finalizeEvent({ kind: 30078, created_at: ts++, tags: [['d', d]], content: randomBytes(2400).toString('base64') }, sk)
        last = evt
        pubs.push(r.publish(evt).then(() => { stats.okPublishes++ }, (e) => stats.rejects.push(String(e?.message || e).slice(0, 60))))
        await sleep(120)
      }
      await Promise.allSettled(pubs)
      r.close()
    } catch (e) { stats.connect.push('FAIL'); continue }
    await sleep(1500)
    try {
      const { r } = await connect(url)
      const { best, ms } = await getLatest(r, { kinds: [30078], authors: [last.pubkey], '#d': [d] })
      if (best && best.id === last.id) stats.reads++
      stats.readMs.push(ms)
      r.close()
    } catch {}
  }
  const med = (a) => { const n = a.filter((x) => typeof x === 'number').sort((x, y) => x - y); return n.length ? n[Math.floor(n.length / 2)] : null }
  return { url, connectMed: med(stats.connect), connectFails: stats.connect.filter((x) => x === 'FAIL').length, published: `${stats.okPublishes}/${ROUNDS * BURST}`, latestReadBack: `${stats.reads}/${ROUNDS}`, readMed: med(stats.readMs), rejects: [...new Set(stats.rejects)] }
}

// sequential per relay to get honest latency numbers
for (const u of RELAYS) console.log(JSON.stringify(await withTimeout(run(u), 120000, 'run').catch((e) => ({ url: u, err: e.message }))))
process.exit(0)
