import { Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrescriptionIssueService } from './prescription-issue.service';

@ApiTags('Prescription Issue (처방전 발급)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/encounters')
export class PrescriptionIssueController {
  constructor(private readonly svc: PrescriptionIssueService) {}

  /** 처방전 발급 — 발급번호·QR(진위 확인) · 같은 내용이면 같은 번호 · 약국 전송 없음(채널 미구현 — 응답이 말한다) */
  @Post(':encounterId/prescription-issue')
  // 문서 발급 EP 와 같은 역할(처방전 출력은 원무도 한다)
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST)
  @ApiOperation({ summary: '처방전 발급(발급번호·진위 확인 QR) — 서명된 진료만 · 전자 전송 없음' })
  async issue(@Param('encounterId', ParseUUIDPipe) encounterId: string, @CurrentUser('id') userId: string) {
    return { data: await this.svc.issue(encounterId, userId) };
  }
}
