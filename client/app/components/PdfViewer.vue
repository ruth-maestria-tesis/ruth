<script setup lang="ts">
import { downloadFile, fetchBlobUrl } from '~/utils/http';

/** Authenticated PDF viewer (cookies), rendered by the browser's built-in viewer. */
const props = defineProps<{ path: string | null; fileName?: string; title?: string }>();
const url = ref<string | null>(null);
const loading = ref(false);
const failed = ref(false);

async function load() {
  if (url.value) URL.revokeObjectURL(url.value);
  url.value = null;
  failed.value = false;
  if (!props.path) return;
  loading.value = true;
  try {
    url.value = await fetchBlobUrl(props.path);
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}
watch(() => props.path, load, { immediate: true });
onBeforeUnmount(() => url.value && URL.revokeObjectURL(url.value));
</script>

<template>
  <div class="pdf-shell d-flex flex-column h-100">
    <div class="d-flex align-center px-3 py-2 text-white" style="background: #1e293b; border-radius: 10px 10px 0 0">
      <v-icon icon="mdi-file-pdf-box" class="mr-2" />
      <span class="text-body-2 font-weight-medium">{{ title ?? 'Visor de manuscrito oficial (PDF)' }}</span>
      <v-spacer />
      <v-btn v-if="path" size="small" variant="outlined" color="white" prepend-icon="mdi-download" @click="downloadFile(path, fileName ?? 'manuscrito.pdf')">Descargar</v-btn>
    </div>
    <div class="flex-grow-1 d-flex" style="background: #334155; border-radius: 0 0 10px 10px; min-height: 480px">
      <iframe v-if="url" :src="url" class="pdf-frame" title="Manuscrito" />
      <div v-else class="ma-auto text-center text-white pa-6">
        <v-progress-circular v-if="loading" indeterminate />
        <template v-else-if="failed">
          <v-icon icon="mdi-file-alert-outline" size="48" />
          <div class="mt-2">No se pudo cargar el manuscrito.</div>
        </template>
        <template v-else>
          <v-icon icon="mdi-file-hidden" size="48" />
          <div class="mt-2">No hay manuscrito disponible.</div>
        </template>
      </div>
    </div>
  </div>
</template>
