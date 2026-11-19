import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { EvaluationStatus } from '@thesis/shared';
import { Connection, Model } from 'mongoose';
import { Assignment } from '../assignments/schemas/assignment.schema';
import type { AuthUser } from '../common/types/auth-user';
import { Defense } from '../defenses/schemas/defense.schema';
import { Minutes } from '../minutes/schemas/minutes.schema';
import { ThesesService } from '../theses/theses.service';
import { isStaff } from '../theses/thesis-view';

export type GraphNodeKind =
  'STATUS' | 'ASSIGNMENT' | 'EVALUATION' | 'DEFENSE' | 'MINUTES';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  at: string;
  status?: string;
  current?: boolean;
}
export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

const STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Tesis radicada',
  JURORS_ASSIGNED: 'Jurados asignados',
  PENDING_JUROR_REPLACEMENT: 'Pendiente de reemplazo de jurado',
  UNDER_EVALUATION: 'En evaluación',
  IN_DISPUTE: 'En disputa',
  REVISIONS_IN_PROGRESS: 'Correcciones en curso',
  READY_FOR_DEFENSE: 'Lista para sustentación',
  DEFENSE_SCHEDULED: 'Sustentación programada',
  NOT_APPROVED: 'No aprobada',
  COMPLETED_APPROVED: 'Finalizada: aprobada',
  COMPLETED_FAILED: 'Finalizada: reprobada',
};
const ASSIGNMENT_LABELS: Record<string, string> = {
  PENDING: 'pendiente de respuesta',
  ACCEPTED: 'aceptada',
  DECLINED: 'rechazada',
  EXPIRED: 'vencida',
  REPLACED: 'reemplazada',
};
const EVALUATION_LABELS: Record<string, string> = {
  DRAFT: 'en borrador',
  SUBMITTED: 'enviada',
};
const DEFENSE_LABELS: Record<string, string> = {
  PROPOSED: 'propuesta',
  CONFIRMED: 'confirmada',
  HELD: 'realizada',
  CANCELLED: 'cancelada',
};
const MINUTES_LABELS: Record<string, string> = {
  DRAFT: 'en borrador',
  SEALED: 'sellada',
};

interface EvaluationRow {
  _id: unknown;
  jurorId?: { toString(): string };
  status?: string;
  verdict?: string;
  submittedAt?: Date;
  createdAt?: Date;
}

interface Stamped {
  createdAt: Date;
}

@Injectable()
export class TraceabilityService {
  constructor(
    private readonly theses: ThesesService,
    @InjectModel(Assignment.name)
    private readonly assignments: Model<Assignment>,
    @InjectModel(Defense.name) private readonly defenses: Model<Defense>,
    @InjectModel(Minutes.name) private readonly minutes: Model<Minutes>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async graph(id: string, user: AuthUser) {
    const thesis = await this.theses.findReadable(id, user);
    const entries = [...thesis.history]
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((h) => ({ to: h.to, at: h.at, reason: h.reason }));
    if (!entries.length) {
      entries.push({
        to: thesis.status,
        at: (thesis as unknown as Stamped).createdAt,
        reason: undefined,
      });
    }

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const statusNodes: GraphNode[] = entries.map((h, i) => ({
      id: `status-${i}`,
      kind: 'STATUS',
      label: STATUS_LABELS[h.to] ?? h.to,
      at: h.at.toISOString(),
      status: h.to,
      current: i === entries.length - 1,
    }));
    statusNodes.forEach((node, i) => {
      nodes.push(node);
      if (i > 0) {
        const reason = entries[i].reason;
        edges.push({
          from: statusNodes[i - 1].id,
          to: node.id,
          ...(reason ? { label: reason } : {}),
        });
      }
    });

    /** The STATUS node active at `at`: the last one entered at or before it. */
    const owner = (at: Date): GraphNode => {
      let found = statusNodes[0];
      for (const n of statusNodes) {
        if (Date.parse(n.at) <= at.getTime()) found = n;
      }
      return found;
    };
    const attach = (node: GraphNode, at: Date) => {
      nodes.push(node);
      edges.push({ from: owner(at).id, to: node.id });
    };

    const [assignments, defenses, minutes, evaluations] = await Promise.all([
      this.assignments
        .find({ thesisId: thesis._id })
        .sort({ assignedAt: 1 })
        .lean()
        .exec(),
      this.defenses
        .find({ thesisId: thesis._id })
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
      this.minutes.find({ thesisId: thesis._id }).lean().exec(),
      this.evaluations(thesis._id),
    ]);

    for (const a of assignments) {
      attach(
        {
          id: `assignment-${String(a._id)}`,
          kind: 'ASSIGNMENT',
          label: `Asignación de jurado ${a.slot}: ${ASSIGNMENT_LABELS[a.status] ?? a.status}`,
          at: a.assignedAt.toISOString(),
          status: a.status,
        },
        a.assignedAt,
      );
    }
    const staff = isStaff(user);
    for (const e of evaluations) {
      const submitted = e.status === EvaluationStatus.SUBMITTED;
      // Drafts are private: only staff and the draft's own author see them.
      if (!submitted && !staff && e.jurorId?.toString() !== user.id) continue;
      const at = e.submittedAt ?? e.createdAt;
      if (!at) continue;
      const state = EVALUATION_LABELS[e.status ?? ''] ?? e.status ?? '';
      // A draft label never carries the verdict.
      const verdict = submitted && e.verdict ? ` (${e.verdict})` : '';
      attach(
        {
          id: `evaluation-${String(e._id)}`,
          kind: 'EVALUATION',
          label: `Evaluación ${state}${verdict}`.trim(),
          at: at.toISOString(),
          status: e.status,
        },
        at,
      );
    }
    for (const d of defenses) {
      const created = (d as unknown as Stamped).createdAt;
      attach(
        {
          id: `defense-${String(d._id)}`,
          kind: 'DEFENSE',
          label: `Sustentación ${DEFENSE_LABELS[d.status] ?? d.status}`,
          at: created.toISOString(),
          status: d.status,
        },
        created,
      );
    }
    for (const m of minutes) {
      const at = m.sealedAt ?? (m as unknown as Stamped).createdAt;
      attach(
        {
          id: `minutes-${String(m._id)}`,
          kind: 'MINUTES',
          label: `Acta ${m.number} ${MINUTES_LABELS[m.status] ?? m.status}`,
          at: at.toISOString(),
          status: m.status,
        },
        at,
      );
    }

    return {
      thesisId: thesis.id as string,
      status: thesis.status,
      progress: thesis.progress,
      nodes,
      edges,
    };
  }

  /** Raw read: the evaluations module may not exist yet; a missing collection yields []. */
  private async evaluations(thesisId: unknown): Promise<EvaluationRow[]> {
    try {
      return await this.connection
        .collection<EvaluationRow>('evaluations')
        .find({ thesisId } as Record<string, unknown>)
        .sort({ _id: 1 })
        .toArray();
    } catch {
      return [];
    }
  }
}
