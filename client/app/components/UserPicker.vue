<script setup lang="ts">
import { Role } from '@thesis/shared';
import type { User } from '~/types/api';
import { usersApi } from '~/utils/api';
import { fullName } from '~/utils/i18n';

/**
 * Searchable user picker: faculty (advisors, jurors) or students. Faculty show whether they
 * are Unicórdoba (interno) or from another institution (externo), in the list and in the chips.
 */
const model = defineModel<string | string[] | null>({ default: null });
const props = withDefaults(
  defineProps<{ source: 'faculty' | 'students'; label: string; multiple?: boolean; excludeIds?: string[]; max?: number; hint?: string }>(),
  { multiple: false, excludeIds: () => [], max: undefined, hint: undefined },
);

const isInternal = (u: User) => u.jurorProfile?.isUnicordoba ?? !u.roles.includes(Role.EXTERNAL_JUROR);
const originLabel = (u: User) => (isInternal(u) ? 'Interno' : 'Externo');
const subtitle = (u: User) =>
  props.source === 'faculty' ? `${u.email} · ${u.jurorProfile?.institution ?? (isInternal(u) ? 'Universidad de Córdoba' : 'Sin institución')}` : u.email;
const full = computed(() => !!props.max && Array.isArray(model.value) && model.value.length >= props.max);
const itemProps = (u: User) => ({
  disabled: full.value && Array.isArray(model.value) && !model.value.includes(u.id),
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
    :item-props="itemProps"
    item-value="id"
    :label="label"
    :hint="hint"
    :persistent-hint="!!hint"
    :multiple="multiple"
    :chips="multiple"
    :closable-chips="multiple"
    :loading="loading"
    no-filter
    clearable
    no-data-text="Sin resultados"
  >
    <template #item="{ props: p, item }">
      <v-list-item v-bind="p" :subtitle="subtitle(item.raw)">
        <template v-if="source === 'faculty'" #append>
          <v-chip :color="isInternal(item.raw) ? 'primary' : 'secondary'" variant="tonal" size="x-small">{{ originLabel(item.raw) }}</v-chip>
        </template>
      </v-list-item>
    </template>
    <template v-if="source === 'faculty'" #chip="{ props: cp, item }">
      <v-chip v-bind="cp">
        <span :class="['origin mr-1', isInternal(item.raw) ? 'text-primary' : 'text-secondary']">{{ originLabel(item.raw) }} ·</span>
        {{ fullName(item.raw) }}
      </v-chip>
    </template>
    <template v-if="source === 'faculty' && !multiple" #selection="{ item }">
      <span class="text-truncate">
        <span :class="['origin mr-1', isInternal(item.raw) ? 'text-primary' : 'text-secondary']">{{ originLabel(item.raw) }} ·</span>
        {{ fullName(item.raw) }}
      </span>
    </template>
  </v-autocomplete>
</template>

<style scoped>
.origin { font-size: 11px; font-weight: 700; }
</style>
