import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import {
  AssignmentStatus,
  DefenseModality,
  DefenseStatus,
  ErrorCode,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { Assignment } from '../assignments/schemas/assignment.schema';
import { AppException } from '../common/errors/app.exception';
import { paginate } from '../common/pagination/paginate';
import { Paginated } from '../common/pagination/pagination.dto';
import { Actor, actorFrom } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { ThesisDocument } from '../theses/schemas/thesis.schema';
import { ThesesService } from '../theses/theses.service';
import { UsersService } from '../users/users.service';
import { WorkflowService } from '../workflow/workflow.service';
import { ActiveJuror, findActiveJurors, jurorFor } from './active-jurors';
import { DEFENSE_EVENTS, DefenseEvent } from './defense.events';
import {
  QueryDefensesDto,
  ScheduleDefenseDto,
  UpdateDefenseDto,
} from './dto/defense.dto';
import { Defense, DefenseDocument } from './schemas/defense.schema';

export interface DefenseView {
  id: string;
  thesisId: string;
  thesis: { id: string; code: string; title: string; studentName: string };
  scheduledAt: Date;
  modality: DefenseModality;
  location?: string;
  meetingUrl?: string;
  status: DefenseStatus;
  jurors: { userId: string; name: string; confirmedAt?: Date }[];
  createdAt: Date;
  updatedAt: Date;
}

const STAFF = [Role.ADMIN, Role.COORDINATOR];

const notFound = () =>
  new AppException(
    ErrorCode.DEFENSE_NOT_FOUND,
    HttpStatus.NOT_FOUND,
    'Defense not found',
  );
const invalid = (message: string) =>
  new AppException(
    ErrorCode.VALIDATION_FAILED,
    HttpStatus.BAD_REQUEST,
    message,
  );
const notEditable = (status: DefenseStatus) =>
  new AppException(
    ErrorCode.DEFENSE_NOT_EDITABLE,
    HttpStatus.CONFLICT,
    `Defense is ${status}`,
    { status },
  );

type Fields = Pick<
  Defense,
  'scheduledAt' | 'modality' | 'location' | 'meetingUrl'
>;

/** CU-03 field rules: future date; VIRTUAL/HYBRID need a URL, IN_PERSON/HYBRID a location. */
function normalizeFields(input: {
  scheduledAt: string | Date;
  modality: DefenseModality;
  location?: string;
  meetingUrl?: string;
}): Fields {
  const scheduledAt = new Date(input.scheduledAt);
  if (!(scheduledAt.getTime() > Date.now()))
    throw invalid('scheduledAt must be in the future');
  const needsUrl = input.modality !== DefenseModality.IN_PERSON;
  const needsLocation = input.modality !== DefenseModality.VIRTUAL;
  if (needsUrl && !input.meetingUrl)
    throw invalid(`meetingUrl is required for ${input.modality}`);
  if (needsLocation && !input.location)
    throw invalid(`location is required for ${input.modality}`);
  return {
    scheduledAt,
    modality: input.modality,
    location: needsLocation ? input.location : undefined,
    meetingUrl: needsUrl ? input.meetingUrl : undefined,
  };
}

@Injectable()
export class DefensesService {
  constructor(
    @InjectModel(Defense.name) private readonly model: Model<Defense>,
    @InjectModel(Assignment.name)
    private readonly assignments: Model<Assignment>,
    private readonly theses: ThesesService,
    private readonly users: UsersService,
    private readonly workflow: WorkflowService,
    private readonly events: EventEmitter2,
  ) {}

  activeJurors(thesisId: Types.ObjectId | string): Promise<ActiveJuror[]> {
    return findActiveJurors(this.assignments, thesisId);
  }

  /** The current non-cancelled defense of a thesis (PROPOSED, CONFIRMED or HELD). */
  findOpenForThesis(
    thesisId: Types.ObjectId | string,
  ): Promise<DefenseDocument | null> {
    return this.model.findOne({ thesisId, isOpen: true }).exec();
  }

  /** CU-04: creating the minutes marks the confirmed defense as held. */
  async markHeld(defenseId: Types.ObjectId): Promise<void> {
    await this.model
      .updateOne(
        { _id: defenseId, status: DefenseStatus.CONFIRMED },
        { $set: { status: DefenseStatus.HELD } },
      )
      .exec();
  }

  async list(
    query: QueryDefensesDto,
    user: AuthUser,
  ): Promise<Paginated<DefenseView>> {
    const filter: FilterQuery<Defense> = {};
    if (query.status) filter.status = query.status;
    if (query.from || query.to) {
      filter.scheduledAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }
    if (!user.roles.some((r) => STAFF.includes(r))) {
      // Jurors: only defenses of theses where they hold an accepted assignment.
      const own: FilterQuery<Assignment> = {
        jurorId: user.id,
        isActive: true,
        status: AssignmentStatus.ACCEPTED,
      };
      if (user.scope) own._id = { $in: user.scope.assignmentIds };
      filter.thesisId = {
        $in: await this.assignments.distinct('thesisId', own),
      };
    }
    const page = await paginate(this.model, filter, query, {
      sortFields: { scheduledAt: 'scheduledAt', createdAt: 'createdAt' },
      defaultSort: 'scheduledAt',
    });
    return { ...page, items: await this.toViews(page.items) };
  }

  async findForThesis(
    thesisId: string,
    user: AuthUser,
  ): Promise<DefenseView | null> {
    const thesis = await this.theses.findReadable(thesisId, user);
    const defense = await this.findOpenForThesis(thesis._id);
    return defense ? (await this.toViews([defense], [thesis]))[0] : null;
  }

  async findOneView(id: string, user: AuthUser): Promise<DefenseView> {
    const { defense, thesis } = await this.findReadable(id, user);
    return (await this.toViews([defense], [thesis]))[0];
  }

  async schedule(
    thesisId: string,
    dto: ScheduleDefenseDto,
    user: AuthUser,
  ): Promise<DefenseView> {
    const thesis = await this.theses.findById(thesisId);
    if (thesis.status !== ThesisStatus.READY_FOR_DEFENSE) {
      throw new AppException(
        ErrorCode.DEFENSE_THESIS_STATUS,
        HttpStatus.CONFLICT,
        'The thesis is not ready for defense',
        { status: thesis.status },
      );
    }
    const fields = normalizeFields(dto);
    if (await this.findOpenForThesis(thesis._id)) throw this.exists();
    let defense: DefenseDocument;
    try {
      defense = await this.model.create({
        ...fields,
        thesisId: thesis._id,
        createdBy: new Types.ObjectId(user.id),
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw this.exists();
      throw err;
    }
    this.emit(
      DEFENSE_EVENTS.PROPOSED,
      defense,
      actorFrom(user, Role.COORDINATOR),
    );
    return (await this.toViews([defense], [thesis]))[0];
  }

  /** While PROPOSED; any change clears the confirmations. */
  async update(
    id: string,
    dto: UpdateDefenseDto,
    user: AuthUser,
  ): Promise<DefenseView> {
    const { defense, thesis } = await this.findReadable(id, user);
    if (defense.status !== DefenseStatus.PROPOSED)
      throw notEditable(defense.status);
    const fields = normalizeFields({
      scheduledAt: dto.scheduledAt ?? defense.scheduledAt,
      modality: dto.modality ?? defense.modality,
      location: dto.location ?? defense.location,
      meetingUrl: dto.meetingUrl ?? defense.meetingUrl,
    });
    const updated = await this.model
      .findOneAndUpdate(
        { _id: defense._id, status: DefenseStatus.PROPOSED },
        this.updateDoc(fields),
        { new: true, runValidators: true },
      )
      .exec();
    if (!updated) throw notEditable(DefenseStatus.CONFIRMED);
    return (await this.toViews([updated], [thesis]))[0];
  }

  async confirm(id: string, user: AuthUser): Promise<DefenseView> {
    const { defense, thesis } = await this.findReadable(id, user);
    if (defense.status !== DefenseStatus.PROPOSED)
      throw notEditable(defense.status);
    const jurors = await this.activeJurors(thesis._id);
    if (!jurorFor(jurors, user)) {
      throw new AppException(
        ErrorCode.DEFENSE_NOT_JUROR,
        HttpStatus.FORBIDDEN,
        'Only an active juror of the thesis can confirm',
      );
    }
    const userId = new Types.ObjectId(user.id);
    await this.model
      .updateOne(
        {
          _id: defense._id,
          status: DefenseStatus.PROPOSED,
          'confirmations.userId': { $ne: userId },
        },
        { $push: { confirmations: { userId, confirmedAt: new Date() } } },
      )
      .exec();
    let current = (await this.model.findById(defense._id).exec())!;
    const confirmed = new Set(
      current.confirmations.map((c) => c.userId.toHexString()),
    );
    if (
      current.status === DefenseStatus.PROPOSED &&
      jurors.every((j) => confirmed.has(j.userId))
    ) {
      const won = await this.model
        .findOneAndUpdate(
          { _id: defense._id, status: DefenseStatus.PROPOSED },
          { $set: { status: DefenseStatus.CONFIRMED } },
          { new: true },
        )
        .exec();
      if (won) {
        current = won;
        const actor = actorFrom(user, Role.INTERNAL_JUROR, Role.EXTERNAL_JUROR);
        await this.workflow.transition({
          thesisId: thesis.id as string,
          to: ThesisStatus.DEFENSE_SCHEDULED,
          expectedFrom: [ThesisStatus.READY_FOR_DEFENSE],
          actor,
          reason: 'All jurors confirmed the defense',
        });
        this.emit(DEFENSE_EVENTS.CONFIRMED, current, actor);
      }
    }
    return (await this.toViews([current], [thesis]))[0];
  }

  async cancel(id: string, user: AuthUser): Promise<DefenseView> {
    const { defense, thesis } = await this.findReadable(id, user);
    const updated = await this.model
      .findOneAndUpdate(
        { _id: defense._id, status: DefenseStatus.PROPOSED },
        { $set: { status: DefenseStatus.CANCELLED, isOpen: false } },
        { new: true },
      )
      .exec();
    if (!updated) throw notEditable(defense.status);
    this.emit(
      DEFENSE_EVENTS.CANCELLED,
      updated,
      actorFrom(user, Role.COORDINATOR),
    );
    return (await this.toViews([updated], [thesis]))[0];
  }

  /** $set the fields and clear confirmations; $unset the optional fields the modality drops. */
  private updateDoc(fields: Fields) {
    const $set: Record<string, unknown> = {
      scheduledAt: fields.scheduledAt,
      modality: fields.modality,
      confirmations: [],
    };
    const $unset: Record<string, ''> = {};
    for (const key of ['location', 'meetingUrl'] as const) {
      if (fields[key]) $set[key] = fields[key];
      else $unset[key] = '';
    }
    return Object.keys($unset).length ? { $set, $unset } : { $set };
  }

  private async findReadable(
    id: string,
    user: AuthUser,
  ): Promise<{ defense: DefenseDocument; thesis: ThesisDocument }> {
    const defense = await this.model.findById(id).exec();
    if (!defense) throw notFound();
    try {
      const thesis = await this.theses.findReadable(
        defense.thesisId.toHexString(),
        user,
      );
      return { defense, thesis };
    } catch {
      throw notFound();
    }
  }

  private exists() {
    return new AppException(
      ErrorCode.DEFENSE_EXISTS,
      HttpStatus.CONFLICT,
      'The thesis already has an open defense',
    );
  }

  private emit(name: string, defense: DefenseDocument, actor: Actor): void {
    const event: DefenseEvent = {
      thesisId: defense.thesisId.toHexString(),
      defenseId: defense.id as string,
      actor,
    };
    this.events.emit(name, event);
  }

  private async toViews(
    defenses: DefenseDocument[],
    knownTheses: ThesisDocument[] = [],
  ): Promise<DefenseView[]> {
    if (!defenses.length) return [];
    const thesisIds = [
      ...new Set(defenses.map((d) => d.thesisId.toHexString())),
    ];
    const known = new Set(knownTheses.map((t) => t.id as string));
    const theses = [
      ...knownTheses,
      ...(await this.theses.findManyByIds(
        thesisIds.filter((id) => !known.has(id)),
      )),
    ];
    const thesisById = new Map(theses.map((t) => [t.id as string, t]));
    const jurorsByThesis = new Map<string, ActiveJuror[]>();
    for (const id of thesisIds)
      jurorsByThesis.set(id, await this.activeJurors(id));
    const userIds = [
      ...new Set([...jurorsByThesis.values()].flat().map((j) => j.userId)),
    ];
    const users = await this.users.findManyByIds(userIds);
    const nameById = new Map(
      users.map((u) => [u.id as string, `${u.firstName} ${u.lastName}`]),
    );
    return defenses.map((d) => {
      const tid = d.thesisId.toHexString();
      const t = thesisById.get(tid);
      const confirmedAt = new Map(
        d.confirmations.map((c) => [c.userId.toHexString(), c.confirmedAt]),
      );
      return {
        id: d.id as string,
        thesisId: tid,
        thesis: {
          id: tid,
          code: t?.code ?? '',
          title: t?.title ?? '',
          studentName: t?.studentName ?? '',
        },
        scheduledAt: d.scheduledAt,
        modality: d.modality,
        location: d.location,
        meetingUrl: d.meetingUrl,
        status: d.status,
        jurors: (jurorsByThesis.get(tid) ?? []).map((j) => ({
          userId: j.userId,
          name: nameById.get(j.userId) ?? '',
          confirmedAt: confirmedAt.get(j.userId),
        })),
        createdAt: (d as unknown as { createdAt: Date }).createdAt,
        updatedAt: (d as unknown as { updatedAt: Date }).updatedAt,
      };
    });
  }
}
