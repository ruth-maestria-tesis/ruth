<script setup lang="ts">
import { DefenseModality, DefenseStatus } from '@thesis/shared';
import type { Defense, ThesisSummary } from '~/types/api';
import { defensesApi } from '~/utils/api';
import { DEFENSE_STATUS_LABELS, MODALITY_LABELS, formatDate } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

/** CU-03: the coordinator schedules; active jurors confirm; the student reads. */
const props = withDefaults(defineProps<{ thesis: ThesisSummary; mode: 'coordinator' | 'juror' | 'student'; jurors?: { userId: string; name: string }[] }>(), {
  jurors: () => [],
});
const emit = defineEmits<{ changed: [defense: Defense | null] }>();
const ui = useUiStore();
const actor = useActor();

const defense = defineModel<Defense | null>('defense', { default: null });
const editing = ref(false);
const saving = ref(false);
const form = reactive({ date: '', time: '09:00', modality: DefenseModality.HYBRID, location: '', meetingUrl: '' });
const modalityItems = Object.values(DefenseModality).map((m) => ({ value: m, title: MODALITY_LABELS[m] }));
const needsLocation = computed(() => form.modality !== DefenseModality.VIRTUAL);
const needsUrl = computed(() => form.modality !== DefenseModality.IN_PERSON);
const formValid = computed(
  () => form.date && form.time && (!needsLocation.value || form.location.trim()) && (!needsUrl.value || /^https?:\/\//.test(form.meetingUrl.trim())),
);
const canSchedule = computed(() => props.mode === 'coordinator' && !defense.value && props.thesis.status === 'READY_FOR_DEFENSE');
const myConfirmation = computed(() => defense.value?.jurors.find((j) => j.userId === actor.value.id));

function startEdit() {
  const d = defense.value;
  if (d) {
    const at = new Date(d.scheduledAt);
    form.date = at.toISOString().slice(0, 10);
    form.time = at.toTimeString().slice(0, 5);
    form.modality = d.modality;
    form.location = d.location ?? '';
    form.meetingUrl = d.meetingUrl ?? '';
  }
  editing.value = true;
}

async function save() {
  saving.value = true;
  const body = {
    scheduledAt: new Date(`${form.date}T${form.time}`).toISOString(),
    modality: form.modality,
    ...(needsLocation.value && { location: form.location.trim() }),
    ...(needsUrl.value && { meetingUrl: form.meetingUrl.trim() }),
  };
  try {
    defense.value = defense.value
      ? await defensesApi.update(defense.value.id, body)
      : await defensesApi.schedule({ id: props.thesis.id, code: props.thesis.code, title: props.thesis.title, studentName: props.thesis.studentName }, body, props.jurors);
    editing.value = false;
    ui.notify('Sustentación programada. Se notificó a los jurados y al estudiante.');
    emit('changed', defense.value);
  } catch (e) {
    ui.error(e);
  } finally {
    saving.value = false;
  }
}
async function confirm() {
  if (!defense.value) return;
  saving.value = true;
  try {
    defense.value = await defensesApi.confirm(defense.value.id, actor.value);
    ui.notify('Asistencia confirmada.');
    emit('changed', defense.value);
  } catch (e) {
    ui.error(e);
  } finally {
    saving.value = false;
  }
}
async function cancel() {
  if (!defense.value) return;
  saving.value = true;
  try {
    await defensesApi.cancel(defense.value.id);
    defense.value = null;
    ui.notify('Sustentación cancelada.');
    emit('changed', null);
  } catch (e) {
    ui.error(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-card class="pa-4">
    <div class="d-flex align-center mb-3">
      <v-icon icon="mdi-calendar-clock" color="primary" class="mr-2" />
      <div class="text-h2-section">Programación de la sustentación (CU-03)</div>
      <v-spacer />
      <v-chip v-if="defense" :color="defense.status === DefenseStatus.CONFIRMED ? 'success' : 'warning'" variant="tonal">
        {{ DEFENSE_STATUS_LABELS[defense.status] }}
      </v-chip>
    </div>

    <template v-if="defense && !editing">
      <v-row dense class="text-body-2 mb-2">
        <v-col cols="12" sm="6"><div class="text-meta">Fecha y hora</div>{{ formatDate(defense.scheduledAt, true) }}</v-col>
        <v-col cols="12" sm="6"><div class="text-meta">Modalidad</div>{{ MODALITY_LABELS[defense.modality] }}</v-col>
        <v-col v-if="defense.location" cols="12" sm="6"><div class="text-meta">Lugar</div>{{ defense.location }}</v-col>
        <v-col v-if="defense.meetingUrl" cols="12" sm="6">
          <div class="text-meta">Enlace virtual</div>
          <a :href="defense.meetingUrl" target="_blank" rel="noopener" class="text-info">{{ defense.meetingUrl }}</a>
        </v-col>
      </v-row>
      <div class="text-meta mb-1">Confirmación de asistencia de los jurados</div>
      <div v-for="j in defense.jurors" :key="j.userId" class="d-flex align-center ga-2 mb-1 text-body-2">
        <v-icon :icon="j.confirmedAt ? 'mdi-check-circle' : 'mdi-clock-outline'" :color="j.confirmedAt ? 'success' : 'warning'" size="18" />
        {{ j.name }}
        <span class="text-meta">{{ j.confirmedAt ? `Confirmó el ${formatDate(j.confirmedAt, true)}` : 'Pendiente' }}</span>
      </div>
      <div v-if="!defense.jurors.length" class="text-body-2 text-medium-emphasis">Sin jurados registrados.</div>
      <div class="d-flex flex-wrap ga-2 mt-3">
        <v-btn v-if="mode === 'juror' && defense.status === 'PROPOSED' && !myConfirmation?.confirmedAt" color="primary" prepend-icon="mdi-check" :loading="saving" @click="confirm">
          Confirmar asistencia
        </v-btn>
        <template v-if="mode === 'coordinator' && defense.status === 'PROPOSED'">
          <v-btn variant="outlined" prepend-icon="mdi-pencil" @click="startEdit">Reprogramar</v-btn>
          <v-btn variant="text" color="error" :loading="saving" @click="cancel">Cancelar sustentación</v-btn>
        </template>
      </div>
    </template>

    <template v-else-if="canSchedule || editing">
      <v-row dense>
        <v-col cols="6" md="3"><v-text-field v-model="form.date" type="date" label="Fecha" /></v-col>
        <v-col cols="6" md="3"><v-text-field v-model="form.time" type="time" label="Hora" /></v-col>
        <v-col cols="12" md="6"><v-select v-model="form.modality" :items="modalityItems" label="Modalidad" /></v-col>
        <v-col v-if="needsLocation" cols="12" md="6"><v-text-field v-model="form.location" label="Auditorio o lugar" /></v-col>
        <v-col v-if="needsUrl" cols="12" md="6"><v-text-field v-model="form.meetingUrl" label="Enlace de la sesión virtual (https://…)" /></v-col>
      </v-row>
      <div class="d-flex justify-end ga-2">
        <v-btn v-if="editing" variant="text" @click="editing = false">Cancelar</v-btn>
        <v-btn color="primary" :disabled="!formValid" :loading="saving" prepend-icon="mdi-calendar-check" @click="save">Programar sustentación</v-btn>
      </div>
    </template>

    <div v-else class="text-body-2 text-medium-emphasis">
      <template v-if="mode === 'coordinator'">La sustentación se programa cuando la tesis está lista para sustentación.</template>
      <template v-else>Aún no hay sustentación programada.</template>
    </div>
  </v-card>
</template>
