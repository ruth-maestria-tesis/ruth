<script setup lang="ts">
import { FeedbackAction, FeedbackChapter, FeedbackStatus } from '@thesis/shared';
import type { FeedbackItem } from '~/types/api';
import { feedbackApi } from '~/utils/api';
import { CHAPTER_LABELS, FEEDBACK_STATUS_COLORS, FEEDBACK_STATUS_LABELS, ROLE_LABELS, formatDate, fullName } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

/**
 * CU-06 thread per chapter with RN-06 rules per role:
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

const chapter = ref<FeedbackChapter | 'ALL'>('ALL');
const items = ref<FeedbackItem[]>([]);
const loading = ref(true);
const newItem = reactive({ chapter: FeedbackChapter.METHODOLOGY, reference: '', content: '' });
const creating = ref(false);
const reply = ref<{ item: FeedbackItem; action: FeedbackAction } | null>(null);
const replyText = ref('');
const sending = ref(false);

const chapters = Object.values(FeedbackChapter);
const visible = computed(() => (chapter.value === 'ALL' ? items.value : items.value.filter((i) => i.chapter === chapter.value)));
const countFor = (c: FeedbackChapter) => items.value.filter((i) => i.chapter === c).length;
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
    await feedbackApi.create(
      props.thesisId,
      { chapter: newItem.chapter, reference: newItem.reference.trim() || undefined, content: newItem.content.trim() },
      actor.value,
    );
    newItem.content = '';
    newItem.reference = '';
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
        <div class="text-h2-section d-flex align-center ga-2"><v-icon icon="mdi-message-text-outline" color="primary" /> Observaciones por capítulo (CU-06)</div>
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

    <v-tabs v-model="chapter" color="primary" show-arrows class="mb-3">
      <v-tab value="ALL">Todas ({{ items.length }})</v-tab>
      <v-tab v-for="c in chapters" :key="c" :value="c">{{ CHAPTER_LABELS[c] }} ({{ countFor(c) }})</v-tab>
    </v-tabs>

    <v-sheet v-if="mode === 'juror' && canCreate" border class="pa-3 mb-4 rounded-lg">
      <div class="font-weight-medium mb-2">Nueva observación</div>
      <v-row dense>
        <v-col cols="12" md="4"><v-select v-model="newItem.chapter" :items="chapters.map((c) => ({ value: c, title: CHAPTER_LABELS[c] }))" label="Capítulo" hide-details /></v-col>
        <v-col cols="12" md="8"><v-text-field v-model="newItem.reference" label="Referencia (página o párrafo)" hide-details /></v-col>
        <v-col cols="12"><v-textarea v-model="newItem.content" label="Requerimiento" rows="2" auto-grow hide-details /></v-col>
      </v-row>
      <div class="d-flex justify-end mt-2">
        <v-btn color="primary" :disabled="!newItem.content.trim()" :loading="creating" prepend-icon="mdi-plus" @click="create">Registrar observación</v-btn>
      </div>
    </v-sheet>

    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <div v-else-if="!visible.length" class="text-medium-emphasis text-body-2 pa-4">No hay observaciones en este capítulo.</div>

    <v-timeline v-else side="end" density="compact" align="start" truncate-line="both">
      <v-timeline-item v-for="i in visible" :key="i.id" :dot-color="FEEDBACK_STATUS_COLORS[i.status]" size="small">
        <v-card class="pa-3 mb-2" style="min-width: 280px">
          <div class="d-flex flex-wrap align-center ga-2 mb-1">
            <strong>{{ jurorName(i) }}</strong>
            <span class="text-meta">{{ formatDate(i.createdAt, true) }} · {{ CHAPTER_LABELS[i.chapter] }}<template v-if="i.reference"> · {{ i.reference }}</template></span>
            <v-spacer />
            <v-chip :color="FEEDBACK_STATUS_COLORS[i.status]" variant="tonal">{{ FEEDBACK_STATUS_LABELS[i.status] }}</v-chip>
          </div>
          <div class="text-body-2 mb-2">{{ i.content }}</div>
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
      </v-timeline-item>
    </v-timeline>

    <v-dialog :model-value="!!reply" max-width="520" @update:model-value="(v: boolean) => !v && (reply = null)">
      <v-card v-if="reply" :title="ACTION_TEXT[reply.action]">
        <v-card-text>
          <div class="text-body-2 mb-3 text-medium-emphasis">{{ reply.item.content }}</div>
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
