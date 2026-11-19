<script setup lang="ts">
import { Role, ThesisStatus } from '@thesis/shared';
import type { Defense, Thesis } from '~/types/api';
import { defensesApi, thesesApi } from '~/utils/api';
import { DEFENSE_STATUS_LABELS, MODALITY_LABELS, formatDate } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

definePageMeta({ middleware: 'role', roles: [Role.COORDINATOR] });
const ui = useUiStore();
const defenses = ref<Defense[]>([]);
const ready = ref<Thesis[]>([]);
const scheduled = ref<Thesis[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const [d, r, s] = await Promise.all([
      defensesApi.list(),
      thesesApi.list({ status: ThesisStatus.READY_FOR_DEFENSE, limit: 100 }),
      thesesApi.list({ status: ThesisStatus.DEFENSE_SCHEDULED, limit: 100 }),
    ]);
    defenses.value = d.filter((x) => x.status !== 'CANCELLED').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    ready.value = r.items;
    scheduled.value = s.items;
  } catch (e) {
    ui.error(e);
  } finally {
    loading.value = false;
  }
});
const hasDefense = (t: Thesis) => defenses.value.some((d) => d.thesisId === t.id);
</script>

<template>
  <div>
    <div class="text-h1-module mb-1">Sustentaciones y actas</div>
    <div class="text-body-2 text-medium-emphasis mb-4">Programación (CU-03), confirmación de jurados y cierre de actas (CU-04)</div>
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <v-row>
      <v-col cols="12" lg="7">
        <v-card class="pa-4">
          <div class="text-h2-section mb-3">Agenda de sustentaciones</div>
          <v-table v-if="defenses.length" density="comfortable">
            <thead><tr><th>Fecha</th><th>Tesis</th><th>Modalidad</th><th>Confirmaciones</th><th>Estado</th><th /></tr></thead>
            <tbody>
              <tr v-for="d in defenses" :key="d.id">
                <td class="text-no-wrap">{{ formatDate(d.scheduledAt, true) }}</td>
                <td><strong>{{ d.thesis?.code }}</strong><div class="text-meta">{{ d.thesis?.studentName }}</div></td>
                <td>{{ MODALITY_LABELS[d.modality] }}</td>
                <td>{{ d.jurors.filter((j) => j.confirmedAt).length }}/{{ d.jurors.length }}</td>
                <td><v-chip :color="d.status === 'CONFIRMED' ? 'success' : 'warning'" variant="tonal">{{ DEFENSE_STATUS_LABELS[d.status] }}</v-chip></td>
                <td><v-btn size="small" variant="outlined" :to="`/coordinator/theses/${d.thesisId}/defense`">Gestionar</v-btn></td>
              </tr>
            </tbody>
          </v-table>
          <div v-else class="text-body-2 text-medium-emphasis">No hay sustentaciones programadas.</div>
        </v-card>
      </v-col>
      <v-col cols="12" lg="5">
        <v-card class="pa-4 mb-4">
          <div class="text-h2-section mb-3">Listas para programar</div>
          <v-list v-if="ready.filter((t) => !hasDefense(t)).length" density="compact">
            <v-list-item v-for="t in ready.filter((t) => !hasDefense(t))" :key="t.id" :title="t.title" :subtitle="`${t.code} · ${t.studentName}`">
              <template #append><v-btn size="small" color="primary" :to="`/coordinator/theses/${t.id}/defense`">Programar</v-btn></template>
            </v-list-item>
          </v-list>
          <div v-else class="text-body-2 text-medium-emphasis">Ninguna tesis espera programación.</div>
        </v-card>
        <v-card class="pa-4">
          <div class="text-h2-section mb-3">Actas por diligenciar</div>
          <v-list v-if="scheduled.length" density="compact">
            <v-list-item v-for="t in scheduled" :key="t.id" :title="t.title" :subtitle="`${t.code} · ${t.studentName}`">
              <template #append><v-btn size="small" variant="outlined" :to="`/coordinator/theses/${t.id}/defense`">Acta</v-btn></template>
            </v-list-item>
          </v-list>
          <div v-else class="text-body-2 text-medium-emphasis">No hay actas pendientes.</div>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>
