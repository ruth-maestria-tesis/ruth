<script setup lang="ts">
import { useUiStore } from '~/stores/ui';
const ui = useUiStore();
</script>

<template>
  <v-snackbar v-model="ui.snackbar.show" :color="ui.snackbar.color" location="top right" timeout="4500">
    {{ ui.snackbar.text }}
    <template #actions>
      <v-btn variant="text" icon="mdi-close" @click="ui.snackbar.show = false" />
    </template>
  </v-snackbar>
</template>
