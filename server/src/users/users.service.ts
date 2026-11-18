import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode, JUROR_ROLES, Role } from '@thesis/shared';
import { FilterQuery, isValidObjectId, Model } from 'mongoose';
import { AppException } from '../common/errors/app.exception';
import { Paginated } from '../common/pagination/pagination.dto';
import { hashPassword } from '../common/security/password';
import { escapeRegex } from '../common/utils/escape-regex';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserDocument } from './schemas/user.schema';

const USER_SORT_FIELDS = ['email', 'firstName', 'lastName', 'createdAt'];

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly model: Model<User>) {}

  async create(dto: CreateUserDto): Promise<UserDocument> {
    const isExternalOnly = dto.roles.every((r) => r === Role.EXTERNAL_JUROR);
    if (!dto.password && !isExternalOnly) {
      throw new AppException(
        ErrorCode.USER_PASSWORD_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'Password is required',
      );
    }
    if (dto.roles.some((r) => JUROR_ROLES.includes(r)) && !dto.jurorProfile) {
      throw new AppException(
        ErrorCode.USER_JUROR_PROFILE_REQUIRED,
        HttpStatus.BAD_REQUEST,
        'Juror profile is required',
      );
    }
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
    const sortField =
      query.sort && USER_SORT_FIELDS.includes(query.sort)
        ? query.sort
        : 'createdAt';
    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ [sortField]: query.order === 'desc' ? -1 : 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      this.model.countDocuments(filter),
    ]);
    return { items, total, page: query.page, limit: query.limit };
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
      .find(filter)
      .sort({ lastName: 1, firstName: 1 })
      .limit(20)
      .exec();
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDocument> {
    await this.findById(id);
    const updated = await this.model.findByIdAndUpdate(id, dto, {
      new: true,
      runValidators: true,
    });
    if (!updated)
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
        'User not found',
      );
    return updated;
  }

  async setActive(id: string, isActive: boolean): Promise<UserDocument> {
    const user = await this.findById(id);
    user.isActive = isActive;
    return user.save();
  }

  async setPassword(id: string, password: string): Promise<void> {
    await this.model.updateOne(
      { _id: id },
      { passwordHash: await hashPassword(password) },
    );
  }
}
