<script setup lang="ts">
import { Role } from '@thesis/shared';
import type { Evaluation } from '~/types/api';
import { evaluationsApi, thesesApi } from '~/utils/api';
import { downloadFile } from '~/utils/http';
import { VERDICT_LABELS, formatDate, fullName } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

definePageMeta({ middleware: 'role', roles: [Role.STUDENT] });
const ui = useUiStore();
const { thesis, summary, loading, load } = useMyThesis();
const { programName } = useCatalogs();
const evaluations = ref<Evaluation[]>([]);
const file = ref<File | File[] | null>(null);
const uploading = ref(false);

onMounted(async () => {
  await load();
  if (thesis.value) evaluations.value = await evaluationsApi.forThesis(thesis.value.id).catch(() => []);
});
async function upload() {
  const f = Array.isArray(file.value) ? file.value[0] : file.value;
  if (!f || !thesis.value) return;
  uploading.value = true;
  try {
    thesis.value = await thesesApi.uploadManuscript(thesis.value.id, f);
    file.value = null;
    ui.notify('Nueva versión del manuscrito cargada.');
  } catch (e) {
    ui.error(e);
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div>
    <div class="text-h1-module mb-1">Estado de mi tesis</div>
    <div class="text-body-2 text-medium-emphasis mb-4">Avance, conceptos de los jurados y trazabilidad</div>
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <v-alert v-else-if="!thesis" type="info" variant="tonal">Aún no tiene una tesis radicada. Contacte a la coordinación del programa.</v-alert>
    <template v-if="thesis && summary">
      <v-card class="pa-5 mb-4">
        <div class="d-flex flex-wrap align-center ga-3">
          <div class="flex-grow-1">
            <div class="text-meta">{{ thesis.code }} · {{ programName(thesis.programId) }}</div>
            <div class="text-h2-section">{{ thesis.title }}</div>
          </div>
          <ThesisStatusChip :status="thesis.status" />
        </div>
        <div class="mt-4">
          <div class="d-flex mb-1"><span class="text-body-2 font-weight-medium">Avance del proceso (RF-P02)</span><v-spacer /><strong>{{ thesis.progress }}%</strong></div>
          <v-progress-linear :model-value="thesis.progress" color="primary" height="12" rounded />
        </div>
      </v-card>

      <v-row>
        <v-col cols="12" lg="6">
          <v-card class="pa-4 h-100">
            <div class="text-h2-section mb-3">Conceptos de los jurados</div>
            <div v-if="!evaluations.length" class="text-body-2 text-medium-emphasis">Aún no hay conceptos emitidos.</div>
            <v-sheet v-for="e in evaluations" :key="e.id" border class="pa-3 mb-2 rounded-lg">
              <div class="d-flex align-center ga-2">
                <strong>{{ e.juror ? fullName(e.juror) : 'Jurado' }}</strong>
                <v-spacer />
                <v-chip :color="e.verdict === 'REJECTED' ? 'error' : 'success'" variant="tonal">{{ e.verdict ? VERDICT_LABELS[e.verdict] : '—' }}</v-chip>
              </div>
              <div class="text-meta mb-1">Emitido {{ formatDate(e.submittedAt) }} · Nota {{ e.score?.toFixed(1) ?? '—' }}</div>
              <div class="text-body-2">{{ e.comments }}</div>
              <v-chip
                v-for="f in e.correctionFiles"
                :key="f.fileId"
                class="mt-2 mr-1"
                prepend-icon="mdi-download"
                variant="outlined"
                @click="downloadFile(evaluationsApi.filePath(e.id, f.fileId), f.fileName)"
              >
                {{ f.fileName }}
              </v-chip>
            </v-sheet>
            <v-btn class="mt-2" variant="outlined" prepend-icon="mdi-message-text-outline" to="/student/feedback">Ver observaciones por capítulo</v-btn>
          </v-card>
        </v-col>
        <v-col cols="12" lg="6">
          <v-card class="pa-4 h-100">
            <div class="text-h2-section mb-3">Manuscrito</div>
            <v-list v-if="thesis.manuscripts.length" density="compact">
              <v-list-item v-for="m in [...thesis.manuscripts].reverse()" :key="m.fileId" prepend-icon="mdi-file-pdf-box" :title="`v${m.version} — ${m.fileName}`" :subtitle="formatDate(m.uploadedAt, true)">
                <template #append>
                  <v-btn icon="mdi-download" variant="text" size="small" @click="downloadFile(thesesApi.manuscriptPath(thesis.id, m.fileId), m.fileName)" />
                </template>
              </v-list-item>
            </v-list>
            <div class="d-flex ga-2 align-start mt-2">
              <v-file-input v-model="file" label="Cargar nueva versión (PDF)" accept="application/pdf" prepend-icon="" prepend-inner-icon="mdi-upload" hide-details show-size />
              <v-btn color="primary" :disabled="!file" :loading="uploading" height="48" @click="upload">Subir</v-btn>
            </div>
          </v-card>
        </v-col>
      </v-row>
      <div class="mt-4"><TraceabilityGraph :thesis="thesis" /></div>
    </template>
  </div>
</template>
