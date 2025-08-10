// time-sync.ts
let offset = 0;

async function syncTime() {
  try {
    const t0 = Date.now();
    const res = await fetch('http://worldtimeapi.org/api/ip'); // HTTPS in production

    // example response
// {
//   "utc_offset": "+03:00",
//   "timezone": "Europe/Kyiv",
//   "day_of_week": 6,
//   "day_of_year": 221,
//   "datetime": "2025-08-09T00:25:58.894578+03:00",
//   "utc_datetime": "2025-08-08T21:25:58.894578+00:00",
//   "unixtime": 1754688358,
//   "raw_offset": 7200,
//   "week_number": 32,
//   "dst": true,
//   "abbreviation": "EEST",
//   "dst_offset": 3600,
//   "dst_from": "2025-03-30T01:00:00+00:00",
//   "dst_until": "2025-10-26T01:00:00+00:00",
//   "client_ip": "91.225.199.55"
// }

    const t1 = Date.now();
    const data = await res.json();

    // Adjust for half the round-trip delay
    const serverTime = new Date(data.utc_datetime).getTime() + (t1 - t0) / 2;
    offset = serverTime - t1;
  } catch (err) {
    console.warn('Time sync failed', err);
  }
}

export function now() {
  return Date.now() + offset;
}

// Returns the synchronized current time in UTC (milliseconds since epoch).
// Equivalent to now(), provided for clarity at call sites that require UTC.
export function nowUtc() {
  return Date.now() + offset;
}

export async function initTimeSync() {
  await syncTime();
  setInterval(syncTime, 5 * 60 * 1000); // refresh every 5 min
}
