import { IsString, IsUUID, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRelationDto {
  @ApiProperty({ description: '관련 환자 ID' })
  @IsUUID()
  relatedId: string;

  @ApiProperty({ description: '관계 유형', enum: ['PARENT', 'CHILD', 'SPOUSE', 'SIBLING', 'GRANDPARENT', 'GRANDCHILD', 'GUARDIAN', 'DEPENDENT'] })
  @IsString()
  @IsIn(['PARENT', 'CHILD', 'SPOUSE', 'SIBLING', 'GRANDPARENT', 'GRANDCHILD', 'GUARDIAN', 'DEPENDENT'])
  relationship: string;

  @ApiPropertyOptional({ description: '메모' })
  @IsOptional()
  @IsString()
  notes?: string;
}
