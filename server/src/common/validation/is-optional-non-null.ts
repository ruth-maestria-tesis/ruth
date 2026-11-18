import { ValidateIf } from 'class-validator';

/** Like @IsOptional() but `null` is still validated (and therefore rejected). */
export const IsOptionalNonNull = () =>
  ValidateIf((_obj: unknown, value: unknown) => value !== undefined);
