<script setup lang="ts">
import { PeriodTerm, ProgramLevel, Role } from '@thesis/shared';
import type { Cohort, Period, Program } from '~/types/api';
import { catalogsApi } from '~/utils/api';
import { ApiError } from '~/utils/http';
import { formatDate } from '~/utils/i18n';
import { useUiStore } from '~/stores/ui';

/** Programs, periods and cohorts. Nothing is deleted: programs are deactivated. */
definePageMeta({ middleware: 'role', roles: [Role.COORDINATOR, Role.ADMIN] });

const ui = useUiStore();
const { programs, periods, cohorts, reload, programName, periodCode } = useCatalogs();
const tab = ref<'programs' | 'periods' | 'cohorts'>('programs');

const LEVEL_LABELS: Record<ProgramLevel, string> = { [ProgramLevel.MASTER]: 'Maestría', [ProgramLevel.DOCTORATE]: 'Doctorado' };
const levelItems = Object.values(ProgramLevel).map((v) => ({ value: v, title: LEVEL_LABELS[v] }));
const termItems = Object.values(PeriodTerm);
/** ISO date → yyyy-mm-dd for <input type="date">. */
const day = (iso?: string) => (iso ? iso.slice(0, 10) : '');

const dialog = ref<null | 'program' | 'period' | 'cohort'>(null);
const editingId = ref<string | null>(null);
const saving = ref(false);
const error = ref('');

const program = reactive({ code: '', name: '', level: ProgramLevel.MASTER as string, isActive: true });
const period = reactive({ year: new Date().getFullYear(), term: PeriodTerm.I as PeriodTerm, startsAt: '', endsAt: '' });
const cohort = reactive({ programId: null as string | null, number: 1, periodId: null as string | null, name: '' });

function openProgram(p?: Program) {
  editingId.value = p?.id ?? null;
  Object.assign(program, p ? { code: p.code, name: p.name, level: p.level, isActive: p.isActive } : { code: '', name: '', level: ProgramLevel.MASTER, isActive: true });
  error.value = '';
  dialog.value = 'program';
}
function openPeriod(p?: Period) {
  editingId.value = p?.id ?? null;
  Object.assign(
    period,
    p ? { year: p.year, term: p.term as PeriodTerm, startsAt: day(p.startsAt), endsAt: day(p.endsAt) } : { year: new Date().getFullYear(), term: PeriodTerm.I, startsAt: '', endsAt: '' },
  );
  error.value = '';
  dialog.value = 'period';
}
function openCohort(c?: Cohort) {
  editingId.value = c?.id ?? null;
  const nextNumber = Math.max(0, ...cohorts.value.filter((x) => x.programId === programs.value[0]?.id).map((x) => x.number)) + 1;
  Object.assign(
    cohort,
    c
      ? { programId: c.programId, number: c.number, periodId: c.periodId, name: c.name }
      : { programId: programs.value[0]?.id ?? null, number: nextNumber, periodId: periods.value[0]?.id ?? null, name: '' },
  );
  error.value = '';
  dialog.value = 'cohort';
}

const canSave = computed(() => {
  if (dialog.value === 'program') return /^[A-Za-z0-9]{2,20}$/.test(program.code) && !!program.name.trim();
  if (dialog.value === 'period') return !!period.startsAt && !!period.endsAt && period.startsAt <= period.endsAt && period.year >= 2000;
  if (dialog.value === 'cohort') return !!cohort.programId && !!cohort.periodId && cohort.number >= 1 && !!cohort.name.trim();
  return false;
});

async function save() {
  saving.value = true;
  error.value = '';
  const id = editingId.value;
  try {
    if (dialog.value === 'program') {
      if (id) await catalogsApi.updateProgram(id, { name: program.name.trim(), level: program.level, isActive: program.isActive });
      else await catalogsApi.createProgram({ code: program.code.trim(), name: program.name.trim(), level: program.level });
    } else if (dialog.value === 'period') {
      if (id) await catalogsApi.updatePeriod(id, { startsAt: period.startsAt, endsAt: period.endsAt });
      else await catalogsApi.createPeriod({ year: period.year, term: period.term, startsAt: period.startsAt, endsAt: period.endsAt });
    } else if (dialog.value === 'cohort') {
      if (id) await catalogsApi.updateCohort(id, { name: cohort.name.trim(), periodId: cohort.periodId! });
      else await catalogsApi.createCohort({ programId: cohort.programId!, number: cohort.number, periodId: cohort.periodId!, name: cohort.name.trim() });
    }
    await reload();
    ui.notify(id ? 'Cambios guardados.' : 'Registro creado.');
    dialog.value = null;
  } catch (e) {
    error.value = e instanceof ApiError ? e.userMessage : 'No se pudo guardar.';
  } finally {
    saving.value = false;
  }
}

async function toggleProgram(p: Program) {
  try {
    await catalogsApi.updateProgram(p.id, { isActive: !p.isActive });
    await reload();
  } catch (e) {
    ui.error(e);
  }
}
</script>

<template>
  <v-card class="pa-4">
    <div class="d-flex flex-wrap align-center ga-3 mb-2">
      <div>
        <div class="text-h2-section d-flex align-center ga-2"><v-icon icon="mdi-book-cog-outline" color="primary" /> Catálogos académicos</div>
        <div class="text-body-2 text-medium-emphasis">Programas, periodos y cohortes usados al radicar tesis y en los filtros</div>
      </div>
    </div>
    <v-tabs v-model="tab" color="primary" class="mb-4">
      <v-tab value="programs">Programas ({{ programs.length }})</v-tab>
      <v-tab value="periods">Periodos ({{ periods.length }})</v-tab>
      <v-tab value="cohorts">Cohortes ({{ cohorts.length }})</v-tab>
    </v-tabs>

    <v-window v-model="tab">
      <v-window-item value="programs">
        <div class="d-flex justify-end mb-2"><v-btn color="primary" prepend-icon="mdi-plus" @click="openProgram()">Nuevo programa</v-btn></div>
        <v-table density="comfortable">
          <thead><tr><th>Código</th><th>Nombre</th><th>Nivel</th><th>Activo</th><th class="text-end">Acciones</th></tr></thead>
          <tbody>
            <tr v-for="p in programs" :key="p.id">
              <td><strong>{{ p.code }}</strong></td>
              <td>{{ p.name }}</td>
              <td>{{ LEVEL_LABELS[p.level] ?? p.level }}</td>
              <td><v-switch :model-value="p.isActive" color="success" hide-details density="compact" inset @update:model-value="toggleProgram(p)" /></td>
              <td class="text-end"><v-btn size="small" variant="text" prepend-icon="mdi-pencil-outline" @click="openProgram(p)">Editar</v-btn></td>
            </tr>
            <tr v-if="!programs.length"><td colspan="5" class="text-medium-emphasis">Sin programas.</td></tr>
          </tbody>
        </v-table>
      </v-window-item>

      <v-window-item value="periods">
        <div class="d-flex justify-end mb-2"><v-btn color="primary" prepend-icon="mdi-plus" @click="openPeriod()">Nuevo periodo</v-btn></div>
        <v-table density="comfortable">
          <thead><tr><th>Código</th><th>Inicio</th><th>Fin</th><th class="text-end">Acciones</th></tr></thead>
          <tbody>
            <tr v-for="p in periods" :key="p.id">
              <td><strong>{{ p.code }}</strong></td>
              <td>{{ formatDate(p.startsAt) }}</td>
              <td>{{ formatDate(p.endsAt) }}</td>
              <td class="text-end"><v-btn size="small" variant="text" prepend-icon="mdi-pencil-outline" @click="openPeriod(p)">Editar</v-btn></td>
            </tr>
            <tr v-if="!periods.length"><td colspan="4" class="text-medium-emphasis">Sin periodos.</td></tr>
          </tbody>
        </v-table>
      </v-window-item>

      <v-window-item value="cohorts">
        <div class="d-flex justify-end mb-2">
          <v-btn color="primary" prepend-icon="mdi-plus" :disabled="!programs.length || !periods.length" @click="openCohort()">Nueva cohorte</v-btn>
        </div>
        <v-table density="comfortable">
          <thead><tr><th>Nombre</th><th>Programa</th><th>Número</th><th>Periodo de inicio</th><th class="text-end">Acciones</th></tr></thead>
          <tbody>
            <tr v-for="c in cohorts" :key="c.id">
              <td><strong>{{ c.name }}</strong></td>
              <td>{{ programName(c.programId) }}</td>
              <td>{{ c.number }}</td>
              <td>{{ periodCode(c.periodId) }}</td>
              <td class="text-end"><v-btn size="small" variant="text" prepend-icon="mdi-pencil-outline" @click="openCohort(c)">Editar</v-btn></td>
            </tr>
            <tr v-if="!cohorts.length"><td colspan="5" class="text-medium-emphasis">Sin cohortes.</td></tr>
          </tbody>
        </v-table>
      </v-window-item>
    </v-window>

    <v-dialog :model-value="!!dialog" max-width="560" @update:model-value="(v: boolean) => !v && (dialog = null)">
      <v-card :title="`${editingId ? 'Editar' : 'Nuevo'} ${dialog === 'program' ? 'programa' : dialog === 'period' ? 'periodo' : 'cohorte'}`">
        <v-card-text>
          <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">{{ error }}</v-alert>
          <v-row v-if="dialog === 'program'" dense>
            <v-col cols="12" md="4">
              <v-text-field v-model="program.code" label="Código *" :disabled="!!editingId" hint="2 a 20 letras o números" persistent-hint />
            </v-col>
            <v-col cols="12" md="8"><v-select v-model="program.level" :items="levelItems" label="Nivel *" /></v-col>
            <v-col cols="12"><v-text-field v-model="program.name" label="Nombre *" counter="200" maxlength="200" /></v-col>
          </v-row>
          <v-row v-else-if="dialog === 'period'" dense>
            <v-col cols="6"><v-text-field v-model.number="period.year" type="number" label="Año *" :disabled="!!editingId" /></v-col>
            <v-col cols="6"><v-select v-model="period.term" :items="termItems" label="Semestre *" :disabled="!!editingId" /></v-col>
            <v-col cols="6"><v-text-field v-model="period.startsAt" type="date" label="Inicio *" /></v-col>
            <v-col cols="6"><v-text-field v-model="period.endsAt" type="date" label="Fin *" /></v-col>
            <v-col v-if="editingId" cols="12"><div class="text-caption text-medium-emphasis">El año y el semestre forman el código del periodo y no se pueden cambiar.</div></v-col>
          </v-row>
          <v-row v-else-if="dialog === 'cohort'" dense>
            <v-col cols="12"><v-select v-model="cohort.programId" :items="programs" item-title="name" item-value="id" label="Programa *" :disabled="!!editingId" /></v-col>
            <v-col cols="4"><v-text-field v-model.number="cohort.number" type="number" min="1" label="Número *" :disabled="!!editingId" /></v-col>
            <v-col cols="8"><v-select v-model="cohort.periodId" :items="periods" item-title="code" item-value="id" label="Periodo de inicio *" /></v-col>
            <v-col cols="12"><v-text-field v-model="cohort.name" label="Nombre *" placeholder="p. ej. Cohorte 3 (2026-I)" counter="100" maxlength="100" /></v-col>
          </v-row>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = null">Cancelar</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!canSave" :loading="saving" @click="save">{{ editingId ? 'Guardar cambios' : 'Crear' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>
