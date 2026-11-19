<script setup lang="ts">
import { useAuthStore } from '~/stores/auth';
import { ApiError } from '~/utils/http';

definePageMeta({ layout: 'blank' });

const auth = useAuthStore();
const route = useRoute();
const tab = ref<'institutional' | 'external'>('institutional');
const email = ref('');
const password = ref('');
const showPassword = ref(false);
const token = ref('');
const loading = ref(false);
const error = ref('');

const safeRedirect = (r: unknown) => (typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : null);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(email.value.trim(), password.value);
    await navigateTo(safeRedirect(route.query.redirect) ?? auth.home);
  } catch (e) {
    error.value = e instanceof ApiError ? e.userMessage : 'No se pudo iniciar sesión.';
  } finally {
    loading.value = false;
  }
}

/** Accepts a raw token or a full link (…?token=XYZ or …/external/XYZ). */
function extractToken(v: string): string {
  const s = v.trim();
  try {
    const u = new URL(s);
    return u.searchParams.get('token') ?? u.pathname.split('/').filter(Boolean).pop() ?? s;
  } catch {
    return s;
  }
}
function goExternal() {
  const t = extractToken(token.value);
  if (t) navigateTo(`/external/${encodeURIComponent(t)}`);
}
</script>

<template>
  <div class="d-flex align-center justify-center pa-4" style="min-height: 100vh">
    <v-card class="login-card overflow-hidden" max-width="960" width="100%" elevation="6">
      <v-row no-gutters>
        <v-col cols="12" md="5" class="identity pa-8 d-flex flex-column justify-space-between">
          <div>
            <div class="brand-logo mb-6">UC</div>
            <div class="text-h5 font-weight-bold mb-2">Universidad de Córdoba</div>
            <div class="text-body-1" style="opacity: 0.9">Vicerrectoría de Investigación y Posgrados</div>
          </div>
          <div class="mt-8">
            <div class="text-h6 font-weight-semibold mb-2">Plataforma de Tesis de Posgrado</div>
            <div class="text-body-2" style="opacity: 0.85">
              Radicación, evaluación por jurados, sustentación y actas con sello criptográfico, con trazabilidad completa.
            </div>
            <div class="text-caption mt-6 font-italic" style="opacity: 0.75">“Por una universidad de excelencia académica”</div>
          </div>
        </v-col>
        <v-col cols="12" md="7" class="pa-8">
          <div class="text-h1-module mb-1">Iniciar sesión</div>
          <div class="text-body-2 text-medium-emphasis mb-4">Seleccione su tipo de acceso</div>
          <v-tabs v-model="tab" color="primary" class="mb-6" grow>
            <v-tab value="institutional" prepend-icon="mdi-account-tie">Docentes y Coordinación</v-tab>
            <v-tab value="external" prepend-icon="mdi-earth">Jurado Externo</v-tab>
          </v-tabs>
          <v-window v-model="tab">
            <v-window-item value="institutional">
              <v-form @submit.prevent="submit">
                <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>
                <v-text-field v-model="email" label="Correo institucional" type="email" prepend-inner-icon="mdi-email-outline" autocomplete="username" autofocus />
                <v-text-field
                  v-model="password"
                  label="Contraseña"
                  :type="showPassword ? 'text' : 'password'"
                  prepend-inner-icon="mdi-lock-outline"
                  :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
                  autocomplete="current-password"
                  @click:append-inner="showPassword = !showPassword"
                />
                <v-btn type="submit" color="primary" size="large" block :loading="loading" :disabled="!email || !password">Ingresar</v-btn>
              </v-form>
              <div class="text-caption text-medium-emphasis mt-4">
                ¿Olvidó su contraseña? Solicite el restablecimiento a la coordinación del programa.
              </div>
            </v-window-item>
            <v-window-item value="external">
              <v-alert type="info" variant="tonal" density="compact" class="mb-4" icon="mdi-shield-key-outline">
                Use el enlace o el token de acceso que le envió la coordinación del posgrado (RF-J14).
              </v-alert>
              <v-form @submit.prevent="goExternal">
                <v-text-field v-model="token" label="Token o enlace de acceso" prepend-inner-icon="mdi-key-variant" class="mono" />
                <v-btn type="submit" color="primary" size="large" block :disabled="!token.trim()">Ingresar como jurado externo</v-btn>
              </v-form>
            </v-window-item>
          </v-window>
          <div class="text-caption text-medium-emphasis mt-8">
            Al ingresar acepta la política de confidencialidad académica de la Universidad de Córdoba.
          </div>
        </v-col>
      </v-row>
    </v-card>
  </div>
</template>

<style scoped>
.identity { background: linear-gradient(135deg, #004825 0%, #006837 100%); color: white; }
.brand-logo {
  width: 56px; height: 56px; background: white; border-radius: 12px; display: flex; align-items: center;
  justify-content: center; font-weight: 800; color: #006837; font-size: 1.5rem;
}
</style>
