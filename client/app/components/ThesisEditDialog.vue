<script setup lang="ts">
import { ThesisStatus } from '@thesis/shared';
import type { Thesis } from '~/types/api';
import { thesesApi } from '~/utils/api';
import { ApiError } from '~/utils/http';
import { useUiStore } from '~/stores/ui';

/**
 * Edits a registered thesis (PATCH /theses/:id). Student, program, cohort and period are fixed
 * (they form the code). Advisor, co-advisors and conflicts only change before jury assignment.
 */
const open = defineModel<boolean>({ default: false });
const props = defineProps<{ thesis: Thesis }>();
const emit = defineEmits<{ saved: [thesis: Thesis] }>();
const ui = useUiStore();

const form = reactive({
  title: '',
  abstract: '',
  keywords: [] as string[],
  advisorId: null as string | null,
  coAdvisorIds: [] as string[],
  conflictOfInterestUserIds: [] as string[],
});
const saving = ref(false);
const error = ref('');
const participantsEditable = computed(() => props.thesis.status === ThesisStatus.SUBMITTED);

watch(open, (v) => {
  if (!v) return;
  const t = props.thesis;
  Object.assign(form, {
    title: t.title,
    abstract: t.abstract ?? '',
    keywords: [...t.keywords],
    advisorId: t.advisorId,
    coAdvisorIds: [...t.coAdvisorIds],
    conflictOfInterestUserIds: [...(t.conflictOfInterestUserIds ?? [])],
  });
  error.value = '';
});

const valid = computed(() => !!form.title.trim() && !!form.advisorId);

async function save() {
  saving.value = true;
  error.value = '';
  try {
    const updated = await thesesApi.update(props.thesis.id, {
      title: form.title.trim(),
      abstract: form.abstract.trim(),
      keywords: form.keywords.map((k) => k.trim()).filter(Boolean),
      ...(participantsEditable.value && {
        advisorId: form.advisorId!,
        coAdvisorIds: form.coAdvisorIds,
        conflictOfInterestUserIds: form.conflictOfInterestUserIds,
      }),
    });
    ui.notify('Tesis actualizada.');
    emit('saved', updated);
    open.value = false;
  } catch (e) {
    error.value = e instanceof ApiError ? e.userMessage : 'No se pudo guardar la tesis.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="860" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center ga-2 pt-4">
        <v-icon icon="mdi-pencil-outline" color="primary" /> Editar tesis {{ thesis.code }}
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="open = false" />
      </v-card-title>
      <v-card-text>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
        <v-row dense>
          <v-col cols="12"><v-text-field v-model="form.title" label="Título de la tesis *" counter="300" maxlength="300" /></v-col>
          <v-col cols="12"><v-textarea v-model="form.abstract" label="Resumen" rows="4" auto-grow counter="5000" maxlength="5000" /></v-col>
          <v-col cols="12">
            <v-combobox
              v-model="form.keywords"
              label="Palabras clave (Enter para agregar, máx. 10)"
              hint="Se usan para sugerir jurados por afinidad"
              persistent-hint
              multiple
              chips
              closable-chips
            />
          </v-col>
        </v-row>
        <div class="text-meta mt-4 mb-2">Participantes</div>
        <v-alert v-if="!participantsEditable" type="info" variant="tonal" density="compact" class="mb-2">
          El director, los codirectores y los conflictos de interés solo se pueden cambiar antes de asignar jurados.
        </v-alert>
        <v-row dense>
          <v-col cols="12" md="6">
            <UserPicker v-model="form.advisorId" source="faculty" label="Director *" :disabled="!participantsEditable" />
          </v-col>
          <v-col cols="12" md="6">
            <UserPicker v-model="form.coAdvisorIds" source="faculty" label="Codirectores (máx. 3)" multiple :disabled="!participantsEditable" />
          </v-col>
          <v-col cols="12">
            <UserPicker
              v-model="form.conflictOfInterestUserIds"
              source="faculty"
              label="Docentes con conflicto de interés (no pueden ser jurados)"
              multiple
              :disabled="!participantsEditable"
            />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions class="pa-4">
        <v-spacer />
        <v-btn variant="text" @click="open = false">Cancelar</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!valid" :loading="saving" @click="save">Guardar cambios</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
