import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * 접수 정정 본문 — 🔴 (2026-09-15 N4-B8) 종전 인라인 타입은 ValidationPipe 가 통째로 건너뛰었다.
 * `doctorId` 에 UUID 가 아닌 값이 오면 저장 단계 P2023 → 500 · `visitType` 이 컬럼 길이(VarChar 20)를 넘으면 500.
 * 방문 유형 어휘는 접수 생성 경로도 강제하지 않아(자유 문자열) 여기서도 지어내지 않는다 — 스키마 길이만.
 */
export class UpdateQueueDto {
  @ApiPropertyOptional({ description: '변경할 진료과' }) @IsOptional() @IsString() @IsNotEmpty() departmentName?: string;
  @ApiPropertyOptional({ description: '변경할 의사' }) @IsOptional() @IsUUID() doctorId?: string;
  @ApiPropertyOptional({ description: '방문 유형(waiting_queue.visit_type VarChar 20)' }) @IsOptional() @IsString() @MaxLength(20) visitType?: string;
  @ApiPropertyOptional({ description: '사유(빈 문자열=지움)' }) @IsOptional() @IsString() reason?: string;
}
