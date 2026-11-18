import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  // bcrypt only uses the first 72 bytes of the input.
  @MaxLength(72)
  newPassword!: string;
}
