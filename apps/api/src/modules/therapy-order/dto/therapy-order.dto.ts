import { IsString, IsOptional, IsInt, IsBoolean, IsDateString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTherapyOrderDto {
  @ApiProperty() @IsString() orderId: string;
  @ApiProperty() @IsString() therapyType: string;
  @ApiProperty() @IsDateString() scheduledDate: string;
  @ApiPropertyOptional() @IsOptional() @IsString() scheduledTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(5) duration?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() therapistId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() stationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRecurring?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() recurPattern?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() recurEndDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) totalSessions?: number;
}

export class UpdateTherapyOrderDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() scheduledTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() duration?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() therapistId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() stationId?: string;
}

export class CompleteTherapyOrderDto {
  @ApiPropertyOptional() @IsOptional() resultData?: Record<string, unknown>;
}
