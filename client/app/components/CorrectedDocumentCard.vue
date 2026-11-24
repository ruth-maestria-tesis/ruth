<script setup lang="ts">
import { EvaluationStatus, ThesisStatus } from '@thesis/shared';
import type { Assignment, Evaluation, Thesis } from '~/types/api';
import { evaluationsApi, thesesApi } from '~/utils/api';
import { downloadFile } from '~/utils/http';
import { formatDate } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

/**
 * Juror flow on the whole document: 1) download the full manuscript (it is not shown on
 * screen), 2) upload that same document with the corrections (PDF or Word). Uploads stay
 * open after the verdict while the thesis is under evaluation or revision.
 */
const props = defineProps<{ assignment: Assignment; thesis: Thesis | null }>();
const ui = useUiStore();

const OPEN_AFTER_SUBMIT: readonly string[] = [ThesisStatus.UNDER_EVALUATION, ThesisStatus.IN_DISPUTE, ThesisStatus.REVISIONS_IN_PROGRESS];

const evaluation = ref<Evaluation | null>(null);
const file = ref<File | File[] | null>(null);
const downloading = ref(false);
const uploading = ref(false);
const progress = ref<number | null>(null);

const manuscript = computed(() => props.thesis?.manuscripts.find((m) => m.fileId === props.thesis?.currentManuscriptId));
const pdfPath = computed(() => (props.thesis && manuscript.value ? thesesApi.manuscriptPath(props.thesis.id, manuscript.value.fileId) : null));
const files = computed(() => [...(evaluation.value?.correctionFiles ?? [])].reverse());
const canUpload = computed(
  () => !evaluation.value || evaluation.value.status === EvaluationStatus.DRAFT || OPEN_AFTER_SUBMIT.includes(props.thesis?.status ?? ''),
);
/** The student uploaded a newer manuscript after the juror's last corrected document. */
const newerManuscript = computed(() => {
  const last = files.value[0]?.manuscriptVersion;
  return !!manuscript.value && !!last && manuscript.value.version > last;
});

onMounted(async () => {
  try {
    evaluation.value = await evaluationsApi.forAssignment(props.assignment.id);
  } catch (e) {
    ui.error(e);
  }
});

async function download() {
  if (!pdfPath.value) return;
  downloading.value = true;
  try {
    await downloadFile(pdfPath.value, manuscript.value?.fileName ?? 'manuscrito.pdf');
  } catch (e) {
    ui.error(e);
  } finally {
    downloading.value = false;
  }
}

async function upload() {
  const f = Array.isArray(file.value) ? file.value[0] : file.value;
  if (!f) return;
  uploading.value = true;
  try {
    // Corrections hang off the juror's evaluation: create the draft if there is none yet.
    const ev = evaluation.value ?? (await evaluationsApi.saveDraft(props.assignment.id, props.assignment.thesisId, { comments: '' }));
    evaluation.value = await evaluationsApi.uploadCorrection(ev.id, f, (p) => (progress.value = p));
    file.value = null;
    ui.notify('Documento corregido cargado. El estudiante podrá descargarlo cuando el concepto esté emitido.');
  } catch (e) {
    ui.error(e);
  } finally {
    uploading.value = false;
    progress.value = null;
  }
}
</script>

<template>
  <v-card class="pa-4 mb-4">
    <div class="text-h2-section d-flex align-center ga-2 mb-3">
      <v-icon icon="mdi-file-document-edit-outline" color="primary" /> Documento completo y correcciones
    </div>

    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <v-avatar color="primary" size="28" class="text-body-2">1</v-avatar>
      <div>
        <div class="font-weight-medium">Descargar el documento completo</div>
        <div v-if="manuscript" class="text-body-2 text-medium-emphasis">
          {{ manuscript.fileName }} · versión {{ manuscript.version }} · cargado el {{ formatDate(manuscript.uploadedAt, true) }}
        </div>
        <div v-else class="text-body-2 text-medium-emphasis">No hay manuscrito disponible.</div>
      </div>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-download" :disabled="!pdfPath" :loading="downloading" @click="download">Descargar documento completo (PDF)</v-btn>
    </div>

    <div class="d-flex flex-wrap align-start ga-3">
      <v-avatar color="primary" size="28" class="text-body-2">2</v-avatar>
      <div class="flex-grow-1">
        <div class="font-weight-medium">Subir el mismo documento con sus correcciones</div>
        <div class="text-body-2 text-medium-emphasis mb-2">PDF anotado o Word con control de cambios. Puede subir varias versiones; la más reciente es la vigente.</div>
        <v-alert v-if="newerManuscript" type="info" variant="tonal" density="compact" class="mb-2">
          El estudiante cargó una versión nueva del manuscrito (v{{ manuscript!.version }}) después de su última corrección.
        </v-alert>
        <div v-if="canUpload" class="d-flex flex-wrap ga-2 align-center">
          <v-file-input
            v-model="file"
            label="Documento corregido (PDF o Word)"
            accept=".pdf,.doc,.docx"
            prepend-icon=""
            prepend-inner-icon="mdi-upload"
            show-size
            hide-details
            style="min-width: 260px"
          />
          <v-btn color="primary" variant="flat" height="48" :disabled="!file" :loading="uploading" @click="upload">Subir corrección</v-btn>
        </div>
        <v-alert v-else type="warning" variant="tonal" density="compact">La etapa de evaluación y subsanación terminó; ya no se reciben documentos corregidos.</v-alert>
        <v-progress-linear v-if="progress !== null" :model-value="progress" color="primary" height="6" rounded class="mt-2" />

        <v-list v-if="files.length" density="compact" class="mt-2">
          <v-list-item
            v-for="(f, i) in files"
            :key="f.fileId"
            prepend-icon="mdi-paperclip"
            :title="f.fileName"
            :subtitle="`${formatDate(f.uploadedAt, true)}${f.manuscriptVersion ? ` · sobre la versión ${f.manuscriptVersion}` : ''}${i === 0 ? ' · vigente' : ''}`"
            @click="downloadFile(evaluationsApi.filePath(evaluation!.id, f.fileId), f.fileName)"
          >
            <template #append><v-icon icon="mdi-download" size="small" /></template>
          </v-list-item>
        </v-list>
      </div>
    </div>
  </v-card>
</template>
