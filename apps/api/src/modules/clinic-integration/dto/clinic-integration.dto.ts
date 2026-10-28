import {
  IsString, IsOptional, IsNotEmpty, IsObject, IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ── SSO 토큰 검증 ──

export class VerifySsoDto {
  @ApiProperty({ description: 'SSO 토큰' })
  @IsString()
  @IsNotEmpty()
  token: string;
}

// ── 수술 일정 Clinic 동기화 ──

export class SyncSurgeryScheduleDto {
  @ApiPropertyOptional({ description: '수술 ID' })
  @IsOptional()
  @IsString()
  surgeryId?: string;

  @ApiPropertyOptional({ description: '환자명' })
  @IsOptional()
  @IsString()
  patientName?: string;

  @ApiPropertyOptional({ description: '수술명' })
  @IsOptional()
  @IsString()
  procedureName?: string;

  @ApiPropertyOptional({ description: '예정일시' })
  @IsOptional()
  @IsString()
  scheduledAt?: string;

  @ApiPropertyOptional({ description: '집도의' })
  @IsOptional()
  @IsString()
  surgeonName?: string;

  @ApiPropertyOptional({ description: '수술실' })
  @IsOptional()
  @IsString()
  operatingRoom?: string;
}

// ── 역할 매핑 업데이트 ──

export class UpdateRoleMappingDto {
  @ApiProperty({ description: '직원 ID' })
  @IsString()
  @IsNotEmpty()
  staffId: string;

  @ApiProperty({ description: 'Clinic 사용자 ID' })
  @IsString()
  @IsNotEmpty()
  clinicUserId: string;

  @ApiPropertyOptional({ description: 'HIS 역할' })
  @IsOptional()
  @IsString()
  hisRole?: string;

  @ApiPropertyOptional({ description: '부서' })
  @IsOptional()
  @IsString()
  department?: string;
}

// ── 알림 발송 ──

export class SendNotificationDto {
  @ApiProperty({ description: '수신자 목록', type: [String] })
  @IsArray()
  @IsString({ each: true })
  recipients: string[];

  @ApiProperty({ description: '제목' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: '메시지 내용' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiPropertyOptional({ description: '우선순위' })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({ description: '링크' })
  @IsOptional()
  @IsString()
  link?: string;

  @ApiPropertyOptional({ description: '카테고리' })
  @IsOptional()
  @IsString()
  category?: string;
}

// ── 긴급 알림 ──

export class SendUrgentNotificationDto {
  @ApiProperty({ description: '채널' })
  @IsString()
  @IsNotEmpty()
  channel: string;

  @ApiProperty({ description: '제목' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: '메시지 내용' })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({ description: '담당자 목록', type: [String] })
  @IsArray()
  @IsString({ each: true })
  assignees: string[];
}

// ── 채널 메시지 ──

export class SendChannelMessageDto {
  @ApiProperty({ description: '채널명' })
  @IsString()
  @IsNotEmpty()
  channelName: string;

  @ApiProperty({ description: '내용' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ description: '발신자' })
  @IsOptional()
  @IsString()
  sender?: string;
}

// ── 인수인계 ──

export class SendHandoffDto {
  @ApiProperty({ description: '부서' })
  @IsString()
  @IsNotEmpty()
  department: string;

  @ApiProperty({ description: '내용' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ description: '인수자' })
  @IsString()
  @IsNotEmpty()
  fromUser: string;

  @ApiProperty({ description: '인계자' })
  @IsString()
  @IsNotEmpty()
  toUser: string;
}

// ── 캘린더 동기화 ──

export class SyncCalendarDto {
  @ApiProperty({ description: '이벤트 목록' })
  @IsArray()
  events: Record<string, unknown>[];
}

// ── 연차 신청 ──

export class RequestLeaveDto {
  @ApiProperty({ description: '사용자 ID' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: '시작일 (YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({ description: '종료일 (YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  endDate: string;

  @ApiProperty({ description: '사유' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

// ── 전자결재 요청 ──

export class RequestApprovalDto {
  @ApiProperty({ description: '템플릿 ID' })
  @IsString()
  @IsNotEmpty()
  templateId: string;

  @ApiProperty({ description: '제목' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: '기안자' })
  @IsString()
  @IsNotEmpty()
  drafter: string;

  @ApiProperty({ description: '결재자 목록', type: [String] })
  @IsArray()
  @IsString({ each: true })
  approvers: string[];

  @ApiProperty({ description: '내용' })
  content: Record<string, unknown>;

  @ApiProperty({ description: '콜백 URL' })
  @IsString()
  @IsNotEmpty()
  callbackUrl: string;
}

// ── Wiki 페이지 생성 ──

export class CreateWikiPageDto {
  @ApiProperty({ description: '제목' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: '내용' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ description: '경로' })
  @IsString()
  @IsNotEmpty()
  path: string;
}

// ── Webhook 구독 ──

export class SubscribeWebhookDto {
  @ApiProperty({ description: 'Webhook URL' })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiProperty({ description: '이벤트 목록', type: [String] })
  @IsArray()
  @IsString({ each: true })
  events: string[];

  @ApiProperty({ description: '시크릿 키' })
  @IsString()
  @IsNotEmpty()
  secret: string;
}

// ── Webhook 수신 ──

export class ReceiveWebhookDto {
  @ApiProperty({ description: '이벤트 타입' })
  @IsString()
  @IsNotEmpty()
  event: string;

  @ApiProperty({ description: '타임스탬프' })
  @IsString()
  @IsNotEmpty()
  timestamp: string;

  @ApiProperty({ description: '병원 코드' })
  @IsString()
  @IsNotEmpty()
  hospitalCode: string;

  @ApiProperty({ description: '이벤트 ID(멱등키) — C-3 정본: 최상위 필드', required: false })
  @IsOptional()
  @IsString()
  eventId?: string;

  @ApiProperty({ description: '서명(body 병행 표기 — 검증은 X-Clinic-Signature 헤더/rawBody 기준)', required: false })
  @IsOptional()
  @IsString()
  signature?: string;

  // 🔴 데코레이터 필수 — 전역 whitelist가 미데코 필드를 조용히 strip(docId 유실 잠복 결함, 2026-07-17 발견)
  @ApiProperty({ description: '이벤트 데이터' })
  @IsOptional()
  @IsObject()
  data: Record<string, unknown>;
}
