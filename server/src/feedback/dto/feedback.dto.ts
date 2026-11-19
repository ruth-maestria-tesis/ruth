import { FeedbackChapter, FeedbackStatus } from '@thesis/shared';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateFeedbackDto {
  @IsEnum(FeedbackChapter)
  chapter!: FeedbackChapter;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reference?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;
}

/** ADDRESS, REOPEN and COMMENT need a message. */
export class FeedbackReplyDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content!: string;
}

/** RESOLVE: the message is optional. */
export class ResolveFeedbackDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  content?: string;
}

export class QueryFeedbackDto {
  @IsOptional()
  @IsEnum(FeedbackChapter)
  chapter?: FeedbackChapter;

  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;
}
