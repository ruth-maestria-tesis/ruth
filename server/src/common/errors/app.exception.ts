import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@thesis/shared';

/** Domain error with a stable machine-readable code (see @thesis/shared ErrorCode). */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    status: HttpStatus,
    message?: string,
    public readonly details?: unknown,
  ) {
    super({ code, message: message ?? code, details }, status);
  }
}
