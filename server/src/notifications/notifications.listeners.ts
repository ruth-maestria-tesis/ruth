import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Role } from '@thesis/shared';
import { Model, Types } from 'mongoose';
import { ASSIGNMENT_EVENTS } from '../assignments/assignment.events';
import type { AssignmentEvent } from '../assignments/assignment.events';
import { Assignment } from '../assignments/schemas/assignment.schema';
import { findActiveJurors } from '../defenses/active-jurors';
import { Evaluation } from '../evaluations/schemas/evaluation.schema';
import { Thesis } from '../theses/schemas/thesis.schema';
import { THESIS_STATUS_CHANGED } from '../workflow/workflow.events';
import type { ThesisStatusChangedEvent } from '../workflow/workflow.events';
import { NotificationsService } from './notifications.service';
import type { NotificationPayload } from './notifications.service';

/** Payloads of events owned by other modules: every field optional, guarded before use. */
interface LooseEvent {
  thesisId?: unknown;
  jurorId?: unknown;
  studentId?: unknown;
  evaluationId?: unknown;
  defenseId?: unknown;
  minutesId?: unknown;
  verdict?: unknown;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v
    ? v
    : v instanceof Types.ObjectId
      ? v.toHexString()
      : undefined;

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: 'Radicada',
  JURORS_ASSIGNED: 'Jurados asignados',
  PENDING_JUROR_REPLACEMENT: 'Pendiente de reemplazo de jurado',
  UNDER_EVALUATION: 'En evaluación',
  IN_DISPUTE: 'En desacuerdo (tercer jurado)',
  REVISIONS_IN_PROGRESS: 'En correcciones',
  READY_FOR_DEFENSE: 'Lista para sustentación',
  DEFENSE_SCHEDULED: 'Sustentación programada',
  NOT_APPROVED: 'No aprobada',
  COMPLETED_APPROVED: 'Finalizada (aprobada)',
  COMPLETED_FAILED: 'Finalizada (reprobada)',
};

interface ThesisInfo {
  id: string;
  label: string;
  studentId: string;
  advisorId?: string;
}

@Injectable()
export class NotificationsListeners {
  private readonly logger = new Logger(NotificationsListeners.name);

  constructor(
    private readonly notifications: NotificationsService,
    @InjectModel(Thesis.name) private readonly theses: Model<Thesis>,
    @InjectModel(Assignment.name)
    private readonly assignments: Model<Assignment>,
    @InjectModel(Evaluation.name)
    private readonly evaluations: Model<Evaluation>,
  ) {}

  /** Listeners never throw into the emitter. */
  private async safe(event: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(
        `Failed to create notifications for "${event}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async thesisInfo(thesisId?: string): Promise<ThesisInfo | null> {
    if (!thesisId || !Types.ObjectId.isValid(thesisId)) return null;
    const t = await this.theses
      .findById(thesisId, { code: 1, title: 1, studentId: 1, advisorId: 1 })
      .lean()
      .exec();
    if (!t) return null;
    return {
      id: String(t._id),
      label: `${t.code} — ${t.title}`,
      studentId: String(t.studentId),
      advisorId: t.advisorId ? String(t.advisorId) : undefined,
    };
  }

  /** Same rule as the defenses module: ACCEPTED primaries + a tiebreaker that SUBMITTED. */
  private async activeJurorIds(thesisId: string): Promise<string[]> {
    const jurors = await findActiveJurors(
      this.assignments,
      this.evaluations,
      new Types.ObjectId(thesisId),
    );
    return jurors.map((j) => j.userId);
  }

  /** Student (+ active jurors / coordinators) of a thesis, for the loosely typed events. */
  private async fanOut(
    event: string,
    e: LooseEvent | undefined,
    audience: { student?: boolean; jurors?: boolean; coordinators?: boolean },
    build: (label: string) => Pick<NotificationPayload, 'title' | 'body'> & {
      link: string;
      entity: { kind: string; id?: string };
    },
  ): Promise<void> {
    const thesisId = str(e?.thesisId);
    const t = await this.thesisInfo(thesisId);
    const b = build(t?.label ?? 'la tesis');
    const payload: NotificationPayload = {
      type: event,
      title: b.title,
      body: b.body,
      link: b.link,
      entityRef: { kind: b.entity.kind, id: b.entity.id ?? thesisId ?? '' },
      ...(t ? { thesisId: t.id } : {}),
    };
    if (!payload.entityRef?.id) delete payload.entityRef;
    const ids: string[] = [];
    if (t && audience.student) ids.push(t.studentId);
    if (t && audience.jurors) ids.push(...(await this.activeJurorIds(t.id)));
    await this.notifications.notify(ids, payload);
    if (audience.coordinators) {
      await this.notifications.notifyRole(Role.COORDINATOR, {
        ...payload,
        link: thesisId ? `/coordinator/theses/${thesisId}` : '/coordinator',
      });
    }
  }

  // ---- assignments ----

  @OnEvent(ASSIGNMENT_EVENTS.CREATED)
  onAssignmentCreated(e: AssignmentEvent) {
    return this.safe(ASSIGNMENT_EVENTS.CREATED, async () => {
      const t = await this.thesisInfo(e.thesisId);
      await this.notifications.notify([e.jurorId], {
        type: ASSIGNMENT_EVENTS.CREATED,
        title: 'Nueva asignación como jurado',
        body: `Fuiste asignado como jurado de la tesis ${t?.label ?? ''}. Responde dentro del plazo.`,
        link: '/juror',
        entityRef: { kind: 'assignment', id: e.assignmentId },
        thesisId: e.thesisId,
      });
    });
  }

  private notifyCoordinators(
    event: string,
    e: AssignmentEvent,
    title: string,
    what: string,
  ) {
    return this.safe(event, async () => {
      const t = await this.thesisInfo(e.thesisId);
      await this.notifications.notifyRole(Role.COORDINATOR, {
        type: event,
        title,
        body: `${what} de la tesis ${t?.label ?? ''}.${e.reason ? ` Motivo: ${e.reason}` : ''}`,
        link: `/coordinator/theses/${e.thesisId}`,
        entityRef: { kind: 'assignment', id: e.assignmentId },
        thesisId: e.thesisId,
      });
    });
  }

  @OnEvent(ASSIGNMENT_EVENTS.ACCEPTED)
  onAssignmentAccepted(e: AssignmentEvent) {
    return this.notifyCoordinators(
      ASSIGNMENT_EVENTS.ACCEPTED,
      e,
      'Asignación aceptada',
      'Un jurado aceptó la asignación',
    );
  }

  @OnEvent(ASSIGNMENT_EVENTS.DECLINED)
  onAssignmentDeclined(e: AssignmentEvent) {
    return this.notifyCoordinators(
      ASSIGNMENT_EVENTS.DECLINED,
      e,
      'Asignación rechazada',
      'Un jurado rechazó la asignación',
    );
  }

  @OnEvent(ASSIGNMENT_EVENTS.EXPIRED)
  onAssignmentExpired(e: AssignmentEvent) {
    return this.notifyCoordinators(
      ASSIGNMENT_EVENTS.EXPIRED,
      e,
      'Asignación vencida',
      'Venció el plazo de respuesta de un jurado en la asignación',
    );
  }

  @OnEvent(ASSIGNMENT_EVENTS.REPLACED)
  onAssignmentReplaced(e: AssignmentEvent) {
    return this.safe(ASSIGNMENT_EVENTS.REPLACED, async () => {
      const t = await this.thesisInfo(e.thesisId);
      await this.notifications.notify([e.jurorId], {
        type: ASSIGNMENT_EVENTS.REPLACED,
        title: 'Asignación reemplazada',
        body: `Tu asignación como jurado de la tesis ${t?.label ?? ''} fue reemplazada por la coordinación.`,
        link: '/juror',
        entityRef: { kind: 'assignment', id: e.assignmentId },
        thesisId: e.thesisId,
      });
    });
  }

  // ---- workflow ----

  @OnEvent(THESIS_STATUS_CHANGED)
  onThesisStatusChanged(e: ThesisStatusChangedEvent) {
    return this.safe(THESIS_STATUS_CHANGED, async () => {
      const t = await this.thesisInfo(e.thesisId);
      if (!t) return;
      const status = STATUS_LABEL[e.to] ?? e.to;
      await this.notifications.notify([t.studentId], {
        type: THESIS_STATUS_CHANGED,
        title: 'Cambio de estado de tu tesis',
        body: `Tu tesis ${t.label} cambió a: ${status}.`,
        link: '/student',
        entityRef: { kind: 'thesis', id: e.thesisId },
        thesisId: t.id,
      });
      if (t.advisorId && t.advisorId !== t.studentId) {
        await this.notifications.notify([t.advisorId], {
          type: THESIS_STATUS_CHANGED,
          title: 'Cambio de estado de una tesis que diriges',
          body: `La tesis ${t.label} cambió a: ${status}.`,
          entityRef: { kind: 'thesis', id: e.thesisId },
          thesisId: t.id,
        });
      }
    });
  }

  // ---- events owned by other teams (defensive payloads) ----

  @OnEvent('evaluation.submitted')
  onEvaluationSubmitted(e?: LooseEvent) {
    return this.safe('evaluation.submitted', () =>
      this.fanOut(
        'evaluation.submitted',
        e,
        { student: true, coordinators: true },
        (label) => ({
          title: 'Evaluación enviada',
          body: `Un jurado envió su evaluación de la tesis ${label}.`,
          link: '/student',
          entity: { kind: 'evaluation', id: str(e?.evaluationId) },
        }),
      ),
    );
  }

  @OnEvent('feedback.created')
  onFeedbackCreated(e?: LooseEvent) {
    return this.safe('feedback.created', async () => {
      const thesisId = str(e?.thesisId);
      const t = await this.thesisInfo(thesisId);
      await this.notifications.notify([str(e?.studentId) ?? t?.studentId], {
        type: 'feedback.created',
        title: 'Nueva observación de un jurado',
        body: `Recibiste una observación sobre la tesis ${t?.label ?? ''}. Revísala y atiéndela.`,
        link: '/student',
        ...(t
          ? { entityRef: { kind: 'thesis', id: t.id }, thesisId: t.id }
          : {}),
      });
    });
  }

  @OnEvent('feedback.addressed')
  onFeedbackAddressed(e?: LooseEvent) {
    return this.safe('feedback.addressed', async () => {
      const thesisId = str(e?.thesisId);
      const t = await this.thesisInfo(thesisId);
      await this.notifications.notify([str(e?.jurorId)], {
        type: 'feedback.addressed',
        title: 'Observación atendida',
        body: `El estudiante atendió una observación tuya en la tesis ${t?.label ?? ''}.`,
        link: '/juror',
        ...(t
          ? { entityRef: { kind: 'thesis', id: t.id }, thesisId: t.id }
          : {}),
      });
    });
  }

  @OnEvent('feedback.reopened')
  onFeedbackReopened(e?: LooseEvent) {
    return this.safe('feedback.reopened', async () => {
      const thesisId = str(e?.thesisId);
      const t = await this.thesisInfo(thesisId);
      await this.notifications.notify([str(e?.studentId) ?? t?.studentId], {
        type: 'feedback.reopened',
        title: 'Observación reabierta',
        body: `Un jurado reabrió una observación sobre la tesis ${t?.label ?? ''}. Revísala y atiéndela de nuevo.`,
        link: '/student',
        ...(t
          ? { entityRef: { kind: 'thesis', id: t.id }, thesisId: t.id }
          : {}),
      });
    });
  }

  @OnEvent('defense.cancelled')
  onDefenseCancelled(e?: LooseEvent) {
    return this.safe('defense.cancelled', () =>
      this.fanOut(
        'defense.cancelled',
        e,
        { student: true, jurors: true },
        (label) => ({
          title: 'Sustentación cancelada',
          body: `Se canceló la sustentación de la tesis ${label}.`,
          link: '/student',
          entity: { kind: 'defense', id: str(e?.defenseId) },
        }),
      ),
    );
  }

  @OnEvent('defense.updated')
  onDefenseUpdated(e?: LooseEvent) {
    return this.safe('defense.updated', () =>
      this.fanOut(
        'defense.updated',
        e,
        { student: true, jurors: true },
        (label) => ({
          title: 'Sustentación reprogramada',
          body: `La sustentación de la tesis ${label} fue reprogramada, confirme de nuevo.`,
          link: '/student',
          entity: { kind: 'defense', id: str(e?.defenseId) },
        }),
      ),
    );
  }

  @OnEvent('defense.proposed')
  onDefenseProposed(e?: LooseEvent) {
    return this.safe('defense.proposed', () =>
      this.fanOut(
        'defense.proposed',
        e,
        { student: true, jurors: true },
        (label) => ({
          title: 'Fecha de sustentación propuesta',
          body: `Se propuso una fecha de sustentación para la tesis ${label}.`,
          link: '/student',
          entity: { kind: 'defense', id: str(e?.defenseId) },
        }),
      ),
    );
  }

  @OnEvent('defense.confirmed')
  onDefenseConfirmed(e?: LooseEvent) {
    return this.safe('defense.confirmed', () =>
      this.fanOut(
        'defense.confirmed',
        e,
        { student: true, coordinators: true },
        (label) => ({
          title: 'Sustentación confirmada',
          body: `Se confirmó la sustentación de la tesis ${label}.`,
          link: '/student',
          entity: { kind: 'defense', id: str(e?.defenseId) },
        }),
      ),
    );
  }

  @OnEvent('minutes.sealed')
  onMinutesSealed(e?: LooseEvent) {
    return this.safe('minutes.sealed', () =>
      this.fanOut(
        'minutes.sealed',
        e,
        { student: true, jurors: true },
        (label) => ({
          title: 'Acta de sustentación sellada',
          body: `El acta de la tesis ${label} fue firmada y sellada${str(e?.verdict) ? ` (resultado: ${str(e?.verdict)})` : ''}.`,
          link: '/student',
          entity: { kind: 'minutes', id: str(e?.minutesId) },
        }),
      ),
    );
  }
}
