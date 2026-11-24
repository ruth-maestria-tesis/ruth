import { createVuetify } from 'vuetify';
import { es } from 'vuetify/locale';
import { THEME_KEY } from '~/composables/useAppTheme';

/** Saved theme choice; falls back to the system preference. */
function initialTheme(): 'ruth' | 'ruthDark' {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'ruth' || saved === 'ruthDark') return saved;
  } catch {
    /* storage blocked */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'ruthDark' : 'ruth';
}

/**
 * Violet primary with an amber accent (a nod to the Unicórdoba gold), on a cool
 * lavender canvas. The navigation drawer stays dark in both themes.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const vuetify = createVuetify({
    locale: { locale: 'es', messages: { es } },
    theme: {
      defaultTheme: initialTheme(),
      themes: {
        ruth: {
          dark: false,
          colors: {
            primary: '#6C47FF',
            'primary-darken-1': '#5232D9',
            secondary: '#F5A524',
            accent: '#22C3B5',
            background: '#F5F4FB',
            surface: '#FFFFFF',
            'surface-variant': '#ECEAF7',
            'on-background': '#17142B',
            'on-surface': '#17142B',
            error: '#E5484D',
            success: '#12A374',
            info: '#3E8BFF',
            warning: '#F5A524',
          },
          variables: { 'border-color': '#17142B', 'border-opacity': 0.08 },
        },
        ruthDark: {
          dark: true,
          colors: {
            primary: '#8E72FF',
            'primary-darken-1': '#6C47FF',
            secondary: '#F7B84B',
            accent: '#3DD9CA',
            background: '#0E0C1A',
            surface: '#17152A',
            'surface-variant': '#221F3A',
            'on-background': '#ECEAF7',
            'on-surface': '#ECEAF7',
            error: '#FF6B6F',
            success: '#2FD39A',
            info: '#6AA6FF',
            warning: '#F7B84B',
          },
          variables: { 'border-color': '#FFFFFF', 'border-opacity': 0.08 },
        },
      },
    },
    defaults: {
      VBtn: { rounded: 'lg', class: 'text-none', style: 'letter-spacing: 0' },
      VCard: { rounded: 'xl', elevation: 0, class: 'uc-card' },
      VTextField: { variant: 'outlined', density: 'comfortable', color: 'primary', rounded: 'lg' },
      VTextarea: { variant: 'outlined', density: 'comfortable', color: 'primary', rounded: 'lg' },
      VSelect: { variant: 'outlined', density: 'comfortable', color: 'primary', rounded: 'lg' },
      VAutocomplete: { variant: 'outlined', density: 'comfortable', color: 'primary', rounded: 'lg' },
      VCombobox: { variant: 'outlined', density: 'comfortable', color: 'primary', rounded: 'lg' },
      VFileInput: { variant: 'outlined', density: 'comfortable', color: 'primary', rounded: 'lg' },
      VChip: { size: 'small', rounded: 'pill' },
      VAlert: { rounded: 'lg' },
      VDialog: { scrim: '#0E0C1A' },
    },
  });
  nuxtApp.vueApp.use(vuetify);
});
