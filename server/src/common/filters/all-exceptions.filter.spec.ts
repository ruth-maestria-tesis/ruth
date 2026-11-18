import {
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCode } from '@thesis/shared';
import { AppException } from '../errors/app.exception';
import { toErrorBody } from './all-exceptions.filter';

describe('toErrorBody', () => {
  it('keeps AppException code, status and details', () => {
    const body = toErrorBody(
      new AppException(
        ErrorCode.USER_EMAIL_TAKEN,
        HttpStatus.CONFLICT,
        'Email taken',
        { email: 'a@b.co' },
      ),
    );
    expect(body).toEqual({
      statusCode: 409,
      code: ErrorCode.USER_EMAIL_TAKEN,
      message: 'Email taken',
      details: { email: 'a@b.co' },
    });
  });

  it('maps ValidationPipe errors to VALIDATION_FAILED with messages as details', () => {
    const body = toErrorBody(
      new BadRequestException(['email must be an email']),
    );
    expect(body.statusCode).toBe(400);
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(body.details).toEqual(['email must be an email']);
  });

  it('maps NotFoundException to NOT_FOUND', () => {
    const body = toErrorBody(new NotFoundException('Cannot GET /x'));
    expect(body).toMatchObject({
      statusCode: 404,
      code: ErrorCode.NOT_FOUND,
      message: 'Cannot GET /x',
    });
  });

  it('maps Mongo duplicate key errors to 409 DUPLICATE_KEY', () => {
    const body = toErrorBody({ code: 11000, keyValue: { email: 'a@b.co' } });
    expect(body).toMatchObject({
      statusCode: 409,
      code: ErrorCode.DUPLICATE_KEY,
      details: { fields: ['email'] },
    });
  });

  it('hides unknown errors behind INTERNAL_ERROR', () => {
    const body = toErrorBody(new Error('db password leaked in message'));
    expect(body).toEqual({
      statusCode: 500,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    });
  });

  it('hides messages of 5xx HttpExceptions', () => {
    const body = toErrorBody(new InternalServerErrorException('secret detail'));
    expect(body).toEqual({
      statusCode: 500,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    });
  });

  it('maps body-parser malformed JSON errors to 400 VALIDATION_FAILED', () => {
    const err = Object.assign(new SyntaxError('Unexpected token } in JSON'), {
      status: 400,
    });
    expect(toErrorBody(err)).toEqual({
      statusCode: 400,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Malformed request',
    });
  });

  it('maps other plain 4xx errors such as 413 to their status', () => {
    const err = Object.assign(new Error('request entity too large'), {
      name: 'PayloadTooLargeError',
      statusCode: 413,
    });
    expect(toErrorBody(err)).toEqual({
      statusCode: 413,
      code: ErrorCode.HTTP_ERROR,
      message: 'Request error',
    });
  });
});
