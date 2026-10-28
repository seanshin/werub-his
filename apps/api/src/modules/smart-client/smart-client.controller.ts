import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { SmartClientService } from './smart-client.service';
import { SmartAccessService } from './smart-access.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateSmartClientDto, UpdateSmartClientDto } from './dto/smart-client.dto';

@ApiTags('SMART Client (외부 클라이언트)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/smart-clients')
export class SmartClientController {
  constructor(
    private readonly smartClientService: SmartClientService,
    private readonly smartAccess: SmartAccessService,
  ) {}

  // ── 접근 리포트(Cerno 협의 '감사로그 연계') — 정적 경로를 ':id' 보다 먼저 선언(Nest 선점 규칙)
  @Get('access/summary')
  @ApiOperation({ summary: 'SMART 접근 요약 — 클라이언트별·사용자별·리소스별' })
  async accessSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.smartAccess.summary(from, to) };
  }

  @Get('access')
  @ApiOperation({ summary: 'SMART 접근 목록 — 클라이언트·사용자·환자로 좁힘(커서)' })
  async accessList(
    @Query('clientId') clientId?: string,
    @Query('userId') userId?: string,
    @Query('patientId') patientId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return { data: await this.smartAccess.list({ clientId, userId, patientId, from, to, before, limit: limit ? Number(limit) : undefined }) };
  }

  @Get()
  @ApiOperation({ summary: '클라이언트 목록 조회' })
  async findAll() {
    return { data: await this.smartClientService.findAll() };
  }

  @Post()
  @ApiOperation({ summary: '클라이언트 등록' })
  async create(@Body() dto: CreateSmartClientDto) {
    return { data: await this.smartClientService.create(dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: '클라이언트 수정(launch URL·redirect·스코프·이름)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSmartClientDto) {
    return { data: await this.smartClientService.update(id, dto) };
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: '클라이언트 활성/비활성 전환' })
  async toggle(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.smartClientService.toggle(id) };
  }

  @Delete(':id')
  @ApiOperation({ summary: '클라이언트 삭제' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.smartClientService.remove(id) };
  }
}
