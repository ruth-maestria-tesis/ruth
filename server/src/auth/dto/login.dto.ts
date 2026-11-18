import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  // Caps the work done on attacker-controlled input before bcrypt runs.
  @MaxLength(256)
  password!: string;
}
