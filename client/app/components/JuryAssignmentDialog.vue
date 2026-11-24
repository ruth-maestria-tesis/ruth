<script setup lang="ts">
import { JuryViolation } from '@thesis/shared';
import type { ExternalLink, JurorInput, JuryViolationItem, Thesis, User } from '~/types/api';
import { assignmentsApi } from '~/utils/api';
import { ApiError } from '~/utils/http';
import { VIOLATION_LABELS } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

/** CU-01 · RF-C13 · RN-01 · RF-C14 */
const open = defineModel<boolean>({ default: false });
const props = defineProps<{ thesis: Thesis; advisorName?: string }>();
const emit = defineEmits<{ assigned: [links: ExternalLink[]] }>();
const ui = useUiStore();

const juror1 = ref<JurorInput | null>(null);
const juror2 = ref<JurorInput | null>(null);
const user1 = ref<User | null>(null);
const user2 = ref<User | null>(null);
const days = ref(8);
const violations = ref<JuryViolationItem[]>([]);
const validating = ref(false);
const saving = ref(false);
const serverError = ref('');
const key = ref(0);

watch(open, (v) => {
  if (v) {
    juror1.value = juror2.value = user1.value = user2.value = null;
    violations.value = [];
    serverError.value = '';
    key.value++;
  }
});

const jurors = computed(() => [juror1.value, juror2.value].filter((j): j is JurorInput => !!j));
/** The API numbers slots by list position; map them back to the form's Jurado 1/2. */
const toUiSlots = (list: JuryViolationItem[]): JuryViolationItem[] => {
  const ui = [juror1.value ? 1 : null, juror2.value ? 2 : null].filter((n): n is number => n !== null);
  return list.map((v) => (v.slot ? { ...v, slot: ui[v.slot - 1] ?? v.slot } : v));
};
const hasCode = (c: JuryViolation) => violations.value.some((v) => v.code === c);
const slotError = (slot: number) => {
  const v = violations.value.find((x) => x.slot === slot);
  return v ? VIOLATION_LABELS[v.code] : null;
};

const checks = computed(() => [
  { ok: jurors.value.length === 2 && !hasCode(JuryViolation.JUROR_COUNT) && !hasCode(JuryViolation.JUROR_DUPLICATE), text: 'Exactamente 2 jurados designados' },
  {
    ok:
      (!!user1.value?.jurorProfile?.isUnicordoba ||
        !!user2.value?.jurorProfile?.isUnicordoba ||
        !!juror1.value?.newExternal?.isUnicordoba ||
        !!juror2.value?.newExternal?.isUnicordoba) &&
      !hasCode(JuryViolation.JUROR_UNICORDOBA_REQUIRED),
    text: 'Al menos 1 con afiliación a la Universidad de Córdoba (RF-C13)',
  },
  {
    ok: jurors.value.length > 0 && !hasCode(JuryViolation.JUROR_CONFLICT_OF_INTEREST) && !hasCode(JuryViolation.JUROR_PREVIOUSLY_ASSIGNED),
    text: 'Ausencia total de conflicto de interés (RN-01)',
  },
]);

let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;
watch(
  () => JSON.stringify([juror1.value, juror2.value, days.value]),
  () => {
    clearTimeout(timer);
    if (!jurors.value.length) {
      violations.value = [];
      return;
    }
    timer = setTimeout(async () => {
      const mine = ++seq;
      validating.value = true;
      try {
        const r = await assignmentsApi.validate(props.thesis.id, jurors.value, days.value);
        if (mine === seq) violations.value = toUiSlots(r.violations);
      } catch (e) {
        if (mine === seq) serverError.value = e instanceof ApiError ? e.userMessage : '';
      } finally {
        if (mine === seq) validating.value = false;
      }
    }, 350);
  },
);

const canSubmit = computed(() => jurors.value.length === 2 && violations.value.length === 0 && !validating.value && checks.value.every((c) => c.ok));

async function submit() {
  saving.value = true;
  serverError.value = '';
  try {
    const r = await assignmentsApi.assign(props.thesis.id, jurors.value, days.value);
    ui.notify('Jurados asignados. Se notificó a los designados.');
    emit('assigned', r.externalLinks);
    open.value = false;
  } catch (e) {
    if (e instanceof ApiError) {
      serverError.value = e.userMessage;
      const v = (e.details?.violations ?? []) as JuryViolationItem[];
      if (v.length) violations.value = toUiSlots(v);
    } else serverError.value = 'No se pudo asignar el jurado.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="980" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center ga-2 pt-4">
        <v-icon icon="mdi-account-multiple-plus" color="primary" />
        Asignación de Jurados Evaluadores (CU-01)
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="open = false" />
      </v-card-title>
      <v-card-text>
        <v-sheet class="pa-4 mb-4 rounded-lg" color="green-lighten-5">
          <div class="text-meta">{{ thesis.code }}</div>
          <div class="font-weight-bold text-primary">{{ thesis.title }}</div>
          <div class="text-body-2 text-medium-emphasis">
            Estudiante: <strong>{{ thesis.studentName }}</strong>
            <template v-if="advisorName"> · Director: <strong>{{ advisorName }}</strong></template>
            · Codirectores: {{ thesis.coAdvisorIds.length }}
          </div>
        </v-sheet>
        <v-alert v-if="!thesis.currentManuscriptId" type="warning" variant="tonal" density="compact" class="mb-4">
          La tesis aún no tiene manuscrito. Cárguelo en la ficha antes de asignar jurados.
        </v-alert>
        <v-row>
          <v-col cols="12" md="6">
            <JurorSelector :key="`a${key}`" v-model="juror1" label="Jurado 1 (Docente Unicórdoba)" :thesis-id="thesis.id" :exclude-ids="user2 ? [user2.id] : []" :error="slotError(1)" @selected="user1 = $event" />
          </v-col>
          <v-col cols="12" md="6">
            <JurorSelector :key="`b${key}`" v-model="juror2" label="Jurado 2" :thesis-id="thesis.id" :exclude-ids="user1 ? [user1.id] : []" :error="slotError(2)" @selected="user2 = $event" />
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12" md="7">
            <v-alert :type="canSubmit ? 'success' : 'warning'" variant="tonal" :icon="canSubmit ? 'mdi-shield-check' : 'mdi-shield-alert'">
              <div class="font-weight-bold mb-1">
                Validador de reglas de negocio
                <v-progress-circular v-if="validating" indeterminate size="14" width="2" class="ml-2" />
              </div>
              <div v-for="c in checks" :key="c.text" class="d-flex align-center ga-2">
                <v-icon :icon="c.ok ? 'mdi-check-circle' : 'mdi-close-circle'" :color="c.ok ? 'success' : 'error'" size="18" />
                <span>{{ c.text }}</span>
              </div>
              <ul v-if="violations.length" class="mt-2 ml-4 text-body-2">
                <li v-for="(v, i) in violations" :key="i">
                  <template v-if="v.slot">Jurado {{ v.slot }}: </template>{{ VIOLATION_LABELS[v.code] ?? v.code }}
                </li>
              </ul>
            </v-alert>
          </v-col>
          <v-col cols="12" md="5">
            <v-text-field v-model.number="days" type="number" min="1" max="60" label="Plazo de respuesta (días hábiles)" prepend-inner-icon="mdi-calendar-clock" hint="Por defecto 8 días hábiles" persistent-hint />
          </v-col>
        </v-row>
        <v-alert v-if="serverError" type="error" variant="tonal" density="compact" class="mt-2">{{ serverError }}</v-alert>
      </v-card-text>
      <v-card-actions class="pa-4">
        <v-spacer />
        <v-btn variant="text" @click="open = false">Cancelar</v-btn>
        <v-btn color="primary" variant="flat" prepend-icon="mdi-check" :disabled="!canSubmit" :loading="saving" @click="submit">
          Confirmar asignación de jurados
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
