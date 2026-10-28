import { IsIn, IsNumber, IsString, IsOptional, IsArray, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewClaimDto {
  /**
   * 🔴 심사 결과. 화면이 이 값을 보내는데 DTO 에 없어 ValidationPipe(whitelist)가 **조용히 제거**했고,
   *    서버는 `rejectReason`·`reducedAmount` 유무로만 판정해 **반려·부분인정을 골라도 전부 APPROVED**
   *    로 저장됐다(2026-08-13 W6). 반려 청구가 '인정'으로 남으면 삭감액이 병원 부담으로 계상되지
   *    않고, 같은 트랜잭션의 billing 정산·ERP 아웃박스까지 잘못 나간다.
   */
  @ApiPropertyOptional({ description: '심사 결과 (APPROVED · PARTIALLY_APPROVED · REJECTED)' })
  @IsOptional()
  @IsIn(['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED'])
  reviewResult?: 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED';

  @ApiProperty({ description: '승인 금액' })
  @IsNumber()
  approvedAmount: number;

  @ApiPropertyOptional({ description: '삭감 금액' })
  @IsOptional()
  @IsNumber()
  reducedAmount?: number;

  @ApiPropertyOptional({ description: '거절 사유' })
  @IsOptional()
  @IsString()
  rejectReason?: string;

  /** 화면의 '삭감/반려 사유' — 종전엔 이 이름으로 보내 서버에 닿지 않았다 */
  @ApiPropertyOptional({ description: '삭감/반려 사유(화면 입력)' })
  @IsOptional()
  @IsString()
  reducedReason?: string;
}

export class ExportClaimXmlDto {
  @ApiProperty({ description: '청구 ID 목록' })
  @IsArray()
  @IsUUID('4', { each: true })
  claimIds: string[];
}
