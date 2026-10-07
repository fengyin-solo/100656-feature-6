<template>
  <section class="page" data-module="plant">
    <header class="page-head">
      <div>
        <h2>水厂台账管理</h2>
        <p class="page-desc">维护水厂基础档案，围绕水厂编号、水厂名称、设计供水规模、水源类型做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水厂基础档案</button>
        <button class="btn" type="button" @click="exportRows">导出水厂台账清单</button>
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
          <td v-for="column in columns" :key="column">
            <button v-if="column === '水厂编号'" class="link" type="button" @click="openDetail(row)">
              {{ row[column] ?? '—' }}
            </button>
            <template v-else>{{ row[column] || '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看档案</button>
            <button class="link" type="button" @click="openEdit(row)">修改档案</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="!canRun(row, action)"
              :title="canRun(row, action) ? '' : `当前「${row.status}」不允许直接${action}`"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无水厂台账数据，可先登记水厂基础档案</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条水厂台账记录（导出清单与当前筛选结果一致）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="noticeMessage" class="ok-text">{{ noticeMessage }}</span>
    </footer>

    <div v-if="formOpen" class="modal-mask" @click.self="closeForm">
      <div class="modal">
        <h3 class="modal-title">{{ editing ? '修改水厂档案' : '登记水厂基础档案' }}</h3>
        <p class="modal-tip">水厂名称按行政区命名（如：城东区水厂）；同一水厂编号重复登记只覆盖原行，不会新增第二行。</p>
        <div class="form-grid">
          <label v-for="field in formFields" :key="field" class="form-item">
            <span>{{ field }}<em v-if="coreFields.includes(field)" class="required">*</em></span>
            <select v-if="field === '水源类型'" v-model="form[field]">
              <option value="" disabled>请选择水源类型</option>
              <option value="地表水">地表水</option>
              <option value="地下水">地下水</option>
            </select>
            <input
              v-else
              v-model="form[field]"
              :type="field === '投运日期' ? 'date' : 'text'"
              :disabled="editing !== null && field === '水厂编号'"
              :placeholder="fieldPlaceholder(field)"
            />
          </label>
        </div>
        <p v-if="formError" class="error-text form-error">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeForm">取消</button>
          <button class="btn primary" type="button" @click="submitForm">保存档案</button>
        </div>
      </div>
    </div>

    <div v-if="detail" class="modal-mask" @click.self="detail = null">
      <div class="modal">
        <h3 class="modal-title">水厂档案详情</h3>
        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd>{{ detail[field] || '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detail.status }}</dd>
        </dl>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="detail = null">知道了</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  upsertEntry,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('plant')
const columns = ["水厂编号", "水厂名称", "设计供水规模", "水源类型", "所属片区", "投运日期", "水厂厂长", "运行状态"]
const detailFields = columns.slice(0, 7)
const formFields = ["水厂编号", "水厂名称", "设计供水规模", "水源类型", "所属片区", "投运日期", "水厂厂长"]
const coreFields = ["水厂编号", "水厂名称", "设计供水规模", "水源类型"]
const actions = ["提交投运", "安排检修", "办理停役"]
const statuses = ["待投运", "运行中", "检修中", "已停役"]
const waterSourceTypes = ["地表水", "地下水"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const formOpen = ref(false)
const editing = ref<EntryRow | null>(null)
const formError = ref('')
const form = reactive<Record<string, string>>({})
const detail = ref<EntryRow | null>(null)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 统计直接读当前列表这份数据，库里存什么，卡片就数什么。
const stats = computed(() => {
  let scaleWan = 0
  let scaleSeen = false
  let scaleMixed = false
  for (const row of rows.value) {
    const matched = String(row['设计供水规模'] ?? '').match(/([\d.]+)/)
    if (!matched) {
      continue
    }
    scaleSeen = true
    if (String(row['设计供水规模']).includes('万')) {
      scaleWan += Number.parseFloat(matched[1])
    } else {
      scaleMixed = true
    }
  }
  const scaleText = !scaleSeen
    ? '—'
    : scaleMixed
      ? `${scaleWan}万吨/日起`
      : `${scaleWan}万吨/日`
  return [
    { label: '运行中水厂', value: rows.value.filter((row) => row.status === '运行中').length },
    { label: '检修中水厂', value: rows.value.filter((row) => row.status === '检修中').length },
    { label: '设计供水规模', value: scaleText },
  ]
})

function canRun(row: EntryRow, action: string): boolean {
  const target = meta.actionTargets[action]
  const allowed = meta.transitions?.[String(row.status)] ?? []
  return allowed.includes(target)
}

function fieldPlaceholder(field: string): string {
  if (field === '水厂名称') {
    return '按行政区命名，如：城东区水厂'
  }
  if (field === '设计供水规模') {
    return '如：10万吨/日'
  }
  return `请输入${field}`
}

function resetForm() {
  for (const field of formFields) {
    form[field] = ''
  }
  formError.value = ''
}

function openCreate() {
  editing.value = null
  resetForm()
  formOpen.value = true
}

function openEdit(row: EntryRow) {
  editing.value = row
  resetForm()
  for (const field of formFields) {
    form[field] = String(row[field] ?? '')
  }
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editing.value = null
}

function openDetail(row: EntryRow) {
  detail.value = row
}

function submitForm() {
  formError.value = ''
  for (const field of coreFields) {
    if (!String(form[field] ?? '').trim()) {
      formError.value = `${field}为必填项，补齐后才能存档`
      return
    }
  }
  if (!waterSourceTypes.includes(form['水源类型'].trim())) {
    formError.value = '水源类型只能选「地表水」或「地下水」'
    return
  }
  const result = upsertEntry(meta.key, '水厂编号', { ...form })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  closeForm()
  noticeMessage.value = result.message
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    // 与页面同源：带上当前筛选条件，导出的就是眼前这批；中途失败提示后可再点一次重发。
    downloadEntries(meta.key, filters.value, columns)
    noticeMessage.value = '清单导出成功，内容与当前页面一致'
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '导出中途中断了，请重新再发一次'
  }
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 详情弹窗始终从库里按 id 取整份（不受当前筛选影响），台账页与详情页同源、不可能各说各话。
    if (detail.value) {
      detail.value = listEntries(meta.key).items.find((row) => row.id === detail.value?.id) ?? null
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水厂台账列表读取失败'
  }
}

onMounted(reload)
</script>
