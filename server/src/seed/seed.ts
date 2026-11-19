import { INestApplicationContext } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import {
  DefenseModality,
  EvaluationVerdict,
  FeedbackAction,
  FeedbackChapter,
  MinutesVerdict,
  PeriodTerm,
  ProgramLevel,
  Role,
  ThesisStatus,
} from '@thesis/shared';
import { Connection, Model, mongo, Types } from 'mongoose';
import { AssignmentResponsesService } from '../assignments/assignment-responses.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { Assignment } from '../assignments/schemas/assignment.schema';
import { CatalogsService } from '../catalogs/catalogs.service';
import { Cohort } from '../catalogs/schemas/cohort.schema';
import { Period } from '../catalogs/schemas/period.schema';
import { Program } from '../catalogs/schemas/program.schema';
import type { Actor } from '../common/types/actor';
import type { AuthUser } from '../common/types/auth-user';
import { DefensesService } from '../defenses/defenses.service';
import { Defense } from '../defenses/schemas/defense.schema';
import { EvaluationsService } from '../evaluations/evaluations.service';
import { Evaluation } from '../evaluations/schemas/evaluation.schema';
import { FeedbackService } from '../feedback/feedback.service';
import { FeedbackItem } from '../feedback/schemas/feedback-item.schema';
import { FilesService } from '../files/files.service';
import { MinutesService } from '../minutes/minutes.service';
import { Minutes } from '../minutes/schemas/minutes.schema';
import { Notification } from '../notifications/schemas/notification.schema';
import { Counter } from '../theses/schemas/counter.schema';
import { Thesis, ThesisDocument } from '../theses/schemas/thesis.schema';
import { ThesesService } from '../theses/theses.service';
import { UserDocument, User } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { escapeRegex } from '../common/utils/escape-regex';
import { renderManuscriptPdf } from './manuscript-pdf';
import {
  ADMIN,
  COORDINATOR,
  DEFAULT_SEED_TAG,
  EXTERNAL_JURORS,
  INTERNAL_JURORS,
  PASSWORDS,
  PROGRAM,
  STUDENTS,
  TOPICS,
} from './seed.data';

export interface SeedOptions {
  /** Defaults to DEMO; normalized to uppercase. */
  tag?: string;
  /** Delete the tagged documents first. */
  reset?: boolean;
  /** Allow running with NODE_ENV=production. */
  force?: boolean;
  log?: (message: string) => void;
}

export interface SeededThesis {
  code: string;
  status: ThesisStatus;
  studentEmail: string;
  title: string;
  note?: string;
}

export interface SeedCredential {
  role: string;
  email: string;
  password: string;
}

export interface SeedResult {
  tag: string;
  theses: SeededThesis[];
  credentials: SeedCredential[];
  externalLink?: { jurorEmail: string; thesisCode: string; url: string };
}

const BUCKET = 'files';
const DAY = 86_400_000;

/** Uppercase letters, digits and underscores; starts with a letter. */
export function normalizeSeedTag(raw: string = DEFAULT_SEED_TAG): string {
  const tag = raw.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(tag))
    throw new Error(
      `Invalid seed tag "${raw}": use 2-20 letters, digits or _ (starting with a letter)`,
    );
  return tag;
}

interface Models {
  users: Model<User>;
  theses: Model<Thesis>;
  assignments: Model<Assignment>;
  evaluations: Model<Evaluation>;
  feedback: Model<FeedbackItem>;
  defenses: Model<Defense>;
  minutes: Model<Minutes>;
  notifications: Model<Notification>;
  programs: Model<Program>;
  periods: Model<Period>;
  cohorts: Model<Cohort>;
  counters: Model<Counter>;
}

function models(app: INestApplicationContext): Models {
  const m = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
  return {
    users: m<User>(User.name),
    theses: m<Thesis>(Thesis.name),
    assignments: m<Assignment>(Assignment.name),
    evaluations: m<Evaluation>(Evaluation.name),
    feedback: m<FeedbackItem>(FeedbackItem.name),
    defenses: m<Defense>(Defense.name),
    minutes: m<Minutes>(Minutes.name),
    notifications: m<Notification>(Notification.name),
    programs: m<Program>(Program.name),
    periods: m<Period>(Period.name),
    cohorts: m<Cohort>(Cohort.name),
    counters: m<Counter>(Counter.name),
  };
}

const bucketOf = (app: INestApplicationContext) =>
  new mongo.GridFSBucket(app.get<Connection>(getConnectionToken()).db!, {
    bucketName: BUCKET,
  });

/** Distinct ObjectIds found in `field` of documents of `model` matching `filter`. */
async function referenced(
  model: Model<any>,
  field: string,
  filter: Record<string, unknown>,
): Promise<string[]> {
  const ids = (await model.distinct(field, filter).exec()) as unknown[];
  return ids.filter(Boolean).map(String);
}

/**
 * Deletes the documents tagged `tag` (and the counters/files the seed wrote). The shared catalogs
 * (program, periods) are never tagged, so they are never deleted. A tagged thesis, user or cohort
 * that untagged documents still reference is kept.
 */
export async function resetSeed(
  app: INestApplicationContext,
  rawTag?: string,
): Promise<Record<string, number>> {
  const tag = normalizeSeedTag(rawTag);
  const m = models(app);
  const removed: Record<string, number> = {};
  const oid = (ids: string[]) => ids.map((i) => new Types.ObjectId(i));

  // Notifications written by listeners after the seed finished are tagged here first.
  const userIds = (
    await m.users.find({ seedTag: tag }, { _id: 1 }).lean().exec()
  ).map((u) => u._id);
  if (userIds.length)
    await m.notifications
      .updateMany({ userId: { $in: userIds } }, { $set: { seedTag: tag } })
      .exec();

  // Theses that someone outside the seed has attached documents to stay (with their children).
  const taggedTheses = (
    await m.theses.find({ seedTag: tag }, { _id: 1 }).lean().exec()
  ).map((t) => t._id);
  const untagged = { seedTag: { $ne: tag } };
  const blocked = new Set<string>();
  for (const model of [
    m.assignments,
    m.evaluations,
    m.feedback,
    m.defenses,
    m.minutes,
  ] as Model<any>[])
    for (const id of await referenced(model, 'thesisId', {
      thesisId: { $in: taggedTheses },
      ...untagged,
    }))
      blocked.add(id);
  const bucket = bucketOf(app);
  const outsideFiles = await bucket
    .find({
      'metadata.thesisId': { $in: taggedTheses },
      'metadata.seedTag': { $ne: tag },
    })
    .toArray();
  for (const f of outsideFiles)
    blocked.add(String((f.metadata as { thesisId: Types.ObjectId }).thesisId));
  const keepTheses = oid([...blocked]);

  const files = await bucket
    .find({
      'metadata.seedTag': tag,
      'metadata.thesisId': { $nin: keepTheses },
    })
    .toArray();
  // FilesService also removes the bytes of blob-stored files (uploaded to seeded theses).
  const filesService = app.get(FilesService);
  for (const f of files) await filesService.delete(f._id.toHexString());
  removed.files = files.length;

  removed.notifications = (
    await m.notifications.deleteMany({ seedTag: tag }).exec()
  ).deletedCount;
  for (const [name, model] of [
    ['minutes', m.minutes],
    ['defenses', m.defenses],
    ['feedbackItems', m.feedback],
    ['evaluations', m.evaluations],
    ['assignments', m.assignments],
  ] as [string, Model<any>][])
    removed[name] = (
      await model
        .deleteMany({ seedTag: tag, thesisId: { $nin: keepTheses } })
        .exec()
    ).deletedCount;
  removed.theses = (
    await m.theses
      .deleteMany({ seedTag: tag, _id: { $nin: keepTheses } })
      .exec()
  ).deletedCount;

  // Users still referenced by remaining documents stay.
  const userRefs: [Model<any>, string][] = [
    [m.theses, 'studentId'],
    [m.theses, 'advisorId'],
    [m.theses, 'coAdvisorIds'],
    [m.assignments, 'jurorId'],
    [m.assignments, 'assignedBy'],
    [m.evaluations, 'jurorId'],
    [m.feedback, 'jurorId'],
    [m.feedback, 'authorId'],
    [m.defenses, 'createdBy'],
    [m.minutes, 'createdBy'],
    [m.minutes, 'requiredSigners.userId'],
  ];
  const keepUsers = new Set<string>();
  for (const [model, field] of userRefs)
    for (const id of await referenced(model, field, {
      [field]: { $in: userIds },
    }))
      keepUsers.add(id);
  removed.users = (
    await m.users
      .deleteMany({ seedTag: tag, _id: { $nin: oid([...keepUsers]) } })
      .exec()
  ).deletedCount;

  // Cohorts still used by remaining theses or users stay.
  const cohortIds = (
    await m.cohorts.find({ seedTag: tag }, { _id: 1 }).lean().exec()
  ).map((c) => c._id);
  const keepCohorts = new Set<string>([
    ...(await referenced(m.theses, 'cohortId', {
      cohortId: { $in: cohortIds },
    })),
    ...(await referenced(m.users, 'studentProfile.cohortId', {
      'studentProfile.cohortId': { $in: cohortIds },
    })),
  ]);
  removed.cohorts = (
    await m.cohorts
      .deleteMany({ seedTag: tag, _id: { $nin: oid([...keepCohorts]) } })
      .exec()
  ).deletedCount;

  // Thesis codes and minutes numbers of the seed carry the tag in their counter key
  // (thesis:DEMO-MIETIA-2026-I, minutes:DEMO-MIETIA-2026). Keep them while kept theses exist.
  removed.counters = keepTheses.length
    ? 0
    : (
        await m.counters
          .deleteMany({
            _id: new RegExp(`^(thesis|minutes):${escapeRegex(tag)}-`),
          })
          .exec()
      ).deletedCount;
  return removed;
}

/** Waits until the async notification listeners stop writing (count stable). */
async function settleNotifications(m: Models): Promise<void> {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const n = await m.notifications.estimatedDocumentCount().exec();
    if (n === last) return;
    last = n;
  }
}

const auth = (u: UserDocument): AuthUser => ({
  id: u.id as string,
  email: u.email,
  roles: u.roles,
});
const fullName = (u: UserDocument) => `${u.firstName} ${u.lastName}`;
const RUBRIC_GOOD = { methodology: 5, relevance: 4, writingQuality: 4 };
const RUBRIC_OK = { methodology: 4, relevance: 4, writingQuality: 3 };
const RUBRIC_LOW = { methodology: 2, relevance: 3, writingQuality: 2 };

/**
 * Builds the demo dataset through the real services, acting as the seeded users, so history,
 * events, deadlines and hashes are coherent. Every document gets `seedTag`.
 */
export async function runSeed(
  app: INestApplicationContext,
  opts: SeedOptions = {},
): Promise<SeedResult> {
  const tag = normalizeSeedTag(opts.tag);
  const log = opts.log ?? (() => undefined);
  if (process.env.NODE_ENV === 'production' && !opts.force)
    throw new Error(
      'Refusing to seed with NODE_ENV=production; pass --force to override',
    );
  const m = models(app);
  if (opts.reset) {
    const removed = await resetSeed(app, tag);
    log(`Reset ${tag}: ${JSON.stringify(removed)}`);
  }
  const createdUserIds: Types.ObjectId[] = [];
  const thesisIds: Types.ObjectId[] = [];
  try {
    return await buildSeed(app, tag, log, m, createdUserIds, thesisIds);
  } finally {
    // Also runs when the seed fails partway, so `--reset` can always remove what was written.
    try {
      await tagSeeded(app, tag, m, createdUserIds, thesisIds);
    } catch (e) {
      log(`Could not tag seeded documents: ${String(e)}`);
    }
  }
}

/** Tags the documents the services created on the seed's behalf (children of seeded theses...). */
async function tagSeeded(
  app: INestApplicationContext,
  tag: string,
  m: Models,
  userIds: Types.ObjectId[],
  thesisIds: Types.ObjectId[],
): Promise<void> {
  await settleNotifications(m);
  const byThesis = { thesisId: { $in: thesisIds } };
  const $set = { $set: { seedTag: tag } };
  await m.users.updateMany({ _id: { $in: userIds } }, $set).exec();
  await m.theses.updateMany({ _id: { $in: thesisIds } }, $set).exec();
  for (const model of [
    m.assignments,
    m.evaluations,
    m.feedback,
    m.defenses,
    m.minutes,
  ] as Model<any>[])
    await model.updateMany(byThesis, $set).exec();
  await m.notifications.updateMany({ userId: { $in: userIds } }, $set).exec();
  await app
    .get<Connection>(getConnectionToken())
    .db!.collection(`${BUCKET}.files`)
    .updateMany(
      { 'metadata.thesisId': { $in: thesisIds } },
      { $set: { 'metadata.seedTag': tag } },
    );
}

async function buildSeed(
  app: INestApplicationContext,
  tag: string,
  log: (message: string) => void,
  m: Models,
  createdUserIds: Types.ObjectId[],
  thesisIds: Types.ObjectId[],
): Promise<SeedResult> {
  const users = app.get(UsersService);
  const catalogs = app.get(CatalogsService);
  const theses = app.get(ThesesService);
  const assignments = app.get(AssignmentsService);
  const responses = app.get(AssignmentResponsesService);
  const evaluations = app.get(EvaluationsService);
  const feedback = app.get(FeedbackService);
  const defenses = app.get(DefensesService);
  const minutes = app.get(MinutesService);

  // ------------------------------------------------------------ guards
  const jurorEmails = INTERNAL_JURORS.map(
    (_, i) => `jurado${i + 1}@unicordoba.edu.co`,
  );
  const studentEmails = STUDENTS.map(
    (_, i) => `estudiante${i + 1}@correo.unicordoba.edu.co`,
  );
  const allEmails = [
    ADMIN.email,
    COORDINATOR.email,
    ...jurorEmails,
    ...EXTERNAL_JURORS.map((e) => e.email),
    ...studentEmails,
  ];
  const taken = await users.findManyByEmails(allEmails);
  if (taken.length) {
    const tagged = taken.some((u) => u.seedTag === tag);
    throw new Error(
      tagged
        ? `Seed data ${tag} already exists; run with --reset`
        : `Untagged users already use the demo emails: ${taken.map((u) => u.email).join(', ')}`,
    );
  }

  // ------------------------------------------------------------ catalogs
  const program =
    (await m.programs.findOne({ code: PROGRAM.code }).exec()) ??
    // Shared catalogs are never tagged: a reset must not delete them.
    (await catalogs.createProgram({
      code: PROGRAM.code,
      name: PROGRAM.name,
      level: ProgramLevel.MASTER,
    }));
  const period = async (
    year: number,
    term: PeriodTerm,
    startsAt: string,
    endsAt: string,
  ) =>
    (await m.periods.findOne({ code: `${year}-${term}` }).exec()) ??
    (await catalogs.createPeriod({ year, term, startsAt, endsAt }));
  const p2025 = await period(2025, PeriodTerm.II, '2025-07-28', '2025-12-12');
  const p2026 = await period(2026, PeriodTerm.I, '2026-02-02', '2026-06-19');
  const maxCohort =
    (
      await m.cohorts
        .findOne({ programId: program._id })
        .sort({ number: -1 })
        .lean()
        .exec()
    )?.number ?? 0;
  const cohort1 = await catalogs.createCohort(
    {
      programId: program.id as string,
      periodId: p2025.id as string,
      number: maxCohort + 1,
      name: `Cohorte ${maxCohort + 1} (2025-II)`,
    },
    tag,
  );
  const cohort2 = await catalogs.createCohort(
    {
      programId: program.id as string,
      periodId: p2026.id as string,
      number: maxCohort + 2,
      name: `Cohorte ${maxCohort + 2} (2026-I)`,
    },
    tag,
  );
  log('Catalogs ready');

  // ------------------------------------------------------------ users
  // Tag each user right after creating it, so a seed that fails partway is fully removable.
  const track = async (u: UserDocument) => {
    createdUserIds.push(u._id);
    await m.users.updateOne({ _id: u._id }, { $set: { seedTag: tag } }).exec();
    return u;
  };
  await track(
    await users.create({
      ...ADMIN,
      password: PASSWORDS.admin,
      roles: [Role.ADMIN],
    }),
  );
  const coordinator = await track(
    await users.create({
      ...COORDINATOR,
      password: PASSWORDS.coordinator,
      roles: [Role.COORDINATOR],
    }),
  );
  const J: UserDocument[] = [];
  for (const [i, j] of INTERNAL_JURORS.entries())
    J.push(
      await track(
        await users.create({
          email: jurorEmails[i],
          password: PASSWORDS.juror,
          firstName: j.firstName,
          lastName: j.lastName,
          documentId: j.documentId,
          roles: [Role.INTERNAL_JUROR],
          jurorProfile: {
            institution: 'Universidad de Córdoba',
            isUnicordoba: true,
            highestDegree: j.highestDegree,
            country: 'Colombia',
            expertise: j.expertise,
          },
        }),
      ),
    );
  const E: UserDocument[] = [];
  for (const e of EXTERNAL_JURORS)
    E.push(await track(await users.createExternalJuror(e)));
  const S: UserDocument[] = [];
  for (const [i, s] of STUDENTS.entries()) {
    const cohort = i < 8 ? cohort1 : cohort2;
    S.push(
      await track(
        await users.create({
          email: studentEmails[i],
          password: PASSWORDS.student,
          firstName: s.firstName,
          lastName: s.lastName,
          documentId: s.documentId,
          roles: [Role.STUDENT],
          studentProfile: {
            studentCode: `${i < 8 ? '2025' : '2026'}${String(i + 1).padStart(4, '0')}`,
            programId: program.id as string,
            cohortId: cohort.id as string,
          },
        }),
      ),
    );
  }
  log(`Users ready (${createdUserIds.length})`);

  // ------------------------------------------------------------ helpers
  const coordAuth = auth(coordinator);
  const coordActor: Actor = {
    id: coordinator.id as string,
    role: Role.COORDINATOR,
  };
  const seeded: SeededThesis[] = [];

  const register = async (i: number, advisor: UserDocument) => {
    const topic = TOPICS[i];
    const student = S[i];
    const cohort = i < 8 ? cohort1 : cohort2;
    const t = await theses.create(
      {
        title: topic.title,
        abstract: topic.abstract,
        keywords: topic.keywords,
        studentId: student.id as string,
        advisorId: advisor.id as string,
        programId: program.id as string,
        periodId: cohort.periodId.toHexString(),
        cohortId: cohort.id as string,
      },
      coordActor,
      { seedTag: tag },
    );
    thesisIds.push(t._id);
    const pdf = await renderManuscriptPdf({
      ...topic,
      studentName: fullName(student),
      advisorName: fullName(advisor),
      programName: program.name,
    });
    await theses.addManuscript(
      t.id as string,
      {
        buffer: pdf,
        originalname: `manuscrito-${t.code}.pdf`,
        size: pdf.length,
      },
      auth(student),
    );
    return t;
  };
  const assign = async (t: ThesisDocument, jurors: UserDocument[]) => {
    const res = await assignments.assignJury(
      t.id as string,
      { jurors: jurors.map((j) => ({ jurorId: j.id as string })) },
      coordActor,
    );
    return res;
  };
  const accept = (assignmentId: string, juror: UserDocument) =>
    responses.accept(assignmentId, auth(juror));
  /** CU-01 + both accept; returns the two assignment ids. */
  const evaluating = async (
    t: ThesisDocument,
    jurors: [UserDocument, UserDocument],
  ) => {
    const { assignments: a } = await assign(t, jurors);
    await accept(a[0].id, jurors[0]);
    await accept(a[1].id, jurors[1]);
    return [a[0].id, a[1].id] as const;
  };
  const submit = (
    assignmentId: string,
    juror: UserDocument,
    verdict: EvaluationVerdict,
    comments: string,
    rubric?: typeof RUBRIC_OK,
  ) =>
    evaluations.submit(
      assignmentId,
      { rubric, verdict, comments },
      auth(juror),
    );
  const addFeedback = (
    t: ThesisDocument,
    juror: UserDocument,
    chapter: FeedbackChapter,
    content: string,
    reference?: string,
  ) =>
    feedback.create(
      t.id as string,
      { chapter, content, reference },
      auth(juror),
    );
  const scheduleDefense = (
    t: ThesisDocument,
    inDays: number,
    modality: DefenseModality,
  ) =>
    defenses.schedule(
      t.id as string,
      {
        scheduledAt: new Date(Date.now() + inDays * DAY).toISOString(),
        modality,
        location:
          modality === DefenseModality.VIRTUAL
            ? undefined
            : 'Auditorio Cultural, Universidad de Córdoba, Montería',
        meetingUrl:
          modality === DefenseModality.IN_PERSON
            ? undefined
            : 'https://meet.google.com/mie-tia-demo',
      },
      coordAuth,
    );
  const byId = new Map<string, UserDocument>(
    [...J, ...E].map((u) => [u.id as string, u]),
  );
  const confirmAll = async (defenseId: string, jurorIds: string[]) => {
    for (const id of jurorIds)
      await defenses.confirm(defenseId, auth(byId.get(id)!));
  };
  /** Defense confirmed by every active juror, minutes signed by all → sealed. */
  const complete = async (
    t: ThesisDocument,
    grade: number,
    verdict: MinutesVerdict,
    remarks: string,
  ) => {
    const defense = await scheduleDefense(t, 3, DefenseModality.IN_PERSON);
    await confirmAll(
      defense.id,
      defense.jurors.map((j) => j.userId),
    );
    // The defense took place before the minutes: move its date to the past (seed-only path;
    // the public API still requires a future date).
    await m.defenses
      .updateOne(
        { _id: defense.id },
        { $set: { scheduledAt: new Date(Date.now() - 7 * DAY) } },
      )
      .exec();
    const draft = await minutes.create(
      t.id as string,
      { finalGrade: grade, verdict, remarks },
      coordAuth,
      { numberPrefix: tag },
    );
    const ctx = { ip: '127.0.0.1', userAgent: 'seed' };
    for (const s of draft.requiredSigners.filter(
      (x) => x.role !== Role.COORDINATOR,
    ))
      await minutes.sign(draft.id, auth(byId.get(s.userId)!), ctx);
    await minutes.sign(draft.id, coordAuth, ctx);
  };
  const done = async (t: ThesisDocument, note?: string) => {
    const fresh = await theses.findById(t.id as string);
    seeded.push({
      code: fresh.code,
      status: fresh.status,
      studentEmail:
        studentEmails[S.findIndex((s) => s._id.equals(fresh.studentId))],
      title: fresh.title,
      note,
    });
  };
  const [J1, J2, J3, J4, J5, J6] = J;
  const [E1, E2, E3] = E;
  const LONG = (s: string) =>
    `${s} El documento cumple con la estructura exigida por el programa.`;
  let externalLink: SeedResult['externalLink'];

  // ------------------------------------------------------------ theses
  // 1-2 SUBMITTED
  await done(await register(0, J6), 'Lista para asignar jurados');
  await done(await register(1, J5), 'Lista para asignar jurados');

  // 3 JURORS_ASSIGNED: jurado1 and an external juror PENDING (external link)
  {
    const t = await register(2, J6);
    const res = await assign(t, [J1, E1]);
    const link = res.externalLinks[0];
    if (link)
      externalLink = {
        jurorEmail: E1.email,
        thesisCode: t.code,
        url: link.url,
      };
    await done(t, 'jurado1 y jurado externo con asignación PENDIENTE');
  }

  // 4 PENDING_JUROR_REPLACEMENT: jurado3 accepted, jurado2 declined
  {
    const t = await register(3, J5);
    const { assignments: a } = await assign(t, [J2, J3]);
    await accept(a[1].id, J3);
    await responses.decline(
      a[0].id,
      auth(J2),
      'Tengo una carga académica que no me permite evaluar en el plazo establecido.',
    );
    await done(t, 'jurado2 declinó; requiere reemplazo');
  }

  // 5 UNDER_EVALUATION: jurado1 ACCEPTED with a draft evaluation
  {
    const t = await register(4, J6);
    const [a1] = await evaluating(t, [J1, J4]);
    await evaluations.saveDraft(
      a1,
      {
        rubric: { methodology: 4, relevance: 5 },
        comments:
          'Borrador: revisar la validez del instrumento de evaluación de textos.',
      },
      auth(J1),
    );
    await addFeedback(
      t,
      J4,
      FeedbackChapter.METHODOLOGY,
      'Precisar el tamaño de la muestra y el criterio de selección de los textos.',
      'Sección 3.2',
    );
    await done(t, 'jurado1 con borrador de evaluación');
  }

  // 6 UNDER_EVALUATION: the external juror already submitted
  {
    const t = await register(5, J4);
    const [, a2] = await evaluating(t, [J2, E2]);
    await submit(
      a2,
      E2,
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      LONG('Trabajo pertinente con impacto en el contexto rural.'),
      RUBRIC_GOOD,
    );
    await done(t, 'un concepto emitido, otro pendiente');
  }

  // 7 IN_DISPUTE: split verdicts, tiebreaker jurado6 PENDING
  {
    const t = await register(6, J1);
    const [a1, a2] = await evaluating(t, [J3, J5]);
    await submit(
      a1,
      J3,
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      LONG('La propuesta es sólida y el prototipo funciona correctamente.'),
      RUBRIC_GOOD,
    );
    await submit(
      a2,
      J5,
      EvaluationVerdict.REJECTED,
      'La validación con usuarios es insuficiente y las conclusiones no se sustentan en los datos.',
      RUBRIC_LOW,
    );
    await assignments.assignTiebreaker(
      t.id as string,
      { jurorId: J6.id as string },
      coordActor,
    );
    await done(t, 'dirimente jurado6 PENDIENTE');
  }

  // 8 REVISIONS_IN_PROGRESS: feedback RESOLVED, ADDRESSED and PENDING
  {
    const t = await register(7, J3);
    const [a1, a2] = await evaluating(t, [J1, J2]);
    const f1 = await addFeedback(
      t,
      J1,
      FeedbackChapter.THEORETICAL_FRAMEWORK,
      'Incluir referentes recientes (2020-2025) sobre aprendizaje adaptativo.',
      'Capítulo 2',
    );
    const f2 = await addFeedback(
      t,
      J1,
      FeedbackChapter.RESULTS,
      'Reportar el tamaño del efecto además de la significancia estadística.',
      'Tabla 4',
    );
    await addFeedback(
      t,
      J2,
      FeedbackChapter.CONCLUSIONS,
      'Las conclusiones deben responder explícitamente a cada objetivo específico.',
    );
    await submit(
      a1,
      J1,
      EvaluationVerdict.APPROVED_WITH_CHANGES,
      LONG(
        'Aprobado con ajustes menores en el marco teórico y los resultados.',
      ),
      RUBRIC_OK,
    );
    await submit(
      a2,
      J2,
      EvaluationVerdict.APPROVED_WITH_CHANGES,
      LONG('Aprobado con cambios en las conclusiones.'),
      RUBRIC_OK,
    );
    const student = auth(S[7]);
    await feedback.transition(
      f1.id,
      FeedbackAction.ADDRESS,
      'Se incorporaron seis referencias recientes en la sección 2.3.',
      student,
    );
    await feedback.transition(
      f2.id,
      FeedbackAction.ADDRESS,
      'Se agregó la d de Cohen en la tabla 4.',
      student,
    );
    await feedback.transition(
      f1.id,
      FeedbackAction.RESOLVE,
      'Ajuste verificado.',
      auth(J1),
    );
    await done(t, 'observaciones: 1 resuelta, 1 atendida, 1 pendiente');
  }

  // 9 READY_FOR_DEFENSE: both approved
  {
    const t = await register(8, J2);
    const [a1, a2] = await evaluating(t, [J4, E3]);
    await submit(
      a1,
      J4,
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      LONG('Excelente caracterización con muestra representativa.'),
      RUBRIC_GOOD,
    );
    await submit(
      a2,
      E3,
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      LONG('Trabajo riguroso y bien escrito.'),
      RUBRIC_GOOD,
    );
    await done(t, 'lista para programar sustentación');
  }

  // 10 READY_FOR_DEFENSE via revisions (auto on last resolve), defense PROPOSED
  {
    const t = await register(9, J4);
    const [a1, a2] = await evaluating(t, [J5, J6]);
    const f = await addFeedback(
      t,
      J5,
      FeedbackChapter.INTRODUCTION,
      'Delimitar mejor el problema de investigación.',
    );
    await submit(
      a1,
      J5,
      EvaluationVerdict.APPROVED_WITH_CHANGES,
      LONG('Aprobado con ajustes en la introducción.'),
      RUBRIC_OK,
    );
    await submit(
      a2,
      J6,
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      LONG('Aporte relevante a la integridad académica.'),
      RUBRIC_GOOD,
    );
    await feedback.transition(
      f.id,
      FeedbackAction.ADDRESS,
      'Se reescribió el planteamiento del problema.',
      auth(S[9]),
    );
    await feedback.transition(
      f.id,
      FeedbackAction.RESOLVE,
      undefined,
      auth(J5),
    );
    const defense = await scheduleDefense(t, 10, DefenseModality.VIRTUAL);
    await defenses.confirm(defense.id, auth(J5));
    await done(t, 'sustentación PROPUESTA, falta confirmación de jurado6');
  }

  // 11 DEFENSE_SCHEDULED: defense confirmed by both jurors
  {
    const t = await register(10, J5);
    const [a1, a2] = await evaluating(t, [J3, J4]);
    await submit(
      a1,
      J3,
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      LONG('Muy buen trabajo experimental.'),
      RUBRIC_GOOD,
    );
    await submit(
      a2,
      J4,
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      LONG('Análisis estadístico adecuado.'),
      RUBRIC_OK,
    );
    const defense = await scheduleDefense(t, 5, DefenseModality.HYBRID);
    await confirmAll(
      defense.id,
      defense.jurors.map((j) => j.userId),
    );
    await done(t, 'sustentación CONFIRMADA');
  }

  // 12 NOT_APPROVED: both rejected
  {
    const t = await register(11, J6);
    const [a1, a2] = await evaluating(t, [J2, J4]);
    await submit(
      a1,
      J2,
      EvaluationVerdict.REJECTED,
      'El diseño metodológico no permite responder la pregunta de investigación.',
      RUBRIC_LOW,
    );
    await submit(
      a2,
      J4,
      EvaluationVerdict.REJECTED,
      'Los resultados no se derivan de los datos recolectados y faltan análisis.',
      RUBRIC_LOW,
    );
    await done(t, 'ambos jurados rechazaron');
  }

  // 13 COMPLETED_APPROVED: meritorious, minutes sealed
  {
    const t = await register(12, J2);
    const [a1, a2] = await evaluating(t, [J3, J1]);
    await submit(
      a1,
      J3,
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      LONG('Propuesta innovadora y bien fundamentada.'),
      RUBRIC_GOOD,
    );
    await submit(
      a2,
      J1,
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      LONG('Validación sólida del modelo.'),
      RUBRIC_GOOD,
    );
    await complete(
      t,
      4.7,
      MinutesVerdict.APPROVED_MERITORIOUS,
      'Sustentación destacada; se recomienda su publicación.',
    );
    await done(t, 'acta sellada (meritoria) con PDF');
  }

  // 14 COMPLETED_APPROVED after a dispute resolved by a tiebreaker
  {
    const t = await register(13, J3);
    const [a1, a2] = await evaluating(t, [J1, E1]);
    await submit(
      a1,
      J1,
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      LONG('Solución pertinente para la inclusión.'),
      RUBRIC_GOOD,
    );
    await submit(
      a2,
      E1,
      EvaluationVerdict.REJECTED,
      'La evaluación con usuarios finales es limitada y no hay grupo de control.',
      RUBRIC_LOW,
    );
    const tb = await assignments.assignTiebreaker(
      t.id as string,
      { jurorId: J5.id as string },
      coordActor,
    );
    await accept(tb.assignment.id, J5);
    await submit(
      tb.assignment.id,
      J5,
      EvaluationVerdict.APPROVED,
      'Dirimo a favor: las limitaciones se reconocen y no invalidan el aporte.',
    );
    await complete(
      t,
      4.2,
      MinutesVerdict.APPROVED,
      'Aprobada tras dirimencia; el jurado dirimente firma el acta.',
    );
    await done(t, 'discrepancia resuelta por dirimente; acta sellada');
  }

  // 15 COMPLETED_FAILED
  {
    const t = await register(14, J1);
    const [a1, a2] = await evaluating(t, [J2, J6]);
    await submit(
      a1,
      J2,
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      LONG('El documento es adecuado para sustentar.'),
      RUBRIC_OK,
    );
    await submit(
      a2,
      J6,
      EvaluationVerdict.APPROVED_FOR_DEFENSE,
      LONG('Cumple los requisitos mínimos.'),
      RUBRIC_OK,
    );
    await complete(
      t,
      2.6,
      MinutesVerdict.FAILED,
      'La sustentación no demostró dominio de los resultados presentados.',
    );
    await done(t, 'acta sellada (reprobada)');
  }

  return {
    tag,
    theses: seeded,
    credentials: [
      { role: 'ADMIN', email: ADMIN.email, password: PASSWORDS.admin },
      {
        role: 'COORDINATOR',
        email: COORDINATOR.email,
        password: PASSWORDS.coordinator,
      },
      {
        role: 'INTERNAL_JUROR',
        email: 'jurado1..6@unicordoba.edu.co',
        password: PASSWORDS.juror,
      },
      {
        role: 'STUDENT',
        email: 'estudiante1..15@correo.unicordoba.edu.co',
        password: PASSWORDS.student,
      },
      {
        role: 'EXTERNAL_JUROR',
        email: EXTERNAL_JURORS.map((e) => e.email).join(', '),
        password: '(sin contraseña: enlace externo)',
      },
    ],
    externalLink,
  };
}
