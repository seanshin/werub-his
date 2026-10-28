import { IsString, IsOptional, IsEnum, IsDateString, IsBoolean, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NursingNoteType, ShiftType } from '@prisma/client';

export class CreateNursingNoteDto {
  @ApiProperty({ enum: NursingNoteType })
  @IsEnum(NursingNoteType)
  noteType: NursingNoteType;

  @ApiPropertyOptional({ description: 'Focus Charting 초점' })
  @IsOptional()
  @IsString()
  focus?: string;

  @ApiPropertyOptional({ description: 'D: 자료' })
  @IsOptional()
  @IsString()
  data?: string;

  @ApiPropertyOptional({ description: 'A: 간호중재' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'R: 반응/평가' })
  @IsOptional()
  @IsString()
  response?: string;

  @ApiPropertyOptional({ description: '서술식 기록 (NARRATIVE)' })
  @IsOptional()
  @IsString()
  content?: string;

  // SOAP 간호기록(S/O/A/P)·교육·우선순위 — 종전 DTO 누락으로 whitelist strip되어 유실되던 필드 복구
  @ApiPropertyOptional({ description: 'S: 주관적 호소(SOAP)' })
  @IsOptional()
  @IsString()
  subjective?: string;

  @ApiPropertyOptional({ description: 'O: 객관적 관찰/측정(SOAP)' })
  @IsOptional()
  @IsString()
  objective?: string;

  @ApiPropertyOptional({ description: 'A: 간호 판단(SOAP)' })
  @IsOptional()
  @IsString()
  assessment?: string;

  @ApiPropertyOptional({ description: 'P: 간호 계획(SOAP)' })
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional({ description: 'E: 환자 교육(DARE)' })
  @IsOptional()
  @IsString()
  education?: string;

  @ApiPropertyOptional({ description: '우선순위(NORMAL|URGENT|CRITICAL)' })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiProperty({ enum: ShiftType })
  @IsEnum(ShiftType)
  shiftType: ShiftType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  recordedAt?: string;

  @ApiPropertyOptional({ description: '초안으로 저장(미서명). 생략 시 작성=서명(SIGNED)' })
  @IsOptional()
  @IsBoolean()
  draft?: boolean;

  // AI 보조 프로비넌스(F-1 ai-draft 응답을 그대로 동봉) — 있으면 aiAssisted=true 로 영속화.
  // AI는 저자 아님: 책임=서명 간호사 불변. 본 메타는 감사·투명성(JCI MOI.11.1.1)·수정량 측정용.
  @ApiPropertyOptional({ description: 'AI 초안 프로비넌스({aiModel,aiPromptVersion,aiSourceSnapshot})' })
  @IsOptional()
  @IsObject()
  aiProvenance?: { aiModel?: string; aiPromptVersion?: string; aiSourceSnapshot?: Record<string, unknown> };
}
