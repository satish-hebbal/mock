import { openDB, type IDBPDatabase } from 'idb'

// Local-first persistence (PRD §6.11): project JSON + media blobs in IndexedDB.
const DB_NAME = 'mockup-studio'
const PROJECT_STORE = 'project'
const ASSET_STORE = 'assets'
const PROJECT_KEY = 'current'

let dbPromise: Promise<IDBPDatabase> | null = null

function db() {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(PROJECT_STORE)
      d.createObjectStore(ASSET_STORE)
    },
  })
  return dbPromise
}

export async function saveProjectJSON(json: unknown) {
  await (await db()).put(PROJECT_STORE, json, PROJECT_KEY)
}

export async function loadProjectJSON<T>(): Promise<T | undefined> {
  return (await db()).get(PROJECT_STORE, PROJECT_KEY)
}

export async function saveAsset(id: string, blob: Blob) {
  await (await db()).put(ASSET_STORE, blob, id)
}

export async function loadAsset(id: string): Promise<Blob | undefined> {
  return (await db()).get(ASSET_STORE, id)
}
