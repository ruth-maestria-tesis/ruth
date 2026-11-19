import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode, isExternalOnly, JUROR_ROLES, Role } from '@thesis/shared';
import { FilterQuery, isValidObjectId, Model, Types } from 'mongoose';
import {
  RefreshToken,
  revokeRefreshTokens,
} from '../auth/schemas/refresh-token.schema';
import { AppException } from '../common/errors/app.exception';
import { Paginated } from '../common/pagination/pagination.dto';
import { paginate, SortFields } from '../common/pagination/paginate';
import { hashPassword } from '../common/security/password';
import { escapeRegex } from '../common/utils/escape-regex';
import { CreateUserDto } from './dto/create-user.dto';
import { NewExternalJurorDto } from './dto/external-juror.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserDocument } from './schemas/user.schema';

const USER_SORT_FIELDS: SortFields = {
  email: 'email',
  firstName: 'firstName',
  lastName: 'lastName',
  createdAt: 'createdAt',
};

/** Fields exposed by the faculty autocomplete (M7); `id` comes from the toJSON virtual. */
const FACULTY_PROJECTION =
  'firstName lastName email roles isActive jurorProfile';

/** Set comparison: order and duplicates do not matter. */
const sameRoles = (a: readonly Role[], b: readonly Role[]) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((r) => right.has(r));
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly model: Model<User>,
    @InjectModel(RefreshToken.name)
    private readonly refreshTokens: Model<RefreshToken>,
  ) {}

  async create(dto: CreateUserDto): Promise<UserDocument> {
    if (dto.password && isExternalOnly(dto.roles)) {
      throw new AppException(
        ErrorCode.USER_PASSWORD_NOT_ALLOWED,
        HttpStatus.BAD_REQUEST,
        'External jurors use token access and cannot have a password',
      );
    }
    this.assertRoleInvariants(dto.roles, !!dto.password, !!dto.jurorProfile);
    if (await this.model.exists({ email: dto.email.toLowerCase() })) {
      throw new AppException(
        ErrorCode.USER_EMAIL_TAKEN,
        HttpStatus.CONFLICT,
        'Email already registered',
      );
    }
    const { password, ...rest } = dto;
    return this.model.create({
      ...rest,
      passwordHash: password ? await hashPassword(password) : undefined,
    });
  }

  /** RF-C14: external juror created during CU-01 or a replacement. */
  createExternalJuror(dto: NewExternalJurorDto): Promise<UserDocument> {
    return this.create({
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
      roles: [Role.EXTERNAL_JUROR],
      jurorProfile: {
        institution: dto.institution,
        isUnicordoba: false,
        highestDegree: dto.highestDegree,
        country: dto.country,
      },
    });
  }

  findManyByEmails(emails: readonly string[]): Promise<UserDocument[]> {
    return this.model
      .find({ email: { $in: emails.map((e) => e.toLowerCase()) } })
      .exec();
  }

  /** Only for compensating a failed multi-step write (e.g. CU-01 inline jurors). */
  async deleteByIds(ids: readonly string[]): Promise<void> {
    await this.model.deleteMany({ _id: { $in: ids } }).exec();
  }

  /** Cheap per-request check (JwtAuthGuard): the user exists and is active. */
  async isActive(id: string): Promise<boolean> {
    if (!isValidObjectId(id)) return false;
    return !!(await this.model.exists({ _id: id, isActive: true }).exec());
  }

  async findById(id: string): Promise<UserDocument> {
    const user = isValidObjectId(id) ? await this.model.findById(id) : null;
    if (!user)
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'User not found',
      );
    return user;
  }

  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.model
      .findOne({ email: email.toLowerCase() })
      .select('+passwordHash')
      .exec();
  }

  async findByIdWithPassword(id: string): Promise<UserDocument> {
    const user = isValidObjectId(id)
      ? await this.model.findById(id).select('+passwordHash')
      : null;
    if (!user)
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'User not found',
      );
    return user;
  }

  async list(query: QueryUsersDto): Promise<Paginated<UserDocument>> {
    const filter: FilterQuery<User> = {};
    if (query.role) filter.roles = query.role;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
    }
    return paginate(this.model, filter, query, {
      sortFields: USER_SORT_FIELDS,
      defaultSort: 'createdAt',
    });
  }

  /** Bulk lookup used by other modules to validate references (theses, assignments). */
  findManyByIds(ids: readonly string[]): Promise<UserDocument[]> {
    const valid = ids.filter((id) => isValidObjectId(id));
    return this.model.find({ _id: { $in: valid } }).exec();
  }

  /** Autocomplete for juror selection (CU-01): active internal and external jurors. */
  searchFaculty(q?: string): Promise<UserDocument[]> {
    const filter: FilterQuery<User> = {
      roles: { $in: [...JUROR_ROLES] },
      isActive: true,
    };
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [
        { firstName: rx },
        { lastName: rx },
        { email: rx },
        { 'jurorProfile.institution': rx },
      ];
    }
    return this.model
      .find(filter, FACULTY_PROJECTION)
      .sort({ lastName: 1, firstName: 1 })
      .limit(20)
      .exec();
  }

  /**
   * Validates the merged state (stored user + dto) with the same rules as create, and
   * protects against admin lockout. A role change revokes the user's refresh tokens.
   */
  async update(
    id: string,
    dto: UpdateUserDto,
    actorId: string,
  ): Promise<UserDocument> {
    const existing = await this.findByIdWithPassword(id);
    const roles = dto.roles ?? existing.roles;
    const jurorProfile =
      dto.jurorProfile !== undefined ? dto.jurorProfile : existing.jurorProfile;
    this.assertRoleInvariants(roles, !!existing.passwordHash, !!jurorProfile);

    const losesAdmin =
      existing.roles.includes(Role.ADMIN) && !roles.includes(Role.ADMIN);
    if (losesAdmin) {
      this.assertNotSelf(existing, actorId);
      if (existing.isActive) await this.assertNotLastActiveAdmin(id);
    }

    // A user turned external-only loses password login (RF-J14 token access only).
    const updated = await this.model.findByIdAndUpdate(
      id,
      isExternalOnly(roles) ? { $set: dto, $unset: { passwordHash: 1 } } : dto,
      { new: true, runValidators: true },
    );
    if (!updated)
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'User not found',
      );
    if (!sameRoles(existing.roles, updated.roles))
      await this.revokeSessions(id);
    return updated;
  }

  /** Deactivation revokes the user's refresh tokens. */
  async setActive(
    id: string,
    isActive: boolean,
    actorId: string,
  ): Promise<UserDocument> {
    const user = await this.findById(id);
    if (!isActive) {
      this.assertNotSelf(user, actorId);
      if (user.isActive && user.roles.includes(Role.ADMIN))
        await this.assertNotLastActiveAdmin(id);
    }
    user.isActive = isActive;
    const saved = await user.save();
    if (!isActive) await this.revokeSessions(id);
    return saved;
  }

  async setPassword(id: string, password: string): Promise<void> {
    await this.model.updateOne(
      { _id: id },
      { passwordHash: await hashPassword(password) },
    );
  }

  /** Creation invariants, also applied to the merged state on update. */
  private assertRoleInvariants(
    roles: readonly Role[],
    hasPassword: boolean,
    hasJurorProfile: boolean,
  ): void {
    if (!hasPassword && !isExternalOnly(roles)) {
      throw new AppException(
        ErrorCode.USER_PASSWORD_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'Password is required',
      );
    }
    if (roles.some((r) => JUROR_ROLES.includes(r)) && !hasJurorProfile) {
      throw new AppException(
        ErrorCode.USER_JUROR_PROFILE_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'Juror profile is required',
      );
    }
  }

  /**
   * An admin cannot demote or deactivate themselves. Compares against the loaded
   * document's ObjectId, so case variants of the hex id in the URL cannot bypass it.
   */
  private assertNotSelf(target: UserDocument, actorId: string): void {
    if (target._id.equals(actorId)) {
      throw new AppException(
        ErrorCode.USER_SELF_LOCKOUT,
        HttpStatus.BAD_REQUEST,
        'You cannot remove your own admin access',
      );
    }
  }

  /**
   * Count-then-write without a transaction: two concurrent demotions/deactivations of
   * the last two admins could both pass. Accepted for this prototype.
   */
  private async assertNotLastActiveAdmin(targetId: string): Promise<void> {
    const others = await this.model.countDocuments({
      _id: { $ne: targetId },
      roles: Role.ADMIN,
      isActive: true,
    });
    if (others === 0) {
      throw new AppException(
        ErrorCode.USER_LAST_ADMIN,
        HttpStatus.CONFLICT,
        'At least one active admin is required',
      );
    }
  }

  /**
   * Revokes every refresh token of the user so the next refresh fails with 401.
   * By design an access token that was already issued stays valid until it expires
   * (JWT_ACCESS_TTL_SECONDS, 15 minutes by default): access tokens are not checked
   * against the database on each request.
   */
  private revokeSessions(userId: string): Promise<void> {
    return revokeRefreshTokens(this.refreshTokens, {
      userId: new Types.ObjectId(userId),
    });
  }
}
