import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite } from '@capacitor-community/sqlite'
import { defineCustomElements as jeepSqlite } from 'jeep-sqlite/loader'

// Ensure the jeep-sqlite web component and web store are ready as early as possible
if (Capacitor.getPlatform() === 'web') {
  try {
    // Register the custom element
    jeepSqlite(window)
    // Ensure the element exists in the DOM
    if (!document.querySelector('jeep-sqlite')) {
      const el = document.createElement('jeep-sqlite')
      document.body.prepend(el)
    }
    // Wait for the element to be defined, then init the web store (IndexedDB)
    customElements
      .whenDefined('jeep-sqlite')
      .then(() => CapacitorSQLite.initWebStore())
      .catch(() => {/* noop */})
  } catch {
    // ignore; the store code will fall back gracefully
  }
}
