import { Controller, Get, Post, Body, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { EligibilityService } from './eligibility.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CheckEligibilityDto, VerifyIdentityDto } from './dto/eligibility-write.dto';

/**
 * 수진자 자격조회(공단 연계) + 본인확인 의무화 — 원무/임상
 *
 * 🔴 (2026-09-16 K3) 위 한 줄은 **원무**를 적어 두고 `@Roles` 에는 넣지 않았다 — 주석이 의도를 선언하고
 *    코드가 그것을 어긴 자리다. 본인확인 의무화 기록은 접수 데스크의 행위이고, 부르는 화면은
 *    `/reception`(nav: ADMIN·NURSE·RECEPTIONIST)의 `EligibilityVerifyModal` 이다 —
 *    원무가 '신분증 확인'을 누르면 403 이었다(P2 가 그 모달의 대조 항목 전송을 고쳤지만 역할은 아무도 안 봤다).
 */
@ApiTags('Eligibility (수진자 자격조회)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR, UserRole.RECEPTIONIST)
@Controller('api/v1/eligibility')
export class EligibilityController {
  constructor(private readonly svc: EligibilityService) {}

  @Post('check')
  @ApiOperation({ summary: '수진자 자격조회 (자격유무·본인부담구분·산정특례)' })
  async check(
    @Body() body: CheckEligibilityDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.check(body.patientId, { visitType: body.visitType, queueId: body.queueId, userId }) };
  }

  @Get('patient/:patientId')
  @ApiOperation({ summary: '최신 자격조회 결과 (캐시 유효성 포함)' })
  async latest(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return { data: await this.svc.latest(patientId) };
  }

  @Post('verify-identity')
  @ApiOperation({ summary: '본인확인 의무화 기록 (신분증/모바일건보증/구두예외)' })
  async verifyIdentity(
    @Body() body: VerifyIdentityDto,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.svc.verifyIdentity(body.patientId, body, userId) };
  }
}
