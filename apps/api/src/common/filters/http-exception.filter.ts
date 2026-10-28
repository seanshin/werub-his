import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Response } from 'express';
import { DomainException } from '../errors/domain.exception';

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
  meta: {
    timestamp: string;
    path: string;
    method: string;
  };
}

// Error code mapping
const ERROR_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'ERR_BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'ERR_UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'ERR_FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'ERR_NOT_FOUND',
  [HttpStatus.CONFLICT]: 'ERR_CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'ERR_VALIDATION',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'ERR_INTERNAL',
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'ERR_INTERNAL';
    let message = 'Internal server error';
    let details: any;

    if (exception instanceof DomainException) {
      status = exception.getStatus();
      code = exception.domainCode;
      const exceptionResponse = exception.getResponse() as any;
      message = exceptionResponse.message ?? message;
      details = exceptionResponse.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = ERROR_CODES[status] || code;
      const exceptionResponse = exception.getResponse() as any;

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (exceptionResponse.message) {
        message = Array.isArray(exceptionResponse.message)
          ? exceptionResponse.message.join(', ')
          : exceptionResponse.message;
      }

      // Handle validation errors
      if (status === HttpStatus.BAD_REQUEST && exceptionResponse.error === 'Bad Request') {
        code = 'ERR_VALIDATION';
        if (Array.isArray(exceptionResponse.message)) {
          details = {
            validation: exceptionResponse.message.map((msg: string) => ({
              field: msg.split(' ')[0],
              constraint: msg,
            })),
          };
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const errorResponse: ErrorResponse = {
      error: {
        code,
        message,
        ...(details && { details }),
      },
      meta: {
        timestamp: new Date().toISOString(),
        path: request?.url ?? '',
        method: request?.method ?? '',
      },
    };

    try {
      if (!response.headersSent) {
        response.status(status).json(errorResponse);
      }
    } catch (sendError) {
      console.warn('[ExceptionFilter] Failed to send error response:', message);
    }
  }
}
