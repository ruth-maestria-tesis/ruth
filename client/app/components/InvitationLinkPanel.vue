<script setup lang="ts">
import type { Assignment, ExternalLink } from '~/types/api';
import { assignmentsApi } from '~/utils/api';
import { formatDate, fullName } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

/**
 * RF-J14 invitation for a juror without a password: shows whether a link is active and
 * generates one. The link is only shown when generated, so a lost link means a new one,
 * which stops the previous one from working.
 */
const props = defineProps<{ assignment: Assignment }>();
const emit = defineEmits<{ generated: [link: ExternalLink] }>();
const ui = useUiStore();

const busy = ref(false);
const confirmOpen = ref(false);
const active = computed(
  () => props.assignment.hasExternalLink && (!props.assignment.externalLinkExpiresAt || new Date(props.assignment.externalLinkExpiresAt) > new Date()),
);

function ask() {
  if (active.value) confirmOpen.value = true;
  else generate();
}
async function generate() {
  confirmOpen.value = false;
  busy.value = true;
  try {
    emit('generated', await assignmentsApi.externalLink(props.assignment.id));
  } catch (e) {
    ui.error(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="invite mt-3 pa-3">
    <div class="d-flex flex-wrap align-center ga-3">
      <div class="invite-icon"><v-icon icon="mdi-email-fast-outline" size="20" /></div>
      <div class="flex-grow-1" style="min-width: 160px">
        <div class="text-body-2 font-weight-bold">Enlace de invitación</div>
        <div class="text-meta">
          <template v-if="active">
            Activo{{ assignment.externalLinkExpiresAt ? ` · vence el ${formatDate(assignment.externalLinkExpiresAt)}` : '' }}
          </template>
          <template v-else-if="assignment.hasExternalLink">Vencido: genere uno nuevo</template>
          <template v-else>Aún no se ha generado</template>
        </div>
      </div>
      <v-btn size="small" color="primary" :variant="active ? 'tonal' : 'flat'" prepend-icon="mdi-link-variant-plus" :loading="busy" @click="ask">
        {{ active ? 'Generar nuevo enlace' : 'Generar enlace' }}
      </v-btn>
    </div>

    <v-dialog v-model="confirmOpen" max-width="460">
      <v-card title="¿Generar un enlace nuevo?">
        <v-card-text>
          El enlace que ya tiene {{ fullName(assignment.juror) }} dejará de funcionar. Úselo si el jurado perdió el enlace o
          si venció. Por seguridad el enlace anterior no se puede volver a mostrar.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmOpen = false">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" @click="generate">Generar nuevo enlace</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.invite { border-radius: 12px; background: rgba(var(--v-theme-primary), 0.06); border: 1px dashed rgba(var(--v-theme-primary), 0.35); }
.invite-icon {
  width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
  background: rgba(var(--v-theme-primary), 0.14); color: rgb(var(--v-theme-primary));
}
</style>
