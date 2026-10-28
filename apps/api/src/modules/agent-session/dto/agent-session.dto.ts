import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAgentSessionDto {
  @ApiPropertyOptional({ description: '채널', example: 'HIS_RECEPTION' })
  @IsOptional()
  @IsString()
  channel?: string;
}

export class SendAgentMessageDto {
  @ApiProperty({ description: '메시지 내용' })
  @IsString()
  message: string;
}
