import { HttpStatus, Injectable, PipeTransform } from '@nestjs/common';
import { ErrorCode } from '@thesis/shared';
import { AppException } from '../errors/app.exception';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Path-param guard: malformed ids answer 400 instead of reaching Mongoose. */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !OBJECT_ID.test(value)) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Invalid id',
      );
    }
    return value.toLowerCase();
  }
}
