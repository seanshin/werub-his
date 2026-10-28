import { Controller, Get, Post, Body, Param, Query, Headers, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsString } from 'class-validator';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IntegrationAuthService } from '../integration/integration-auth.service';
import { HrService } from './hr.service';

class MapDto { @IsString() erpEmployeeCode!: string; }

// ERP ↔ 인사(hr) 연동 (서버-서버). PII 조회=PII키(S-1)·매핑 쓰기=웹훅키. 디렉터리=HIS, 인사·급여=ERP(SoT)
@ApiTags('ERP Integration (HR 인사)')
@SkipThrottle()
@Controller('api/v1/integration/hr')
export class HrErpController {
  constructor(private readonly prisma: PrismaService, private readonly integrationAuth: IntegrationAuthService, private readonly hrService: HrService) {}

  @Get('staff')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: 'ERP 직원 디렉터리 스냅샷(인사 동기화용) — PII 조회 키' })
  async staff(@Headers('x-integration-key') key: string, @Query('status') status?: string) {
    // ERP(piiReadKey) 또는 edu(edu.integrationKey) 둘 다 허용 — 직원 디렉터리 조회(userRole 포함)
    try {
      await this.integrationAuth.assertPiiReadKey(key);
    } catch {
      await this.integrationAuth.assertEduKey(key);
    }
    const rows = await this.prisma.staff.findMany({
      where: status ? { status: status as never } : {},
      select: { id: true, employeeNumber: true, erpEmployeeCode: true, clinicUserId: true, userId: true, managerStaffId: true, familyName: true, givenName: true, category: true, department: true, position: true, status: true, hireDate: true },
      orderBy: { employeeNumber: 'asc' },
    });
    // userRole 동봉(edu 직종 조회·P2-8) — Staff↔User relation 미정의라 별도 조회로 매핑
    const userIds = rows.map((r) => r.userId).filter((v): v is string => !!v);
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, role: true } }) : [];
    const roleByUser = new Map(users.map((u) => [u.id, u.role]));
    // 보고라인(managerEmployeeNumber) 동봉(P1-7) — 상급자 Staff의 사번으로 해석
    const mgrIds = [...new Set(rows.map((r) => r.managerStaffId).filter((v): v is string => !!v))];
    const mgrs = mgrIds.length ? await this.prisma.staff.findMany({ where: { id: { in: mgrIds } }, select: { id: true, employeeNumber: true } }) : [];
    const mgrEmpByStaff = new Map(mgrs.map((m) => [m.id, m.employeeNumber]));
    return {
      data: rows.map((s) => ({
        ...s,
        name: `${s.familyName}${s.givenName}`,
        userRole: s.userId ? roleByUser.get(s.userId) ?? null : null,
        managerEmployeeNumber: s.managerStaffId ? mgrEmpByStaff.get(s.managerStaffId) ?? null : null,
      })),
    };
  }

  @Get('staff/:employeeNumber/schedule')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiHeader({ name: 'X-Target-Token', required: false })
  @ApiOperation({ summary: '직원 근무 스케줄(근태 산정용) — PII 조회 키 + 대상 토큰(S-3 IDOR)' })
  async schedule(@Headers('x-integration-key') key: string, @Headers('x-target-token') targetToken: string, @Param('employeeNumber') empNo: string, @Query('from') from?: string, @Query('to') to?: string) {
    await this.integrationAuth.assertPiiReadKey(key);
    await this.integrationAuth.assertTargetAuth({ token: targetToken, target: empNo }); // S-3: 대상(employeeNumber) 일치 검증
    const staff = await this.prisma.staff.findUnique({ where: { employeeNumber: empNo } });
    if (!staff) throw new NotFoundException('직원 없음');
    // 정본=DutyEntry+승인 LeaveRequest(OFF 파생) — 구 StaffSchedule 응답 형태 유지(모델 이원화 통합 2026-07-22)
    const rows = await this.hrService.buildUnifiedSchedules(
      [staff], from ? new Date(from) : undefined, to ? new Date(to) : undefined,
    );
    const schedules = rows.map(({ staff: _s, ...r }) => r);
    return { data: { employeeNumber: empNo, erpEmployeeCode: staff.erpEmployeeCode, schedules } };
  }

  @Post('staff/:employeeNumber/map')
  @ApiHeader({ name: 'X-Integration-Key' })
  @ApiOperation({ summary: 'ERP 인사코드 매핑(ERP가 Employee 생성 후 회신)' })
  async map(@Headers('x-integration-key') key: string, @Param('employeeNumber') empNo: string, @Body() dto: MapDto) {
    await this.integrationAuth.assertWebhookKey(key);
    const staff = await this.prisma.staff.findUnique({ where: { employeeNumber: empNo } });
    if (!staff) throw new NotFoundException('직원 없음');
    await this.prisma.staff.update({ where: { employeeNumber: empNo }, data: { erpEmployeeCode: dto.erpEmployeeCode } });
    return { data: { ok: true, employeeNumber: empNo, erpEmployeeCode: dto.erpEmployeeCode } };
  }
}
