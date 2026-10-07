import { lastSavedRow, listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 水厂台账的领域规则都收在这里：列表页与详情页共用同一份读写逻辑，不再各说各话。
export const PLANT_KEY = 'plant'
const PUMP_KEY = 'intakepump'

export const PLANT_STATUSES = ['待投运', '运行中', '检修中', '已停役'] as const
// 每个状态只允许的下一个动作；顺着走、不跳级、不回头，已停役没有出口。
const NEXT_ACTION: Record<string, string> = {
  待投运: '提交投运',
  运行中: '安排检修',
  检修中: '办理停役',
}
export const WATER_SOURCE_TYPES = ['地表水', '地下水'] as const

export type PlantForm = {
  水厂编号: string
  水厂名称: string
  设计供水规模: string
  水源类型: string
  所属片区: string
  投运日期: string
  水厂厂长: string
}

export type SavePlantResult = {
  ok: boolean
  message: string
  id?: number
  overwritten?: boolean
}

export type PlantLookup = {
  row: EntryRow
  // 现行台账里已取不到这行时，返回的是上一次存档快照。
  fromSnapshot: boolean
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function normalize(row: EntryRow): EntryRow {
  const status = String(row.status)
  return { ...row, status, 运行状态: status, pending: status !== '已停役' }
}

// 读水厂统一走这里：让库里的运行状态与列表显示始终对得上，顺带把不一致的旧行落库。
export function listPlants(): EntryRow[] {
  const rows = listRows(PLANT_KEY)
  const reconciled = rows.map(normalize)
  if (reconciled.some((row, index) => JSON.stringify(row) !== JSON.stringify(rows[index]))) {
    saveRows(PLANT_KEY, reconciled)
  }
  return reconciled
}

export function getPlant(id: number): PlantLookup | null {
  const current = listPlants().find((row) => Number(row.id) === id)
  if (current) {
    return { row: current, fromSnapshot: false }
  }
  const snapshot = lastSavedRow(PLANT_KEY, id)
  if (snapshot) {
    return { row: normalize(snapshot), fromSnapshot: true }
  }
  return null
}

function validate(form: PlantForm): string {
  const code = form.水厂编号.trim()
  if (!code) {
    return '水厂编号不能为空'
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(code)) {
    return '水厂编号只能由字母、数字与连字符组成'
  }
  const name = form.水厂名称.trim()
  if (!name) {
    return '水厂名称不能为空'
  }
  // 水厂名称按行政区命名，形如「滨江区第一水厂」。
  if (name.length < 4 || !name.endsWith('水厂')) {
    return '水厂名称需按行政区命名并以「水厂」结尾，例如「滨江区第一水厂」'
  }
  const scale = Number(form.设计供水规模)
  if (form.设计供水规模.trim() === '' || Number.isNaN(scale) || scale <= 0) {
    return '设计供水规模需填写大于 0 的数字（单位：万吨/日）'
  }
  if (!(WATER_SOURCE_TYPES as readonly string[]).includes(form.水源类型)) {
    return '水源类型只能选择地表水或地下水'
  }
  if (!form.所属片区.trim()) {
    return '所属片区不能为空'
  }
  if (!form.水厂厂长.trim()) {
    return '水厂厂长不能为空'
  }
  if (form.投运日期 && !/^\d{4}-\d{2}-\d{2}$/.test(form.投运日期.trim())) {
    return '投运日期需为 YYYY-MM-DD 格式'
  }
  return ''
}

// 登记/编辑落同一个入口：水厂编号重复时盖掉原行，绝不留下第二行。
export function savePlant(form: PlantForm): SavePlantResult {
  const message = validate(form)
  if (message) {
    return { ok: false, message }
  }
  const rows = listPlants()
  const code = form.水厂编号.trim()
  const existing = rows.find((row) => String(row['水厂编号']).trim() === code)
  const profile = {
    水厂编号: code,
    水厂名称: form.水厂名称.trim(),
    设计供水规模: `${Number(form.设计供水规模)}万吨/日`,
    水源类型: form.水源类型,
    所属片区: form.所属片区.trim(),
    投运日期: form.投运日期.trim(),
    水厂厂长: form.水厂厂长.trim(),
  }
  if (existing) {
    const next = rows.map((row) =>
      row === existing
        ? normalize({
            ...row,
            ...profile,
            // 档案改了也不抹掉投运历史：未重新填写时沿用原来的投运日期。
            投运日期: profile.投运日期 || String(row['投运日期'] ?? ''),
          })
        : row,
    )
    saveRows(PLANT_KEY, next)
    return { ok: true, message: `水厂编号 ${code} 已存在，原档案已按本次登记覆盖`, id: Number(existing.id), overwritten: true }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const created: EntryRow = normalize({
    id,
    status: '待投运',
    pending: true,
    abnormal: false,
    ...profile,
  })
  saveRows(PLANT_KEY, [...rows, created])
  return { ok: true, message: `水厂档案 ${code} 已登记`, id }
}

// 把投运结论回写到该厂待启泵泵组的「启泵待办」上。
function writebackPumpTodo(plantName: string, date: string): number {
  const pumps = listRows(PUMP_KEY)
  const conclusion = `水厂「${plantName}」已于 ${date} 投运，结论：准予启泵`
  let touched = 0
  const next = pumps.map((pump) => {
    const belongs = String(pump['所属水厂'] ?? '').trim() === plantName
    if (!belongs || String(pump.status) !== '待启泵' || String(pump['启泵待办'] ?? '') === conclusion) {
      return pump
    }
    touched += 1
    return { ...pump, 启泵待办: conclusion }
  })
  if (touched > 0) {
    saveRows(PUMP_KEY, next)
  }
  return touched
}

export function allowedAction(status: string): string | null {
  return NEXT_ACTION[status] ?? null
}

export function runPlantAction(id: number, action: string): ActionResult {
  const rows = listPlants()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的水厂档案` }
  }
  const current = String(rows[index].status)
  const want = allowedAction(current)
  if (current === '已停役') {
    return { ok: false, message: '水厂已停役，状态到此封档，不许再折返到运行中' }
  }
  if (want !== action) {
    const currentIndex = PLANT_STATUSES.indexOf(current as (typeof PLANT_STATUSES)[number])
    const target = PLANT_STATUSES[currentIndex + 1]
    const hint =
      action === '提交投运' && current !== '待投运'
        ? `运行状态不许回头：当前「${current}」不能再执行「${action}」`
        : `运行状态不许跳级：须先从「${current}」流转到「${target}」（当前只可「${want}」）`
    return { ok: false, message: hint }
  }

  const targetStatus = PLANT_STATUSES[PLANT_STATUSES.indexOf(current as (typeof PLANT_STATUSES)[number]) + 1]
  let updated = normalize({ ...rows[index], status: targetStatus })
  let extra = ''
  if (action === '提交投运') {
    // 投运日期与设计供水规模一起记在档案上：投运当日自动补登投运日期。
    const date = String(updated['投运日期'] ?? '').trim() || today()
    updated = { ...updated, 投运日期: date }
    const plantName = String(updated['水厂名称'] ?? '')
    const pumpCount = writebackPumpTodo(plantName, date)
    extra = pumpCount > 0 ? `，已把投运结论回写到 ${pumpCount} 台待启泵泵组的启泵待办` : '，该厂暂无待启泵泵组需要回写'
  }
  const next = [...rows]
  next[index] = updated
  saveRows(PLANT_KEY, next)
  return { ok: true, message: `水厂已${action}，当前状态「${targetStatus}」${extra}` }
}

export function formFromRow(row: EntryRow): PlantForm {
  const scale = String(row['设计供水规模'] ?? '').replace(/万吨\/日$/, '')
  return {
    水厂编号: String(row['水厂编号'] ?? ''),
    水厂名称: String(row['水厂名称'] ?? ''),
    设计供水规模: scale,
    水源类型: String(row['水源类型'] ?? ''),
    所属片区: String(row['所属片区'] ?? ''),
    投运日期: String(row['投运日期'] ?? ''),
    水厂厂长: String(row['水厂厂长'] ?? ''),
  }
}
