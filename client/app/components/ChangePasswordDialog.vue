<script setup lang="ts">
import { authApi } from '~/utils/api';
import { ApiError } from '~/utils/http';
import { useUiStore } from '~/stores/ui';

const open = defineModel<boolean>({ default: false });
const ui = useUiStore();
const current = ref('');
const next = ref('');
const confirm = ref('');
const saving = ref(false);
const error = ref('');

const rules = {
  min: (v: string) => v.length >= 8 || 'Mínimo 8 caracteres',
  match: (v: string) => v === next.value || 'Las contraseñas no coinciden',
};

watch(open, (v) => {
  if (v) {
    current.value = next.value = confirm.value = error.value = '';
  }
});

async function save() {
  error.value = '';
  if (next.value.length < 8 || next.value !== confirm.value) return;
  saving.value = true;
  try {
    await authApi.changePassword(current.value, next.value);
    ui.notify('Contraseña actualizada.');
    open.value = false;
  } catch (e) {
    error.value = e instanceof ApiError ? e.userMessage : 'No se pudo cambiar la contraseña.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="440">
    <v-card title="Cambiar contraseña">
      <v-card-text>
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
        <v-text-field v-model="current" label="Contraseña actual" type="password" autocomplete="current-password" />
        <v-text-field v-model="next" label="Nueva contraseña" type="password" :rules="[rules.min]" autocomplete="new-password" />
        <v-text-field v-model="confirm" label="Confirmar nueva contraseña" type="password" :rules="[rules.match]" autocomplete="new-password" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Cancelar</v-btn>
        <v-btn color="primary" variant="flat" :loading="saving" :disabled="!current || next.length < 8 || next !== confirm" @click="save">Guardar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
