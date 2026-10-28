import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PatientMessageService, type StaffActor } from './patient-message.service';
import { PATIENT_MESSAGE_READ_ROLES } from './patient-message.policy';
import { ReplyPatientMessageDto } from './dto/reply-patient-message.dto';

const READ_ROLES = PATIENT_MESSAGE_READ_ROLES as unknown as UserRole[];

/**
 * 환자↔담당의 메시지 — **직원 측**. 환자 측(포털·모바일)은 `portal/messages` 가 쓴다.
 * 🔴 포털 EP 는 staff 가드가 아니다 — 이 컨트롤러는 직원 JWT(JwtAuthGuard+RolesGuard)만 받는다.
 * 감사: 스레드 조회(`/patient-messages/patients/:uuid`)는 PHI 열람 패턴에 등재 · 답변(POST)은 변이 기본 감사.
 */
@ApiTags('PatientMessage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/patient-messages')
export class PatientMessageController {
  constructor(private readonly service: PatientMessageService) {}

  private actor(req: { user: { id: string; role: string } }): StaffActor {
    return { id: req.user.id, role: req.user.role };
  }

  @Get('inbox')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: '환자 메시지 받은편지함(환자별 묶음 · 본문 없음)' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async inbox(@Req() req: any) {
    return { data: await this.service.inbox(this.actor(req)) };
  }

  @Get('patients/:patientId')
  @Roles(...READ_ROLES)
  @ApiOperation({ summary: '환자 한 명의 메시지 스레드(범위 안)' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async thread(@Req() req: any, @Param('patientId', new ParseUUIDPipe()) patientId: string) {
    return { data: await this.service.thread(this.actor(req), patientId) };
  }

  @Post('patients/:patientId/reply')
  @Roles(UserRole.DOCTOR)
  @ApiOperation({ summary: '의사 답변(sender DOCTOR) · 환자 앱 알림은 옵트인+설정' })
  async reply(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Req() req: any,
    @Param('patientId', new ParseUUIDPipe()) patientId: string,
    @Body() dto: ReplyPatientMessageDto,
  ) {
    return { data: await this.service.reply(this.actor(req), patientId, dto.content, dto.notifyPatient) };
  }
}
