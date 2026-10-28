import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { SterilizationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { gateMode } from '../../common/gate-mode';
import { enforceGate, type GateWarning } from '../../common/gate-enforce';
// 게이트 위반 원장 — BI/CI 미PASS STERILE 확정이 WARN 에서도 남아야 승격 근거가 생긴다
import { SafetyGateService } from '../safety-gate/safety-gate.service';
import { assertEnumParam } from '../../common/enum-param';

// 재처리 단계 단방향 전이(DIRTY→세척→멸균→STERILE→사용/만료). 임의 점프(DIRTY→STERILE) 차단.
const SET_TRANSITIONS: Record<string, SterilizationStatus[]> = {
  DIRTY: ['WASHING'],
  WASHING: ['STERILIZING'],
  STERILIZING: ['STERILE', 'DIRTY'], // 멸균 실패 시 재세척
  STERILE: ['IN_USE', 'EXPIRED'],
  IN_USE: ['DIRTY'],
  EXPIRED: ['DIRTY'],
};

@Injectable()
export class CssdService {
  private readonly logger = new Logger(CssdService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly configRuntime?: ConfigRuntimeService,
    @Optional() private readonly gates?: SafetyGateService,
  ) {}

  /** 멸균 유효기간(일) — 미설정·비정상 값이면 종전 동작(30일)을 지킨다 */
  private async sterileValidDays(): Promise<number> {
    const v = await this.configRuntime?.get('cssd.sterileValidDays').catch(() => null);
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
  }

  async getAllSets(status?: string) {
    const where: Prisma.InstrumentSetWhereInput = {};
    if (status) { assertEnumParam(status, SterilizationStatus, '상태'); where.status = status as SterilizationStatus; }
    return this.prisma.instrumentSet.findMany({ where, orderBy: { name: 'asc' } });
  }

  async createSet(data: { name: string; contents: any; location?: string }) {
    return this.prisma.instrumentSet.create({
      data: { name: data.name, contents: data.contents as unknown as Prisma.InputJsonValue, location: data.location },
    });
  }

  async updateStatus(id: string, status: SterilizationStatus, userId: string, notes?: string, biResult?: string, ciResult?: string) {
    const set = await this.prisma.instrumentSet.findUnique({ where: { id } });
    if (!set) throw new NotFoundException('Instrument set not found');

    // 단계 건너뛰기 차단 — 무게이트로 DIRTY→STERILE 점프해 비멸균 기구가 '멸균'되던 문제.
    if (status !== set.status) {
      const allowed = SET_TRANSITIONS[set.status] ?? [];
      if (!allowed.includes(status)) {
        throw new BadRequestException(`멸균 단계 ${set.status}→${status} 전이는 허용되지 않습니다`);
      }
    }

    // 🔴 사용 시점 유효기간 강제 — 패키지 경로(`CssdPackageService.usePackage`)에는 이미 있는데
    //    **기구 세트 경로에는 없었다.** STERILE→IN_USE 전이가 `expiresAt` 을 아예 보지 않아,
    //    자동 만료 크론이 한 번이라도 못 돌면(그 크론은 조회 실패를 조용히 삼켰다)
    //    유효기간이 지난 세트가 STERILE 인 채로 출고됐다(v4.3.0 "만료 혈소판이 출고가능"과 같은 유형).
    //    크론을 안전장치로 쓰지 않는다 — 여기서 막고, 상태도 EXPIRED 로 바로잡는다
    //    (STERILE→EXPIRED 는 SET_TRANSITIONS 가 이미 허용하는 정상 전이다).
    if (status === 'IN_USE' && set.status === 'STERILE' && set.expiresAt && set.expiresAt.getTime() < Date.now()) {
      // 🔴 (2026-09-16 F3) 상태 전환과 재처리 이력은 한 트랜잭션 — 로그만 실패하면 EXPIRED 가 된 이유가
      //    이력에 남지 않고, 상태만 실패하면 "만료 전환"이라 적힌 로그가 실제로는 일어나지 않은 일이 된다.
      await this.prisma.$transaction(async (tx) => {
        await tx.instrumentSet.update({ where: { id }, data: { status: 'EXPIRED' } });
        await tx.sterilizationLog.create({
          data: { instrumentSetId: id, action: '만료(사용 차단)', performedBy: userId, notes: `유효기간 경과(${set.expiresAt!.toISOString()}) — 출고 차단 후 EXPIRED 전환` },
        });
      });
      throw new BadRequestException('유효기간이 만료된 기구 세트는 출고/사용할 수 없습니다. 재처리(세척→멸균) 후 사용하세요.');
    }

    const updateData: Prisma.InstrumentSetUpdateInput = { status };
    let biCiWarning: GateWarning | null = null;
    if (status === 'STERILE') {
      // BI/CI 게이트(P3) — 생물학적(BI)·화학적(CI) 지표 PASS 없이 STERILE 확정 차단(비멸균 출고 방지).
      //  config cssd.biCiEnforce(OFF|WARN|BLOCK·기본 OFF·fallback 'OFF'). 패키지 경로(releaseLoad)와 안전수준 통일.
      // 🔴 2026-08-26: 종전엔 `=== 'BLOCK'` 하나만 분기해 **WARN 이 OFF 와 완전히 동일**했다 —
      //    WARN 에서는 BI/CI 미PASS STERILE 확정이 아무 흔적도 남기지 않았다(비멸균 출고 축).
      biCiWarning = await enforceGate({
        gateKey: 'cssd.biCiEnforce',
        mode: gateMode(await this.configRuntime?.get('cssd.biCiEnforce'), 'OFF'),
        violated: biResult !== 'PASS' || ciResult !== 'PASS',
        code: 'CSSD_BI_CI_REQUIRED',
        message: `BI/CI 지표 PASS 없이 멸균(STERILE) 확정(BI=${biResult ?? '미기재'}·CI=${ciResult ?? '미기재'}) — 비멸균 출고 위험.`,
        blockMessage: '생물학적(BI)·화학적(CI) 지표 PASS 없이 멸균(STERILE) 확정할 수 없습니다.',
        refType: 'InstrumentSet', refId: id,
        recorder: this.gates, logger: this.logger,
      });
      updateData.lastSterilizedAt = new Date();
      // 🔴 주석은 "(설정 가능)"이라 적혀 있었는데 **설정을 읽지 않았다** —
      //    `cssd.sterileValidDays`(표시 30)를 아무도 안 봤고, 기본값이 같아 티도 안 났다.
      const validDays = await this.sterileValidDays();
      const expires = new Date();
      expires.setDate(expires.getDate() + validDays);
      updateData.expiresAt = expires;
    }

    /**
     * 🔴 (2026-09-16 F3) 재처리 이력과 세트 상태는 한 트랜잭션이다.
     *    종전엔 로그를 먼저 커밋해서, 상태 갱신이 실패하면 **"멸균 완료"라고 적힌 이력만 남고
     *    세트는 DIRTY 인 채**가 됐다(이력은 인증 심사가 보는 자리다). 반대로 로그가 실패하면
     *    STERILE 이 된 경위가 이력에서 사라진다 — 둘 다 같은 트랜잭션에서만 막을 수 있다.
     *    게이트 판정(BI/CI)과 위반 원장은 위에서 tx 밖에 이미 기록됐다(차단·롤백돼도 보존).
     */
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.sterilizationLog.create({
        data: {
          instrumentSetId: id, action: this.statusToAction(status), performedBy: userId,
          // WARN 통과 사실은 이 세트의 재처리 이력에도 남아야 한다 — 원장(GateViolationLog)은 관제용,
          // 여기는 이 세트를 여는 사람이 보는 자리다. 둘 다 필요하다.
          notes: biCiWarning ? [notes, `[BI/CI-BYPASS ${biCiWarning.message}]`].filter(Boolean).join(' ') : notes,
        },
      });
      return tx.instrumentSet.update({ where: { id }, data: updateData });
    });
    return biCiWarning ? { ...updated, warnings: [biCiWarning.message] } : updated;
  }

  async getLogs(setId: string) {
    return this.prisma.sterilizationLog.findMany({
      where: { instrumentSetId: setId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getExpiringSoon() {
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    return this.prisma.instrumentSet.findMany({
      where: { status: 'STERILE', expiresAt: { lte: threeDaysFromNow } },
      orderBy: { expiresAt: 'asc' },
    });
  }

  /** 대시보드 통계 — 상태별 카운트 + 만료임박/만료 */
  async getStats() {
    const grouped = await this.prisma.instrumentSet.groupBy({ by: ['status'], _count: { id: true } });
    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count.id;
    const now = new Date();
    const soon = new Date(); soon.setDate(soon.getDate() + 3);
    const [total, expiringSoon, expired] = await Promise.all([
      this.prisma.instrumentSet.count(),
      this.prisma.instrumentSet.count({ where: { status: 'STERILE', expiresAt: { gte: now, lte: soon } } }),
      this.prisma.instrumentSet.count({ where: { OR: [{ status: 'EXPIRED' }, { status: 'STERILE', expiresAt: { lt: now } }] } }),
    ]);
    return { total, byStatus, expiringSoon, expired };
  }

  private statusToAction(status: SterilizationStatus): string {
    const map: Record<string, string> = { DIRTY: '반납', WASHING: '세척', STERILIZING: '멸균 중', STERILE: '멸균 완료', IN_USE: '출고' };
    return map[status] ?? status;
  }
}