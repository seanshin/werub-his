import { Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CssdInventoryService, type RepackageConsumeResult } from './cssd-inventory.service';
import { JourneyService } from '../journey/journey.service';
import { CssdUnitService } from './cssd-unit.service';
import { assertStateTransition, stateChangedConflict, TransitionMap } from '../../common/state-transition';

/** 멸균 패키지 상태 어휘 — 스키마 주석(SterilePackage.status) 그대로 */
export type SterilePackageStatus = 'ASSEMBLING' | 'PACKAGED' | 'IN_LOAD' | 'STERILE' | 'IN_USE' | 'RETURNED' | 'EXPIRED' | 'RECALLED';
/** 반납은 사용한 것을 되돌려 받는 일이다 — 리콜·만료는 반납으로 지워지지 않는다(RECALLED 는 이 표 밖: 어느 상태에서나 가능) */
export const PACKAGE_TRANSITIONS: TransitionMap<SterilePackageStatus> = {
  ASSEMBLING: ['PACKAGED'],
  PACKAGED: ['IN_LOAD', 'EXPIRED'],
  IN_LOAD: ['STERILE', 'PACKAGED'],
  STERILE: ['IN_USE', 'EXPIRED', 'RETURNED'],
  IN_USE: ['RETURNED'],
  RETURNED: [],
  EXPIRED: [],
  RECALLED: [],
};
export const PACKAGE_TX_CTX = { code: 'STERILE_PACKAGE', message: '지금 상태에서는 할 수 없는 멸균 패키지 처리입니다' };

/**
 * 자동 만료 크론의 결과 — **3상태**로 말한다.
 * `packagesFound`/`sets` 의 `null` 은 "0건"이 아니라 **조회하지 못했다(모른다)** 는 뜻이다.
 */
export interface CssdExpireResult {
  /** 실패 없이 전 구간을 끝냈는가 */
  ok: boolean;
  /** 만료 대상 패키지 수. `null`=조회 실패(모른다) */
  packagesFound: number | null;
  /** 실제로 EXPIRED 로 바꾼 패키지 수 */
  packagesExpired: number;
  /** 만료된 기구 세트 수. `null`=처리 실패(모른다) */
  sets: number | null;
  /** 사람이 읽을 실패 사유 — 비어 있으면 전 구간 성공 */
  failures: string[];
}

@Injectable()
export class CssdPackageService {
  private readonly logger = new Logger(CssdPackageService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: CssdInventoryService,
    @Optional() private readonly journey?: JourneyService,
    @Optional() private readonly units?: CssdUnitService,
  ) {}

  /**
   * 유효기간 경과 멸균품 자동 만료(STERILE→EXPIRED) — 매시 정각(FR-09)
   *
   * 🔴 종전엔 조회를 `.catch(() => [])` 로 접었다. 그러면 조회가 실패했을 때
   *    ① 만료 처리가 통째로 스킵되고 ② 로그는 `if (pkgs.length || sets.count)` 안에만 있어서
   *    **아무 흔적도 남지 않았다** — "만료 대상 0건"과 "탐지기가 죽었다"가 구분되지 않는다
   *    (v4.4.0 DUR 43룰 매칭 0 과 같은 유형: 0행이 '위반 없음'이 아니라 '안 돌았다'였다).
   *    조회 실패를 "없음"으로 번역하지 않는다 — 실패는 실패라고 말하고 결과에 담는다.
   *
   * 던지지 않는 이유: 크론 콜백에서 reject 하면 unhandledRejection 이 되어 DB 순간 장애가
   * API 프로세스를 죽일 수 있다. 대신 ①건별 실패를 `failures` 에 모으고 ②error 로그로 남기고
   * ③**매 틱 한 줄을 반드시 남겨** "돌았는데 0건"과 "안 돌았다"를 사람이 구분할 수 있게 한다.
   *
   * 🔴 그리고 크론을 안전장치로 쓰지 않는다 — 만료품 출고 차단의 정본은 **사용 시점 검사**다
   *    (패키지=`usePackage`, 기구 세트=`CssdService.updateStatus` STERILE→IN_USE).
   *    크론이 못 돌아도 만료품이 나가지 않아야 한다.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireOverdue(): Promise<CssdExpireResult> {
    const now = new Date();
    const failures: string[] = [];
    const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

    // 멸균 패키지(LOT) — 조회 실패 시 `packagesFound=null`("모른다"). 0("대상 없음")과 다른 사실이다.
    let targets: { id: string }[] | null = null;
    try {
      targets = await this.prisma.sterilePackage.findMany({ where: { status: 'STERILE', expiresAt: { lt: now } }, select: { id: true } });
    } catch (e) {
      failures.push(`패키지 만료 대상 조회 실패: ${msg(e)}`);
    }
    let packagesExpired = 0;
    for (const p of targets ?? []) {
      try {
        await this.prisma.sterilePackage.update({ where: { id: p.id }, data: { status: 'EXPIRED' } });
        packagesExpired++;
      } catch (e) {
        failures.push(`패키지 ${p.id} 만료 처리 실패: ${msg(e)}`);
        continue; // 상태를 못 바꿨으면 '만료' 이벤트도 남기지 않는다(일어나지 않은 일을 적지 않는다)
      }
      try {
        await this.prisma.packageEvent.create({ data: { packageId: p.id, action: '만료', note: '유효기간 경과 자동 만료' } });
      } catch (e) {
        // 상태는 바뀌었고 감사 이벤트만 실패 — 만료를 되돌리지 않되 흔적은 남긴다
        failures.push(`패키지 ${p.id} 만료 이벤트 기록 실패: ${msg(e)}`);
      }
    }

    // 기구 세트 — updateMany 실패도 `null`(모른다)로 둔다
    let sets: number | null = null;
    try {
      sets = (await this.prisma.instrumentSet.updateMany({ where: { status: 'STERILE', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } })).count;
    } catch (e) {
      failures.push(`기구 세트 만료 처리 실패: ${msg(e)}`);
    }

    const result: CssdExpireResult = {
      ok: failures.length === 0,
      packagesFound: targets ? targets.length : null,
      packagesExpired,
      sets,
      failures,
    };
    // 🔴 항상 한 줄 — 조용히 아무 일도 안 하는 상태를 없앤다(0건도 '돌았다'는 사실이다)
    const line = `CSSD 자동 만료 — 패키지 ${targets ? `${packagesExpired}/${targets.length}` : '조회실패'}건, 세트 ${sets ?? '조회실패'}건`;
    if (failures.length) this.logger.error(`${line} · 실패 ${failures.length}건: ${failures.join(' | ')}`);
    else this.logger.log(line);
    return result;
  }

  // ── 트레이 마스터 ──
  listTemplates() {
    return this.prisma.instrumentSetTemplate.findMany({ orderBy: { name: 'asc' } });
  }
  createTemplate(data: { name: string; category?: string; packagingType?: string; shelfLifeDays?: number; items: { name: string; qty: number }[] }) {
    return this.prisma.instrumentSetTemplate.create({
      data: {
        name: data.name, category: data.category ?? null,
        packagingType: data.packagingType ?? 'POUCH', shelfLifeDays: data.shelfLifeDays ?? 30,
        items: data.items as object,
      },
    });
  }
  updateTemplate(id: string, data: { category?: string; packagingType?: string; shelfLifeDays?: number; items?: object; isActive?: boolean }) {
    return this.prisma.instrumentSetTemplate.update({ where: { id }, data });
  }

  // ── 재포장 (조립·카운트·포장 → LOT 패키지 생성) ──
  private async genLot(prefix = 'PKG') {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const seq = (await this.prisma.sterilePackage.count({ where: { lotNo: { startsWith: `${prefix}-${ymd}` } } })) + 1;
    return `${prefix}-${ymd}-${String(seq).padStart(3, '0')}`;
  }

  async repackage(data: { templateId: string; countVerified: boolean; countNote?: string; location?: string; unitSerials?: string[]; userId: string }) {
    const tmpl = await this.prisma.instrumentSetTemplate.findUnique({ where: { id: data.templateId } });
    if (!tmpl) throw new NotFoundException('트레이 마스터 없음');
    if (!data.countVerified) throw new BadRequestException('구성품 카운트 검증이 완료되어야 포장할 수 있습니다');
    // 기구 개체(선택) — LOT 를 만들기 **전에** 확인한다. 없는 번호·폐기 개체는 여기서 400(무엇을 넣었는지 모르는 LOT 를 만들지 않는다).
    // 수명 한도 도달·다른 열린 패키지 중복은 막지 않고 경고(unitWarnings)로 돌려주고 패키지 이벤트에 남긴다.
    if (data.unitSerials?.length && !this.units) throw new BadRequestException('기구 개체 연결을 처리할 수 없습니다');
    const unitPlan = this.units ? await this.units.resolveForPackage(data.unitSerials) : { units: [], warnings: [] };
    const lotNo = await this.genLot();
    const pkg = await this.prisma.sterilePackage.create({
      data: {
        lotNo, templateId: tmpl.id, templateName: tmpl.name, status: 'PACKAGED',
        packagingType: tmpl.packagingType, countVerified: true, countNote: data.countNote ?? null,
        assembledBy: data.userId, packagedAt: new Date(), location: data.location ?? '중앙공급실',
      },
    });
    await this.event(pkg.id, '조립·포장', data.userId, `LOT ${lotNo}`);
    if (unitPlan.units.length) {
      await this.prisma.sterilePackageUnit.createMany({
        data: unitPlan.units.map((u) => ({ packageId: pkg.id, unitId: u.id, addedBy: data.userId })),
        skipDuplicates: true,
      });
      await this.event(pkg.id, '기구 개체 구성', data.userId, unitPlan.units.map((u) => u.serialNo).join(', ').slice(0, 300));
    }
    for (const w of unitPlan.warnings) {
      await this.event(pkg.id, w.code === 'LIFE_LIMIT_REACHED' ? '수명 한도 도달 기구 포함' : '다른 열린 패키지의 기구 포함', data.userId, w.serialNo);
    }
    // 구성 품목 재고 소모(품목 연계된 항목만)
    // 🔴 종전: `.catch(() => [])` — 소모 도중 실패하면 **앞 품목 재고는 이미 차감**됐는데
    //    응답은 `shortages: []`("부족 없음")이었다. 실패를 없음으로 번역한 것.
    //    이제 실패를 그대로 담는다. 패키지(LOT)는 이미 만들어졌으므로 여기서 던지지 않는다 —
    //    던지면 LOT 이 존재하는데 500 이 나가 화면이 "실패"로 읽는다(더 나쁜 거짓말).
    const items = (tmpl.items as unknown as { itemId?: string; name?: string; qty?: number }[]) ?? [];
    const inventory: RepackageConsumeResult = await this.inventory
      .consumeForRepackage(items, lotNo, data.userId)
      .catch((e: unknown) => ({
        shortages: [], consumed: [],
        failed: [{ itemId: '(전체)', message: e instanceof Error ? e.message : String(e) }],
        complete: false,
      }));
    if (!inventory.complete) {
      this.logger.error(`재포장 자재 소모 미완료(LOT ${lotNo}) — 실패 ${inventory.failed.length}건: ${inventory.failed.map((f) => `${f.name ?? f.itemId}:${f.message}`).join(' | ')}`);
    }
    // `shortages` 는 그대로 두되(기존 소비처 호환) `inventory.complete` 로 신뢰 여부를 함께 말한다
    return { ...pkg, shortages: inventory.shortages, inventory, unitSerials: unitPlan.units.map((u) => u.serialNo), unitWarnings: unitPlan.warnings };
  }

  // ── 패키지 ──
  async listPackages(status?: string) {
    return this.prisma.sterilePackage.findMany({
      where: status && status !== 'ALL' ? { status } : {},
      orderBy: { createdAt: 'desc' }, take: 200,
    });
  }
  async getPackage(id: string) {
    const pkg = await this.prisma.sterilePackage.findUnique({
      where: { id },
      include: {
        template: true, load: true, events: { orderBy: { createdAt: 'desc' } },
        // 구성 기구 개체 — 리콜(CSSD_RECALL) 시 어떤 개체가 이 LOT 에 있었는지 추적하는 근거
        units: { select: { addedAt: true, unit: { select: { id: true, serialNo: true, status: true } } } },
      },
    });
    if (!pkg) throw new NotFoundException('패키지 없음');
    return pkg;
  }
  async usePackage(id: string, userId: string, encounterId?: string) {
    const pkg = await this.prisma.sterilePackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('패키지 없음');
    if (pkg.status !== 'STERILE') throw new BadRequestException('멸균 완료 패키지만 출고/사용할 수 있습니다');
    // 사용 시점 유효기간 강제 — cron(시간당)에만 의존하면 만료~다음틱 사이 만료품 출고 가능.
    if (pkg.expiresAt && pkg.expiresAt.getTime() < Date.now()) {
      await this.prisma.sterilePackage.update({ where: { id }, data: { status: 'EXPIRED' } });
      await this.event(id, '만료(사용 차단)', userId);
      throw new BadRequestException('유효기간이 만료된 멸균 패키지는 사용할 수 없습니다');
    }
    // 원자적 선점 — STERILE인 경우에만 IN_USE로. 동시 사용 2건이 같은 패키지를 두 진료에 기록하는 것 방지.
    //
    // 🔴 (2026-09-16 I2) 상태(IN_USE)와 원장(packageEvent '출고·사용')을 한 트랜잭션에서 쓴다.
    //    종전엔 선점이 먼저 커밋되고 이벤트가 따로 나갔다 — 이벤트 기록이 실패하면 **어느 진료에
    //    나갔는지 원장에 없는 IN_USE 패키지**가 남는다(인증 심사가 보는 추적성). 이 파일의
    //    `expireOverdue` 는 "상태를 못 바꿨으면 이벤트도 남기지 않는다"를 이미 규칙으로 적어 뒀다.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.sterilePackage.updateMany({
        where: { id, status: 'STERILE' },
        data: { status: 'IN_USE', usedEncounterId: encounterId ?? null, usedAt: new Date() },
      });
      if (claim.count === 0) return 0;
      await tx.packageEvent.create({
        data: { packageId: id, action: '출고·사용', by: userId ?? null, note: encounterId ? `사용처 ${encounterId}` : null },
      });
      return claim.count;
    });
    if (claimed === 0) throw new BadRequestException('이미 사용되었거나 상태가 변경된 패키지입니다');
    return this.prisma.sterilePackage.findUnique({ where: { id } });
  }
  /**
   * 사용 후 반납. 🔴 (2026-09-15 D1) 종전엔 상태를 보지 않아 **리콜(RECALLED)·만료(EXPIRED) 패키지를 RETURNED 로
   * 바꿀 수 있었다** — 리콜 목록(`status='RECALLED'` 집계)에서 사라져 회수해야 할 멸균 패키지가 보이지 않게 된다.
   */
  async returnPackage(id: string, userId: string) {
    const cur = await this.prisma.sterilePackage.findUnique({ where: { id }, select: { status: true } });
    if (!cur) throw new NotFoundException('멸균 패키지를 찾을 수 없습니다');
    if (cur.status === 'RETURNED') return this.prisma.sterilePackage.findUnique({ where: { id } });
    assertStateTransition(PACKAGE_TRANSITIONS, cur.status as SterilePackageStatus, 'RETURNED', PACKAGE_TX_CTX);
    // 🔴 (2026-09-16 I2) 종전엔 이벤트를 **먼저** 쓰고 상태를 바꿨다 — 경합으로 상태 변경이 0건이면
    //    원장에는 '반납'이 적혀 있는데 패키지는 반납되지 않은 채로 남는다(일어나지 않은 일을 적는다).
    //    둘을 한 트랜잭션에 넣고, 상태가 안 바뀌면 이벤트도 남지 않게 한다.
    const returned = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.sterilePackage.updateMany({ where: { id, status: cur.status }, data: { status: 'RETURNED' } });
      if (upd.count === 0) return 0;
      await tx.packageEvent.create({ data: { packageId: id, action: '반납', by: userId ?? null, note: null } });
      return upd.count;
    });
    if (returned === 0) stateChangedConflict(PACKAGE_TX_CTX, cur.status);
    return this.prisma.sterilePackage.findUnique({ where: { id } });
  }
  /** 리콜은 어느 상태에서도 할 수 있다 — 안전측으로 접는 방향은 막지 않는다(이미 리콜이면 다시 쓰지 않는다) */
  async recallPackage(id: string, userId: string, note?: string) {
    const cur = await this.prisma.sterilePackage.findUnique({ where: { id }, select: { status: true } });
    if (!cur) throw new NotFoundException('멸균 패키지를 찾을 수 없습니다');
    if (cur.status === 'RECALLED') return this.prisma.sterilePackage.findUnique({ where: { id } });
    // 🔴 (2026-09-16 I2) 이벤트 선기록 → 상태 변경 순서를 원자화(returnPackage 와 같은 결함).
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.sterilePackage.update({ where: { id }, data: { status: 'RECALLED' } });
      await tx.packageEvent.create({ data: { packageId: id, action: '리콜', by: userId ?? null, note: note ?? null } });
      return row;
    });
  }

  // ── 멸균 로드 + BI/CI ──
  async listLoads() {
    return this.prisma.sterilizationLoad.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { packages: { select: { id: true, lotNo: true, templateName: true, status: true } } } });
  }
  async createLoad(data: { sterilizer: string; program?: string; tempC?: number; durationMin?: number; packageIds: string[]; userId: string }) {
    if (!data.packageIds?.length) throw new BadRequestException('포함할 패키지를 선택하세요');
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const seq = (await this.prisma.sterilizationLoad.count({ where: { loadNo: { startsWith: `L-${ymd}` } } })) + 1;
    /**
     * 🔴 (2026-09-16 H4) 로드 생성과 패키지 투입은 한 트랜잭션이다. 종전엔 로드를 먼저 커밋해,
     *    투입이 실패하면 **패키지 없는 빈 로드**가 남았다 — 그 로드를 판독·불출(`releaseLoad`)하면
     *    아무 패키지도 멸균 완료로 바뀌지 않는데 로드에는 BI/CI 합격이 적힌다(인증 심사가 보는 기록).
     */
    const load = await this.prisma.$transaction(async (tx) => {
      const created = await tx.sterilizationLoad.create({
        data: {
          loadNo: `L-${ymd}-${String(seq).padStart(2, '0')}`, sterilizer: data.sterilizer,
          program: data.program ?? 'STEAM', tempC: data.tempC ?? 134, durationMin: data.durationMin ?? 30,
          operatorId: data.userId, startedAt: new Date(),
        },
      });
      await tx.sterilePackage.updateMany({ where: { id: { in: data.packageIds }, status: 'PACKAGED' }, data: { status: 'IN_LOAD', loadId: created.id } });
      return created;
    });
    for (const pid of data.packageIds) await this.event(pid, '멸균 로드 투입', data.userId, load.loadNo);
    return load;
  }
  /** BI/CI 판독 → BI·CI 모두 PASS일 때만 일괄 STERILE+유효기간, 그 외(FAIL/PENDING) 회수 */
  async releaseLoad(id: string, data: { biResult: string; ciResult: string; userId: string }) {
    const load = await this.prisma.sterilizationLoad.findUnique({ where: { id }, include: { packages: { include: { template: true } } } });
    if (!load) throw new NotFoundException('멸균 로드 없음');
    // BI 미결과(PENDING)로는 불출 불가 — BI 배양 완료 후 판독해야 함(비멸균 로드 출고 방지).
    if (data.biResult === 'PENDING' || !data.biResult) {
      throw new BadRequestException('생물학적 지표(BI) 결과가 나오기 전에는 로드를 불출할 수 없습니다');
    }
    // fail-safe: BI·CI 둘 다 명시적 PASS일 때만 합격. (기존 biResult!=='FAIL'은 PENDING/오타/미입력도 통과)
    const pass = data.biResult === 'PASS' && data.ciResult === 'PASS';
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.sterilizationLoad.update({
        where: { id }, data: { biResult: data.biResult, ciResult: data.ciResult, finishedAt: now, releasedBy: data.userId, releasedAt: now },
      });
      for (const p of load.packages) {
        if (p.status !== 'IN_LOAD') continue;
        if (pass) {
          const exp = new Date(now); exp.setDate(exp.getDate() + (p.template?.shelfLifeDays ?? 30));
          await tx.sterilePackage.update({ where: { id: p.id }, data: { status: 'STERILE', sterilizedAt: now, expiresAt: exp } });
        } else {
          await tx.sterilePackage.update({ where: { id: p.id }, data: { status: 'PACKAGED', loadId: null } });
        }
      }
    });
    // 감사 이벤트는 트랜잭션 밖(event가 별도 prisma 사용).
    let eventsNotRecorded = 0;
    for (const p of load.packages) {
      if (p.status !== 'IN_LOAD') continue;
      const recorded = pass
        ? await this.event(p.id, '멸균 합격', data.userId, load.loadNo)
        : await this.event(p.id, '멸균 실패·회수', data.userId, `${load.loadNo} (BI:${data.biResult}/CI:${data.ciResult})`);
      if (!recorded) eventsNotRecorded++;
    }
    /** eventsNotRecorded — 판정은 반영됐으나 패키지 원장에 남기지 못한 건수(0 이 아니면 수기 확인) */
    return { ok: true, released: pass, count: load.packages.length, eventsNotRecorded };
  }

  /**
   * 지연양성 BI 로드 회수 — BI 배양(24~48h)이 불출 후 양성으로 전환된 경우, 해당 로드의 전 패키지를
   * 일괄 RECALLED 처리하고 이미 환자에게 사용된 패키지(usedEncounterId)를 감염위험 추적 대상으로 노출한다.
   * (기존 recallPackage는 단건 수동 회수만 가능해 로드 단위 추적·환자 통지가 불가했음.)
   */
  async recallLoad(loadId: string, userId: string, note?: string) {
    const load = await this.prisma.sterilizationLoad.findUnique({ where: { id: loadId }, include: { packages: true } });
    if (!load) throw new NotFoundException('멸균 로드 없음');

    // 이미 종말(RECALLED) 아닌 패키지만 회수. 사용된(usedEncounterId) 패키지는 환자 추적 대상.
    const targets = load.packages.filter((p) => p.status !== 'RECALLED');
    const usedPackages = targets.filter((p) => p.usedEncounterId);

    await this.prisma.$transaction(async (tx) => {
      // 로드에 지연양성 기록(BI FAIL) — 재판독 결과 반영. (회수 상세는 PackageEvent 감사에 기록)
      await tx.sterilizationLoad.update({
        where: { id: loadId },
        data: { biResult: 'FAIL' },
      });
      for (const p of targets) {
        await tx.sterilePackage.update({ where: { id: p.id }, data: { status: 'RECALLED' } });
      }
    });

    // 감사 이벤트 + 사용된 패키지의 환자 여정에 감염위험 추적 이벤트 발행.
    let eventsNotRecorded = 0;
    for (const p of targets) {
      if (!(await this.event(p.id, '로드 회수(지연양성 BI)', userId, `${load.loadNo}${note ? ` · ${note}` : ''}`))) eventsNotRecorded++;
    }
    // 🔴 진료건 조회가 실패하면 그 환자에게 **감염위험 여정 이벤트가 발행되지 않는데**, 종전 응답은
    //    `ok:true` + affectedEncounters 에 그 id 를 담아 **통보된 것처럼** 읽혔다(회수는 임상 후속조치를 부른다).
    //    발행에 실패한 건을 따로 세어 응답이 말하게 한다 — 발행 시도 ≠ 도달.
    const affectedEncounters: string[] = [];
    const notifyFailed: string[] = [];
    for (const p of usedPackages) {
      const encId = p.usedEncounterId!;
      affectedEncounters.push(encId);
      let enc: { patientId: string } | null = null;
      try {
        enc = await this.prisma.encounter.findUnique({ where: { id: encId }, select: { patientId: true } });
      } catch (e) {
        this.logger.error(`CSSD 회수 — 진료건 조회 실패(encounter=${encId}): ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!enc?.patientId) { notifyFailed.push(encId); continue; }
      try {
        this.journey?.emit({
          patientId: enc.patientId, eventType: 'CSSD_RECALL', refType: 'ENCOUNTER', refId: encId, // 여정 P0-5: 원 기록 귀속(기구를 쓴 진료)
          title: '멸균 패키지 회수(감염 위험 평가 필요)',
          description: `로드 ${load.loadNo} 지연양성 BI — 사용 패키지 ${p.lotNo} 회수. 감염 징후 모니터링 권고`,
        });
      } catch (e) {
        notifyFailed.push(encId);
        this.logger.error(`CSSD 회수 — 여정 이벤트 발행 실패(encounter=${encId}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return {
      ok: true,
      loadNo: load.loadNo,
      recalled: targets.length,
      usedOnPatients: usedPackages.length,
      affectedEncounters,
      /** 감염위험 이벤트가 발행되지 **못한** 진료건 — 수기 확인 필요(0이면 전건 발행). */
      journeyNotifyFailed: notifyFailed,
      journeyNotified: affectedEncounters.length - notifyFailed.length,
      /** 회수는 반영됐으나 패키지 원장에 남기지 못한 건수(0 이 아니면 수기 확인) */
      eventsNotRecorded,
    };
  }

  // ── 통계 ──
  async stats() {
    const grouped = await this.prisma.sterilePackage.groupBy({ by: ['status'], _count: { id: true } });
    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count.id;
    const now = new Date(); const soon = new Date(); soon.setDate(soon.getDate() + 3);
    const [total, expiringSoon, expired, pendingLoads] = await Promise.all([
      this.prisma.sterilePackage.count(),
      this.prisma.sterilePackage.count({ where: { status: 'STERILE', expiresAt: { gte: now, lte: soon } } }),
      this.prisma.sterilePackage.count({ where: { OR: [{ status: 'EXPIRED' }, { status: 'STERILE', expiresAt: { lt: now } }] } }),
      this.prisma.sterilizationLoad.count({ where: { OR: [{ biResult: 'PENDING' }, { ciResult: 'PENDING' }] } }),
    ]);
    return { total, byStatus, expiringSoon, expired, pendingLoads };
  }

  /**
   * 패키지 이벤트 원장 기록 — 🔴 (2026-09-14) 종전 `.catch(() => null)` 은 멸균 추적 원장(리콜·감염 추적의 근거)이
   * 조용히 비는 것을 숨겼다. 실패는 warn 으로 남기고 `false` 를 돌려준다.
   * 전파(throw)하지 않는 이유: 호출부는 전부 상태 변경(트랜잭션)을 **이미 커밋한 뒤** 이벤트를 쓴다 — 여기서 던지면
   * 이미 일어난 합격·회수를 "실패"로 응답해 재시도(이중 회수·이중 합격 기록)를 부른다. 대신 멸균 판정·로드 회수처럼
   * 원장이 법정·리콜 근거인 흐름은 기록 못 한 건수를 **응답에 싣는다**(`eventsNotRecorded`).
   */
  private async event(packageId: string, action: string, by?: string, note?: string): Promise<boolean> {
    try {
      await this.prisma.packageEvent.create({ data: { packageId, action, by: by ?? null, note: note ?? null } });
      return true;
    } catch (e) {
      this.logger.warn(`CSSD package event not recorded (package=${packageId}, action=${action}): ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }
}
