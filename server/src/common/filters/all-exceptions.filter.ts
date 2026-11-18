import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ErrorCode } from '@thesis/shared';
import type { Response } from 'express';
import { Error as MongooseError } from 'mongoose';
import { AppException } from '../errors/app.exception';

export interface ErrorBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.AUTH_UNAUTHENTICATED,
  403: ErrorCode.AUTH_FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.FILE_TOO_LARGE,
  429: ErrorCode.RATE_LIMITED,
};

function isMongoDuplicateKey(
  e: unknown,
): e is { code: number; keyValue?: Record<string, unknown> } {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 11000
  );
}

/** Body-parser style errors: plain objects carrying a 4xx `status`/`statusCode`. */
function plainClientErrorStatus(e: unknown): number | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const { status, statusCode } = e as {
    status?: unknown;
    statusCode?: unknown;
  };
  for (const v of [status, statusCode]) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 400 && v <= 499)
      return v;
  }
  return undefined;
}

export function toErrorBody(exception: unknown): ErrorBody {
  if (exception instanceof AppException) {
    const body: ErrorBody = {
      statusCode: exception.getStatus(),
      code: exception.code,
      message: (exception.getResponse() as { message: string }).message,
    };
    if (exception.details !== undefined) body.details = exception.details;
    return body;
  }

  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    if (statusCode >= 500) {
      return {
        statusCode,
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
      };
    }
    const response = exception.getResponse();
    const code = STATUS_CODES[statusCode] ?? ErrorCode.HTTP_ERROR;
    if (
      typeof response === 'object' &&
      response !== null &&
      Array.isArray((response as { message?: unknown }).message)
    ) {
      return {
        statusCode,
        code,
        message: 'Validation failed',
        details: (response as { message: unknown[] }).message,
      };
    }
    const message =
      typeof response === 'string'
        ? response
        : typeof (response as { message?: unknown }).message === 'string'
          ? (response as { message: string }).message
          : exception.message;
    return { statusCode, code, message };
  }

  if (exception instanceof MongooseError.ValidationError) {
    return {
      statusCode: 400,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Validation failed',
      details: Object.values(exception.errors).map((e) => ({
        path: e.path,
        message: e.message,
      })),
    };
  }

  if (exception instanceof MongooseError.CastError) {
    return {
      statusCode: 400,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Invalid value',
      details: [{ path: exception.path }],
    };
  }

  if (isMongoDuplicateKey(exception)) {
    return {
      statusCode: 409,
      code: ErrorCode.DUPLICATE_KEY,
      message: 'Duplicate key',
      details: { fields: Object.keys(exception.keyValue ?? {}) },
    };
  }

  const clientStatus = plainClientErrorStatus(exception);
  if (clientStatus !== undefined) {
    return {
      statusCode: clientStatus,
      code:
        clientStatus === 400
          ? ErrorCode.VALIDATION_FAILED
          : (STATUS_CODES[clientStatus] ?? ErrorCode.HTTP_ERROR),
      message: clientStatus === 400 ? 'Malformed request' : 'Request error',
    };
  }

  return {
    statusCode: 500,
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Internal server error',
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = toErrorBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(body.statusCode)
      .json(body);
  }
}
