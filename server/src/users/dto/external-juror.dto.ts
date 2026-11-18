import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** RF-C14: external juror created inline during assignment (no password, token access). */
export class NewExternalJurorDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  institution!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  highestDegree!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country!: string;
}
