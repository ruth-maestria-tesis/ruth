<script setup lang="ts">
import { AssignmentStatus, Role } from '@thesis/shared';
import type { Assignment, Defense } from '~/types/api';
import { assignmentsApi, defensesApi } from '~/utils/api';
import { fullName } from '~/utils/i18n';
import { useAuthStore } from '~/stores/auth';

definePageMeta({ middleware: 'role', roles: [Role.COORDINATOR, Role.ADMIN] });
const route = useRoute();
const auth = useAuthStore();
const id = computed(() => String(route.params.id));
const { thesis, summary, error, load } = useThesis(id);
const { programName } = useCatalogs();
const defense = ref<Defense | null>(null);
const assignments = ref<Assignment[]>([]);

const activeJurors = computed(() => assignments.value.filter((a) => a.status === AssignmentStatus.ACCEPTED));
const jurors = computed(() => activeJurors.value.map((a) => ({ userId: a.jurorId, name: fullName(a.juror) })));
const signers = computed(() => [
  ...activeJurors.value.map((a) => ({ userId: a.jurorId, name: fullName(a.juror), role: a.juror?.roles.includes(Role.EXTERNAL_JUROR) ? Role.EXTERNAL_JUROR : Role.INTERNAL_JUROR })),
  { userId: auth.user?.id ?? '', name: auth.displayName, role: Role.COORDINATOR },
]);
const mode = computed(() => (auth.hasRole(Role.COORDINATOR) ? 'coordinator' : 'student') as 'coordinator' | 'student');

onMounted(async () => {
  await load();
  [defense.value, assignments.value] = await Promise.all([
    defensesApi.forThesis(id.value).catch(() => null),
    assignmentsApi.forThesis(id.value).catch(() => []),
  ]);
});
</script>

<template>
  <div>
    <v-alert v-if="error" type="error" variant="tonal">No se encontró la tesis.</v-alert>
    <template v-if="summary && thesis">
      <ThesisHeader :thesis="summary" />
      <v-row>
        <v-col cols="12" lg="5">
          <DefensePanel v-model:defense="defense" :thesis="summary" :mode="mode" :jurors="jurors" @changed="load" />
        </v-col>
        <v-col cols="12" lg="7">
          <MinutesPanel :thesis="summary" :mode="mode" :program-name="programName(thesis.programId)" :signers="signers" @changed="load" />
        </v-col>
      </v-row>
    </template>
  </div>
</template>
