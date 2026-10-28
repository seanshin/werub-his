import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { StaffCallService } from './staff-call.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateStaffCallDto, BroadcastDto, CodeCallDto, RespondDto, CancelStaffCallDto } from './dto/staff-call.dto';

@ApiTags('staff-call')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/staff-calls')
export class StaffCallController {
  constructor(private readonly svc: StaffCallService) {}

  @Post()
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '직원 호출(개인/역할/부서)' })
  async create(@CurrentUser('id') userId: string, @Body() body: CreateStaffCallDto) {
    return { data: await this.svc.createCall(userId, body) };
  }

  // FR-44: 브로드캐스트·Code는 고권한 역할로 제한
  @Post('broadcast')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR)
  @ApiOperation({ summary: '긴급 알림 브로드캐스트' })
  async broadcast(@CurrentUser('id') userId: string, @Body() body: BroadcastDto) {
    return { data: await this.svc.broadcast(userId, body) };
  }

  @Post('code')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: 'Code 호출(코드블루 등)' })
  async code(@CurrentUser('id') userId: string, @Body() body: CodeCallDto) {
    return { data: await this.svc.code(userId, body) };
  }

  @Post(':id/respond')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '호출 응답(수락/확인/콜백/수신확인)' })
  async respond(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: RespondDto,
  ) {
    return { data: await this.svc.respond(id, userId, body.response) };
  }

  @Post(':id/cancel')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '호출 취소/철회(발신자/책임자)' })
  async cancel(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Param('id') id: string,
    @Body() body: CancelStaffCallDto,
  ) {
    return { data: await this.svc.cancel(id, userId, role === 'ADMIN', body?.falseAlarm) };
  }

  @Post(':id/escalate')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '미응답 에스컬레이션(대상 확대 재전송)' })
  async escalate(@Param('id') id: string) {
    return { data: await this.svc.escalate(id) };
  }

  @Get('mine')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '내가 보낸 호출 + 응답 집계' })
  async mine(@CurrentUser('id') userId: string) {
    return { data: await this.svc.myRecent(userId) };
  }

  @Get(':id')
  @Roles(UserRole.DOCTOR, UserRole.NURSE, UserRole.PHARMACIST, UserRole.LAB_TECH, UserRole.ADMIN)
  @ApiOperation({ summary: '호출 상세(응답 목록)' })
  async detail(@Param('id') id: string) {
    return { data: await this.svc.getCall(id) };
  }
}
