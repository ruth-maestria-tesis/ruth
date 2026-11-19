<script setup lang="ts">
import { Role } from '@thesis/shared';
import type { User } from '~/types/api';
import { usersApi } from '~/utils/api';
import { fullName } from '~/utils/i18n';

/** Searchable user picker: faculty (advisors, jurors) or students. */
const model = defineModel<string | string[] | null>({ default: null });
const props = withDefaults(defineProps<{ source: 'faculty' | 'students'; label: string; multiple?: boolean; excludeIds?: string[] }>(), {
  multiple: false,
  excludeIds: () => [],
});

const search = ref('');
const loading = ref(false);
const options = ref<User[]>([]);
const known = new Map<string, User>();

async function load(q?: string) {
  loading.value = true;
  try {
    const list = props.source === 'faculty' ? await usersApi.faculty(q || undefined) : (await usersApi.list({ role: Role.STUDENT, q: q || undefined, limit: 20 })).items;
    list.forEach((u) => known.set(u.id, u));
    const selectedIds = Array.isArray(model.value) ? model.value : model.value ? [model.value] : [];
    const kept = selectedIds.map((id) => known.get(id)).filter((u): u is User => !!u);
    options.value = [...kept, ...list.filter((u) => !selectedIds.includes(u.id) && !props.excludeIds.includes(u.id))];
  } catch {
    options.value = [];
  } finally {
    loading.value = false;
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch(search, (q) => {
  clearTimeout(timer);
  timer = setTimeout(() => load(q), 300);
});
onMounted(() => load());
</script>

<template>
  <v-autocomplete
    v-model="model"
    v-model:search="search"
    :items="options"
    :item-title="(u: User) => fullName(u)"
    item-value="id"
    :label="label"
    :multiple="multiple"
    :chips="multiple"
    :closable-chips="multiple"
    :loading="loading"
    no-filter
    clearable
    no-data-text="Sin resultados"
  >
    <template #item="{ props: p, item }">
      <v-list-item v-bind="p" :subtitle="item.raw.email" />
    </template>
  </v-autocomplete>
</template>
