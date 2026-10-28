import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { NursingService } from './nursing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Nursing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.NURSE, UserRole.DOCTOR)
@Controller('api/v1/nursing')
export class NursingStationController {
  constructor(private readonly nursingService: NursingService) {}

  @Get('station-board')
  @ApiOperation({ summary: '간호 스테이션 보드 — 병동별 재원 환자 실시간 현황(EWS·투약지연·낙상·미서명)' })
  async stationBoard(@Query('wardId') wardId?: string) {
    return { data: await this.nursingService.getStationBoard(wardId) };
  }

  /**
   * ⑩ 스테이션 벽걸이(TV) 화면 — 🔴 방문객·환자도 보는 자리라 **서버가 지운다**(화면 숨김에 기대지 않는다 · TV 전광판과 같은 규약).
   *  · 이름 = 홍○동(maskPublicName — ER·대기 전광판과 같은 규칙) · 등록번호·인계 메모·검사값·술식명·근무표 부서 없음
   *  · 신호는 있음/없음·수·시각만 · 간호사 이름도 같은 마스킹
   * 계약 테스트: `station-wall.spec.ts`(응답에 원문 이름·MRN·메모 키가 없다)
   */
  @Get('station-board/wall')
  @ApiOperation({ summary: '간호 스테이션 벽걸이 화면 — 서버 마스킹(이름 홍○동·MRN·메모·검사값·술식명 없음)' })
  async stationWall(@Query('wardId') wardId?: string) {
    return { data: await this.nursingService.getStationWall(wardId) };
  }

  @Get('shift-closeout')
  @Roles(UserRole.NURSE, UserRole.ADMIN)
  @ApiOperation({ summary: '근무조 마감(하번) — 내 담당 환자별 이번 근무조 기록 유무(간호기록·활력·I/O·투약·인계) · 충분성 판정 아님' })
  async shiftCloseout(@CurrentUser('id') nurseId: string) {
    return { data: await this.nursingService.getShiftCloseout(nurseId) };
  }

  @Get('station-briefing')
  @ApiOperation({ summary: 'F-5 스테이션 브리핑 — 보드 집계 한 문단 요약(게이트·읽기 보조)' })
  async stationBriefing(@Query('wardId') wardId?: string) {
    return { data: await this.nursingService.getStationBriefing(wardId) };
  }

  @Get('resolve-patient')
  @ApiOperation({ summary: '간호사 타블렛 — 환자식별 QR/코드 해석(IPSG.1·MRN/patientId→활성 입원)' })
  async resolvePatient(@Query('code') code: string) {
    return { data: await this.nursingService.resolvePatientByCode(code) };
  }
}
