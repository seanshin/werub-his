import { IsOptional, IsEnum, IsInt, IsString, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IntakeType, OutputType } from '@prisma/client';

export class CreateIntakeOutputDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  recordedAt?: string;

  @ApiPropertyOptional({ enum: IntakeType })
  @IsOptional()
  @IsEnum(IntakeType)
  intakeType?: IntakeType;

  @ApiPropertyOptional({ description: 'mL' })
  @IsOptional()
  @IsInt()
  intakeAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  intakeDetail?: string;

  @ApiPropertyOptional({ enum: OutputType })
  @IsOptional()
  @IsEnum(OutputType)
  outputType?: OutputType;

  @ApiPropertyOptional({ description: 'mL' })
  @IsOptional()
  @IsInt()
  outputAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  outputDetail?: string;
}
