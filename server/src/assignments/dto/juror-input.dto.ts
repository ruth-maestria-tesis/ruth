import { Type } from 'class-transformer';
import { IsMongoId, IsOptional, ValidateNested } from 'class-validator';
import { NewExternalJurorDto } from '../../users/dto/external-juror.dto';

/** Exactly one of jurorId (existing faculty) or newExternal (RF-C14) — enforced in the service. */
export class JurorInputDto {
  @IsOptional()
  @IsMongoId()
  jurorId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewExternalJurorDto)
  newExternal?: NewExternalJurorDto;
}
