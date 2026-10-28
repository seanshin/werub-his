import { HttpException, HttpStatus } from '@nestjs/common';

import { exposeErrorDetails } from '../../common/release-security';
/**
 * Custom domain exceptions for Hospital RUN
 */

export class ValidationException extends HttpException {
  constructor(message: string, details?: any) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Validation Error',
        message,
        details,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message: string = 'Unauthorized') {
    super(
      {
        statusCode: HttpStatus.UNAUTHORIZED,
        error: 'Unauthorized',
        message,
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export class ForbiddenException extends HttpException {
  constructor(message: string = 'Forbidden') {
    super(
      {
        statusCode: HttpStatus.FORBIDDEN,
        error: 'Forbidden',
        message,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}

export class ResourceNotFoundException extends HttpException {
  constructor(resource: string, id: string) {
    super(
      {
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: `${resource} with id ${id} not found`,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

export class ConflictException extends HttpException {
  constructor(message: string, details?: any) {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message,
        details,
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class DuplicateResourceException extends HttpException {
  constructor(resource: string, field: string, value: string) {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: 'Duplicate',
        message: `${resource} with ${field} '${value}' already exists`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class InternalServerException extends HttpException {
  constructor(message: string = 'Internal server error', details?: any) {
    super(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message,
        details: exposeErrorDetails() ? details : undefined, // 🔴 T4-2 — REAL 은 내부 details 를 싣지 않는다
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

export class AppointmentConflictException extends ConflictException {
  constructor(doctorId: string, timeSlot: string) {
    super(`Doctor ${doctorId} has a scheduling conflict at ${timeSlot}`, {
      doctorId,
      timeSlot,
    });
  }
}

export class InvalidStatusTransitionException extends ConflictException {
  constructor(currentStatus: string, requestedStatus: string) {
    super(`Cannot transition from ${currentStatus} to ${requestedStatus}`, {
      currentStatus,
      requestedStatus,
    });
  }
}
