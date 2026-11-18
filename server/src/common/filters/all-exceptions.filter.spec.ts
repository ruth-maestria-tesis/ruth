import {
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ErrorCode } from '@thesis/shared';
import { Error as MongooseError } from 'mongoose';
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

  it('maps other plain 4xx errors such as 415 to their status', () => {
    const err = Object.assign(new Error('unsupported charset'), {
      name: 'UnsupportedMediaTypeError',
      statusCode: 415,
    });
    expect(toErrorBody(err)).toEqual({
      statusCode: 415,
      code: ErrorCode.HTTP_ERROR,
      message: 'Request error',
    });
  });

  it('maps a Mongoose ValidationError to 400 VALIDATION_FAILED with paths', () => {
    const err = new MongooseError.ValidationError();
    err.addError(
      'firstName',
      new MongooseError.ValidatorError({
        path: 'firstName',
        message: 'Path `firstName` is required.',
      }),
    );
    expect(toErrorBody(err)).toEqual({
      statusCode: 400,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Validation failed',
      details: [
        { path: 'firstName', message: 'Path `firstName` is required.' },
      ],
    });
  });

  it('maps a Mongoose CastError to 400 VALIDATION_FAILED', () => {
    const err = new MongooseError.CastError('ObjectId', 'nope', 'programId');
    expect(toErrorBody(err)).toEqual({
      statusCode: 400,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Invalid value',
      details: [{ path: 'programId' }],
    });
  });

  it('maps 413 (multer file size limit) to FILE_TOO_LARGE', () => {
    expect(toErrorBody(new PayloadTooLargeException('File too large'))).toEqual(
      {
        statusCode: 413,
        code: ErrorCode.FILE_TOO_LARGE,
        message: 'File too large',
      },
    );
  });

  it('maps a plain { status: 413 } object to HTTP_ERROR, not FILE_TOO_LARGE', () => {
    expect(toErrorBody({ status: 413 })).toEqual({
      statusCode: 413,
      code: ErrorCode.HTTP_ERROR,
      message: 'Request error',
    });
  });
});
