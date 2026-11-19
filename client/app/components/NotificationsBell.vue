<script setup lang="ts">
import type { AppNotification } from '~/types/api';
import { notificationsApi } from '~/utils/api';
import { formatDate } from '~/utils/i18n';

const items = ref<AppNotification[]>([]);
const unread = ref(0);
const open = ref(false);

async function refreshCount() {
  try {
    unread.value = (await notificationsApi.unreadCount()).count;
  } catch {
    /* bell is best effort */
  }
}
async function load() {
  try {
    items.value = await notificationsApi.list();
  } catch {
    items.value = [];
  }
}
async function markRead(n: AppNotification) {
  if (!n.readAt) {
    await notificationsApi.read(n.id);
    n.readAt = new Date().toISOString();
    unread.value = Math.max(0, unread.value - 1);
  }
  if (n.link) navigateTo(n.link);
}
async function markAll() {
  await notificationsApi.readAll();
  items.value.forEach((n) => (n.readAt ??= new Date().toISOString()));
  unread.value = 0;
}
watch(open, (v) => v && load());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  refreshCount();
  timer = setInterval(refreshCount, 60_000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <v-menu v-model="open" :close-on-content-click="false" location="bottom end" max-width="380">
    <template #activator="{ props }">
      <v-btn v-bind="props" icon variant="text" color="white" aria-label="Notificaciones">
        <v-badge :content="unread" :model-value="unread > 0" color="secondary">
          <v-icon icon="mdi-bell-outline" />
        </v-badge>
      </v-btn>
    </template>
    <v-card min-width="340">
      <v-card-title class="d-flex align-center text-body-1 font-weight-bold">
        Notificaciones
        <v-spacer />
        <v-btn size="small" variant="text" :disabled="!unread" @click="markAll">Marcar todas como leídas</v-btn>
      </v-card-title>
      <v-divider />
      <v-list v-if="items.length" density="compact" max-height="420" class="overflow-y-auto">
        <v-list-item v-for="n in items" :key="n.id" :class="{ 'bg-green-lighten-5': !n.readAt }" @click="markRead(n)">
          <v-list-item-title class="font-weight-medium">{{ n.title }}</v-list-item-title>
          <div class="text-body-2">{{ n.body }}</div>
          <div class="text-meta">{{ formatDate(n.createdAt, true) }}</div>
        </v-list-item>
      </v-list>
      <v-card-text v-else class="text-medium-emphasis">No tiene notificaciones.</v-card-text>
    </v-card>
  </v-menu>
</template>
