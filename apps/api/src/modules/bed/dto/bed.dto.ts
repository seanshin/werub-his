import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BedStatus } from '@prisma/client';

export class UpdateBedStatusDto {
  @ApiProperty({ description: '병상 상태', enum: BedStatus })
  @IsEnum(BedStatus)
  status: BedStatus;
}
