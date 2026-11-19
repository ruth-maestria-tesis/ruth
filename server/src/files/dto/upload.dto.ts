import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

/** `POST <resource>/uploads`: what the browser is about to send. */
export class CreateUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  fileName!: string;

  /** Bytes; above MAX_FILE_BYTES is 413 FILE_TOO_LARGE (checked by the service). */
  @IsInt()
  @Min(1)
  size!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  contentType!: string;
}

/** `POST <resource>/uploads/complete`: the blob the browser just uploaded. */
export class CompleteUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  pathname!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  fileName!: string;
}
