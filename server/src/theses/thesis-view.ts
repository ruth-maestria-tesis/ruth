import { Role } from '@thesis/shared';
import type { AuthUser } from '../common/types/auth-user';
import type { ThesisDocument } from './schemas/thesis.schema';
import type { JurorAccess } from './thesis-access.policy';

/** Who is looking at the thesis: staff, the owner student, or a juror with an access level. */
export type ThesisAudience =
  | { kind: 'STAFF' }
  | { kind: 'STUDENT' }
  | { kind: 'JUROR'; access: JurorAccess };

/** Staff = an unscoped ADMIN or COORDINATOR session. */
export function isStaff(user: AuthUser): boolean {
  return (
    !user.scope &&
    (user.roles.includes(Role.ADMIN) || user.roles.includes(Role.COORDINATOR))
  );
}

/** Fields only staff may see. */
const STAFF_ONLY_FIELDS = ['conflictOfInterestUserIds', 'seedTag'] as const;

type Json = Record<string, unknown>;

/**
 * Role-specific thesis representation (privacy). Staff get the whole document. Students and
 * jurors lose conflicts of interest, the seed tag and the actor/evidence ids of history
 * entries; jurors see manuscripts only with MANUSCRIPT access (an ACCEPTED assignment).
 */
export function toThesisView(
  thesis: ThesisDocument,
  audience: ThesisAudience,
): Json {
  const json = thesis.toJSON() as Json;
  if (audience.kind === 'STAFF') return json;
  for (const field of STAFF_ONLY_FIELDS) delete json[field];
  if (Array.isArray(json.history)) {
    json.history = (json.history as Json[]).map((entry) => ({
      from: entry.from ?? null,
      to: entry.to,
      at: entry.at,
      actorRole: entry.actorRole,
      ...(entry.reason !== undefined && { reason: entry.reason }),
    }));
  }
  if (audience.kind === 'JUROR' && audience.access !== 'MANUSCRIPT') {
    json.manuscripts = [];
    delete json.currentManuscriptId;
  }
  return json;
}
