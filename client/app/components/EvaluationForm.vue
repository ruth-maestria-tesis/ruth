<script setup lang="ts">
import { AssignmentType, EvaluationStatus, EvaluationVerdict } from '@thesis/shared';
import type { Assignment, Evaluation, Rubric } from '~/types/api';
import { evaluationsApi } from '~/utils/api';
import { downloadFile } from '~/utils/http';
import { VERDICT_LABELS, formatDate } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

/** CU-02: rubric (1–5 ×3), verdict, comments and correction file. Locked once submitted. */
const props = defineProps<{ assignment: Assignment }>();
const emit = defineEmits<{ submitted: [evaluation: Evaluation] }>();
const ui = useUiStore();

const isTiebreaker = computed(() => props.assignment.type === AssignmentType.TIEBREAKER);
const evaluation = ref<Evaluation | null>(null);
const rubric = reactive<Rubric>({ methodology: 0, relevance: 0, writingQuality: 0 });
const verdict = ref<EvaluationVerdict | null>(null);
const comments = ref('');
const file = ref<File | File[] | null>(null);
const loading = ref(true);
const saving = ref(false);
const confirmOpen = ref(false);

const locked = computed(() => evaluation.value?.status === EvaluationStatus.SUBMITTED);
const score = computed(() => {
  const v = [rubric.methodology, rubric.relevance, rubric.writingQuality];
  return v.every((x) => x > 0) ? Math.round((v.reduce((a, b) => a + b, 0) / 3) * 10) / 10 : null;
});
const verdictItems = computed(() =>
  (isTiebreaker.value
    ? [EvaluationVerdict.APPROVED, EvaluationVerdict.REJECTED]
    : [EvaluationVerdict.APPROVED_FOR_DEFENSE, EvaluationVerdict.APPROVED_WITH_CHANGES, EvaluationVerdict.REJECTED]
  ).map((v) => ({ value: v, title: VERDICT_LABELS[v] })),
);
const rubricComplete = computed(() => isTiebreaker.value || score.value !== null);
const canSubmit = computed(() => rubricComplete.value && !!verdict.value && comments.value.trim().length >= 20);

const criteria: { key: keyof Rubric; label: string }[] = [
  { key: 'methodology', label: '1. Rigor científico y coherencia metodológica' },
  { key: 'relevance', label: '2. Relevancia, innovación y aporte al conocimiento' },
  { key: 'writingQuality', label: '3. Calidad formal, estilo y manejo bibliográfico' },
];

function fill(e: Evaluation | null) {
  evaluation.value = e;
  if (!e) return;
  Object.assign(rubric, { methodology: 0, relevance: 0, writingQuality: 0 }, e.rubric ?? {});
  verdict.value = e.verdict;
  comments.value = e.comments ?? '';
}

onMounted(async () => {
  try {
    fill(await evaluationsApi.forAssignment(props.assignment.id));
  } catch (e) {
    ui.error(e);
  } finally {
    loading.value = false;
  }
});

function payload() {
  const r = Object.fromEntries(Object.entries(rubric).filter(([, v]) => v > 0)) as Partial<Rubric>;
  return {
    ...(Object.keys(r).length && { rubric: r }),
    ...(verdict.value && { verdict: verdict.value }),
    comments: comments.value,
  };
}

async function saveDraft(silent = false): Promise<boolean> {
  saving.value = true;
  try {
    fill(await evaluationsApi.saveDraft(props.assignment.id, props.assignment.thesisId, payload()));
    const f = Array.isArray(file.value) ? file.value[0] : file.value;
    if (f && evaluation.value) {
      fill(await evaluationsApi.uploadCorrection(evaluation.value.id, f));
      file.value = null;
    }
    if (!silent) ui.notify('Borrador guardado.');
    return true;
  } catch (e) {
    ui.error(e);
    return false;
  } finally {
    saving.value = false;
  }
}

async function submit() {
  if (!(await saveDraft(true))) return;
  saving.value = true;
  try {
    fill(await evaluationsApi.submit(props.assignment.id));
    confirmOpen.value = false;
    ui.notify('Concepto oficial emitido.');
    emit('submitted', evaluation.value!);
  } catch (e) {
    ui.error(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-card class="pa-4 h-100 overflow-y-auto">
    <div class="text-h2-section d-flex align-center ga-2 mb-4">
      <v-icon icon="mdi-clipboard-check-outline" color="primary" /> Rúbrica y emisión de concepto (CU-02)
    </div>
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <template v-else>
      <v-alert v-if="locked" type="success" variant="tonal" icon="mdi-lock-check" class="mb-4">
        Concepto emitido el {{ formatDate(evaluation?.submittedAt, true) }}. Ya no se puede modificar.
      </v-alert>

      <div v-for="c in criteria" :key="c.key" class="mb-3">
        <div class="text-body-2 font-weight-medium mb-1">
          {{ c.label }} <span v-if="isTiebreaker" class="text-medium-emphasis">(opcional)</span>
        </div>
        <v-btn-toggle v-model="rubric[c.key]" color="primary" variant="outlined" density="comfortable" divided :disabled="locked">
          <v-btn v-for="n in 5" :key="n" :value="n" min-width="48">{{ n }}</v-btn>
        </v-btn-toggle>
      </div>

      <v-alert :type="score && score >= 3 ? 'success' : 'info'" variant="tonal" density="compact" class="mb-4">
        <strong>Nota promedio:</strong>
        <span class="text-h6 font-weight-bold ml-2">{{ score !== null ? `${score.toFixed(1)} / 5.0` : '—' }}</span>
      </v-alert>

      <v-select v-model="verdict" :items="verdictItems" label="Concepto evaluativo final" :disabled="locked" class="font-weight-medium" />
      <v-textarea
        v-model="comments"
        label="Observaciones cualitativas generales"
        placeholder="Detalle las fortalezas y recomendaciones principales del trabajo…"
        rows="4"
        auto-grow
        counter
        :disabled="locked"
        :hint="comments.trim().length < 20 ? 'Mínimo 20 caracteres' : ''"
        persistent-hint
      />

      <div v-if="evaluation?.correctionFiles.length" class="mt-3">
        <div class="text-meta mb-1">Archivos de corrección</div>
        <v-chip
          v-for="f in evaluation.correctionFiles"
          :key="f.fileId"
          prepend-icon="mdi-paperclip"
          class="mr-1 mb-1"
          variant="outlined"
          @click="downloadFile(evaluationsApi.filePath(evaluation.id, f.fileId), f.fileName)"
        >
          {{ f.fileName }}
        </v-chip>
      </div>
      <v-file-input
        v-if="!locked"
        v-model="file"
        class="mt-3"
        label="Adjuntar manuscrito con anotaciones (PDF o Word, opcional)"
        accept=".pdf,.doc,.docx"
        prepend-icon=""
        prepend-inner-icon="mdi-paperclip"
        show-size
      />

      <div v-if="!locked" class="d-flex flex-column ga-2 mt-2">
        <v-btn variant="outlined" :loading="saving" prepend-icon="mdi-content-save-outline" @click="saveDraft()">Guardar borrador</v-btn>
        <v-btn color="primary" :disabled="!canSubmit" prepend-icon="mdi-send" @click="confirmOpen = true">Emitir concepto oficial</v-btn>
      </div>
    </template>

    <v-dialog v-model="confirmOpen" max-width="480">
      <v-card title="Emitir concepto oficial">
        <v-card-text>
          Concepto: <strong>{{ verdict ? VERDICT_LABELS[verdict] : '—' }}</strong>
          <template v-if="score !== null"> · Nota: <strong>{{ score.toFixed(1) }}</strong></template>
          <p class="mt-3">Una vez emitido, el concepto no se puede modificar. ¿Desea continuar?</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmOpen = false">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" :loading="saving" @click="submit">Emitir</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>
