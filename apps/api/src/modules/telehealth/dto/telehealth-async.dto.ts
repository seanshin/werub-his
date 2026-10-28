import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * 비동기 원격진료 본문 — 🔴 (2026-09-14 기획서 전체 검토) 종전 인라인 타입 `@Body() body: { message: string; ... }` 는
 * 런타임 metatype 이 `Object` 라 ValidationPipe 가 통째로 건너뛰었다 — 빈 본문이면 `patientMessage: undefined` 로
 * 세션이 WAITING 이 되어 "메시지를 받았다"는 상태만 남았다. 필드 이름은 종전 인라인 타입과 같다(whitelist 가 지우지 않게).
 * 길이 상한은 정하지 않는다 — 정본 정책이 없어 지어내지 않는다.
 */
export class SubmitTelehealthPatientMessageDto {
  @ApiProperty({ description: '환자 메시지' })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({ description: '첨부 사진(형식은 서비스가 그대로 저장)', type: [Object] })
  @IsOptional()
  @IsArray()
  photos?: unknown[];
}

export class SubmitTelehealthDoctorReplyDto {
  @ApiProperty({ description: '의사 답변' })
  @IsString()
  @IsNotEmpty()
  reply!: string;
}
