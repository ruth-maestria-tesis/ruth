<script setup lang="ts">
/** CU-08 FA-01: declining requires a reason (max 500 characters). */
const open = defineModel<boolean>({ default: false });
defineProps<{ loading?: boolean }>();
const emit = defineEmits<{ confirm: [reason: string] }>();
const reason = ref('');
watch(open, (v) => v && (reason.value = ''));
</script>

<template>
  <v-dialog v-model="open" max-width="520">
    <v-card title="Declinar designación">
      <v-card-text>
        <p class="text-body-2 mb-3">Indique el motivo. La coordinación será notificada para designar un reemplazo.</p>
        <v-textarea v-model="reason" label="Motivo (obligatorio)" rows="4" counter="500" maxlength="500" auto-grow />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Cancelar</v-btn>
        <v-btn color="error" variant="flat" :disabled="!reason.trim()" :loading="loading" @click="emit('confirm', reason.trim())">Declinar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
