import { createVuetify } from 'vuetify';
import { es } from 'vuetify/locale';

export default defineNuxtPlugin((nuxtApp) => {
  const vuetify = createVuetify({
    locale: { locale: 'es', messages: { es } },
    theme: {
      defaultTheme: 'unicordoba',
      themes: {
        unicordoba: {
          dark: false,
          colors: {
            primary: '#006837',
            'primary-darken-1': '#004825',
            secondary: '#FDB913',
            background: '#F8FAFC',
            surface: '#FFFFFF',
            'on-background': '#0F172A',
            'on-surface': '#0F172A',
            error: '#DC2626',
            success: '#16A34A',
            info: '#0284C7',
            warning: '#F59E0B',
          },
        },
      },
    },
    defaults: {
      VBtn: { rounded: 'lg', class: 'text-none', style: 'letter-spacing: 0' },
      VCard: { rounded: 'lg', elevation: 0, class: 'uc-card' },
      VTextField: { variant: 'outlined', density: 'comfortable', color: 'primary' },
      VTextarea: { variant: 'outlined', density: 'comfortable', color: 'primary' },
      VSelect: { variant: 'outlined', density: 'comfortable', color: 'primary' },
      VAutocomplete: { variant: 'outlined', density: 'comfortable', color: 'primary' },
      VFileInput: { variant: 'outlined', density: 'comfortable', color: 'primary' },
      VChip: { size: 'small', label: true },
    },
  });
  nuxtApp.vueApp.use(vuetify);
});
