<script setup lang="ts">
import { Role, ThesisStatus } from '@thesis/shared';
import type { DisputeView, Evaluation, ExternalLink } from '~/types/api';
import { assignmentsApi, disputesApi } from '~/utils/api';
import { VERDICT_LABELS, formatDate, fullName } from '~/utils/i18n';
import { useAuthStore } from '~/stores/auth';
import { useUiStore } from '~/stores/ui';

definePageMeta({ middleware: 'role', roles: [Role.COORDINATOR, Role.ADMIN] });
const route = useRoute();
const auth = useAuthStore();
const ui = useUiStore();
const id = computed(() => String(route.params.id));
const { thesis, summary, error, load } = useThesis(id);
const dispute = ref<DisputeView | null>(null);
const jurorIds = ref<string[]>([]);
const tiebreakerOpen = ref(false);
const replaceOpen = ref(false);
const links = ref<ExternalLink[]>([]);
const linksOpen = ref(false);

async function loadDispute() {
  if (!thesis.value) return;
  try {
    dispute.value = await disputesApi.get(thesis.value.id, thesis.value.status);
    jurorIds.value = (await assignmentsApi.forThesis(thesis.value.id).catch(() => [])).map((a) => a.jurorId);
  } catch (e) {
    ui.error(e);
  }
}
onMounted(async () => {
  await load();
  await loadDispute();
});
const inDispute = computed(() => thesis.value?.status === ThesisStatus.IN_DISPUTE);
/** PENDING, DECLINED, EXPIRED, or ACCEPTED without a submitted evaluation (a stuck tiebreaker). */
const canReplaceTiebreaker = computed(() => {
  const t = dispute.value?.tiebreaker;
  if (!inDispute.value || !auth.hasRole(Role.COORDINATOR) || !t) return false;
  const { status } = t.assignment;
  if (['PENDING', 'DECLINED', 'EXPIRED'].includes(status)) return true;
  return status === 'ACCEPTED' && t.evaluation?.status !== 'SUBMITTED';
});
const approves = (e: Evaluation) => e.verdict !== 'REJECTED';
function onDone(l?: ExternalLink) {
  load().then(loadDispute);
  if (l) {
    links.value = [l];
    linksOpen.value = true;
  }
}
</script>

<template>
  <div>
    <v-alert v-if="error" type="error" variant="tonal">No se encontró la tesis.</v-alert>
    <template v-if="summary && thesis">
      <ThesisHeader :thesis="summary" />
      <v-alert v-if="inDispute" type="error" variant="tonal" prominent icon="mdi-call-split" class="mb-4">
        <div class="font-weight-bold">Tesis en estado de discrepancia evaluativa</div>
        Se requiere designación de jurado dirimente (RN-08).
      </v-alert>
      <v-alert v-else type="info" variant="tonal" class="mb-4">La tesis no está en discrepancia. Se muestran los conceptos emitidos.</v-alert>

      <v-row>
        <v-col v-for="(e, i) in dispute?.primary ?? []" :key="e.id" cols="12" md="6">
          <v-card class="pa-4 h-100" :style="`border-top: 4px solid ${approves(e) ? '#16A34A' : '#DC2626'}`">
            <div class="text-meta">Jurado {{ i + 1 }}</div>
            <div class="font-weight-bold mb-2">{{ e.juror ? fullName(e.juror) : '—' }}</div>
            <div class="d-flex align-center ga-2 mb-3">
              <v-chip :color="approves(e) ? 'success' : 'error'" variant="flat">{{ e.verdict ? VERDICT_LABELS[e.verdict] : '—' }}</v-chip>
              <span class="text-h5 font-weight-bold">{{ e.score?.toFixed(1) ?? '—' }}</span>
              <v-spacer />
              <span class="text-meta">{{ formatDate(e.submittedAt) }}</span>
            </div>
            <div v-if="e.rubric" class="text-body-2 mb-2">
              Metodología {{ e.rubric.methodology }} · Relevancia {{ e.rubric.relevance }} · Redacción {{ e.rubric.writingQuality }}
            </div>
            <div class="text-meta">{{ approves(e) ? 'Observaciones principales' : 'Motivos de reprobación' }}</div>
            <p class="text-body-2">{{ e.comments }}</p>
          </v-card>
        </v-col>
        <v-col v-if="dispute && !dispute.primary.length" cols="12"><div class="text-medium-emphasis">Aún no hay conceptos emitidos.</div></v-col>
      </v-row>

      <v-card class="pa-4 mt-4">
        <div class="text-h2-section mb-2">Jurado dirimente (CU-05)</div>
        <template v-if="dispute?.tiebreaker">
          <div class="d-flex align-center ga-2">
            <strong>{{ fullName(dispute.tiebreaker.assignment.juror) }}</strong>
            <AssignmentStatusChip :status="dispute.tiebreaker.assignment.status" />
            <CountdownChip :assignment="dispute.tiebreaker.assignment" />
          </div>
          <div v-if="dispute.tiebreaker.evaluation" class="mt-2 text-body-2">
            Concepto: <strong>{{ dispute.tiebreaker.evaluation.verdict ? VERDICT_LABELS[dispute.tiebreaker.evaluation.verdict] : '—' }}</strong> — {{ dispute.tiebreaker.evaluation.comments }}
          </div>
        </template>
        <div v-else class="text-body-2 text-medium-emphasis mb-3">Sin jurado dirimente designado.</div>
        <v-btn
          v-if="inDispute && auth.hasRole(Role.COORDINATOR) && !dispute?.tiebreaker"
          color="error"
          prepend-icon="mdi-account-plus"
          class="mt-2"
          @click="tiebreakerOpen = true"
        >
          Designar jurado dirimente
        </v-btn>
        <v-btn v-if="canReplaceTiebreaker" color="warning" variant="tonal" prepend-icon="mdi-account-switch" class="mt-2" @click="replaceOpen = true">Reemplazar dirimente</v-btn>
        <div class="text-meta mt-2">Se valida la ausencia de conflicto de interés (RN-01) y se envía el expediente completo con carácter preferente.</div>
      </v-card>

      <ReplaceJurorDialog v-model="tiebreakerOpen" :thesis-id="thesis.id" mode="tiebreaker" :exclude-ids="jurorIds" @done="onDone" />
      <ReplaceJurorDialog
        v-model="replaceOpen"
        :thesis-id="thesis.id"
        :assignment="dispute?.tiebreaker?.assignment ?? null"
        :exclude-ids="jurorIds"
        @done="onDone"
      />
      <ExternalLinksDialog v-model="linksOpen" :links="links" />
    </template>
  </div>
</template>
