import { FeedbackChapter, FeedbackStatus } from '@thesis/shared';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** A single observation on the whole document can be long. */
export const FEEDBACK_CONTENT_MAX = 20000;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Whole-document observation; `chapter` defaults to GENERAL (no per-section split). */
export class CreateFeedbackDto {
  @IsOptional()
  @IsEnum(FeedbackChapter)
  chapter?: FeedbackChapter;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reference?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(FEEDBACK_CONTENT_MAX)
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
