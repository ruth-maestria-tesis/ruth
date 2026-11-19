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
    /**
     * `retryable`: the call is idempotent server-side (minutes sign, defense confirm), so after a
     * 5xx or network failure the user is told to press the button again; the UI never hides it.
     */
    error(e: unknown, retryable = false) {
      let text = e instanceof ApiError ? e.userMessage : 'Ocurrió un error inesperado.';
      if (retryable && e instanceof ApiError && (e.status >= 500 || e.status === 0)) text += ' Puede intentarlo de nuevo.';
      this.snackbar = { show: true, text, color: 'error' };
    },
  },
});
