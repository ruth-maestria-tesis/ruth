<script setup lang="ts">
import { AssignmentStatus, FeedbackStatus, Role, ThesisStatus } from '@thesis/shared';
import type { Assignment, ExternalLink } from '~/types/api';
import { assignmentsApi, feedbackSummaryApi, thesesApi } from '~/utils/api';
import { downloadFile } from '~/utils/http';
import { formatDate, fullName } from '~/utils/i18n';
import { useAuthStore } from '~/stores/auth';
import { useUiStore } from '~/stores/ui';

definePageMeta({ middleware: 'role', roles: [Role.COORDINATOR, Role.ADMIN] });

const route = useRoute();
const id = computed(() => String(route.params.id));
const auth = useAuthStore();
const ui = useUiStore();
const canManage = computed(() => auth.hasRole(Role.COORDINATOR));
const { thesis, advisor, summary, loading, error, load } = useThesis(id);
const { programName, cohortName, periodCode } = useCatalogs();

const assignments = ref<Assignment[]>([]);
const assignOpen = ref(false);
const replaceOpen = ref(false);
const replaceTarget = ref<Assignment | null>(null);
const linksOpen = ref(false);
const links = ref<ExternalLink[]>([]);
const uploadFile = ref<File | File[] | null>(null);
const uploading = ref(false);

async function loadAssignments() {
  try {
    assignments.value = (await assignmentsApi.forThesis(id.value)).sort((a, b) => a.slot - b.slot || a.assignedAt.localeCompare(b.assignedAt));
  } catch (e) {
    ui.error(e);
  }
}
/** Unresolved feedback (PENDING + ADDRESSED); only loaded while the thesis is in revisions. */
const unresolved = ref<number | null>(null);
const markingReady = ref(false);
const inRevisions = computed(() => thesis.value?.status === ThesisStatus.REVISIONS_IN_PROGRESS);
async function loadFeedbackSummary() {
  if (!inRevisions.value) return;
  try {
    const s = await feedbackSummaryApi.get(id.value);
    unresolved.value = (s.byStatus[FeedbackStatus.PENDING] ?? 0) + (s.byStatus[FeedbackStatus.ADDRESSED] ?? 0);
  } catch (e) {
    ui.error(e);
  }
}
async function markReady() {
  markingReady.value = true;
  try {
    await thesesApi.readyForDefense(id.value);
    ui.notify('La tesis quedó lista para sustentación.');
    await reload();
  } catch (e) {
    ui.error(e);
    await loadFeedbackSummary();
  } finally {
    markingReady.value = false;
  }
}
async function reload() {
  await Promise.all([load(), loadAssignments()]);
  await loadFeedbackSummary();
}
onMounted(async () => {
  await reload();
  if (route.query.assign && thesis.value?.status === 'SUBMITTED' && canManage.value) assignOpen.value = true;
});

const active = computed(() => assignments.value.filter((a) => a.status !== AssignmentStatus.REPLACED));
const history = computed(() => assignments.value.filter((a) => a.status === AssignmentStatus.REPLACED));
const replaceable = (a: Assignment) =>
  canManage.value && a.type === 'PRIMARY' && ['PENDING', 'DECLINED', 'EXPIRED'].includes(a.status) && thesis.value?.status !== 'SUBMITTED';

function openReplace(a: Assignment) {
  replaceTarget.value = a;
  replaceOpen.value = true;
}
function onAssigned(l: ExternalLink[]) {
  reload();
  if (l.length) {
    links.value = l;
    linksOpen.value = true;
  }
}
function onReplaced(l?: ExternalLink) {
  reload();
  if (l) {
    links.value = [l];
    linksOpen.value = true;
  }
}
async function regenerateLink(a: Assignment) {
  try {
    links.value = [await assignmentsApi.externalLink(a.id)];
    linksOpen.value = true;
  } catch (e) {
    ui.error(e);
  }
}
async function upload() {
  const f = Array.isArray(uploadFile.value) ? uploadFile.value[0] : uploadFile.value;
  if (!f) return;
  uploading.value = true;
  try {
    thesis.value = await thesesApi.uploadManuscript(id.value, f);
    uploadFile.value = null;
    ui.notify('Nueva versión del manuscrito cargada.');
  } catch (e) {
    ui.error(e);
  } finally {
    uploading.value = false;
  }
}
const isExternalJuror = (a: Assignment) => a.juror?.roles.includes(Role.EXTERNAL_JUROR) && !a.juror?.roles.includes(Role.INTERNAL_JUROR);
</script>

<template>
  <div>
    <v-progress-linear v-if="loading && !thesis" indeterminate color="primary" />
    <v-alert v-else-if="error" type="error" variant="tonal">No se encontró la tesis o no tiene permiso para verla.</v-alert>
    <template v-if="thesis && summary">
      <ThesisHeader :thesis="summary" />
      <v-alert v-if="canManage && inRevisions && unresolved !== null" :type="unresolved === 0 ? 'success' : 'info'" :variant="unresolved === 0 ? 'flat' : 'tonal'" :border="unresolved === 0 ? 'start' : false" class="mb-4">
        <div class="d-flex flex-wrap align-center ga-3">
          <div class="flex-grow-1">
            <template v-if="unresolved === 0">No hay observaciones abiertas. Puede habilitar la tesis para sustentación.</template>
            <template v-else>Quedan {{ unresolved }} observaciones sin subsanar (RN-06).</template>
          </div>
          <v-btn v-if="unresolved === 0" color="white" variant="flat" size="large" prepend-icon="mdi-check-decagram" :loading="markingReady" @click="markReady">
            Marcar lista para sustentación
          </v-btn>
          <v-btn v-else variant="text" :to="`/coordinator/theses/${thesis.id}/feedback`">Ver observaciones</v-btn>
        </div>
      </v-alert>
      <v-row>
        <v-col cols="12" lg="7">
          <v-card class="pa-4 mb-4">
            <div class="text-h2-section mb-3">Ficha técnica</div>
            <v-row dense class="text-body-2">
              <v-col cols="6" md="4"><div class="text-meta">Programa</div>{{ programName(thesis.programId) }}</v-col>
              <v-col cols="6" md="4"><div class="text-meta">Cohorte</div>{{ cohortName(thesis.cohortId) }}</v-col>
              <v-col cols="6" md="4"><div class="text-meta">Periodo</div>{{ periodCode(thesis.periodId) }}</v-col>
              <v-col cols="6" md="4"><div class="text-meta">Estudiante</div>{{ thesis.studentName }}</v-col>
              <v-col cols="6" md="4"><div class="text-meta">Director</div>{{ fullName(advisor) }}</v-col>
              <v-col cols="6" md="4"><div class="text-meta">Radicada</div>{{ formatDate(thesis.createdAt) }}</v-col>
            </v-row>
            <div v-if="thesis.abstract" class="mt-4">
              <div class="text-meta">Resumen</div>
              <p class="text-body-2" style="white-space: pre-line">{{ thesis.abstract }}</p>
            </div>
            <div v-if="thesis.keywords.length" class="mt-3 d-flex flex-wrap ga-1">
              <v-chip v-for="k in thesis.keywords" :key="k" variant="outlined">{{ k }}</v-chip>
            </div>
          </v-card>

          <v-card class="pa-4">
            <div class="text-h2-section mb-3">Manuscrito y versiones</div>
            <v-list v-if="thesis.manuscripts.length" density="compact">
              <v-list-item
                v-for="m in [...thesis.manuscripts].reverse()"
                :key="m.fileId"
                prepend-icon="mdi-file-pdf-box"
                :title="`v${m.version} — ${m.fileName}`"
                :subtitle="formatDate(m.uploadedAt, true)"
              >
                <template #append>
                  <v-chip v-if="m.fileId === thesis.currentManuscriptId" color="primary" variant="tonal" class="mr-2">Vigente</v-chip>
                  <v-btn icon="mdi-download" variant="text" size="small" @click="downloadFile(thesesApi.manuscriptPath(thesis.id, m.fileId), m.fileName)" />
                </template>
              </v-list-item>
            </v-list>
            <div v-else class="text-medium-emphasis text-body-2 mb-2">Aún no hay manuscrito cargado.</div>
            <div v-if="canManage" class="d-flex ga-2 align-start mt-2">
              <v-file-input v-model="uploadFile" label="Cargar nueva versión (PDF)" accept="application/pdf" prepend-icon="" prepend-inner-icon="mdi-upload" hide-details show-size />
              <v-btn color="primary" :disabled="!uploadFile" :loading="uploading" height="48" @click="upload">Subir</v-btn>
            </div>
          </v-card>
        </v-col>

        <v-col cols="12" lg="5">
          <v-card class="pa-4">
            <div class="d-flex align-center mb-3">
              <div class="text-h2-section">Jurados evaluadores</div>
              <v-spacer />
              <v-btn v-if="canManage && thesis.status === 'SUBMITTED'" color="primary" size="small" prepend-icon="mdi-account-plus" @click="assignOpen = true">Asignar jurados</v-btn>
            </div>
            <div v-if="!active.length" class="text-medium-emphasis text-body-2">Sin jurados asignados (0/2).</div>
            <v-sheet v-for="a in active" :key="a.id" class="pa-3 mb-2 rounded-lg" border>
              <div class="d-flex align-center ga-2">
                <v-avatar color="primary" variant="tonal" size="32">{{ a.slot }}</v-avatar>
                <div class="flex-grow-1">
                  <div class="font-weight-medium">{{ fullName(a.juror) }}</div>
                  <div class="text-meta">
                    {{ a.type === 'TIEBREAKER' ? 'Dirimente' : `Jurado ${a.slot}` }} · {{ a.juror?.institution ?? '—' }}
                    <template v-if="a.juror?.isUnicordoba"> (Unicórdoba)</template>
                  </div>
                </div>
                <AssignmentStatusChip :status="a.status" />
              </div>
              <div class="d-flex flex-wrap align-center ga-2 mt-2">
                <CountdownChip :assignment="a" />
                <span class="text-meta">Asignado {{ formatDate(a.assignedAt) }} (hace {{ a.daysSinceAssigned }} días)</span>
              </div>
              <div v-if="a.declineReason" class="text-body-2 mt-2"><strong>Motivo:</strong> {{ a.declineReason }}</div>
              <div class="d-flex ga-2 mt-2">
                <v-btn v-if="replaceable(a)" size="small" color="warning" variant="tonal" prepend-icon="mdi-account-switch" @click="openReplace(a)">Reemplazar</v-btn>
                <v-btn v-if="canManage && isExternalJuror(a) && ['PENDING', 'ACCEPTED'].includes(a.status)" size="small" variant="outlined" prepend-icon="mdi-link-variant" @click="regenerateLink(a)">
                  Enlace de acceso
                </v-btn>
              </div>
            </v-sheet>
            <v-expansion-panels v-if="history.length" variant="accordion" class="mt-2">
              <v-expansion-panel title="Jurados reemplazados">
                <v-expansion-panel-text>
                  <div v-for="a in history" :key="a.id" class="text-body-2 mb-1">
                    Jurado {{ a.slot }}: {{ fullName(a.juror) }} — {{ formatDate(a.respondedAt ?? a.assignedAt) }}
                    <span v-if="a.declineReason" class="text-medium-emphasis">(“{{ a.declineReason }}”)</span>
                  </div>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-card>
        </v-col>
      </v-row>

      <JuryAssignmentDialog v-model="assignOpen" :thesis="thesis" :advisor-name="fullName(advisor)" @assigned="onAssigned" />
      <ReplaceJurorDialog v-model="replaceOpen" :thesis-id="thesis.id" :assignment="replaceTarget" :exclude-ids="assignments.map((a) => a.jurorId)" @done="onReplaced" />
      <ExternalLinksDialog v-model="linksOpen" :links="links" />
    </template>
  </div>
</template>
