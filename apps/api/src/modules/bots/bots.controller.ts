import { Controller, Get, Post, Patch, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { BotsService } from './bots.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateBotDto, ExecuteBotDto } from './dto/bots.dto';

@ApiTags('Bots (워크플로우 자동화)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('api/v1/bots')
export class BotsController {
  constructor(private readonly botsService: BotsService) {}

  // 🔴 meta.actionEngine — 목록을 읽기 전에 알아야 하는 사실(액션 엔진 미배선). 화면이 이걸
  //    말하지 않으면 '실행 횟수'가 실제 수행 횟수로 읽힌다(2026-08-14 W8).
  @Get()
  @ApiOperation({ summary: '봇 목록 — meta.actionEngine 에 액션 엔진 배선 여부 동봉' })
  async findAll() {
    return { data: await this.botsService.findAll(), meta: { actionEngine: BotsService.ACTION_ENGINE_STATUS } };
  }

  @Post()
  @ApiOperation({ summary: '봇 생성' })
  async create(@Body() dto: CreateBotDto, @CurrentUser('id') userId: string) {
    return { data: await this.botsService.create({ ...dto, createdBy: userId }) };
  }

  @Get(':id')
  @ApiOperation({ summary: '봇 상세 (실행 이력 포함)' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.botsService.findById(id) }; }

  @Patch(':id/toggle')
  @ApiOperation({ summary: '봇 활성화/비활성화' })
  async toggle(@Param('id', ParseUUIDPipe) id: string) { return { data: await this.botsService.toggle(id) }; }

  @Post(':id/execute')
  @ApiOperation({ summary: '봇 수동 실행' })
  async execute(@Param('id', ParseUUIDPipe) id: string, @Body() dto?: ExecuteBotDto) {
    return { data: await this.botsService.execute(id, dto) };
  }
}
