import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CodeBlueService } from './code-blue.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ActivateRrtDto, CreateCodeBlueDto, RespondRrtDto, UpdateCodeBlueDto } from './dto/code-blue.dto';

@ApiTags('Code Blue / RRT (원내 심정지·신속대응팀)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/code-blue')
export class CodeBlueController {
  constructor(private readonly service: CodeBlueService) {}

  // ── 코드블루 ──
  @Post()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '코드블루(심정지) 발생 기록' })
  async create(@Body() body: CreateCodeBlueDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.createCodeBlue(userId, body) };
  }

  @Get('stats')
  // 🔴 @Roles 누락으로 전 직군이 조회 가능했다(2026-09-06 실측) — 심정지 기록은 임상+ADMIN 만
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '코드블루 통계(생존율·평균 기동시간)' })
  async stats(@Query('month') month?: string) {
    return { data: await this.service.codeBlueStats(month) };
  }

  @Get()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '코드블루 목록' })
  async list(@Query('patientId') patientId?: string) {
    return { data: await this.service.listCodeBlue(patientId) };
  }

  @Patch(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '코드블루 경과 업데이트(팀도착·CPR·ROSC·제세동·outcome)' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateCodeBlueDto) {
    return { data: await this.service.updateCodeBlue(id, body) };
  }

  // ── RRT(신속대응팀) ──
  @Post('rrt')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'RRT(신속대응팀) 활성화' })
  async activateRrt(@Body() body: ActivateRrtDto, @CurrentUser('id') userId: string) {
    return { data: await this.service.activateRrt(userId, body) };
  }

  @Get('rrt')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'RRT 목록(도착 SLA 포함)' })
  async listRrt(@Query('patientId') patientId?: string) {
    return { data: await this.service.listRrt(patientId) };
  }

  @Patch('rrt/:id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: 'RRT 응답(도착·팀·outcome)' })
  async respondRrt(@Param('id', ParseUUIDPipe) id: string, @Body() body: RespondRrtDto) {
    return { data: await this.service.respondRrt(id, body) };
  }
}
