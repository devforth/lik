// time-sync.ts
// A single, reliable UTC time source with background sync and caching.

type Snapshot = {
  serverEpochMs: number; // server UTC at the moment of measurement
  localEpochMs: number;  // local time at the moment of measurement
};

const CACHE_KEY = 'timeSync:snapshot:v1';
let snapshot: Snapshot | null = null;
let syncing = false;

function loadSnapshot() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Snapshot;
    if (
      parsed &&
      typeof parsed.serverEpochMs === 'number' &&
      typeof parsed.localEpochMs === 'number'
    ) {
      snapshot = parsed;
    }
  } catch {}
}

function saveSnapshot(s: Snapshot) {
  snapshot = s;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(s));
  } catch {}
}

async function syncTime() {
  if (syncing) return;
  syncing = true;
  try {
    const t0 = Date.now();
    // Prefer HTTPS to avoid mixed-content/CORS/cleartext issues (Android WebView blocks HTTP by default)
    // Use the stable UTC timezone endpoint.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    let res: Response;
    try {
      res = await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC', { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`Time API error: HTTP ${res.status}`);

    const t1 = Date.now();
    const data = await res.json();
    // Adjust for half the round-trip delay
    const serverTime = new Date(data.utc_datetime).getTime() + (t1 - t0) / 2;
    saveSnapshot({ serverEpochMs: serverTime, localEpochMs: t1 });
  } catch (err) {
    // Keep previous snapshot if available
    console.warn('Time sync failed', err);
  } finally {
    syncing = false;
  }
}

// Kick off initial load + periodic refresh without exporting any init API
loadSnapshot();
void syncTime();
setInterval(syncTime, 5 * 60 * 1000); // refresh every 5 min

// Returns synchronized current time in UTC (ms since epoch). If no snapshot yet,
// falls back to local clock (best effort) until sync completes.
export function nowUtc(): number {
  if (snapshot) {
    const delta = Date.now() - snapshot.localEpochMs;
    return snapshot.serverEpochMs + delta;
  }
  return Date.now();
}
