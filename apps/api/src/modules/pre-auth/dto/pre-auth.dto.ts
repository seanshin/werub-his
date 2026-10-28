import { IsString, IsUUID, IsOptional, IsObject, IsIn, MaxLength } from 'class-validator';

/** 의료진발 오더 사전승인 상신(P0: 마약류 처방) */
export class SubmitOrderPreAuthDto {
  @IsString() type!: string; // NARCOTIC_RX
  @IsUUID() encounterId!: string;
  @IsOptional() @IsUUID() approverUserId?: string; // 미지정 시 처방의 관리자(과장)로 해소
  @IsObject() draft!: Record<string, unknown>; // 처방 초안(CreatePrescriptionDto) — 승인 시 발행
  @IsOptional() @IsUUID() prescriberId?: string; // 위임 처방의(선택)
}

/** 환자 포털 사전승인 신청(P2: 재처방·검사·의뢰·시술상담) */
export class SubmitPortalPreAuthDto {
  @IsIn(['PORTAL_REFILL', 'PORTAL_TEST', 'PORTAL_REFERRAL', 'PORTAL_CONSULT']) type!: string;
  @IsOptional() @IsObject() detail?: Record<string, unknown>; // 신청 상세(약품·검사명 등)
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
