<script setup lang="ts">
import { FeedbackAction, FeedbackStatus } from '@thesis/shared';
import type { FeedbackItem } from '~/types/api';
import { feedbackApi } from '~/utils/api';
import { FEEDBACK_STATUS_COLORS, FEEDBACK_STATUS_LABELS, ROLE_LABELS, formatDate, fullName } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

/**
 * CU-06 feedback on the whole document, in a single section (no per-chapter split),
 * grouped by juror, with RN-06 rules per role:
 *  - juror: creates items; resolves or reopens their own ADDRESSED items;
 *  - student: addresses PENDING items;
 *  - coordinator: consolidated view, comments only.
 */
const props = withDefaults(defineProps<{ thesisId: string; mode: 'juror' | 'student' | 'coordinator'; canCreate?: boolean }>(), {
  canCreate: false,
});
const emit = defineEmits<{ changed: [] }>();
const ui = useUiStore();
const actor = useActor();

const items = ref<FeedbackItem[]>([]);
const loading = ref(true);
const newContent = ref('');
const creating = ref(false);
const reply = ref<{ item: FeedbackItem; action: FeedbackAction } | null>(null);
const replyText = ref('');
const sending = ref(false);

/** One block per juror, oldest observation first. */
const byJuror = computed(() => {
  const groups = new Map<string, FeedbackItem[]>();
  for (const i of [...items.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    groups.set(i.jurorId, [...(groups.get(i.jurorId) ?? []), i]);
  }
  return [...groups.values()];
});
const summary = computed(() => ({
  pending: items.value.filter((i) => i.status === FeedbackStatus.PENDING).length,
  addressed: items.value.filter((i) => i.status === FeedbackStatus.ADDRESSED).length,
  resolved: items.value.filter((i) => i.status === FeedbackStatus.RESOLVED).length,
}));

async function load() {
  loading.value = true;
  try {
    items.value = await feedbackApi.list(props.thesisId);
  } catch (e) {
    ui.error(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(() => props.thesisId, load);

async function create() {
  creating.value = true;
  try {
    await feedbackApi.create(props.thesisId, { content: newContent.value.trim() }, actor.value);
    newContent.value = '';
    ui.notify('Observación registrada.');
    await load();
  } catch (e) {
    ui.error(e);
  } finally {
    creating.value = false;
  }
}

const isAuthor = (i: FeedbackItem) => i.jurorId === actor.value.id;
const ACTION_TEXT: Record<FeedbackAction, string> = {
  [FeedbackAction.ADDRESS]: 'Responder y registrar corrección',
  [FeedbackAction.RESOLVE]: 'Aprobar subsanación',
  [FeedbackAction.REOPEN]: 'Reabrir observación',
  [FeedbackAction.COMMENT]: 'Comentar',
};
function open(item: FeedbackItem, action: FeedbackAction) {
  reply.value = { item, action };
  replyText.value = '';
}
const replyRequired = computed(() => reply.value?.action !== FeedbackAction.RESOLVE);
async function send() {
  if (!reply.value) return;
  sending.value = true;
  try {
    await feedbackApi.act(reply.value.item.id, reply.value.action, replyText.value.trim(), actor.value);
    reply.value = null;
    ui.notify('Observación actualizada.');
    await load();
    emit('changed');
  } catch (e) {
    ui.error(e);
  } finally {
    sending.value = false;
  }
}
const jurorName = (i: FeedbackItem) => (i.juror ? fullName(i.juror) : 'Jurado');
</script>

<template>
  <v-card class="pa-4">
    <div class="d-flex flex-wrap align-center ga-2 mb-3">
      <div>
        <div class="text-h2-section d-flex align-center ga-2"><v-icon icon="mdi-message-text-outline" color="primary" /> Observaciones sobre el documento completo (CU-06)</div>
        <div class="text-body-2 text-medium-emphasis">Pendiente → Atendida (estudiante) → Aprobada-Subsanada (jurado autor) — RN-06</div>
      </div>
      <v-spacer />
      <v-chip color="warning" variant="tonal">{{ summary.pending }} pendientes</v-chip>
      <v-chip color="info" variant="tonal">{{ summary.addressed }} atendidas</v-chip>
      <v-chip color="success" variant="tonal">{{ summary.resolved }} subsanadas</v-chip>
    </div>

    <v-alert v-if="mode === 'juror'" type="info" variant="tonal" density="compact" class="mb-3">
      Al aprobar la subsanación de la última observación pendiente se cierra la etapa de revisiones y el coordinador puede habilitar la sustentación.
    </v-alert>

    <v-sheet v-if="mode === 'juror' && canCreate" border class="pa-3 mb-4 rounded-lg">
      <div class="font-weight-medium mb-1">Observación general del documento</div>
      <div class="text-body-2 text-medium-emphasis mb-2">Escriba en un solo bloque sus observaciones sobre todo el trabajo. Puede citar páginas dentro del texto.</div>
      <v-textarea v-model="newContent" label="Observaciones sobre el documento completo" rows="8" auto-grow counter="20000" maxlength="20000" />
      <div class="d-flex justify-end mt-2">
        <v-btn color="primary" :disabled="!newContent.trim()" :loading="creating" prepend-icon="mdi-send" @click="create">Registrar observación</v-btn>
      </div>
    </v-sheet>

    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <div v-else-if="!items.length" class="text-medium-emphasis text-body-2 pa-4">Aún no hay observaciones.</div>

    <template v-else>
    <div v-for="group in byJuror" :key="group[0]!.jurorId" class="mb-4">
      <div class="d-flex align-center ga-2 mb-2">
        <v-icon icon="mdi-account-tie-outline" color="primary" />
        <strong>{{ jurorName(group[0]!) }}</strong>
      </div>
      <v-card v-for="i in group" :key="i.id" class="pa-3 mb-2" variant="outlined">
          <div class="d-flex flex-wrap align-center ga-2 mb-1">
            <span class="text-meta">{{ formatDate(i.createdAt, true) }}<template v-if="i.reference"> · {{ i.reference }}</template></span>
            <v-spacer />
            <v-chip :color="FEEDBACK_STATUS_COLORS[i.status]" variant="tonal">{{ FEEDBACK_STATUS_LABELS[i.status] }}</v-chip>
          </div>
          <div class="text-body-2 mb-2" style="white-space: pre-wrap">{{ i.content }}</div>
          <div v-for="(r, k) in i.replies" :key="k" class="pl-3 mb-1" style="border-left: 3px solid #e2e8f0">
            <div class="text-meta">{{ r.authorName ?? ROLE_LABELS[r.authorRole as keyof typeof ROLE_LABELS] }} · {{ formatDate(r.at, true) }}</div>
            <div class="text-body-2">{{ r.content || '—' }}</div>
          </div>
          <div class="d-flex flex-wrap ga-1 mt-2">
            <v-btn v-if="mode === 'student' && i.status === 'PENDING'" size="small" color="primary" prepend-icon="mdi-reply" @click="open(i, FeedbackAction.ADDRESS)">
              Responder y cargar corrección
            </v-btn>
            <template v-if="mode === 'juror' && isAuthor(i)">
              <v-btn size="small" color="success" prepend-icon="mdi-check" :disabled="i.status !== 'ADDRESSED'" @click="open(i, FeedbackAction.RESOLVE)">Aprobar subsanación</v-btn>
              <v-btn size="small" variant="outlined" color="warning" :disabled="i.status !== 'ADDRESSED'" @click="open(i, FeedbackAction.REOPEN)">Reabrir observación</v-btn>
            </template>
            <v-btn size="small" variant="text" prepend-icon="mdi-comment-outline" @click="open(i, FeedbackAction.COMMENT)">Comentar</v-btn>
          </div>
      </v-card>
    </div>
    </template>

    <v-dialog :model-value="!!reply" max-width="520" @update:model-value="(v: boolean) => !v && (reply = null)">
      <v-card v-if="reply" :title="ACTION_TEXT[reply.action]">
        <v-card-text>
          <div class="text-body-2 mb-3 text-medium-emphasis" style="white-space: pre-wrap; max-height: 200px; overflow-y: auto">{{ reply.item.content }}</div>
          <v-textarea
            v-model="replyText"
            :label="reply.action === 'ADDRESS' ? 'Justifique los cambios realizados' : replyRequired ? 'Mensaje' : 'Mensaje (opcional)'"
            rows="3"
            auto-grow
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="reply = null">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" :disabled="replyRequired && !replyText.trim()" :loading="sending" @click="send">Enviar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>
