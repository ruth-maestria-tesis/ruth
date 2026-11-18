import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  // bcrypt only uses the first 72 bytes of the input. MaxLength counts characters,
  // not bytes, so this is an approximation: multi-byte characters can still exceed 72 bytes.
  @MaxLength(72)
  newPassword!: string;
}
