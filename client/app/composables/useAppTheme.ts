import { useTheme } from 'vuetify';

export const THEME_KEY = 'ruth-theme';

/** Light/dark switch, remembered in this browser. */
export function useAppTheme() {
  const theme = useTheme();
  const isDark = computed(() => theme.global.current.value.dark);
  function toggle() {
    const next = isDark.value ? 'ruth' : 'ruthDark';
    theme.global.name.value = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage blocked: the choice lasts for this page load only */
    }
  }
  return { isDark, toggle };
}
