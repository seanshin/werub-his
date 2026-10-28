import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBedTransferDto {
  @ApiProperty() @IsUUID() admissionId!: string;
  @ApiProperty({ description: '받는 병동' }) @IsUUID() targetWardId!: string;
  @ApiPropertyOptional({ description: '원하는 병상(선택 — 받는 쪽이 바꿀 수 있다)' }) @IsOptional() @IsUUID() targetBedId?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}
export class AcceptBedTransferDto {
  @ApiProperty({ description: '받는 병동의 병상' }) @IsUUID() bedId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class RejectBedTransferDto {
  @ApiProperty({ description: '거절 사유(필수)' }) @IsString() @MaxLength(1000) reason!: string;
}
export class CancelBedTransferDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
