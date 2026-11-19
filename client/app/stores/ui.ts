import { defineStore } from 'pinia';
import { ApiError } from '~/utils/http';

export const useUiStore = defineStore('ui', {
  state: () => ({
    snackbar: { show: false, text: '', color: 'success' as string },
  }),
  actions: {
    notify(text: string, color = 'success') {
      this.snackbar = { show: true, text, color };
    },
    error(e: unknown) {
      const text = e instanceof ApiError ? e.userMessage : 'Ocurrió un error inesperado.';
      this.snackbar = { show: true, text, color: 'error' };
    },
  },
});
