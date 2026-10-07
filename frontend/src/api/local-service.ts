import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export const EXPORT_INTERRUPTED_MESSAGE = '导出中途断了，清单未完整生成，请重新导出一次'

export class ExportInterruptedError extends Error {
  constructor(public readonly progress: number) {
    super(EXPORT_INTERRUPTED_MESSAGE)
    this.name = 'ExportInterruptedError'
  }
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 线性流转模块（如水厂台账）：只能顺着状态列表逐级前进，不跳级、不回头。
  if (meta.linearFlow) {
    const currentIndex = meta.statuses.indexOf(current)
    const targetIndex = meta.statuses.indexOf(target)
    const lastStatus = meta.statuses[meta.statuses.length - 1]
    if (current === lastStatus) {
      return { ok: false, message: `${meta.entity}已「${lastStatus}」，状态到此封档，不许再折返` }
    }
    if (targetIndex !== currentIndex + 1) {
      const nextStatus = meta.statuses[currentIndex + 1]
      return {
        ok: false,
        message:
          targetIndex <= currentIndex
            ? `状态不许回头：当前「${current}」不能执行「${action}」`
            : `状态不许跳级：须先从「${current}」流转到「${nextStatus}」`,
      }
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// 导出行由调用方给定：传当前筛选后的列表，导出的清单就与页面显示完全一致。
// fields 可覆盖模块默认列，保证表头与页面表格逐列对应。
export function buildExportLines(
  key: string,
  rows: EntryRow[] = listRows(key),
  fields?: string[],
): string[] {
  const meta = moduleMeta(key)
  const dataFields = fields ?? meta.fields
  const header = ['编号', ...dataFields, '当前状态']
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(
      [row.id, ...dataFields.map((field) => row[field] ?? ''), row.status].map(csvCell).join(','),
    )
  }
  return lines
}

export function exportEntries(
  key: string,
  rows?: EntryRow[],
  fields?: string[],
): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const lines = buildExportLines(key, rows, fields)
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

type StreamOptions = {
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  // 模拟导出中途断开：在处理到第 failAfter 行之后抛错，让页面提示并允许重发。
  failAfter?: number
  // 覆盖默认导出列，使导出清单与当前页面表格逐列一致。
  fields?: string[]
}

// 逐行拼装导出内容，让出主线程并支持中断；中断时抛出 ExportInterruptedError。
export async function streamEntries(
  key: string,
  rows: EntryRow[],
  options: StreamOptions = {},
): Promise<{ filename: string; content: string }> {
  const meta = moduleMeta(key)
  const lines = buildExportLines(key, rows, options.fields)
  const total = lines.length - 1
  const assembled: string[] = [lines[0]]
  for (let i = 1; i < lines.length; i += 1) {
    if (options.signal?.aborted) {
      throw new ExportInterruptedError(i - 1)
    }
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    assembled.push(lines[i])
    if (typeof options.failAfter === 'number' && i === options.failAfter) {
      throw new ExportInterruptedError(i)
    }
    options.onProgress?.(i, total)
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${assembled.join('\n')}` }
}

export function downloadBlob(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function downloadEntries(key: string, rows?: EntryRow[]): void {
  const { filename, content } = exportEntries(key, rows)
  downloadBlob(filename, content)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
