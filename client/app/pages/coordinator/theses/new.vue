<script setup lang="ts">
import { Role } from '@thesis/shared';
import { thesesApi } from '~/utils/api';
import { ApiError } from '~/utils/http';
import { useUiStore } from '~/stores/ui';

definePageMeta({ middleware: 'role', roles: [Role.COORDINATOR] });

const ui = useUiStore();
const { programs, periods, cohorts } = useCatalogs();
const form = reactive({
  title: '',
  abstract: '',
  keywords: [] as string[],
  /** The first one is the main student; the rest are co-authors. */
  studentIds: [] as string[],
  advisorId: null as string | null,
  coAdvisorIds: [] as string[],
  programId: null as string | null,
  cohortId: null as string | null,
  periodId: null as string | null,
});
const file = ref<File | File[] | null>(null);
const saving = ref(false);
const error = ref('');
const programCohorts = computed(() => cohorts.value.filter((c) => !form.programId || c.programId === form.programId));
watch(() => form.programId, () => (form.cohortId = null));
watch(programs, (p) => {
  if (!form.programId && p.length === 1) form.programId = p[0]!.id;
}, { immediate: true });

const valid = computed(() => form.title.trim() && form.studentIds.length && form.advisorId && form.programId && form.cohortId && form.periodId);

async function submit() {
  if (!valid.value) return;
  saving.value = true;
  error.value = '';
  try {
    const thesis = await thesesApi.create({
      title: form.title.trim(),
      abstract: form.abstract.trim() || undefined,
      keywords: form.keywords.length ? form.keywords : undefined,
      studentId: form.studentIds[0]!,
      coStudentIds: form.studentIds.length > 1 ? form.studentIds.slice(1) : undefined,
      advisorId: form.advisorId!,
      coAdvisorIds: form.coAdvisorIds.length ? form.coAdvisorIds : undefined,
      programId: form.programId!,
      cohortId: form.cohortId!,
      periodId: form.periodId!,
    });
    const f = Array.isArray(file.value) ? file.value[0] : file.value;
    if (f) {
      try {
        await thesesApi.uploadManuscript(thesis.id, f);
      } catch (e) {
        ui.error(e);
      }
    }
    ui.notify(`Tesis radicada con código ${thesis.code}.`);
    await navigateTo(`/coordinator/theses/${thesis.id}`);
  } catch (e) {
    error.value = e instanceof ApiError ? e.userMessage : 'No se pudo radicar la tesis.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-card class="pa-6" max-width="980">
    <div class="text-h1-module mb-1">Radicar tesis</div>
    <div class="text-body-2 text-medium-emphasis mb-6">El código se genera con el programa y el periodo (p. ej. MIETIA-2026-II-001).</div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
    <v-form @submit.prevent="submit">
      <v-row dense>
        <v-col cols="12"><v-text-field v-model="form.title" label="Título de la tesis *" counter="300" maxlength="300" /></v-col>
        <v-col cols="12"><v-textarea v-model="form.abstract" label="Resumen" rows="4" auto-grow counter="5000" /></v-col>
        <v-col cols="12"><v-combobox v-model="form.keywords" label="Palabras clave (Enter para agregar)" multiple chips closable-chips variant="outlined" density="comfortable" /></v-col>
        <v-col cols="12" md="4"><v-select v-model="form.programId" :items="programs" item-title="name" item-value="id" label="Programa *" /></v-col>
        <v-col cols="12" md="4"><v-select v-model="form.cohortId" :items="programCohorts" item-title="name" item-value="id" label="Cohorte *" /></v-col>
        <v-col cols="12" md="4"><v-select v-model="form.periodId" :items="periods" item-title="code" item-value="id" label="Periodo *" /></v-col>
        <v-col cols="12">
          <UserPicker
            v-model="form.studentIds"
            source="students"
            label="Estudiantes * (máx. 3)"
            multiple
            :max="3"
            hint="Para una tesis conjunta agregue a todos los autores. El primero queda como estudiante principal."
          />
        </v-col>
        <v-col cols="12" md="6"><UserPicker v-model="form.advisorId" source="faculty" label="Director *" /></v-col>
        <v-col cols="12" md="6"><UserPicker v-model="form.coAdvisorIds" source="faculty" label="Codirectores (máx. 3)" multiple :max="3" /></v-col>
        <v-col cols="12">
          <v-file-input v-model="file" label="Manuscrito (PDF, máx. 25 MB)" accept="application/pdf" prepend-icon="" prepend-inner-icon="mdi-file-pdf-box" show-size />
        </v-col>
      </v-row>
      <div class="d-flex ga-2 justify-end">
        <v-btn variant="text" to="/coordinator/theses">Cancelar</v-btn>
        <v-btn type="submit" color="primary" :disabled="!valid" :loading="saving" prepend-icon="mdi-check">Radicar</v-btn>
      </div>
    </v-form>
  </v-card>
</template>
