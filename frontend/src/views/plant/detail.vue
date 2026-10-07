<template>
  <section v-if="lookup" class="page" data-module="plant-detail">
    <header class="page-head">
      <div>
        <h2>水厂档案详情 · {{ row['水厂名称'] }}</h2>
        <p class="page-desc">详情页与台账页读取同一份档案数据；现行台账取不到时，按上一次存档显示。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/plant">返回台账列表</RouterLink>
      </div>
    </header>

    <p v-if="lookup.fromSnapshot" class="snapshot-banner" role="status">
      现行台账中已取不到该水厂，以下内容按上一次保存的存档显示。
    </p>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">当前状态</span>
        <strong class="stat-value">{{ row.status }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">可执行动作</span>
        <strong class="stat-value">{{ nextAction ?? '状态封档' }}</strong>
      </article>
    </div>

    <table class="data-table detail-table">
      <tbody>
        <tr v-for="field in detailFields" :key="field">
          <th>{{ field }}</th>
          <td>{{ row[field] || '—' }}</td>
        </tr>
        <tr>
          <th>运行状态</th>
          <td>{{ row.status }}</td>
        </tr>
      </tbody>
    </table>

    <div class="detail-actions">
      <button v-if="!lookup.fromSnapshot" class="btn" type="button" @click="openEdit">编辑档案</button>
      <button
        v-if="nextAction && !lookup.fromSnapshot"
        class="btn primary"
        type="button"
        @click="runNext"
      >
        {{ nextAction }}
      </button>
      <span v-if="lookup.fromSnapshot" class="muted-text">存档记录仅供查看，不参与编辑与状态流转</span>
    </div>
    <p v-if="notice" class="notice-text">{{ notice }}</p>
    <p v-else-if="errorMessage" class="error-text">{{ errorMessage }}</p>

    <div v-if="formOpen" class="modal-mask" @click.self="closeForm">
      <form class="modal" @submit.prevent="submitForm">
        <h3 class="modal-title">编辑水厂档案</h3>
        <p class="modal-hint">保存即覆盖同一水厂编号的原行，刷新或重新进入后读到的仍是本次内容。</p>
        <label class="form-item">
          <span>水厂编号 <em>*</em></span>
          <input v-model="form['水厂编号']" disabled />
        </label>
        <label class="form-item">
          <span>水厂名称（按行政区命名） <em>*</em></span>
          <input v-model="form['水厂名称']" placeholder="例如 滨江区第一水厂" />
        </label>
        <label class="form-item">
          <span>设计供水规模（万吨/日） <em>*</em></span>
          <input v-model="form['设计供水规模']" type="number" min="0" step="0.1" />
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
          <input v-model="form['所属片区']" />
        </label>
        <label class="form-item">
          <span>水厂厂长 <em>*</em></span>
          <input v-model="form['水厂厂长']" />
        </label>
        <label class="form-item">
          <span>投运日期</span>
          <input v-model="form['投运日期']" type="date" />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeForm">取消</button>
          <button class="btn primary" type="submit">覆盖保存</button>
        </div>
      </form>
    </div>
  </section>

  <section v-else class="page">
    <header class="page-head">
      <div>
        <h2>水厂档案详情</h2>
        <p class="page-desc">现行台账与历次存档里都没有找到这座水厂。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/plant">返回台账列表</RouterLink>
      </div>
    </header>
    <p class="error-text">未找到该水厂档案，可能已被重置或编号有误。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import {
  WATER_SOURCE_TYPES,
  allowedAction,
  formFromRow,
  getPlant,
  runPlantAction,
  savePlant,
  type PlantForm,
  type PlantLookup,
} from '@/api/plant-service'

const detailFields = ['水厂编号', '水厂名称', '设计供水规模', '水源类型', '所属片区', '投运日期', '水厂厂长']
const waterSourceTypes = WATER_SOURCE_TYPES

const route = useRoute()
const lookup = ref<PlantLookup | null>(null)

function reload() {
  const id = Number(route.params.id)
  lookup.value = Number.isFinite(id) ? getPlant(id) : null
}

const row = computed(() => lookup.value?.row ?? ({} as PlantLookup['row']))
const nextAction = computed(() => allowedAction(String(row.value.status ?? '')))

const errorMessage = ref('')
const notice = ref('')

const formOpen = ref(false)
const formError = ref('')
const form = ref<PlantForm>(formFromRow({} as PlantLookup['row']))

function openEdit() {
  form.value = formFromRow(row.value)
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

function runNext() {
  errorMessage.value = ''
  notice.value = ''
  const result = runPlantAction(Number(row.value.id), nextAction.value as string)
  if (result.ok) {
    notice.value = result.message
  } else {
    errorMessage.value = result.message
  }
  reload()
}

watch(() => route.params.id, reload, { immediate: true })
</script>
