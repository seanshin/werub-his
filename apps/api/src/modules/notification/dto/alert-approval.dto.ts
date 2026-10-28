import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AlertApprovalDto {
  @ApiProperty({ description: '승인 근거 — 위원회 의결 번호·문서(5자 이상)' }) @IsString() @IsNotEmpty() @MaxLength(1000)
  basis!: string;
}

export class AlertRevokeDto {
  @ApiProperty({ description: '철회 사유(5자 이상)' }) @IsString() @IsNotEmpty() @MaxLength(1000)
  reason!: string;
}
