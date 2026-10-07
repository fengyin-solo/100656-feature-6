import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'waterworks-ops:entries'
// 每个模块最后一次成功保存的记录快照：库里某条取不到时，按这份兜底显示。
const SNAPSHOT_KEY = 'waterworks-ops:last-saved'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readJSON(key: string): Record<string, EntryRow[]> | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as Record<string, EntryRow[]>
  } catch {
    return null
  }
}

function writeJSON(key: string, value: unknown): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存储不可用（隐私模式/配额）时仅保留内存缓存，本次会话内仍一致。
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  const parsed = readJSON(STORAGE_KEY)
  if (!parsed) {
    writeJSON(STORAGE_KEY, fallback)
    return fallback
  }
  return { ...fallback, ...parsed }
}

function readSnapshots(): Record<string, Record<number, EntryRow>> {
  const parsed = readJSON(SNAPSHOT_KEY) as Record<string, Record<string, EntryRow>> | null
  if (!parsed) {
    return {}
  }
  const result: Record<string, Record<number, EntryRow>> = {}
  for (const [key, bag] of Object.entries(parsed)) {
    const bagById: Record<number, EntryRow> = {}
    for (const [id, row] of Object.entries(bag ?? {})) {
      bagById[Number(id)] = row
    }
    result[key] = bagById
  }
  return result
}

let cache: Record<string, EntryRow[]> | null = null
let snapshotCache: Record<string, Record<number, EntryRow>> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  writeJSON(STORAGE_KEY, next)
  remember(key, rows)
}

// 把这批记录按编号拍平进「上一次存档」，读不到现行记录时用它兜底。
export function remember(key: string, rows: EntryRow[]): void {
  const snapshots = snapshotCache ?? readSnapshots()
  const bag = { ...(snapshots[key] ?? {}) }
  for (const row of rows) {
    bag[Number(row.id)] = clone(row)
  }
  snapshots[key] = bag
  snapshotCache = snapshots
  const serializable: Record<string, Record<string, EntryRow>> = {}
  for (const [moduleKey, moduleBag] of Object.entries(snapshots)) {
    serializable[moduleKey] = {}
    for (const [id, row] of Object.entries(moduleBag)) {
      serializable[moduleKey][id] = row
    }
  }
  writeJSON(SNAPSHOT_KEY, serializable)
}

// 取某条记录的上一次存档；库里已没有该行时，页面按这份显示。
export function lastSavedRow(key: string, id: number): EntryRow | null {
  const snapshots = snapshotCache ?? readSnapshots()
  snapshotCache = snapshots
  return snapshots[key]?.[id] ? clone(snapshots[key][id]) : null
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
