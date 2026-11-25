<script setup lang="ts">
import { AssignmentStatus, Role } from '@thesis/shared';
import type { Assignment } from '~/types/api';
import { assignmentsApi } from '~/utils/api';
import { formatDate, studentLabel } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

definePageMeta({ middleware: 'role', roles: [Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR] });

const ui = useUiStore();
const items = ref<Assignment[]>([]);
const loading = ref(true);
const busy = ref<string | null>(null);
const declineOpen = ref(false);
const declineTarget = ref<Assignment | null>(null);

const pending = computed(() => items.value.filter((a) => a.status === AssignmentStatus.PENDING));
const accepted = computed(() => items.value.filter((a) => a.status === AssignmentStatus.ACCEPTED));
const past = computed(() => items.value.filter((a) => ![AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED].includes(a.status)));

async function load() {
  loading.value = true;
  try {
    items.value = await assignmentsApi.mine();
  } catch (e) {
    ui.error(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function accept(a: Assignment) {
  busy.value = a.id;
  try {
    await assignmentsApi.accept(a.id);
    ui.notify('Designación aceptada. Ya puede descargar y evaluar el manuscrito.');
    await load();
  } catch (e) {
    ui.error(e);
  } finally {
    busy.value = null;
  }
}
function askDecline(a: Assignment) {
  declineTarget.value = a;
  declineOpen.value = true;
}
async function decline(reason: string) {
  if (!declineTarget.value) return;
  busy.value = declineTarget.value.id;
  try {
    await assignmentsApi.decline(declineTarget.value.id, reason);
    ui.notify('Designación declinada. La coordinación fue notificada.');
    declineOpen.value = false;
    await load();
  } catch (e) {
    ui.error(e);
  } finally {
    busy.value = null;
  }
}
const roleLabel = (a: Assignment) => (a.type === 'TIEBREAKER' ? 'Jurado dirimente' : `Jurado principal ${a.slot}`);
</script>

<template>
  <div>
    <div class="text-h1-module mb-1">Portal del Jurado Evaluador</div>
    <div class="text-body-2 text-medium-emphasis mb-4">Designaciones, plazos y acceso a la evaluación (CU-08)</div>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <v-card v-for="a in pending" :key="a.id" class="pa-5 mb-4 uc-accent-top">
      <div class="d-flex flex-wrap align-center ga-2 mb-3">
        <div>
          <div class="text-h2-section d-flex align-center ga-2"><v-icon icon="mdi-clipboard-check-outline" color="primary" /> Notificación de designación</div>
          <div class="text-body-2 text-medium-emphasis">Usted ha sido designado para evaluar la siguiente tesis de posgrado</div>
        </div>
        <v-spacer />
        <CountdownChip :assignment="a" size="default" />
      </div>
      <v-row>
        <v-col cols="12" md="8">
          <div class="text-meta">{{ a.thesis?.code }}</div>
          <div class="text-h6 text-primary font-weight-bold mb-1">{{ a.thesis?.title }}</div>
          <div class="text-body-2 text-medium-emphasis mb-3">
            <strong>{{ studentLabel(a.thesis?.studentName) }}:</strong> {{ a.thesis?.studentName }}
            <template v-if="a.thesis?.advisorName"> · <strong>Director:</strong> {{ a.thesis.advisorName }}</template>
          </div>
          <v-alert v-if="a.thesis?.abstract" type="info" variant="tonal" density="compact" icon="mdi-text-box-outline">
            <strong>Resumen:</strong> {{ a.thesis.abstract }}
          </v-alert>
        </v-col>
        <v-col cols="12" md="4">
          <v-sheet class="pa-4 rounded-lg" border color="grey-lighten-5">
            <div class="font-weight-bold text-body-2 mb-2">Su designación</div>
            <ul class="text-body-2 text-medium-emphasis ml-4 mb-4">
              <li>Rol: <strong>{{ roleLabel(a) }}</strong></li>
              <li>Asignada: <strong>{{ formatDate(a.assignedAt) }}</strong> (hace {{ a.daysSinceAssigned }} días)</li>
              <li>Responder antes de: <strong>{{ formatDate(a.responseDeadline, true) }}</strong></li>
            </ul>
            <v-btn block color="success" prepend-icon="mdi-check-circle-outline" class="mb-2" :loading="busy === a.id" :disabled="a.isResponseOverdue" @click="accept(a)">
              Aceptar designación
            </v-btn>
            <v-btn block variant="outlined" color="error" prepend-icon="mdi-close-circle-outline" :disabled="busy === a.id || a.isResponseOverdue" @click="askDecline(a)">
              Declinar designación
            </v-btn>
          </v-sheet>
        </v-col>
      </v-row>
    </v-card>

    <div class="text-h2-section mt-6 mb-3">Tesis aceptadas</div>
    <div v-if="!loading && !accepted.length" class="text-medium-emphasis text-body-2 mb-4">No tiene tesis aceptadas en evaluación.</div>
    <v-row>
      <v-col v-for="a in accepted" :key="a.id" cols="12" md="6" lg="4">
        <v-card class="pa-4 h-100 d-flex flex-column">
          <div class="d-flex align-center ga-2 mb-2">
            <span class="text-meta">{{ a.thesis?.code }}</span>
            <v-spacer />
            <ThesisStatusChip v-if="a.thesis" :status="a.thesis.status" />
          </div>
          <div class="font-weight-bold mb-1">{{ a.thesis?.title }}</div>
          <div class="text-body-2 text-medium-emphasis mb-2">{{ a.thesis?.studentName }} · {{ roleLabel(a) }}</div>
          <CountdownChip :assignment="a" class="mb-3 align-self-start" />
          <v-spacer />
          <div class="d-flex flex-wrap ga-1">
            <v-btn size="small" color="primary" prepend-icon="mdi-file-sign" :to="`/juror/evaluation/${a.id}`">Evaluación</v-btn>
            <v-btn size="small" variant="outlined" prepend-icon="mdi-message-text-outline" :to="`/juror/evaluation/${a.id}/feedback`">Retroalimentación</v-btn>
            <v-btn size="small" variant="outlined" prepend-icon="mdi-certificate-outline" :to="`/juror/evaluation/${a.id}/minutes`">Sustentación y acta</v-btn>
          </div>
        </v-card>
      </v-col>
    </v-row>

    <template v-if="past.length">
      <div class="text-h2-section mt-6 mb-3">Historial</div>
      <v-card>
        <v-list density="compact">
          <v-list-item v-for="a in past" :key="a.id" :title="a.thesis?.title" :subtitle="`${a.thesis?.code} · ${formatDate(a.respondedAt ?? a.responseDeadline)}`">
            <template #append><AssignmentStatusChip :status="a.status" /></template>
          </v-list-item>
        </v-list>
      </v-card>
    </template>

    <DeclineDialog v-model="declineOpen" :loading="!!busy" @confirm="decline" />
  </div>
</template>
