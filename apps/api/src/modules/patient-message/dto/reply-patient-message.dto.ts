import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReplyPatientMessageDto {
  @ApiProperty({ description: '답변 내용' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content!: string;

  @ApiPropertyOptional({
    description:
      '환자 앱 알림 요청(옵트인). true 여도 시스템 설정(notification.patientPush.enabled + types.MESSAGE)이 둘 다 켜져 있어야 나간다.',
  })
  @IsOptional()
  @IsBoolean()
  notifyPatient?: boolean;
}
