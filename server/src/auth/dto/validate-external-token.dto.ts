import { IsString, Matches } from 'class-validator';

export class ValidateExternalTokenDto {
  /** base64url of 32 random bytes, from the `token` query parameter of the link. */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{20,200}$/)
  token!: string;
}
