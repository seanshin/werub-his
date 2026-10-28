import { IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 공개(무인증) 환자 본인 인증 입력 — `POST /api/v1/concierge/patient-auth/verify`.
 *
 * 🔴 (2026-09-16 H1) 종전엔 `@Body('mrn')`·`@Body('dateOfBirth')` 로 **개별 추출**했다.
 *    개별 `@Body(key)` 는 런타임 metatype 이 없어 전역 ValidationPipe 가 **검증을 통째로 건너뛴다**.
 *    그 값이 그대로 `prisma.patient.findFirst({ where: { mrn, … } })` 에 들어가,
 *    `{"mrn":{"not":"__x__"},"dateOfBirth":"1980-01-01"}` 처럼 **객체를 보내면 Prisma 가 필터 연산자로
 *    해석**해 등록번호를 모르고도 그 생년월일의 아무 환자로 인증이 통과했다(본인 인증 우회).
 *    같은 함정이 `consent-public.dto.ts` 머리말에 이미 적혀 있었다 — 이 경로만 그 규약을 안 지났다.
 */
export class ConciergePatientAuthDto {
  @ApiProperty({ description: '환자 등록번호(MRN)' })
  @IsString()
  @Length(1, 32)
  mrn: string;

  @ApiProperty({ description: '생년월일 (YYYY-MM-DD)', example: '1980-01-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateOfBirth 는 YYYY-MM-DD 형식이어야 합니다' })
  dateOfBirth: string;
}
