<template>
  <section class="page" data-module="plant">
    <header class="page-head">
      <div>
        <h2>水厂台账管理</h2>
        <p class="page-desc">维护水厂基础档案，围绕水厂编号、水厂名称、设计供水规模、水源类型做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水厂基础档案</button>
        <button class="btn" type="button" :disabled="exporting" @click="startExport(false)">
          {{ exporting ? '正在导出…' : '导出水厂台账清单' }}
        </button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="exporting" class="export-progress" role="status">
      正在导出第 {{ exportDone }}/{{ exportTotal }} 行…
      <button class="link" type="button" @click="cancelExport">中断</button>
    </p>
    <p v-else-if="exportFailed" class="error-text" role="alert">
      {{ exportFailed }}
      <button class="link" type="button" @click="startExport(true)">重新导出</button>
    </p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <RouterLink class="link" :to="`/plant/${row.id}`">详情</RouterLink>
            <button class="link" type="button" @click="openEdit(row)">编辑</button>
            <button
              v-if="allowedAction(String(row.status))"
              class="link"
              type="button"
              @click="runAction(allowedAction(String(row.status)) as string, row)"
            >
              {{ allowedAction(String(row.status)) }}
            </button>
            <span v-else class="muted-text">状态封档</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无水厂台账数据，可先登记水厂基础档案</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条水厂台账记录，档案保存在本机浏览器，刷新或重新进入仍是同一份</span>
      <span v-if="notice" class="notice-text">{{ notice }}</span>
      <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="formOpen" class="modal-mask" @click.self="closeForm">
      <form class="modal" @submit.prevent="submitForm">
        <h3 class="modal-title">{{ editingId === null ? '登记水厂基础档案' : '编辑水厂档案' }}</h3>
        <p class="modal-hint">水厂编号是唯一登记号：重复登记同一编号时只覆盖原行，不会另起一行。</p>
        <label class="form-item">
          <span>水厂编号 <em>*</em></span>
          <input v-model="form['水厂编号']" :disabled="editingId !== null" placeholder="例如 PLAN-0004" />
        </label>
        <label class="form-item">
          <span>水厂名称（按行政区命名） <em>*</em></span>
          <input v-model="form['水厂名称']" placeholder="例如 滨江区第一水厂" />
        </label>
        <label class="form-item">
          <span>设计供水规模（万吨/日） <em>*</em></span>
          <input v-model="form['设计供水规模']" type="number" min="0" step="0.1" placeholder="例如 20" />
        </label>
        <label class="form-item">
          <span>水源类型 <em>*</em></span>
          <select v-model="form['水源类型']">
            <option value="" disabled>请选择</option>
            <option v-for="item in waterSourceTypes" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>所属片区（行政区） <em>*</em></span>
          <input v-model="form['所属片区']" placeholder="例如 滨江区" />
        </label>
        <label class="form-item">
          <span>水厂厂长 <em>*</em></span>
          <input v-model="form['水厂厂长']" />
        </label>
        <label class="form-item">
          <span>投运日期（提交投运时自动补登）</span>
          <input v-model="form['投运日期']" type="date" />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeForm">取消</button>
          <button class="btn primary" type="submit">{{ editingId === null ? '保存档案' : '覆盖保存' }}</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  EXPORT_INTERRUPTED_MESSAGE,
  ExportInterruptedError,
  downloadBlob,
  filterRows,
} from '@/api/local-service'
import {
  PLANT_KEY,
  WATER_SOURCE_TYPES,
  allowedAction,
  formFromRow,
  listPlants,
  runPlantAction,
  savePlant,
} from '@/api/plant-service'
import type { EntryRow } from '@/data/types'

const columns = ['水厂编号', '水厂名称', '设计供水规模', '水源类型', '所属片区', '投运日期', '水厂厂长']
const filterFields = columns.slice(0, 3)
const waterSourceTypes = WATER_SOURCE_TYPES

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const filters = ref<Record<string, string>>({})

const statusSummary = computed(() =>
  ['待投运', '运行中', '检修中', '已停役'].map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const runningScale = computed(() => {
  const sum = rows.value
    .filter((row) => String(row.status) === '运行中')
    .reduce((acc, row) => acc + (parseFloat(String(row['设计供水规模'])) || 0), 0)
  return `${Math.round(sum * 100) / 100}万吨/日`
})

const stats = computed(() => [
  { label: '运行中水厂', value: statusSummary.value[1].count },
  { label: '检修中水厂', value: statusSummary.value[2].count },
  { label: '运行中设计规模', value: runningScale.value },
])

function emptyForm() {
  return {
    水厂编号: '',
    水厂名称: '',
    设计供水规模: '',
    水源类型: '',
    所属片区: '',
    投运日期: '',
    水厂厂长: '',
  }
}

const formOpen = ref(false)
const formError = ref('')
const editingId = ref<number | null>(null)
const form = ref(emptyForm())

function openCreate() {
  editingId.value = null
  form.value = emptyForm()
  formError.value = ''
  formOpen.value = true
}

function openEdit(row: EntryRow) {
  editingId.value = Number(row.id)
  form.value = formFromRow(row)
  formError.value = ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
}

function submitForm() {
  const result = savePlant(form.value)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  notice.value = result.message
  formOpen.value = false
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  notice.value = ''
  const result = runPlantAction(Number(row.id), action)
  if (result.ok) {
    notice.value = result.message
  } else {
    errorMessage.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = filterRows(listPlants(), filters.value)
    total.value = rows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水厂台账列表读取失败'
  }
}

// 导出当前筛选后的列表，保证清单与页面一致；中断后提示并允许再发一次。
const exporting = ref(false)
const exportDone = ref(0)
const exportTotal = ref(0)
const exportFailed = ref('')
let abortController: AbortController | null = null

async function startExport(retry: boolean) {
  if (exporting.value) {
    return
  }
  const snapshot = rows.value.slice()
  exporting.value = true
  exportFailed.value = ''
  exportDone.value = 0
  exportTotal.value = snapshot.length
  abortController = new AbortController()
  // 模拟导出链路偶发中断：首次导出在中途断开一次；用户重新导出后完整跑完。
  const failAfter = !retry && snapshot.length > 1 ? Math.ceil(snapshot.length / 2) : undefined
  try {
    const { streamEntries } = await import('@/api/local-service')
    const { filename, content } = await streamEntries(PLANT_KEY, snapshot, {
      signal: abortController.signal,
      failAfter,
      fields: columns,
      onProgress: (done) => {
        exportDone.value = done
      },
    })
    downloadBlob(filename, content)
  } catch (error) {
    exportFailed.value =
      error instanceof ExportInterruptedError
        ? `${EXPORT_INTERRUPTED_MESSAGE}（已生成 ${error.progress}/${exportTotal.value} 行）`
        : EXPORT_INTERRUPTED_MESSAGE
  } finally {
    exporting.value = false
    abortController = null
  }
}

function cancelExport() {
  abortController?.abort()
}

onMounted(reload)
</script>
