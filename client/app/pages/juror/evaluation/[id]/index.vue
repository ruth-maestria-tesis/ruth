<script setup lang="ts">
import { Role, ThesisStatus } from '@thesis/shared';
import { assignmentsApi } from '~/utils/api';
import { useUiStore } from '~/stores/ui';

definePageMeta({ middleware: 'role', roles: [Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR] });

const route = useRoute();
const ui = useUiStore();
const { assignment, thesis, loading, error, load } = useJurorAssignment(() => String(route.params.id));
onMounted(load);

const waitingForJury = computed(() => thesis.value?.status === ThesisStatus.JURORS_ASSIGNED);
const busy = ref(false);
const declineOpen = ref(false);

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

      <v-card v-if="assignment.status === 'PENDING'" class="pa-5 uc-accent-top">
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

      <template v-else>
        <CorrectedDocumentCard :assignment="assignment" :thesis="thesis" />
        <!-- The thesis moves to UNDER_EVALUATION only when both primary jurors have accepted. -->
        <v-alert v-if="waitingForJury" type="info" variant="tonal" class="mb-4">
          La evaluación se habilita cuando el otro jurado acepte su designación. Mientras tanto puede descargar el documento completo.
        </v-alert>
        <EvaluationForm v-else :assignment="assignment" />
      </template>
    </template>
  </div>
</template>
