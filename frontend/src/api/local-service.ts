import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
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

// 登记（或覆盖登记）：以身份字段判重，同一座水厂不留第二行，只把原来那行盖掉。
export function upsertEntry(
  key: string,
  identityField: string,
  values: Record<string, string>,
): ActionResult {
  const meta = moduleMeta(key)
  const identity = String(values[identityField] ?? '').trim()
  if (!identity) {
    return { ok: false, message: `${identityField}不能为空，无法存档` }
  }

  const fields: Record<string, string> = {}
  for (const field of meta.fields) {
    fields[field] = String(values[field] ?? '').trim()
  }
  fields[identityField] = identity

  const rows = listRows(key)
  const index = rows.findIndex((row) => String(row[identityField] ?? '') === identity)
  if (index >= 0) {
    // 同一编号已登记过：保留原状态履历，只覆盖档案字段，不新增第二行。
    const prev = rows[index]
    const merged: EntryRow = {
      ...prev,
      ...fields,
      id: prev.id,
      status: prev.status,
      pending: prev.pending,
      abnormal: prev.abnormal,
    }
    if (meta.fields.includes('运行状态')) {
      merged['运行状态'] = merged.status
    }
    const next = [...rows]
    next[index] = merged
    saveRows(key, next)
    return { ok: true, message: `「${identity}」已存在，按本次提交覆盖原档案，未新增第二行` }
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const firstStatus = meta.statuses[0]
  const created: EntryRow = { id, status: firstStatus, pending: true, abnormal: false, ...fields }
  if (meta.fields.includes('运行状态')) {
    created['运行状态'] = firstStatus
  }
  saveRows(key, [...rows, created])
  return { ok: true, message: `「${identity}」已登记存档，当前状态「${firstStatus}」` }
}

// 水厂投运结论回写到取水泵组的启泵待办：只批注待启泵泵组，泵组自身状态不动。
function stampIntakePumpTodo(plant: EntryRow): string {
  const plantCode = String(plant['水厂编号'] ?? '')
  const plantName = String(plant['水厂名称'] ?? '')
  const date = String(plant['投运日期'] ?? '') || today()
  const note = `${plantName}已于${date}投运，可办理启泵`

  const pumps = listRows('intakepump')
  let touched = 0
  const next = pumps.map((pump) => {
    const owner = String(pump['所属水厂'] ?? '')
    const belongs = owner !== '' && (owner === plantCode || owner === plantName)
    const waiting = String(pump.status) === '待启泵'
    if (belongs && waiting) {
      touched += 1
      return { ...pump, 启泵待办: note }
    }
    return pump
  })
  if (touched > 0) {
    saveRows('intakepump', next)
    return `；投运结论已回写 ${touched} 台待启泵泵组的启泵待办`
  }
  return '；该水厂暂无待启泵泵组，无需回写'
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

  // 配了流转白名单的模块（水厂台账）：只能顺级往前走，不能跳级、不能折返。
  if (meta.transitions) {
    const allowed = meta.transitions[current]
    if (!allowed) {
      return { ok: false, message: `水厂已「${current}」，状态到此封档，不能再折返或办理「${action}」` }
    }
    if (!allowed.includes(target)) {
      return {
        ok: false,
        message: `运行状态不能跳级：「${current}」之后只能先到「${allowed.join('」或「')}」，不能直接「${target}」`,
      }
    }
  } else if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (meta.fields.includes('运行状态')) {
    updated['运行状态'] = target
  }

  const next = [...rows]
  let extra = ''
  if (key === 'plant') {
    if (target === '运行中' && String(updated['投运日期'] ?? '').trim() === '') {
      // 投运日期与设计规模一并落在档案上：办理投运当天自动记下投运日期。
      updated['投运日期'] = today()
    }
    next[index] = updated
    saveRows(key, next)
    if (target === '运行中') {
      extra = stampIntakePumpTodo(updated)
    }
  } else {
    next[index] = updated
    saveRows(key, next)
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${extra}` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// 导出与页面同源：按当前筛选条件取数，页面看到什么，清单里就是什么。
export function exportEntries(
  key: string,
  filters: Record<string, string> = {},
  fieldNames?: string[],
): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const fields = fieldNames ?? meta.fields
  const header = ['编号', ...fields, '当前状态']
  const lines = [header.map(csvCell).join(',')]
  for (const row of listEntries(key, filters).items) {
    lines.push(
      [row.id, ...fields.map((field) => row[field] ?? ''), row.status].map(csvCell).join(','),
    )
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

// 触发浏览器下载；过程中任何一步失败都抛出，由页面提示「导出中断，请再发一次」。
export function downloadEntries(
  key: string,
  filters: Record<string, string> = {},
  fieldNames?: string[],
): void {
  const { filename, content } = exportEntries(key, filters, fieldNames)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  } catch {
    throw new Error('导出中途中断，请重新再发一次')
  } finally {
    // 点击后再回收，避免下载尚未开始就被撤销。
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
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
