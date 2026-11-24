<script setup lang="ts">
import { MinutesStatus, MinutesVerdict, Role } from '@thesis/shared';
import type { Minutes, ThesisSummary } from '~/types/api';
import { minutesApi } from '~/utils/api';
import { downloadFile } from '~/utils/http';
import { MINUTES_VERDICT_LABELS, ROLE_LABELS, formatDate } from '~/utils/i18n';
import { isMocked } from '~/utils/mocks';
import { useUiStore } from '~/stores/ui';

/** CU-04 · RF-J10 · RNF-04: grading, simple electronic signatures and the sealed hash. */
const props = withDefaults(
  defineProps<{ thesis: ThesisSummary; mode: 'coordinator' | 'juror' | 'student'; programName?: string; signers?: Minutes['requiredSigners'] }>(),
  { programName: 'Programa de posgrado', signers: () => [] },
);
const emit = defineEmits<{ changed: [minutes: Minutes] }>();
const ui = useUiStore();
const actor = useActor();

const minutes = ref<Minutes | null>(null);
const loading = ref(true);
const saving = ref(false);
const form = reactive({ finalGrade: 4.5, verdict: MinutesVerdict.APPROVED, remarks: '' });
const attest = ref(false);
const verdictItems = Object.values(MinutesVerdict).map((v) => ({ value: v, title: MINUTES_VERDICT_LABELS[v] }));

const sealed = computed(() => minutes.value?.status === MinutesStatus.SEALED);
const editable = computed(() => props.mode === 'coordinator' && !!minutes.value && !sealed.value && !minutes.value.signatures.length);
const signedBy = (userId: string) => minutes.value?.signatures.find((s) => s.userId === userId);
const jurorsSigned = computed(() =>
  (minutes.value?.requiredSigners ?? []).filter((s) => s.role !== Role.COORDINATOR).every((s) => signedBy(s.userId)),
);
/** Demo mode (mocked minutes live in one tab): the current user signs the next pending row. */
const mocked = isMocked('minutes');
const mySigner = computed(() => {
  const list = minutes.value?.requiredSigners ?? [];
  const own = list.find((s) => s.userId === actor.value.id);
  if (own || !(import.meta.dev && mocked)) return own;
  return list.find((s) => s.role !== Role.COORDINATOR && !signedBy(s.userId)) ?? list.find((s) => s.role === Role.COORDINATOR);
});
const canSign = computed(() => {
  const s = mySigner.value;
  if (!s || sealed.value || signedBy(s.userId) || props.mode === 'student') return false;
  return s.role !== Role.COORDINATOR || jurorsSigned.value;
});
const gradeRuleBroken = computed(() => form.finalGrade < 3 && form.verdict !== MinutesVerdict.FAILED);

function fill(m: Minutes | null) {
  minutes.value = m;
  if (m) Object.assign(form, { finalGrade: m.finalGrade, verdict: m.verdict, remarks: m.remarks });
}
async function load() {
  loading.value = true;
  try {
    fill(await minutesApi.forThesis(props.thesis.id));
  } catch (e) {
    ui.error(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
// Reload when the thesis changes or its status moves (parents reload the thesis after `changed`).
watch(() => [props.thesis.id, props.thesis.status], load);

async function create() {
  saving.value = true;
  try {
    fill(await minutesApi.create(props.thesis.id, { ...form, finalGrade: Number(form.finalGrade) }, props.signers));
    ui.notify('Acta creada en borrador.');
    emit('changed', minutes.value!);
  } catch (e) {
    ui.error(e);
  } finally {
    saving.value = false;
  }
}
async function update() {
  saving.value = true;
  try {
    fill(await minutesApi.update(minutes.value!.id, { ...form, finalGrade: Number(form.finalGrade) }));
    ui.notify('Acta actualizada.');
  } catch (e) {
    ui.error(e);
  } finally {
    saving.value = false;
  }
}
/** Signing is idempotent server-side: after a failure the button stays (state comes only from the server) and a repeat call returns 200. */
async function sign() {
  saving.value = true;
  try {
    fill(await minutesApi.sign(minutes.value!.id, mocked && mySigner.value ? { id: mySigner.value.userId, name: mySigner.value.name, role: mySigner.value.role } : actor.value));
    attest.value = false;
    ui.notify(sealed.value ? 'Acta firmada y sellada.' : 'Firma registrada.');
    emit('changed', minutes.value!);
  } catch (e) {
    ui.error(e, true);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-card class="pa-5">
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <template v-else>
      <div class="text-center mb-4">
        <div class="brand-seal mx-auto mb-2">UC</div>
        <div class="text-h6 font-weight-bold text-primary">UNIVERSIDAD DE CÓRDOBA</div>
        <div class="text-body-2 text-medium-emphasis">{{ programName }}</div>
        <div class="text-body-1 font-weight-bold mt-1">ACTA DE SUSTENTACIÓN {{ minutes ? `No. ${minutes.number}` : '' }}</div>
      </div>
      <div class="text-body-2 mb-4">
        <strong>Tesis:</strong> {{ thesis.title }} ({{ thesis.code }})<br />
        <strong>Estudiante:</strong> {{ thesis.studentName }}
      </div>

      <template v-if="!minutes">
        <div v-if="mode !== 'coordinator'" class="text-body-2 text-medium-emphasis">El acta aún no ha sido diligenciada.</div>
        <div v-else-if="thesis.status !== 'DEFENSE_SCHEDULED'" class="text-body-2 text-medium-emphasis">
          El acta se diligencia cuando la sustentación está programada y confirmada.
        </div>
      </template>

      <template v-if="(mode === 'coordinator' && !minutes && thesis.status === 'DEFENSE_SCHEDULED') || editable">
        <div class="text-h2-section mb-2">Panel de deliberación</div>
        <v-row dense>
          <v-col cols="12" md="4"><v-text-field v-model.number="form.finalGrade" type="number" min="0" max="5" step="0.1" label="Calificación final (0.0–5.0)" /></v-col>
          <v-col cols="12" md="8"><v-select v-model="form.verdict" :items="verdictItems" label="Veredicto" /></v-col>
          <v-col cols="12"><v-textarea v-model="form.remarks" label="Observaciones del jurado" rows="3" auto-grow /></v-col>
        </v-row>
        <v-alert v-if="gradeRuleBroken" type="warning" variant="tonal" density="compact" class="mb-2">Una calificación menor a 3.0 exige el veredicto Reprobada.</v-alert>
        <div class="d-flex justify-end">
          <v-btn color="primary" :disabled="gradeRuleBroken" :loading="saving" @click="minutes ? update() : create()">{{ minutes ? 'Guardar cambios' : 'Crear acta' }}</v-btn>
        </div>
      </template>

      <template v-if="minutes">
        <v-sheet v-if="!editable" border class="pa-4 rounded-lg mb-4">
          <v-row dense>
            <v-col cols="12" sm="4"><div class="text-meta">Calificación final</div><div class="text-h4 font-weight-bold text-primary">{{ minutes.finalGrade.toFixed(1) }}</div></v-col>
            <v-col cols="12" sm="8"><div class="text-meta">Veredicto</div><div class="text-h6">{{ MINUTES_VERDICT_LABELS[minutes.verdict] }}</div></v-col>
            <v-col v-if="minutes.remarks" cols="12"><div class="text-meta">Observaciones</div><div class="text-body-2">{{ minutes.remarks }}</div></v-col>
          </v-row>
        </v-sheet>

        <div class="text-h2-section mt-4 mb-2">Confirmación electrónica simple (RF-J10)</div>
        <v-table density="comfortable" class="mb-4">
          <tbody>
            <tr v-for="s in minutes.requiredSigners" :key="s.userId">
              <td><strong>{{ s.name }}</strong><div class="text-meta">{{ ROLE_LABELS[s.role as Role] ?? s.role }}</div></td>
              <td class="text-right">
                <v-chip v-if="signedBy(s.userId)" color="success" variant="tonal" prepend-icon="mdi-check-decagram">
                  Firmado {{ formatDate(signedBy(s.userId)!.signedAt, true) }}<template v-if="signedBy(s.userId)!.ip"> · IP {{ signedBy(s.userId)!.ip }}</template>
                </v-chip>
                <v-chip v-else color="warning" variant="tonal">{{ s.role === 'COORDINATOR' ? 'Pendiente de firma final' : 'Pendiente de firma' }}</v-chip>
              </td>
            </tr>
          </tbody>
        </v-table>

        <v-sheet v-if="mySigner && !signedBy(mySigner.userId) && !sealed && mode !== 'student'" border class="pa-3 rounded-lg mb-4">
          <div v-if="mocked && mySigner.userId !== actor.id" class="text-meta mb-1">Modo demostración: firma en nombre de {{ mySigner.name }}.</div>
          <v-checkbox v-model="attest" label="Doy fe y confirmo el acta" hide-details density="compact" :disabled="!canSign" />
          <div v-if="mySigner.role === 'COORDINATOR' && !jurorsSigned" class="text-meta mb-2">Los jurados deben firmar antes que el coordinador.</div>
          <v-btn color="primary" prepend-icon="mdi-draw-pen" :disabled="!attest || !canSign" :loading="saving" @click="sign">Firmar acta</v-btn>
        </v-sheet>

        <v-alert :type="sealed ? 'success' : 'info'" variant="tonal" :icon="sealed ? 'mdi-shield-lock' : 'mdi-pound'">
          <div class="font-weight-bold">{{ sealed ? 'Documento sellado y registrado en bitácora de auditoría' : 'Huella del contenido (SHA-256)' }}</div>
          <div class="mono mt-1">{{ minutes.contentHash || '—' }}</div>
          <div v-if="minutes.sealedAt" class="text-meta mt-1">Sellada el {{ formatDate(minutes.sealedAt, true) }}</div>
        </v-alert>
        <v-btn v-if="sealed && minutes.pdfAvailable" class="mt-3" color="primary" prepend-icon="mdi-file-download" @click="downloadFile(minutesApi.pdfPath(minutes.id), `acta-${minutes.number}.pdf`)">
          Descargar PDF oficial con sello criptográfico
        </v-btn>
      </template>
    </template>
  </v-card>
</template>

<style scoped>
.brand-seal {
  width: 56px; height: 56px; border-radius: 50%; border: 3px solid rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-primary));
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.25rem;
}
</style>
