import { createRouter, createWebHistory } from 'vue-router'

import Dashboard from '@/views/Dashboard.vue'
const Plant = () => import('@/views/plant/index.vue')
const PlantDetail = () => import('@/views/plant/detail.vue')
const Intakepump = () => import('@/views/intakepump/index.vue')
const Dosing = () => import('@/views/dosing/index.vue')
const Sedimentation = () => import('@/views/sedimentation/index.vue')
const Filter = () => import('@/views/filter/index.vue')
const Disinfection = () => import('@/views/disinfection/index.vue')
const Clearwell = () => import('@/views/clearwell/index.vue')
const Quality = () => import('@/views/quality/index.vue')
const Dispatch = () => import('@/views/dispatch/index.vue')
const Pressure = () => import('@/views/pressure/index.vue')
const Secondary = () => import('@/views/secondary/index.vue')
const Meterread = () => import('@/views/meterread/index.vue')
const Burstrepair = () => import('@/views/burstrepair/index.vue')
const Sourcewater = () => import('@/views/sourcewater/index.vue')
const Valve = () => import('@/views/valve/index.vue')
const Chem = () => import('@/views/chem/index.vue')
const Equipmaint = () => import('@/views/equipmaint/index.vue')
const Shift = () => import('@/views/shift/index.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: Dashboard },
    { path: '/plant', name: 'plant', component: Plant },
    { path: '/plant/:id(\\d+)', name: 'plant-detail', component: PlantDetail },
    { path: '/intakepump', name: 'intakepump', component: Intakepump },
    { path: '/dosing', name: 'dosing', component: Dosing },
    { path: '/sedimentation', name: 'sedimentation', component: Sedimentation },
    { path: '/filter', name: 'filter', component: Filter },
    { path: '/disinfection', name: 'disinfection', component: Disinfection },
    { path: '/clearwell', name: 'clearwell', component: Clearwell },
    { path: '/quality', name: 'quality', component: Quality },
    { path: '/dispatch', name: 'dispatch', component: Dispatch },
    { path: '/pressure', name: 'pressure', component: Pressure },
    { path: '/secondary', name: 'secondary', component: Secondary },
    { path: '/meterread', name: 'meterread', component: Meterread },
    { path: '/burstrepair', name: 'burstrepair', component: Burstrepair },
    { path: '/sourcewater', name: 'sourcewater', component: Sourcewater },
    { path: '/valve', name: 'valve', component: Valve },
    { path: '/chem', name: 'chem', component: Chem },
    { path: '/equipmaint', name: 'equipmaint', component: Equipmaint },
    { path: '/shift', name: 'shift', component: Shift },
  ],
})

export default router
