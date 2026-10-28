import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EmrCertService } from './emr-cert.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('EMR Certification (인증)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/emr-cert')
export class EmrCertController {
  constructor(private readonly emrCertService: EmrCertService) {}

  @Get('checklist')
  @ApiOperation({ summary: 'EMR 인증 체크리스트 현황' })
  async getChecklist() { return { data: await this.emrCertService.getChecklist() }; }

  @Get('checklist/category')
  @ApiOperation({ summary: '카테고리별 지표' })
  async getByCategory(@Query('category') category: string) { return { data: await this.emrCertService.getByCategory(category) }; }
}
