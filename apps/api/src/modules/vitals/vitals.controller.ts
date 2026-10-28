import { Controller, Get, Post, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VitalsService } from './vitals.service';
import { CreateVitalsDto } from './vitals.dto';

@ApiTags('Vitals (활력징후)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/vitals')
export class VitalsController {
  constructor(private readonly service: VitalsService) {}

  @Post()
  @ApiOperation({ summary: '활력징후 기록' })
  async create(@Body() body: CreateVitalsDto, @CurrentUser('id') nurseId: string) {
    // 🔴 저장 여부와 사유를 `meta` 로 함께 낸다 — 종전엔 `data: null` 만 가서
    //    화면이 "왜 저장 안 됐는지"를 알 수 없었다(사실은 서버 로그에만 있었다).
    const r = await this.service.create(body, nurseId);
    return { data: r.vitals, meta: { ingest: r.ingest } };
  }

  @Get()
  @ApiOperation({ summary: '환자 활력징후 이력(최근순)' })
  async list(
    @Query('patientId', ParseUUIDPipe) patientId: string,
    @Query('limit') limit?: string,
  ) {
    return { data: await this.service.listRecent(patientId, limit ? parseInt(limit, 10) : 5) };
  }
}
