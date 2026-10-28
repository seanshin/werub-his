import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class SetConfigValueDto {
  // @Allow(): 전역 whitelist ValidationPipe가 strip하지 않도록(값은 임의 타입 허용)
  @Allow()
  @ApiProperty({ description: '설정값' })
  value: unknown;
}
