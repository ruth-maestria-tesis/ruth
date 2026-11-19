import { ThesisStatus } from '@thesis/shared';

export const STATUS_LABELS: Record<ThesisStatus, string> = {
  [ThesisStatus.SUBMITTED]: 'Radicada',
  [ThesisStatus.JURORS_ASSIGNED]: 'Jurados asignados',
  [ThesisStatus.PENDING_JUROR_REPLACEMENT]: 'Pendiente de reemplazo de jurado',
  [ThesisStatus.UNDER_EVALUATION]: 'En evaluación',
  [ThesisStatus.IN_DISPUTE]: 'En disputa',
  [ThesisStatus.REVISIONS_IN_PROGRESS]: 'Correcciones en curso',
  [ThesisStatus.READY_FOR_DEFENSE]: 'Lista para sustentación',
  [ThesisStatus.DEFENSE_SCHEDULED]: 'Sustentación programada',
  [ThesisStatus.NOT_APPROVED]: 'No aprobada',
  [ThesisStatus.COMPLETED_APPROVED]: 'Finalizada - aprobada',
  [ThesisStatus.COMPLETED_FAILED]: 'Finalizada - reprobada',
};

export const statusLabel = (s: string): string =>
  STATUS_LABELS[s as ThesisStatus] ?? s;

const TZ = 'America/Bogota';

const dateFmt = new Intl.DateTimeFormat('es-CO', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat('es-CO', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export const formatDate = (d?: Date): string => (d ? dateFmt.format(d) : '');
export const formatDateTime = (d?: Date): string =>
  d ? dateTimeFmt.format(d) : '';

/** YYYYMMDD in Bogotá, for file names. */
export function fileDateStamp(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}
