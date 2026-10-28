import { IsString, IsOptional, IsUUID, IsDateString, IsInt, IsEnum, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { AppointmentType } from '@prisma/client';

/** 포털 셀프예약 body — 전역 ValidationPipe로 duration/scheduledAt/type 검증(직접 API 우회 차단). */
export class PortalBookAppointmentDto {
  @IsString() departmentName: string;
  @IsOptional() @IsUUID() doctorId?: string;
  @IsDateString() scheduledAt: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(240) duration?: number;
  @IsOptional() @IsEnum(AppointmentType) type?: AppointmentType;
  @IsOptional() @IsString() reason?: string;
}

/** 포털 대기자 등록 body. */
export class PortalWaitlistDto {
  @IsString() departmentName: string;
  @IsOptional() @IsUUID() doctorId?: string;
  @IsOptional() @IsDateString() preferredFrom?: string;
  @IsOptional() @IsDateString() preferredTo?: string;
  @IsOptional() @IsString() note?: string;
}
