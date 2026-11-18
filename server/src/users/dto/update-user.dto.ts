import { OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['email', 'password'] as const),
) {}

export class UpdateUserStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
