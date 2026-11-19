<script setup lang="ts">
import type { ExternalLink } from '~/types/api';
import { formatDate } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

/** RF-J14: there is no e-mail delivery, so the coordinator copies the link and sends it. */
const open = defineModel<boolean>({ default: false });
defineProps<{ links: ExternalLink[] }>();
const ui = useUiStore();
async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    ui.notify('Enlace copiado al portapapeles.');
  } catch {
    ui.notify('No se pudo copiar; seleccione el enlace manualmente.', 'warning');
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="640">
    <v-card title="Enlaces de acceso para jurados externos">
      <v-card-text>
        <v-alert type="info" variant="tonal" density="compact" class="mb-3">
          Envíe este enlace al jurado externo por correo. Generar uno nuevo invalida el anterior.
        </v-alert>
        <div v-for="l in links" :key="l.assignmentId" class="mb-3">
          <v-text-field :model-value="l.url" readonly class="mono" :hint="`Vence: ${formatDate(l.expiresAt, true)}`" persistent-hint>
            <template #append-inner>
              <v-btn icon="mdi-content-copy" variant="text" size="small" @click="copy(l.url)" />
            </template>
          </v-text-field>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" variant="flat" @click="open = false">Listo</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
