import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsUUID, MaxLength } from 'class-validator';

export class SmartLaunchDto {
  @ApiProperty({ description: '등록된 SMART 클라이언트의 client_id' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  clientId!: string;

  @ApiProperty({ description: '환자 UUID(launch 문맥으로 바인딩)' })
  @IsUUID()
  patientId!: string;
}
