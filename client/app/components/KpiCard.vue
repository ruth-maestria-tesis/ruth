<script setup lang="ts">
/** Metric tile: icon bubble, big number, label. `featured` paints it with the brand gradient. */
withDefaults(
  defineProps<{ value: number | string; label: string; icon: string; tone?: 'primary' | 'warning' | 'info' | 'success'; to?: string; featured?: boolean }>(),
  { tone: 'primary', to: undefined, featured: false },
);
</script>

<template>
  <v-card :to="to" :class="['kpi pa-5 h-100', { 'uc-gradient': featured }]">
    <div class="d-flex align-start justify-space-between mb-4">
      <div :class="['bubble', featured ? 'bubble--light' : `bg-${tone}`]">
        <v-icon :icon="icon" size="22" :color="featured ? 'white' : undefined" />
      </div>
      <v-icon v-if="to" icon="mdi-arrow-top-right" size="18" class="arrow" />
    </div>
    <div class="value">{{ value }}</div>
    <div class="label">{{ label }}</div>
  </v-card>
</template>

<style scoped>
.bubble { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; }
.bubble:not(.bubble--light) { background: rgba(var(--v-theme-on-surface), 0.04) !important; }
.bubble.bg-primary { background: rgba(var(--v-theme-primary), 0.12) !important; color: rgb(var(--v-theme-primary)) !important; }
.bubble.bg-warning { background: rgba(var(--v-theme-warning), 0.16) !important; color: rgb(var(--v-theme-warning)) !important; }
.bubble.bg-info { background: rgba(var(--v-theme-info), 0.14) !important; color: rgb(var(--v-theme-info)) !important; }
.bubble.bg-success { background: rgba(var(--v-theme-success), 0.14) !important; color: rgb(var(--v-theme-success)) !important; }
.bubble--light { background: rgba(255, 255, 255, 0.2); }
.value { font-size: 34px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
.label { font-size: 13px; font-weight: 600; opacity: 0.7; margin-top: 2px; }
.arrow { opacity: 0.45; }
.uc-gradient .label, .uc-gradient .arrow { opacity: 0.9; }
.uc-gradient { border: 0 !important; box-shadow: 0 18px 40px -18px rgba(108, 71, 255, 0.85) !important; }
</style>
