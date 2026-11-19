<script setup lang="ts">
import type { Assignment, ExternalLink, JurorInput, JuryViolationItem } from '~/types/api';
import { assignmentsApi } from '~/utils/api';
import { ApiError } from '~/utils/http';
import { VIOLATION_LABELS, fullName } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

/**
 * Replaces a PENDING, DECLINED or EXPIRED primary juror, or (mode = tiebreaker)
 * designates the CU-05 tiebreaker juror.
 */
const open = defineModel<boolean>({ default: false });
const props = withDefaults(defineProps<{ thesisId: string; assignment?: Assignment | null; mode?: 'replace' | 'tiebreaker'; excludeIds?: string[] }>(), {
  assignment: null,
  mode: 'replace',
  excludeIds: () => [],
});
const emit = defineEmits<{ done: [link?: ExternalLink] }>();
const ui = useUiStore();

const juror = ref<JurorInput | null>(null);
const days = ref(8);
const saving = ref(false);
const error = ref('');
const violations = ref<JuryViolationItem[]>([]);
const key = ref(0);
watch(open, (v) => {
  if (v) {
    juror.value = null;
    error.value = '';
    violations.value = [];
    key.value++;
  }
});

async function submit() {
  if (!juror.value) return;
  saving.value = true;
  error.value = '';
  violations.value = [];
  try {
    const r =
      props.mode === 'tiebreaker'
        ? await assignmentsApi.tiebreaker(props.thesisId, juror.value, days.value)
        : await assignmentsApi.replace(props.thesisId, props.assignment!.id, juror.value, days.value);
    ui.notify(props.mode === 'tiebreaker' ? 'Jurado dirimente designado.' : 'Jurado reemplazado.');
    emit('done', r.externalLink);
    open.value = false;
  } catch (e) {
    if (e instanceof ApiError) {
      error.value = e.userMessage;
      violations.value = (e.details?.violations ?? []) as JuryViolationItem[];
    } else error.value = 'No se pudo completar la operación.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="620">
    <v-card :title="mode === 'tiebreaker' ? 'Designar jurado dirimente (CU-05)' : 'Reemplazar jurado'">
      <v-card-text>
        <div v-if="assignment && mode === 'replace'" class="text-body-2 mb-4">
          Reemplaza a <strong>{{ fullName(assignment.juror) }}</strong> (Jurado {{ assignment.slot }}).
          <span v-if="assignment.declineReason"> Motivo de la declinación: “{{ assignment.declineReason }}”.</span>
        </div>
        <JurorSelector :key="key" v-model="juror" :label="mode === 'tiebreaker' ? 'Tercer evaluador' : 'Nuevo jurado'" :exclude-ids="excludeIds" />
        <v-text-field v-model.number="days" type="number" min="1" max="60" label="Plazo de respuesta (días hábiles)" class="mt-2" />
        <v-alert v-if="error" type="error" variant="tonal" density="compact">
          {{ error }}
          <ul v-if="violations.length" class="ml-4">
            <li v-for="(v, i) in violations" :key="i">{{ VIOLATION_LABELS[v.code] ?? v.code }}</li>
          </ul>
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Cancelar</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!juror" :loading="saving" @click="submit">Confirmar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
