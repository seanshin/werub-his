import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 🔴 (2026-09-15 U4) 발급 처리 기록(반려 사유·교부 송장/수신번호·대리인 검증)은 법정 발급 이력의 일부다.
 *    종전엔 인라인 `@Body` 라 검증이 없었고, 서비스가 `slice` 로 **조용히 잘라** 저장했다(반려 상세 250·송장 120·검증 메모 300),
 *    관계·법적 근거는 VarChar(30·20) 초과 시 500. 길이는 스키마 근거로 400 으로 알린다(화면 입력칸 maxLength 동반).
 */
export class RejectDocumentRequestDto {
  /** 코드 허용 목록 판정은 서비스(INVALID_REASON)가 한다 — 길이만 */
  @ApiProperty({ description: '반려 사유 코드' }) @IsString() @MaxLength(40) reason!: string;
  /** rejectReason VarChar(300) = '<코드>: <상세>' — 서비스 조립과 같은 250 */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(250, { message: '반려 상세 사유는 250자 이내로 입력하세요' }) detail?: string;
}

export class DeliverDocumentRequestDto {
  @ApiPropertyOptional({ description: '우편 송장번호·팩스 수신번호·방문 수령 메모' })
  @IsOptional() @IsString() @MaxLength(120, { message: '송장·수신번호·수령 메모는 120자 이내로 입력하세요' }) ref?: string;
}

export class VerifyProxyDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] }) @IsIn(['VERIFIED', 'REJECTED']) decision!: 'VERIFIED' | 'REJECTED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) relation?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['SELF', 'LEGAL_GUARDIAN', 'DELEGATED', 'BEREAVED']) legalBasis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300, { message: '검증 메모는 300자 이내로 입력하세요' }) note?: string;
}
