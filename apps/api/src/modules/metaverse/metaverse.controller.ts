import { Controller, Get, Query, Param, UseGuards, Sse } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { MetaverseService } from './metaverse.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Observable, interval, map } from 'rxjs';

@ApiTags('Metaverse')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('api/v1/metaverse')
export class MetaverseController {
  constructor(private readonly service: MetaverseService) {}

  /** 층별 안내 — 전 직원(시설 안내 화면). 이름·실번호만(환자·좌표 없음) → 역할 제한을 두지 않는다 */
  @Get('directory')
  @ApiOperation({ summary: '층별 안내(공간 정본의 층·구역 이름) — 전 직원' })
  async getDirectory() {
    return { data: await this.service.getDirectory() };
  }

  @Get('structure')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '병원 전체 구조 (층별 구역)' })
  async getStructure() {
    return { data: await this.service.getStructure() };
  }

  @Get('patients')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '현재 환자 위치 현황' })
  async getPatientLocations(@Query('floor') floor?: string) {
    // 배열은 그대로 data 에 — 판정 규칙·오래된 기록 수·잘림은 meta(응답 정본 { data, meta })
    const r = await this.service.getPatientLocations(floor ? parseInt(floor) : undefined);
    return { data: r.items, meta: r.meta };
  }

  @Get('heatmap')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '구역별 혼잡도 히트맵' })
  async getHeatmap() {
    return { data: await this.service.getHeatmap() };
  }

  @Get('patients/:patientId/trail')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '환자 동선 이력' })
  async getPatientTrail(
    @Param('patientId') patientId: string,
    @Query('date') date?: string,
  ) {
    return { data: await this.service.getPatientTrail(patientId, date) };
  }

  @Get('dwell')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '구역별 체류 p50/p90 — 관측·추정 분리 · 표본 부족은 산출 불가(P4b)' })
  async getDwell(@Query('days') days?: string) {
    return { data: await this.service.getDwell(days) };
  }

  @Get('floor-stats')
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '층별 실시간 통계' })
  async getFloorStats() {
    return { data: await this.service.getFloorStats() };
  }

  @Sse('stream')
  // 🔴 (2026-09-16 E3) 형제 GET 3개는 임상 3역할인데 이 스트림만 전 직원이었다.
  //    지금 흘러나가는 것은 heartbeat 뿐이지만(요약이 말하는 '환자 위치'는 아직 실리지 않는다),
  //    이름이 약속한 데이터가 실리는 날 열려 있으면 늦다 — 형제와 같은 집합으로 둔다.
  //    `@Sse` 는 헤더 선전송이라 CanActivate 가드(RolesGuard)만 유효하다.
  @Roles(UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE)
  @ApiOperation({ summary: '실시간 위치 스트림 (SSE — 현재 heartbeat 만)' })
  stream(): Observable<MessageEvent> {
    return interval(5000).pipe(
      map(() => {
        return {
          data: JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() }),
        } as MessageEvent;
      }),
    );
  }
}
