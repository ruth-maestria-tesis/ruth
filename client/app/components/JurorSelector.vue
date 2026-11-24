<script setup lang="ts">
import type { JurorCandidate, JurorInput, NewExternalJuror, User } from '~/types/api';
import { assignmentsApi, usersApi } from '~/utils/api';
import { fullName } from '~/utils/i18n';

/**
 * Picks a registered juror or registers a new one inline (RF-C14), Unicórdoba or external.
 * With `thesisId`, the list is ranked for that thesis: expertise ↔ keywords, current load,
 * and RN-01 conflicts shown disabled (GET /theses/:id/juror-candidates).
 */
const model = defineModel<JurorInput | null>({ default: null });
const props = withDefaults(
  defineProps<{ label: string; allowExternal?: boolean; error?: string | null; excludeIds?: string[]; thesisId?: string }>(),
  {
    allowExternal: true,
    error: null,
    excludeIds: () => [],
    thesisId: undefined,
  },
);
const emit = defineEmits<{ selected: [user: User | null] }>();

const isNew = ref(!!model.value?.newExternal);
const search = ref('');
const loading = ref(false);
const options = ref<(User | JurorCandidate)[]>([]);
const selected = ref<User | null>(null);
const ext = reactive<Required<NewExternalJuror>>({
  email: '', firstName: '', lastName: '', institution: '', highestDegree: '', country: 'Colombia', isUnicordoba: false,
});

const CONFLICT_LABELS: Record<NonNullable<JurorCandidate['conflict']>, string> = {
  PARTY: 'Conflicto: es parte de la tesis',
  PREVIOUS_JUROR: 'Ya fue jurado de esta tesis',
};
const asCandidate = (u: User | JurorCandidate): JurorCandidate | null => ('affinity' in u ? u : null);

let timer: ReturnType<typeof setTimeout> | undefined;
async function load(q?: string) {
  loading.value = true;
  try {
    const list = props.thesisId ? await assignmentsApi.candidates(props.thesisId, q || undefined) : await usersApi.faculty(q || undefined);
    options.value = list.filter((u) => !props.excludeIds.includes(u.id));
  } catch {
    options.value = [];
  } finally {
    loading.value = false;
  }
}
watch(search, (q) => {
  // Vuetify sets the search text to the chosen item's title: no need to search for it.
  if (selected.value && q === fullName(selected.value)) return;
  clearTimeout(timer);
  timer = setTimeout(() => load(q), 300);
});
onMounted(() => load());

watch(
  () => ext.isUnicordoba,
  (unicor) => {
    if (unicor && !ext.institution.trim()) ext.institution = 'Universidad de Córdoba';
    if (unicor) ext.country = 'Colombia';
  },
);

const extComplete = computed(() =>
  Object.entries(ext).every(([k, v]) => k === 'isUnicordoba' || String(v).trim().length > 0) && /.+@.+\..+/.test(ext.email),
);

function sync() {
  if (isNew.value) {
    model.value = extComplete.value ? { newExternal: { ...ext, email: ext.email.trim() } } : null;
    emit('selected', null);
  } else {
    model.value = selected.value ? { jurorId: selected.value.id } : null;
    emit('selected', selected.value);
  }
}
watch([isNew, selected], sync);
watch(ext, sync, { deep: true });

const itemTitle = (u: User) => fullName(u);
const itemProps = (u: User | JurorCandidate) => ({ disabled: !!asCandidate(u)?.conflict });
</script>

<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-2">
      <div class="font-weight-semibold text-body-1">{{ label }}</div>
      <v-switch v-if="allowExternal" v-model="isNew" color="primary" label="Registrar jurado nuevo" density="compact" hide-details inset />
    </div>
    <v-autocomplete
      v-if="!isNew"
      v-model="selected"
      v-model:search="search"
      :items="options"
      :item-title="itemTitle"
      :item-props="itemProps"
      return-object
      :loading="loading"
      :label="thesisId ? 'Jurados sugeridos para este trabajo · buscar por nombre, correo o institución' : 'Buscar docente por nombre, correo o institución'"
      prepend-inner-icon="mdi-account-search-outline"
      no-filter
      clearable
      :error-messages="error ? [error] : []"
      no-data-text="Sin resultados. Puede registrar un jurado nuevo con el interruptor."
    >
      <template #item="{ props: p, item }">
        <v-list-item v-bind="p" :subtitle="`${item.raw.email} · ${item.raw.jurorProfile?.institution ?? 'Sin institución'}`">
          <template v-if="asCandidate(item.raw)" #default>
            <div class="d-flex flex-wrap ga-1 mt-1">
              <v-chip v-for="a in asCandidate(item.raw)!.affinity" :key="a" color="success" variant="tonal" size="x-small" prepend-icon="mdi-star-outline">{{ a }}</v-chip>
              <v-chip variant="outlined" size="x-small">{{ asCandidate(item.raw)!.activeAssignments }} asignación(es) activa(s)</v-chip>
              <v-chip v-if="asCandidate(item.raw)!.conflict" color="error" variant="tonal" size="x-small">{{ CONFLICT_LABELS[asCandidate(item.raw)!.conflict!] }}</v-chip>
            </div>
          </template>
          <template #append>
            <v-chip v-if="item.raw.jurorProfile?.isUnicordoba" color="primary" variant="tonal" size="x-small">Unicórdoba</v-chip>
            <v-chip v-else color="info" variant="tonal" size="x-small">Externo</v-chip>
          </template>
        </v-list-item>
      </template>
    </v-autocomplete>
    <div v-else>
      <v-checkbox v-model="ext.isUnicordoba" label="Docente de la Universidad de Córdoba" color="primary" density="compact" hide-details class="mb-2" />
      <v-row dense>
        <v-col cols="6"><v-text-field v-model="ext.firstName" label="Nombres" /></v-col>
        <v-col cols="6"><v-text-field v-model="ext.lastName" label="Apellidos" /></v-col>
        <v-col cols="12"><v-text-field v-model="ext.email" label="Correo electrónico" type="email" /></v-col>
        <v-col cols="12"><v-text-field v-model="ext.institution" label="Institución de origen" /></v-col>
        <v-col cols="6"><v-text-field v-model="ext.highestDegree" label="Máximo título (p. ej. Doctorado)" /></v-col>
        <v-col cols="6"><v-text-field v-model="ext.country" label="País" /></v-col>
      </v-row>
      <div class="text-caption text-medium-emphasis">El jurado nuevo recibe un enlace de acceso; no necesita contraseña.</div>
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-2">{{ error }}</v-alert>
    </div>
  </div>
</template>
