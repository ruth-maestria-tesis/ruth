<script setup lang="ts">
import { ThesisStatus } from '@thesis/shared';
import type { HistoryEntry, Thesis } from '~/types/api';
import { ROLE_LABELS, THESIS_STATUS_LABELS, formatDate } from '~/utils/i18n';

/** CU-07 · RF-C16: critical path from `history[]` and `progress`; click a node for details. */
const props = defineProps<{ thesis: Thesis }>();

interface Stage {
  key: string;
  title: string;
  icon: string;
  statuses: ThesisStatus[];
}
const STAGES: Stage[] = [
  { key: 'submitted', title: 'Radicación', icon: 'mdi-inbox-arrow-down', statuses: [ThesisStatus.SUBMITTED] },
  { key: 'jury', title: 'Asignación de jurados', icon: 'mdi-account-multiple-check', statuses: [ThesisStatus.JURORS_ASSIGNED, ThesisStatus.PENDING_JUROR_REPLACEMENT] },
  { key: 'evaluation', title: 'Evaluación', icon: 'mdi-file-sign', statuses: [ThesisStatus.UNDER_EVALUATION, ThesisStatus.IN_DISPUTE] },
  { key: 'revisions', title: 'Subsanación de observaciones', icon: 'mdi-pencil-box-multiple', statuses: [ThesisStatus.REVISIONS_IN_PROGRESS] },
  { key: 'defense', title: 'Sustentación', icon: 'mdi-presentation', statuses: [ThesisStatus.READY_FOR_DEFENSE, ThesisStatus.DEFENSE_SCHEDULED] },
  { key: 'minutes', title: 'Acta final', icon: 'mdi-certificate', statuses: [ThesisStatus.COMPLETED_APPROVED, ThesisStatus.COMPLETED_FAILED, ThesisStatus.NOT_APPROVED] },
];

/** History with the initial SUBMITTED entry guaranteed. */
const entries = computed<HistoryEntry[]>(() => {
  const h = [...(props.thesis.history ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  if (!h.length || h[0]!.to !== ThesisStatus.SUBMITTED) {
    h.unshift({ from: null, to: ThesisStatus.SUBMITTED, at: props.thesis.createdAt, actorRole: 'COORDINATOR', evidenceFileIds: [] });
  }
  return h;
});
const currentIndex = computed(() => STAGES.findIndex((s) => s.statuses.includes(props.thesis.status)));
const terminalNoDefense = computed(() => props.thesis.status === ThesisStatus.NOT_APPROVED);

function stageState(i: number): 'done' | 'current' | 'future' | 'skipped' {
  const isFinal = props.thesis.status === ThesisStatus.COMPLETED_APPROVED || props.thesis.status === ThesisStatus.COMPLETED_FAILED || terminalNoDefense.value;
  if (i === currentIndex.value) return isFinal ? 'done' : 'current';
  if (i < currentIndex.value) {
    const visited = entries.value.some((e) => STAGES[i]!.statuses.includes(e.to));
    return visited ? 'done' : 'skipped';
  }
  return 'future';
}
const stageEntries = (s: Stage) => entries.value.filter((e) => s.statuses.includes(e.to));

const selected = ref<Stage | null>(null);
const drawer = computed({ get: () => !!selected.value, set: (v: boolean) => !v && (selected.value = null) });

function duration(e: HistoryEntry): string {
  const idx = entries.value.indexOf(e);
  const end = entries.value[idx + 1]?.at ?? new Date().toISOString();
  const days = Math.max(0, Math.round((new Date(end).getTime() - new Date(e.at).getTime()) / 86_400_000));
  return `${days} día${days === 1 ? '' : 's'}${idx === entries.value.length - 1 ? ' (en curso)' : ''}`;
}
const COLORS = { done: '#16A34A', current: '#0284C7', future: '#CBD5E1', skipped: '#E2E8F0' };
</script>

<template>
  <v-card class="pa-4">
    <div class="d-flex align-center mb-4">
      <v-icon icon="mdi-graph-outline" color="info" class="mr-2" />
      <div>
        <div class="text-h2-section">Grafo de trazabilidad y progreso (CU-07)</div>
        <div class="text-body-2 text-medium-emphasis">Haga clic en una etapa para ver fechas, responsables y tiempo de permanencia</div>
      </div>
      <v-spacer />
      <div style="width: 180px"><ProgressCell :value="thesis.progress" /></div>
    </div>

    <div class="graph-row">
      <template v-for="(s, i) in STAGES" :key="s.key">
        <button
          type="button"
          class="node"
          :class="[stageState(i), { pulse: stageState(i) === 'current' }]"
          :style="{ borderColor: COLORS[stageState(i)] }"
          @click="selected = s"
        >
          <span class="dot" :style="{ background: COLORS[stageState(i)] }">
            <v-icon :icon="stageState(i) === 'done' ? 'mdi-check' : s.icon" size="20" color="white" />
          </span>
          <span class="label">{{ s.title }}</span>
          <span class="text-meta">{{ stageEntries(s)[0] ? formatDate(stageEntries(s)[0]!.at) : stageState(i) === 'skipped' ? 'No aplica' : '—' }}</span>
          <v-chip v-if="s.key === 'evaluation' && entries.some((e) => e.to === 'IN_DISPUTE')" color="error" variant="tonal" size="x-small" class="mt-1">Discrepancia</v-chip>
        </button>
        <div v-if="i < STAGES.length - 1" class="edge" :style="{ background: stageState(i + 1) === 'future' ? COLORS.future : COLORS.done }" />
      </template>
    </div>

    <v-alert v-if="terminalNoDefense" type="error" variant="tonal" density="compact" class="mt-4">La tesis no fue aprobada en la evaluación; el flujo terminó sin sustentación.</v-alert>

    <div class="text-h2-section mt-6 mb-2">Historial de estados</div>
    <v-timeline side="end" density="compact" align="start">
      <v-timeline-item v-for="(e, k) in entries" :key="k" :dot-color="k === entries.length - 1 ? 'info' : 'success'" size="x-small">
        <div class="d-flex flex-wrap ga-2 align-center">
          <ThesisStatusChip :status="e.to" />
          <span class="text-meta">{{ formatDate(e.at, true) }} · {{ ROLE_LABELS[e.actorRole as keyof typeof ROLE_LABELS] ?? e.actorRole }} · {{ duration(e) }}</span>
        </div>
        <div v-if="e.reason" class="text-body-2 mt-1">{{ e.reason }}</div>
      </v-timeline-item>
    </v-timeline>

    <v-navigation-drawer v-model="drawer" location="right" temporary width="380">
      <div v-if="selected" class="pa-4">
        <div class="d-flex align-center mb-3">
          <v-icon :icon="selected.icon" color="primary" class="mr-2" />
          <div class="text-h2-section">{{ selected.title }}</div>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="selected = null" />
        </div>
        <div v-if="!stageEntries(selected).length" class="text-body-2 text-medium-emphasis">Esta etapa aún no ha ocurrido.</div>
        <v-card v-for="(e, k) in stageEntries(selected)" :key="k" class="pa-3 mb-2">
          <div class="font-weight-medium">{{ THESIS_STATUS_LABELS[e.to] }}</div>
          <div class="text-body-2"><strong>Fecha:</strong> {{ formatDate(e.at, true) }}</div>
          <div class="text-body-2"><strong>Responsable:</strong> {{ ROLE_LABELS[e.actorRole as keyof typeof ROLE_LABELS] ?? e.actorRole }}</div>
          <div class="text-body-2"><strong>Permanencia:</strong> {{ duration(e) }}</div>
          <div v-if="e.reason" class="text-body-2"><strong>Motivo:</strong> {{ e.reason }}</div>
          <div v-if="e.evidenceFileIds.length" class="text-body-2"><strong>Evidencias:</strong> {{ e.evidenceFileIds.length }} archivo(s)</div>
        </v-card>
      </div>
    </v-navigation-drawer>
  </v-card>
</template>

<style scoped>
.graph-row { display: flex; align-items: center; overflow-x: auto; padding: 8px 4px 12px; }
.node {
  display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 128px; padding: 12px 8px;
  border: 2px solid; border-radius: 12px; background: #fff; cursor: pointer; text-align: center;
}
.node.future, .node.skipped { opacity: 0.6; }
.node .dot { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.node .label { font-size: 13px; font-weight: 600; }
.edge { flex: 1 0 24px; height: 4px; border-radius: 2px; }
</style>
