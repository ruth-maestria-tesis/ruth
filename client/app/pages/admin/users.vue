<script setup lang="ts">
import { Role } from '@thesis/shared';
import type { User } from '~/types/api';
import { usersApi } from '~/utils/api';
import { ApiError } from '~/utils/http';
import { ROLE_LABELS, fullName } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

definePageMeta({ middleware: 'role', roles: [Role.ADMIN] });
const ui = useUiStore();
const items = ref<User[]>([]);
const total = ref(0);
const page = ref(1);
const q = ref('');
const role = ref<Role | null>(null);
const loading = ref(false);
const roleItems = Object.values(Role).map((r) => ({ value: r, title: ROLE_LABELS[r] }));
const headers = [
  { title: 'Nombre', key: 'name', sortable: false },
  { title: 'Correo', key: 'email', sortable: false },
  { title: 'Roles', key: 'roles', sortable: false },
  { title: 'Institución', key: 'institution', sortable: false },
  { title: 'Activo', key: 'isActive', sortable: false },
  { title: 'Acciones', key: 'actions', sortable: false, align: 'end' as const },
];

async function load() {
  loading.value = true;
  try {
    const r = await usersApi.list({ q: q.value.trim() || undefined, role: role.value ?? undefined, page: page.value, limit: 20 });
    items.value = r.items;
    total.value = r.total;
  } catch (e) {
    ui.error(e);
  } finally {
    loading.value = false;
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
watch([q, role], () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    page.value = 1;
    load();
  }, 300);
});
onMounted(load);

async function toggle(u: User) {
  try {
    const updated = await usersApi.setStatus(u.id, !u.isActive);
    u.isActive = updated.isActive;
  } catch (e) {
    ui.error(e);
  }
}

const open = ref(false);
/** null = creating a new user. */
const editing = ref<User | null>(null);
const saving = ref(false);
const error = ref('');
const form = reactive({
  email: '', firstName: '', lastName: '', password: '', roles: [] as Role[],
  institution: 'Universidad de Córdoba', isUnicordoba: true, highestDegree: '', country: 'Colombia', studentCode: '',
  expertise: [] as string[],
});
const isJuror = computed(() => form.roles.some((r) => r === Role.INTERNAL_JUROR || r === Role.EXTERNAL_JUROR));
const isExternalOnly = computed(() => form.roles.length > 0 && form.roles.every((r) => r === Role.EXTERNAL_JUROR));
const isStudent = computed(() => form.roles.includes(Role.STUDENT));
function startCreate() {
  editing.value = null;
  Object.assign(form, {
    email: '', firstName: '', lastName: '', password: '', roles: [], studentCode: '', highestDegree: '',
    institution: 'Universidad de Córdoba', isUnicordoba: true, country: 'Colombia', expertise: [],
  });
  error.value = '';
  open.value = true;
}
function startEdit(u: User) {
  editing.value = u;
  Object.assign(form, {
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    password: '',
    roles: [...u.roles],
    institution: u.jurorProfile?.institution ?? 'Universidad de Córdoba',
    isUnicordoba: u.jurorProfile?.isUnicordoba ?? true,
    highestDegree: u.jurorProfile?.highestDegree ?? '',
    country: u.jurorProfile?.country ?? 'Colombia',
    expertise: [...(u.jurorProfile?.expertise ?? [])],
    studentCode: u.studentProfile?.studentCode ?? '',
  });
  error.value = '';
  open.value = true;
}
/** Juror and student profiles, sent whole (the API replaces the sub-document). */
function profiles() {
  return {
    ...(isJuror.value && {
      jurorProfile: {
        institution: form.institution.trim(),
        isUnicordoba: form.isUnicordoba,
        highestDegree: form.highestDegree.trim() || undefined,
        country: form.country.trim() || undefined,
        expertise: form.expertise.map((x) => x.trim()).filter(Boolean),
      },
    }),
    ...(isStudent.value && {
      studentProfile: { ...editing.value?.studentProfile, studentCode: form.studentCode.trim() },
    }),
  };
}
async function save() {
  saving.value = true;
  error.value = '';
  try {
    if (editing.value) {
      await usersApi.update(editing.value.id, {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        roles: form.roles,
        ...profiles(),
      });
      ui.notify('Usuario actualizado.');
    } else {
      await usersApi.create({
        email: form.email.trim(),
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        roles: form.roles,
        ...(!isExternalOnly.value && { password: form.password }),
        ...profiles(),
      });
      ui.notify('Usuario creado.');
    }
    open.value = false;
    load();
  } catch (e) {
    error.value = e instanceof ApiError ? e.userMessage : 'No se pudo guardar el usuario.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-card class="pa-4">
    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <div class="text-h2-section">Gestión de usuarios y perfiles</div>
      <v-spacer />
      <v-text-field v-model="q" label="Buscar" prepend-inner-icon="mdi-magnify" hide-details style="max-width: 260px" />
      <v-select v-model="role" :items="roleItems" label="Rol" clearable hide-details style="max-width: 220px" />
      <v-btn color="primary" prepend-icon="mdi-account-plus" @click="startCreate">Nuevo usuario</v-btn>
    </div>
    <v-data-table-server
      :headers="headers"
      :items="items"
      :items-length="total"
      :loading="loading"
      :page="page"
      :items-per-page="20"
      :items-per-page-options="[20]"
      no-data-text="Sin usuarios"
      @update:page="(p: number) => { page = p; load(); }"
    >
      <template #[`item.name`]="{ item }">{{ fullName(item) }}</template>
      <template #[`item.roles`]="{ item }">
        <v-chip v-for="r in item.roles" :key="r" class="mr-1" variant="tonal" color="primary">{{ ROLE_LABELS[r] }}</v-chip>
      </template>
      <template #[`item.institution`]="{ item }">{{ item.jurorProfile?.institution ?? '—' }}</template>
      <template #[`item.isActive`]="{ item }">
        <v-switch :model-value="item.isActive" color="success" hide-details density="compact" inset @update:model-value="toggle(item)" />
      </template>
      <template #[`item.actions`]="{ item }">
        <v-btn size="small" variant="text" prepend-icon="mdi-pencil-outline" @click="startEdit(item)">Editar</v-btn>
      </template>
    </v-data-table-server>

    <v-dialog v-model="open" max-width="640">
      <v-card :title="editing ? 'Editar usuario' : 'Nuevo usuario'">
        <v-card-text>
          <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
          <v-row dense>
            <v-col cols="6"><v-text-field v-model="form.firstName" label="Nombres" /></v-col>
            <v-col cols="6"><v-text-field v-model="form.lastName" label="Apellidos" /></v-col>
            <v-col cols="12"><v-text-field v-model="form.email" label="Correo" type="email" :disabled="!!editing" :hint="editing ? 'El correo no se puede cambiar' : ''" persistent-hint /></v-col>
            <v-col cols="12"><v-select v-model="form.roles" :items="roleItems" label="Roles" multiple chips /></v-col>
            <v-col v-if="!isExternalOnly && !editing" cols="12"><v-text-field v-model="form.password" label="Contraseña inicial (mín. 8)" type="password" autocomplete="new-password" /></v-col>
            <template v-if="isJuror">
              <v-col cols="8"><v-text-field v-model="form.institution" label="Institución" /></v-col>
              <v-col cols="4"><v-switch v-model="form.isUnicordoba" label="Unicórdoba" color="primary" inset hide-details /></v-col>
              <v-col cols="6"><v-text-field v-model="form.highestDegree" label="Máximo título" /></v-col>
              <v-col cols="6"><v-text-field v-model="form.country" label="País" /></v-col>
              <v-col cols="12">
                <v-combobox
                  v-model="form.expertise"
                  label="Áreas de experticia (Enter para agregar)"
                  hint="Se comparan con las palabras clave de cada tesis para sugerir jurados"
                  persistent-hint
                  multiple
                  chips
                  closable-chips
                />
              </v-col>
            </template>
            <v-col v-if="isStudent" cols="12"><v-text-field v-model="form.studentCode" label="Código estudiantil" /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="open = false">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" :loading="saving" :disabled="!form.email || !form.firstName || !form.lastName || !form.roles.length" @click="save">{{ editing ? 'Guardar cambios' : 'Crear' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>
