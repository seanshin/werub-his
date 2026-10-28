import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 🔴 (2026-09-15 U2) KONIS HAI 집계 보고 — 종전 `@Body() data: Record<string, unknown>` 가 **원 본문 그대로** 외부 전송 채널
 *    (`transmitKonis({ ...data })`)로 넘어갔다. 대외 발신 경로라 본문 검증이 특히 중요하다 — 지금은 채널 미구축이지만
 *    구현되는 날 임의 키가 기관 보고로 나간다. 또 `patientDays:'abc'` 면 감염률이 문자열 "NaN" 으로 응답됐다.
 *    필드는 서비스가 실제로 읽는 7개만(whitelist 가 나머지를 지운다). 발송 로직·3조건·미전송 응답은 건드리지 않는다.
 *    길이 상한은 저장 모델이 없어 근거가 없으므로 두지 않는다(지어낸 제약 금지). 어휘(infectionType)도 막지 않는다.
 */
export class KonisReportDto {
  @ApiPropertyOptional({ description: '요양기관 코드' }) @IsOptional() @IsString() facilityCode?: string;
  @ApiPropertyOptional({ description: 'HAI 유형(CLABSI·CAUTI·VAP 등)' }) @IsOptional() @IsString() infectionType?: string;
  @ApiPropertyOptional({ description: '감시 단위(병동·ICU)' }) @IsOptional() @IsString() unit?: string;
  @ApiPropertyOptional({ description: '기구 사용일수' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) deviceDays?: number;
  @ApiPropertyOptional({ description: '재원일수(감염률 분모 — 없으면 감염률 산출 불가)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) patientDays?: number;
  @ApiPropertyOptional({ description: '감염 발생 건수' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) eventsCount?: number;
  /** 🔴 보고자를 본문에서 받는다 — 인증 사용자로 바꿀지는 계약 변경이라 이번 범위 밖(기록) */
  @ApiPropertyOptional({ description: '보고자(본문 값 그대로)' }) @IsOptional() @IsString() submittedBy?: string;
}
