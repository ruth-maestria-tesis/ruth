<script setup lang="ts">
import type { JurorInput, NewExternalJuror, User } from '~/types/api';
import { usersApi } from '~/utils/api';
import { fullName } from '~/utils/i18n';

/**
 * Picks an existing faculty juror (GET /users/faculty) or, when `allowExternal`,
 * describes a new external juror created inline (RF-C14).
 */
const model = defineModel<JurorInput | null>({ default: null });
const props = withDefaults(defineProps<{ label: string; allowExternal?: boolean; error?: string | null; excludeIds?: string[] }>(), {
  allowExternal: true,
  error: null,
  excludeIds: () => [],
});
const emit = defineEmits<{ selected: [user: User | null] }>();

const isExternal = ref(!!model.value?.newExternal);
const search = ref('');
const loading = ref(false);
const options = ref<User[]>([]);
const selected = ref<User | null>(null);
const ext = reactive<NewExternalJuror>({
  email: '', firstName: '', lastName: '', institution: '', highestDegree: '', country: 'Colombia',
});

let timer: ReturnType<typeof setTimeout> | undefined;
async function load(q?: string) {
  loading.value = true;
  try {
    options.value = (await usersApi.faculty(q || undefined)).filter((u) => !props.excludeIds.includes(u.id));
  } catch {
    options.value = [];
  } finally {
    loading.value = false;
  }
}
watch(search, (q) => {
  clearTimeout(timer);
  timer = setTimeout(() => load(q), 300);
});
onMounted(() => load());

const extComplete = computed(() =>
  Object.values(ext).every((v) => v.trim().length > 0) && /.+@.+\..+/.test(ext.email),
);

function sync() {
  if (isExternal.value) {
    model.value = extComplete.value ? { newExternal: { ...ext, email: ext.email.trim() } } : null;
    emit('selected', null);
  } else {
    model.value = selected.value ? { jurorId: selected.value.id } : null;
    emit('selected', selected.value);
  }
}
watch([isExternal, selected], sync);
watch(ext, sync, { deep: true });

const itemTitle = (u: User) => fullName(u);
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-2">
      <div class="font-weight-semibold text-body-1">{{ label }}</div>
      <v-switch v-if="allowExternal" v-model="isExternal" color="primary" label="Jurado externo nuevo" density="compact" hide-details inset />
    </div>
    <v-autocomplete
      v-if="!isExternal"
      v-model="selected"
      v-model:search="search"
      :items="options"
      :item-title="itemTitle"
      return-object
      :loading="loading"
      label="Buscar docente por nombre, correo o institución"
      prepend-inner-icon="mdi-account-search-outline"
      no-filter
      clearable
      :error-messages="error ? [error] : []"
      no-data-text="Sin resultados"
    >
      <template #item="{ props: p, item }">
        <v-list-item v-bind="p" :subtitle="`${item.raw.email} · ${item.raw.jurorProfile?.institution ?? 'Sin institución'}`">
          <template #append>
            <v-chip v-if="item.raw.jurorProfile?.isUnicordoba" color="primary" variant="tonal" size="x-small">Unicórdoba</v-chip>
            <v-chip v-else color="info" variant="tonal" size="x-small">Externo</v-chip>
          </template>
        </v-list-item>
      </template>
    </v-autocomplete>
    <div v-else>
      <v-row dense>
        <v-col cols="6"><v-text-field v-model="ext.firstName" label="Nombres" /></v-col>
        <v-col cols="6"><v-text-field v-model="ext.lastName" label="Apellidos" /></v-col>
        <v-col cols="12"><v-text-field v-model="ext.email" label="Correo electrónico" type="email" /></v-col>
        <v-col cols="12"><v-text-field v-model="ext.institution" label="Institución de origen" /></v-col>
        <v-col cols="6"><v-text-field v-model="ext.highestDegree" label="Máximo título (p. ej. Doctorado)" /></v-col>
        <v-col cols="6"><v-text-field v-model="ext.country" label="País" /></v-col>
      </v-row>
      <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
    </div>
  </div>
</template>
