/**
 * Single dictionary for user-facing Spanish text tied to API values
 * (statuses, roles, error codes). Components keep their own static copy.
 */
import {
  AssignmentStatus,
  DefenseModality,
  ErrorCode,
  EvaluationVerdict,
  FeedbackStatus,
  JuryViolation,
  MinutesVerdict,
  Role,
  ThesisStatus,
} from '@thesis/shared';

export const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Administrador',
  [Role.COORDINATOR]: 'Coordinador de Posgrado',
  [Role.INTERNAL_JUROR]: 'Jurado Interno',
  [Role.EXTERNAL_JUROR]: 'Jurado Externo',
  [Role.STUDENT]: 'Estudiante',
};

export const THESIS_STATUS_LABELS: Record<ThesisStatus, string> = {
  [ThesisStatus.SUBMITTED]: 'Radicada',
  [ThesisStatus.JURORS_ASSIGNED]: 'Jurados asignados',
  [ThesisStatus.PENDING_JUROR_REPLACEMENT]: 'Reemplazo de jurado pendiente',
  [ThesisStatus.UNDER_EVALUATION]: 'En evaluación',
  [ThesisStatus.IN_DISPUTE]: 'Discrepancia (RN-08)',
  [ThesisStatus.REVISIONS_IN_PROGRESS]: 'En subsanación',
  [ThesisStatus.READY_FOR_DEFENSE]: 'Lista para sustentación',
  [ThesisStatus.DEFENSE_SCHEDULED]: 'Sustentación programada',
  [ThesisStatus.NOT_APPROVED]: 'No aprobada',
  [ThesisStatus.COMPLETED_APPROVED]: 'Aprobada (acta sellada)',
  [ThesisStatus.COMPLETED_FAILED]: 'Reprobada (acta sellada)',
};

export const THESIS_STATUS_COLORS: Record<ThesisStatus, string> = {
  [ThesisStatus.SUBMITTED]: 'primary',
  [ThesisStatus.JURORS_ASSIGNED]: 'warning',
  [ThesisStatus.PENDING_JUROR_REPLACEMENT]: 'warning',
  [ThesisStatus.UNDER_EVALUATION]: 'info',
  [ThesisStatus.IN_DISPUTE]: 'error',
  [ThesisStatus.REVISIONS_IN_PROGRESS]: 'info',
  [ThesisStatus.READY_FOR_DEFENSE]: 'success',
  [ThesisStatus.DEFENSE_SCHEDULED]: 'success',
  [ThesisStatus.NOT_APPROVED]: 'error',
  [ThesisStatus.COMPLETED_APPROVED]: 'success',
  [ThesisStatus.COMPLETED_FAILED]: 'error',
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  [AssignmentStatus.PENDING]: 'Por aceptar',
  [AssignmentStatus.ACCEPTED]: 'Aceptó',
  [AssignmentStatus.DECLINED]: 'Declinó',
  [AssignmentStatus.EXPIRED]: 'Plazo vencido',
  [AssignmentStatus.REPLACED]: 'Reemplazado',
};

export const ASSIGNMENT_STATUS_COLORS: Record<AssignmentStatus, string> = {
  [AssignmentStatus.PENDING]: 'warning',
  [AssignmentStatus.ACCEPTED]: 'success',
  [AssignmentStatus.DECLINED]: 'error',
  [AssignmentStatus.EXPIRED]: 'error',
  [AssignmentStatus.REPLACED]: 'grey',
};

export const VIOLATION_LABELS: Record<JuryViolation, string> = {
  [JuryViolation.JUROR_COUNT]: 'Se requieren exactamente 2 jurados.',
  [JuryViolation.JUROR_DUPLICATE]: 'El mismo jurado está seleccionado dos veces.',
  [JuryViolation.JUROR_NOT_FOUND]: 'El jurado seleccionado no existe.',
  [JuryViolation.JUROR_INACTIVE]: 'El jurado seleccionado está inactivo.',
  [JuryViolation.JUROR_NOT_FACULTY]: 'El usuario seleccionado no tiene perfil de jurado.',
  [JuryViolation.JUROR_CONFLICT_OF_INTEREST]:
    'Conflicto de interés: el jurado es director, codirector, estudiante o tiene un conflicto registrado (RN-01).',
  [JuryViolation.JUROR_PREVIOUSLY_ASSIGNED]: 'Este jurado ya fue designado antes en esta tesis.',
  [JuryViolation.JUROR_EMAIL_TAKEN]: 'El correo del jurado externo ya está registrado.',
  [JuryViolation.JUROR_UNICORDOBA_REQUIRED]:
    'Al menos un jurado debe pertenecer a la Universidad de Córdoba (RF-C13).',
};

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.VALIDATION_FAILED]: 'Revise los datos del formulario.',
  [ErrorCode.NOT_FOUND]: 'El recurso no existe o no tiene permiso para verlo.',
  [ErrorCode.CONFLICT]: 'La operación entra en conflicto con el estado actual.',
  [ErrorCode.DUPLICATE_KEY]: 'Ya existe un registro con esos datos.',
  [ErrorCode.RATE_LIMITED]: 'Demasiados intentos. Espere un momento e intente de nuevo.',
  [ErrorCode.HTTP_ERROR]: 'Error en la solicitud.',
  [ErrorCode.INTERNAL_ERROR]: 'Error interno del servidor. Intente más tarde.',
  [ErrorCode.AUTH_UNAUTHENTICATED]: 'Su sesión expiró. Inicie sesión de nuevo.',
  [ErrorCode.AUTH_FORBIDDEN]: 'No tiene permiso para realizar esta acción.',
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: 'Correo o contraseña incorrectos.',
  [ErrorCode.AUTH_USER_INACTIVE]: 'Su usuario está inactivo. Contacte a la coordinación.',
  [ErrorCode.AUTH_REFRESH_INVALID]: 'Su sesión expiró. Inicie sesión de nuevo.',
  [ErrorCode.AUTH_WRONG_PASSWORD]: 'La contraseña actual no es correcta.',
  [ErrorCode.AUTH_EXTERNAL_TOKEN_INVALID]: 'El enlace de acceso no es válido o ya expiró.',
  [ErrorCode.USER_NOT_FOUND]: 'El usuario no existe.',
  [ErrorCode.USER_EMAIL_TAKEN]: 'El correo ya está registrado.',
  [ErrorCode.USER_PASSWORD_REQUIRED]: 'La contraseña es obligatoria para este rol.',
  [ErrorCode.USER_JUROR_PROFILE_REQUIRED]: 'El perfil de jurado es obligatorio para este rol.',
  [ErrorCode.USER_SELF_LOCKOUT]: 'No puede desactivarse ni quitarse el rol de administrador.',
  [ErrorCode.USER_LAST_ADMIN]: 'Debe existir al menos un administrador activo.',
  [ErrorCode.USER_PASSWORD_NOT_ALLOWED]: 'Los jurados externos no usan contraseña.',
  [ErrorCode.PROGRAM_NOT_FOUND]: 'El programa no existe.',
  [ErrorCode.PERIOD_NOT_FOUND]: 'El periodo no existe.',
  [ErrorCode.COHORT_NOT_FOUND]: 'La cohorte no existe.',
  [ErrorCode.COHORT_PROGRAM_MISMATCH]: 'La cohorte no pertenece al programa seleccionado.',
  [ErrorCode.PERIOD_INVALID_RANGE]: 'El rango de fechas del periodo no es válido.',
  [ErrorCode.THESIS_NOT_FOUND]: 'La tesis no existe o no tiene permiso para verla.',
  [ErrorCode.THESIS_INVALID_REFERENCE]: 'El estudiante, director o catálogo indicado no es válido.',
  [ErrorCode.THESIS_STUDENT_HAS_ACTIVE]: 'El estudiante ya tiene una tesis activa.',
  [ErrorCode.THESIS_NOT_EDITABLE]: 'La tesis ya no se puede editar en su estado actual.',
  [ErrorCode.THESIS_CLOSED]: 'La tesis está cerrada.',
  [ErrorCode.THESIS_MANUSCRIPT_REQUIRED]: 'La tesis necesita un manuscrito antes de continuar.',
  [ErrorCode.WORKFLOW_INVALID_TRANSITION]: 'La transición de estado no está permitida.',
  [ErrorCode.WORKFLOW_STATUS_CONFLICT]: 'El estado de la tesis cambió. Recargue la página.',
  [ErrorCode.FILE_REQUIRED]: 'Debe adjuntar un archivo.',
  [ErrorCode.FILE_TOO_LARGE]: 'El archivo supera el máximo de 25 MB.',
  [ErrorCode.FILE_TYPE_NOT_ALLOWED]: 'Tipo de archivo no permitido.',
  [ErrorCode.FILE_NOT_FOUND]: 'El archivo no existe.',
  [ErrorCode.FILE_UPLOAD_INVALID]: 'La carga del archivo no es válida o expiró. Vuelva a seleccionar el archivo e intente de nuevo.',
  [ErrorCode.MANUSCRIPT_CONFLICT]: 'Otra versión del manuscrito se subió al mismo tiempo. Intente de nuevo.',
  [ErrorCode.ASSIGNMENT_NOT_FOUND]: 'La designación no existe.',
  [ErrorCode.ASSIGNMENT_INVALID_COMPOSITION]: 'La conformación del jurado no cumple las reglas.',
  [ErrorCode.ASSIGNMENT_THESIS_STATUS]: 'La tesis no está en un estado que permita esta asignación.',
  [ErrorCode.ASSIGNMENT_CONFLICT]: 'La designación cambió mientras se procesaba. Recargue la página.',
  [ErrorCode.ASSIGNMENT_NOT_PENDING]: 'La designación ya fue respondida.',
  [ErrorCode.ASSIGNMENT_DEADLINE_PASSED]: 'El plazo para responder la designación ya venció.',
  [ErrorCode.ASSIGNMENT_NOT_REPLACEABLE]: 'Esta designación no se puede reemplazar.',
  [ErrorCode.ASSIGNMENT_NOT_EXTERNAL]: 'La designación no corresponde a un jurado externo.',
  [ErrorCode.EVALUATION_NOT_FOUND]: 'El concepto no existe.',
  [ErrorCode.EVALUATION_NOT_ALLOWED]: 'La tesis no está en una etapa que permita emitir este concepto.',
  [ErrorCode.EVALUATION_LOCKED]: 'El concepto ya fue emitido y no se puede modificar.',
  [ErrorCode.EVALUATION_INCOMPLETE]: 'Complete la rúbrica, el concepto final y observaciones de al menos 20 caracteres.',
  [ErrorCode.EVALUATION_NOT_COMPLETE]: 'Aún no hay conceptos suficientes para calcular el resultado: faltan evaluaciones por emitir.',
  [ErrorCode.FEEDBACK_NOT_FOUND]: 'La observación no existe.',
  [ErrorCode.FEEDBACK_INVALID_TRANSITION]: 'La observación no está en un estado que permita esta acción (RN-06).',
  [ErrorCode.FEEDBACK_THESIS_STATUS]: 'Solo se pueden crear observaciones durante la evaluación o la subsanación.',
  [ErrorCode.DEFENSE_NOT_FOUND]: 'La sustentación no existe.',
  [ErrorCode.DEFENSE_THESIS_STATUS]: 'La tesis debe estar lista para sustentación.',
  [ErrorCode.DEFENSE_EXISTS]: 'Ya hay una sustentación abierta para esta tesis.',
  [ErrorCode.DEFENSE_NOT_EDITABLE]: 'La sustentación ya no se puede modificar.',
  [ErrorCode.DEFENSE_NOT_JUROR]: 'Solo los jurados activos de la tesis pueden confirmar asistencia.',
  [ErrorCode.MINUTES_NOT_FOUND]: 'El acta no existe.',
  [ErrorCode.MINUTES_EXISTS]: 'El acta de esta tesis ya existe.',
  [ErrorCode.MINUTES_INVALID_GRADE]: 'Una calificación menor a 3.0 exige el veredicto Reprobada.',
  [ErrorCode.MINUTES_SEALED]: 'El acta está sellada y no admite cambios.',
  [ErrorCode.MINUTES_SIGNED]: 'El acta ya tiene firmas y no se puede editar.',
  [ErrorCode.MINUTES_SIGN_ORDER]: 'Los jurados firman primero; el coordinador firma al final.',
  [ErrorCode.MINUTES_NOT_SIGNER]: 'Usted no es firmante de esta acta.',
  [ErrorCode.MINUTES_THESIS_STATUS]: 'La tesis debe tener la sustentación programada.',
  [ErrorCode.NOTIFICATION_NOT_FOUND]: 'La notificación no existe.',
};

/** Client-only codes. */
const EXTRA_ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: 'No se pudo conectar con el servidor.',
  UPLOAD_FAILED: 'No se pudo subir el archivo al almacenamiento. Intente de nuevo.',
  DOWNLOAD_FAILED: 'No se pudo descargar el archivo. Intente de nuevo.',
};

export function errorText(code: string | undefined, fallback?: string): string {
  // Never surface the server's English validation message.
  if (code === ErrorCode.VALIDATION_FAILED || code === 'VALIDATION_ERROR') return 'Revise los datos del formulario.';
  if (code && code in ERROR_MESSAGES) return ERROR_MESSAGES[code as ErrorCode]!;
  if (code && code in EXTRA_ERROR_MESSAGES) return EXTRA_ERROR_MESSAGES[code]!;
  return fallback ?? 'Ocurrió un error inesperado.';
}

export const VERDICT_LABELS: Record<EvaluationVerdict, string> = {
  APPROVED_FOR_DEFENSE: 'Aprobado para sustentar',
  APPROVED_WITH_CHANGES: 'Aprobado con modificaciones',
  REJECTED: 'No aprobado / Rechazado',
  APPROVED: 'Aprobado (dirimente)',
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  PENDING: 'Pendiente',
  ADDRESSED: 'Atendida',
  RESOLVED: 'Aprobada-Subsanada',
};
export const FEEDBACK_STATUS_COLORS: Record<FeedbackStatus, string> = {
  PENDING: 'warning',
  ADDRESSED: 'info',
  RESOLVED: 'success',
};

export const MODALITY_LABELS: Record<DefenseModality, string> = {
  IN_PERSON: 'Presencial',
  VIRTUAL: 'Virtual',
  HYBRID: 'Híbrida',
};

export const MINUTES_VERDICT_LABELS: Record<MinutesVerdict, string> = {
  APPROVED: 'Aprobada',
  APPROVED_MERITORIOUS: 'Aprobada con Mención Meritoria',
  APPROVED_LAUREATE: 'Aprobada con Mención Laureada',
  FAILED: 'Reprobada',
};

export const DEFENSE_STATUS_LABELS: Record<string, string> = {
  PROPOSED: 'Propuesta',
  CONFIRMED: 'Confirmada',
  HELD: 'Realizada',
  CANCELLED: 'Cancelada',
};

export const formatDate = (d?: string | Date | null, withTime = false): string => {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    ...(withTime && { hour: '2-digit', minute: '2-digit' }),
  });
};

export const fullName = (u?: { firstName?: string; lastName?: string } | null): string =>
  u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : '—';

/** "Estudiante" or "Estudiantes" for a comma-separated studentName (joint theses). */
export const studentLabel = (names?: string | null) => (names?.includes(', ') ? 'Estudiantes' : 'Estudiante');
