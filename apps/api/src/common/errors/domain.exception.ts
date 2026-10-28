import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 도메인 에러 — 커스텀 에러코드와 HTTP 상태코드를 분리
 *
 * @example
 *   throw new DomainException('BILLING_ALREADY_PAID', 'Already paid', HttpStatus.BAD_REQUEST);
 */
export class DomainException extends HttpException {
  public readonly domainCode: string;

  constructor(
    domainCode: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: unknown,
  ) {
    super({ domainCode, message, details }, status);
    this.domainCode = domainCode;
  }
}
