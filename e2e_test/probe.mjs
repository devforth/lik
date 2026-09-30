// Relay probe for the lik app: tests exactly the event shapes the app uses.
import { Relay } from 'nostr-tools/relay'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { randomBytes } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
mkdirSync(new URL('./out', import.meta.url), { recursive: true })

const CANDIDATES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'wss://relay.damus.io', 'wss://nostr.mom', 'wss://relay.nostr.net', 'wss://relay.primal.net',
  'wss://nos.lol', 'wss://relay.snort.social', 'wss://offchain.pub', 'wss://nostr.oxtr.dev',
  'wss://nostr-pub.wellorder.net', 'wss://nostrue.com', 'wss://relay.nostr.band', 'wss://nostr.bitcoiner.social',
  'wss://relay.mostr.pub', 'wss://relay.0xchat.com', 'wss://nostr21.com', 'wss://relay.noswhere.com',
  'wss://nostr.wine', 'wss://relay.nostr.info', 'wss://nostr.fmt.wiz.biz', 'wss://relay.nostr.bg',
  'wss://nostr.einundzwanzig.space', 'wss://yabu.me', 'wss://relay.nostr.wirednet.jp', 'wss://nostr.land',
  'wss://relay.ditto.pub', 'wss://relay.nos.social', 'wss://nostr.data.haus', 'wss://relay.fountain.fm',
  'wss://nostr.azzamo.net', 'wss://relay.azzamo.net', 'wss://relay.coinos.io', 'wss://nostr-01.yakihonne.com',
  'wss://relay.nostrcheck.me', 'wss://relay.angor.io', 'wss://nostr.sathoarder.com', 'wss://relay.lnau.net',
  'wss://strfry.iris.to', 'wss://relay.orangepill.ovh', 'wss://nostr.polonkai.hu', 'wss://relay.bitcoinpark.com',
  'wss://relay.utxo.one', 'wss://nostr.vulpem.com', 'wss://relay.hodl.ar', 'wss://purplepag.es',
  'wss://relay.nostraddress.com', 'wss://nostr.lu.ke', 'wss://relay.jellyfish.land', 'wss://nostr.coinos.io',
]

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const now = () => Math.floor(Date.now() / 1000)
const b64 = (n) => randomBytes(n).toString('base64')
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), ms))])

async function nip11(url) {
  try {
    const res = await withTimeout(fetch(url.replace(/^wss?:/, 'https:'), { headers: { Accept: 'application/nostr+json' } }), 6000, 'nip11')
    const j = await res.json()
    return {
      software: String(j.software || '').split('/').pop(), version: j.version,
      auth: j.limitation?.auth_required, paid: j.limitation?.payment_required, restricted: j.limitation?.restricted_writes,
      maxContent: j.limitation?.max_content_length, maxMsg: j.limitation?.max_message_length,
      retention: j.retention, kinds: Array.isArray(j.supported_nips) ? undefined : undefined,
    }
  } catch (e) { return { err: String(e.message || e) } }
}

async function connect(url) {
  const t0 = Date.now()
  const r = new Relay(url)
  r.connectionTimeout = 6000
  r.publishTimeout = 8000
  await withTimeout(r.connect(), 7000, 'connect')
  return { r, ms: Date.now() - t0 }
}

async function publish(r, tmpl) {
  const evt = finalizeEvent(tmpl, sk)
  const t0 = Date.now()
  try {
    const reason = await withTimeout(r.publish(evt), 9000, 'publish')
    return { ok: true, reason, ms: Date.now() - t0, evt }
  } catch (e) {
    return { ok: false, reason: String(e?.message || e), ms: Date.now() - t0, evt }
  }
}

function query(r, filter, ms = 6000) {
  return new Promise((resolve) => {
    const events = []
    let done = false
    const finish = (why) => { if (done) return; done = true; try { sub.close() } catch {}; resolve({ events, why }) }
    const sub = r.subscribe([filter], {
      onevent: (e) => events.push(e),
      oneose: () => finish('eose'),
      onclose: (reason) => finish('closed: ' + reason),
      eoseTimeout: ms,
    })
    setTimeout(() => finish('timeout'), ms + 500)
  })
}

async function probe(url) {
  const out = { url, info: await nip11(url) }
  let c
  try { c = await connect(url) } catch (e) { out.connect = 'FAIL ' + (e.message || e); return out }
  out.connectMs = c.ms
  const r = c.r
  const dTag = `lik::crdt::probe-${randomBytes(6).toString('hex')}`
  const t = now()
  // 1) PRE snapshot ~3KB (like an encrypted CRDT snapshot)
  const pre1 = await publish(r, { kind: 30078, created_at: t, tags: [['d', dTag]], content: b64(2400) })
  out.pre = pre1.ok ? `ok ${pre1.ms}ms` : `REJECT: ${pre1.reason}`
  // 2) Same-second replacement (what happens when the app publishes twice within one second)
  const pre2 = await publish(r, { kind: 30078, created_at: t, tags: [['d', dTag]], content: b64(2400) })
  out.preSameSec = pre2.ok ? `ok(${pre2.reason || ''})` : `REJECT: ${pre2.reason}`
  // 3) Later replacement
  const pre3 = await publish(r, { kind: 30078, created_at: t + 1, tags: [['d', dTag]], content: b64(2400) })
  out.preNext = pre3.ok ? 'ok' : `REJECT: ${pre3.reason}`
  // 4) Join request: kind 1 with #t
  const tTag = `lik::sb-join-req::probe-${randomBytes(4).toString('hex')}`
  const k1 = await publish(r, { kind: 1, created_at: now(), tags: [['t', tTag]], content: b64(90) })
  out.k1 = k1.ok ? 'ok' : `REJECT: ${k1.reason}`
  // 5) Profile kind 0
  const k0 = await publish(r, { kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: 'lik relay probe', picture: '' }) })
  out.k0 = k0.ok ? 'ok' : `REJECT: ${k0.reason}`
  try { r.close() } catch {}

  // Read back through a fresh connection after a short pause
  await new Promise((res) => setTimeout(res, 3000))
  let c2
  try { c2 = await connect(url) } catch (e) { out.readback = 'reconnect FAIL'; return out }
  const r2 = c2.r
  const q1 = await query(r2, { kinds: [30078], authors: [pk], '#d': [dTag] })
  const got = q1.events.sort((a, b) => b.created_at - a.created_at)[0]
  const ids = { [pre1.evt.id]: 'v1', [pre2.evt.id]: 'v2(same-sec)', [pre3.evt.id]: 'v3' }
  out.readPre = got ? ids[got.id] || 'unknown' : `MISSING (${q1.why})`
  const q2 = await query(r2, { '#t': [tTag] })
  out.readK1 = q2.events.length ? 'ok' : `MISSING (${q2.why})`
  const q3 = await query(r2, { kinds: [0], authors: [pk] })
  out.readK0 = q3.events.length ? 'ok' : `MISSING (${q3.why})`
  // Retention hint: are there kind 30078 events older than 30/90 days from anybody?
  const q30 = await query(r2, { kinds: [30078], until: now() - 30 * 86400, limit: 3 })
  const q90 = await query(r2, { kinds: [30078], until: now() - 90 * 86400, limit: 3 })
  out.old30078_30d = q30.events.length
  out.old30078_90d = q90.events.length
  // Real app data: recent lik:: snapshots on this relay
  const qLik = await query(r2, { kinds: [30078], since: now() - 60 * 86400, limit: 500 }, 8000)
  const lik = qLik.events.filter((e) => (e.tags || []).some((tg) => tg[0] === 'd' && String(tg[1]).startsWith('lik::') && !String(tg[1]).includes('probe')))
  out.lik = lik.map((e) => ({ pk: e.pubkey, d: (e.tags.find((tg) => tg[0] === 'd') || [])[1], ts: e.created_at }))
  out.recent30078 = qLik.events.length
  try { r2.close() } catch {}
  return out
}

const results = await Promise.all(CANDIDATES.map((u) => withTimeout(probe(u), 90000, 'probe').catch((e) => ({ url: u, connect: 'FAIL ' + e.message }))))
writeFileSync(new URL('./out/probe-results.json', import.meta.url), JSON.stringify({ pk, at: new Date().toISOString(), results }, null, 2))
for (const o of results) {
  const { lik, info, ...rest } = o
  console.log(JSON.stringify({ ...rest, info, likCount: lik?.length }))
}
process.exit(0)
