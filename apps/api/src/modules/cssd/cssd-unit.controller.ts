import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CssdUnitService } from './cssd-unit.service';
import { CreateInstrumentUnitDto, UpdateInstrumentUnitDto, RetireInstrumentUnitDto, SetItemMaxCyclesDto } from './dto/cssd-unit.dto';

@ApiTags('CSSD 기구 개체(수명·멸균 횟수)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.NURSE, UserRole.ADMIN)
@Controller('api/v1/cssd')
export class CssdUnitController {
  constructor(
    private readonly svc: CssdUnitService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('units')
  @ApiOperation({ summary: '기구 개체 목록 — 멸균 합격 사이클·최초 사용일(파생)·수명 판정' })
  list(@Query('itemId') itemId?: string, @Query('status') status?: string, @Query('q') q?: string) {
    return this.svc.list({ itemId, status, q }).then((data) => ({ data }));
  }

  @Get('units/:id')
  @ApiOperation({ summary: '기구 개체 상세 — 패키지(LOT) 이력·수명 판정' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(id).then((data) => ({ data }));
  }

  @Post('units')
  @ApiOperation({ summary: '기구 개체 등록' })
  create(@Body() body: CreateInstrumentUnitDto, @CurrentUser('id') userId: string) {
    return this.svc.create(body, userId).then((data) => ({ data }));
  }

  @Patch('units/:id')
  @ApiOperation({ summary: '기구 개체 수명 한도·메모 변경(null=개체 한도 해제)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateInstrumentUnitDto) {
    return this.svc.update(id, body).then((data) => ({ data }));
  }

  @Post('units/:id/retire')
  @ApiOperation({ summary: '기구 개체 폐기(기록 보존 · 새 패키지 투입 불가)' })
  retire(@Param('id', ParseUUIDPipe) id: string, @Body() body: RetireInstrumentUnitDto, @CurrentUser('id') userId: string) {
    return this.svc.retire(id, userId, body.note).then((data) => ({ data }));
  }

  @Patch('items/:id/max-cycles')
  @ApiOperation({ summary: '품목 기본 수명 한도 설정(null=한도 미설정)' })
  async setItemMaxCycles(@Param('id', ParseUUIDPipe) id: string, @Body() body: SetItemMaxCyclesDto) {
    // 생략(undefined)과 해제(null)를 구분한다 — 빈 본문으로 한도가 조용히 지워지지 않게
    if (body.maxCycles === undefined) throw new BadRequestException('maxCycles 를 숫자 또는 null 로 보내야 합니다');
    const item = await this.prisma.instrumentItem.findUnique({ where: { id }, select: { id: true } });
    if (!item) throw new NotFoundException('기구 품목을 찾을 수 없습니다');
    const data = await this.prisma.instrumentItem.update({ where: { id }, data: { maxCycles: body.maxCycles }, select: { id: true, code: true, name: true, maxCycles: true } });
    return { data };
  }
}
