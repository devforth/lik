// Centralized IndexedDB utilities for the app
// Provides a single opener with upgrade ensuring all object stores exist,
// and simple helpers for common operations.

const DB_NAME = 'appdb'
const BASE_VERSION = 3
const STORES: Record<string, { keyPath: string }> = {
  user: { keyPath: 'id' },
  scoreboards: { keyPath: 'id' },
  profiles: { keyPath: 'pubkey' },
  rejectedScoreboardRequests: { keyPath: 'id' },
  // participants are embedded inside scoreboards
}

let dbPromise: Promise<IDBDatabase> | null = null

function openWithVersion(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version)
    req.onupgradeneeded = () => {
      const db = req.result
      // Create any missing stores
      for (const [name, def] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: def.keyPath })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function ensureAllStores(db: IDBDatabase): Promise<IDBDatabase> {
  const missing: string[] = []
  for (const name of Object.keys(STORES)) {
    if (!db.objectStoreNames.contains(name)) missing.push(name)
  }
  if (missing.length === 0) return db
  try { db.close() } catch {}
  const nextVersion = Math.max((db as any).version || BASE_VERSION, BASE_VERSION) + 1
  return openWithVersion(nextVersion)
}

export async function openDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      let db = await openWithVersion(BASE_VERSION)
      db = await ensureAllStores(db)
      return db
    })()
  }
  return dbPromise
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// Ensure the value is free of Vue proxies or other non-cloneables before IDB put
function toStorable<T>(value: T): T {
  try {
    // JSON clone is sufficient for our simple data (strings/numbers/arrays/objects)
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    // Fallback: return as-is; IDB may still throw, but we tried
    return value
  }
}

export async function dbGetAll<T = any>(storeName: string): Promise<T[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

export async function dbPut(storeName: string, value: any): Promise<void> {
  const db = await openDatabase()
  const tx = db.transaction(storeName, 'readwrite')
  const store = tx.objectStore(storeName)
  store.put(toStorable(value))
  await txDone(tx)
}

export async function dbBulkPut(storeName: string, values: any[]): Promise<void> {
  if (!values?.length) return
  const db = await openDatabase()
  const tx = db.transaction(storeName, 'readwrite')
  const store = tx.objectStore(storeName)
  for (const v of values) store.put(toStorable(v))
  await txDone(tx)
}

export async function dbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDatabase()
  const tx = db.transaction(storeName, 'readwrite')
  const store = tx.objectStore(storeName)
  store.delete(key)
  await txDone(tx)
}

export async function dbBulkDelete(storeName: string, keys: IDBValidKey[]): Promise<void> {
  if (!keys?.length) return
  const db = await openDatabase()
  const tx = db.transaction(storeName, 'readwrite')
  const store = tx.objectStore(storeName)
  for (const k of keys) store.delete(k)
  await txDone(tx)
}

/** Clear all entries from a specific object store. */
export async function dbClear(storeName: string): Promise<void> {
  const db = await openDatabase()
  const tx = db.transaction(storeName, 'readwrite')
  const store = tx.objectStore(storeName)
  store.clear()
  await txDone(tx)
}

/** Clear all known stores used by the app. Useful for key import resets. */
export async function dbClearAll(): Promise<void> {
  const names = Object.keys(STORES)
  for (const n of names) {
    try { await dbClear(n) } catch {}
  }
}
