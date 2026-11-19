<script setup lang="ts">
import { AssignmentStatus, Role } from '@thesis/shared';
import { assignmentsApi, thesesApi } from '~/utils/api';
import { useUiStore } from '~/stores/ui';

definePageMeta({ middleware: 'role', roles: [Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR] });

const route = useRoute();
const ui = useUiStore();
const { assignment, thesis, loading, error, load } = useJurorAssignment(() => String(route.params.id));
onMounted(load);

const busy = ref(false);
const declineOpen = ref(false);
const manuscript = computed(() => thesis.value?.manuscripts.find((m) => m.fileId === thesis.value?.currentManuscriptId));
const pdfPath = computed(() =>
  thesis.value?.currentManuscriptId && assignment.value?.status === AssignmentStatus.ACCEPTED
    ? thesesApi.manuscriptPath(thesis.value.id, thesis.value.currentManuscriptId)
    : null,
);

async function accept() {
  busy.value = true;
  try {
    await assignmentsApi.accept(assignment.value!.id);
    ui.notify('Designación aceptada. Ya puede evaluar el manuscrito.');
    await load();
  } catch (e) {
    ui.error(e);
  } finally {
    busy.value = false;
  }
}
async function decline(reason: string) {
  busy.value = true;
  try {
    await assignmentsApi.decline(assignment.value!.id, reason);
    declineOpen.value = false;
    ui.notify('Designación declinada.');
    await load();
  } catch (e) {
    ui.error(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <v-progress-linear v-if="loading && !assignment" indeterminate color="primary" />
    <v-alert v-else-if="error" type="error" variant="tonal">No se encontró la designación.</v-alert>
    <template v-if="assignment">
      <JurorAssignmentNav :assignment="assignment" />

      <v-card v-if="assignment.status === 'PENDING'" class="pa-5" style="border-top: 4px solid #006837">
        <div class="text-h2-section mb-2">Designación pendiente de respuesta</div>
        <p class="text-body-2 mb-4">Al aceptar se habilita la descarga del manuscrito y el formulario de evaluación.</p>
        <v-alert v-if="assignment.thesis?.abstract" type="info" variant="tonal" density="compact" class="mb-4">
          <strong>Resumen:</strong> {{ assignment.thesis.abstract }}
        </v-alert>
        <div class="d-flex ga-2">
          <v-btn color="success" prepend-icon="mdi-check-circle-outline" :loading="busy" :disabled="assignment.isResponseOverdue" @click="accept">Aceptar designación</v-btn>
          <v-btn variant="outlined" color="error" prepend-icon="mdi-close-circle-outline" :disabled="busy || assignment.isResponseOverdue" @click="declineOpen = true">Declinar</v-btn>
        </div>
        <DeclineDialog v-model="declineOpen" :loading="busy" @confirm="decline" />
      </v-card>

      <v-alert v-else-if="assignment.status !== 'ACCEPTED'" type="warning" variant="tonal">
        Esta designación ya no está activa (<AssignmentStatusChip :status="assignment.status" />).
      </v-alert>

      <div v-else class="eval-split">
        <PdfViewer :path="pdfPath" :file-name="manuscript?.fileName" />
        <EvaluationForm :assignment="assignment" />
      </div>
    </template>
  </div>
</template>
