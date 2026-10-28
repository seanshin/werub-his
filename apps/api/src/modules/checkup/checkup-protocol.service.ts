import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

type GradeBand = { op: '>' | '>=' | '<' | '<=' | 'between'; value?: number; min?: number; max?: number; grade: string };
export type Judgment = { finding: 'NORMAL' | 'ABNORMAL' | 'CRITICAL' | 'PENDING'; grade: string | null; panic: boolean; matched: boolean };

/**
 * 검진 프로토콜 정의·관리 + 판정 룰 엔진(P0).
 * 프로토콜(프로그램·성별·연령 바인딩)이 항목별 판정 룰(참고치·등급경계·위급값)·판독 라우팅·검토/서명 단계를 정의한다.
 * 결과 흐름(autoCollect·readiness·sign)이 이를 실행한다. 기획: docs/01-plan/features/checkup-protocol.plan.md
 */
@Injectable()
export class CheckupProtocolService {
  private readonly logger = new Logger(CheckupProtocolService.name);
  constructor(private readonly prisma: PrismaService) {}

  // ── CRUD ──
  async list(programId?: string, status?: string) {
    return this.prisma.checkupProtocol.findMany({
      where: { ...(programId ? { programId } : {}), ...(status ? { status } : {}) },
      include: { rules: true },
      orderBy: [{ programId: 'asc' }, { version: 'desc' }],
    });
  }

  async get(id: string) {
    const p = await this.prisma.checkupProtocol.findUnique({ where: { id }, include: { rules: true } });
    if (!p) throw new NotFoundException('프로토콜을 찾을 수 없습니다');
    return p;
  }

  async create(dto: {
    code: string; name: string; programId?: string; gender?: string; ageMin?: number; ageMax?: number;
    requireAllInterpretations?: boolean; requireFourEyes?: boolean; signerRoles?: string[]; panelTestCodes?: string[];
  }) {
    if (!dto.code?.trim() || !dto.name?.trim()) throw new BadRequestException('code·name 필수');
    return this.prisma.checkupProtocol.create({
      data: {
        code: dto.code.trim(), name: dto.name.trim(), programId: dto.programId ?? null,
        gender: dto.gender ?? 'ALL', ageMin: dto.ageMin ?? null, ageMax: dto.ageMax ?? null,
        requireAllInterpretations: dto.requireAllInterpretations ?? true,
        requireFourEyes: dto.requireFourEyes ?? false,
        signerRoles: dto.signerRoles?.length ? dto.signerRoles : ['DOCTOR'],
        panelTestCodes: dto.panelTestCodes ?? [],
      },
    });
  }

  async update(id: string, dto: Record<string, unknown>) {
    const p = await this.prisma.checkupProtocol.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('프로토콜을 찾을 수 없습니다');
    if (p.status === 'ACTIVE') throw new BadRequestException('발효(ACTIVE) 프로토콜은 수정 불가 — 신규 버전으로 편집하세요');
    const allowed = ['name', 'gender', 'ageMin', 'ageMax', 'requireAllInterpretations', 'requireFourEyes', 'signerRoles', 'panelTestCodes'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (k in dto) data[k] = dto[k];
    return this.prisma.checkupProtocol.update({ where: { id }, data });
  }

  /** 판정 룰 일괄 교체(DRAFT만) */
  async replaceRules(protocolId: string, rules: Array<Record<string, unknown>>) {
    const p = await this.prisma.checkupProtocol.findUnique({ where: { id: protocolId } });
    if (!p) throw new NotFoundException('프로토콜을 찾을 수 없습니다');
    if (p.status === 'ACTIVE') throw new BadRequestException('발효 프로토콜의 룰은 수정 불가');
    await this.prisma.checkupJudgmentRule.deleteMany({ where: { protocolId } });
    if (rules?.length) {
      await this.prisma.checkupJudgmentRule.createMany({
        data: rules.map((r) => ({
          protocolId,
          testCode: String(r.testCode),
          sex: (r.sex as string) ?? 'ALL',
          ageMin: (r.ageMin as number) ?? null,
          ageMax: (r.ageMax as number) ?? null,
          normalLow: (r.normalLow as number) ?? null,
          normalHigh: (r.normalHigh as number) ?? null,
          gradeBands: (r.gradeBands as Prisma.InputJsonValue) ?? undefined,
          panicLow: (r.panicLow as number) ?? null,
          panicHigh: (r.panicHigh as number) ?? null,
          interpretDept: (r.interpretDept as string) ?? null,
          requiredInterpretation: (r.requiredInterpretation as boolean) ?? false,
        })),
      });
    }
    return this.get(protocolId);
  }

  /** 발효 — 동일 (programId,gender) 기존 ACTIVE는 RETIRED 처리(단일 활성 보장) */
  async publish(id: string, userId: string) {
    const p = await this.prisma.checkupProtocol.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('프로토콜을 찾을 수 없습니다');
    if (p.status === 'RETIRED') throw new BadRequestException('폐기된 프로토콜은 발효 불가');
    await this.prisma.checkupProtocol.updateMany({
      where: { programId: p.programId, gender: p.gender, status: 'ACTIVE', id: { not: id } },
      data: { status: 'RETIRED' },
    });
    return this.prisma.checkupProtocol.update({
      where: { id }, data: { status: 'ACTIVE', publishedAt: new Date(), publishedBy: userId },
    });
  }

  async retire(id: string) {
    const p = await this.prisma.checkupProtocol.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('프로토콜을 찾을 수 없습니다');
    return this.prisma.checkupProtocol.update({ where: { id }, data: { status: 'RETIRED' } });
  }

  /** 새 버전으로 복제(DRAFT) — ACTIVE/RETIRED 프로토콜을 편집 가능한 신규 DRAFT 버전으로. 룰도 복사. */
  async clone(id: string) {
    const src = await this.prisma.checkupProtocol.findUnique({ where: { id }, include: { rules: true } });
    if (!src) throw new NotFoundException('프로토콜을 찾을 수 없습니다');
    const maxVer = await this.prisma.checkupProtocol.aggregate({ where: { code: src.code }, _max: { version: true } });
    const created = await this.prisma.checkupProtocol.create({
      data: {
        code: src.code, name: src.name, programId: src.programId, gender: src.gender,
        ageMin: src.ageMin, ageMax: src.ageMax, version: (maxVer._max.version ?? src.version) + 1, status: 'DRAFT',
        requireAllInterpretations: src.requireAllInterpretations, requireFourEyes: src.requireFourEyes,
        signerRoles: src.signerRoles, panelTestCodes: src.panelTestCodes,
      },
    });
    if (src.rules.length) {
      await this.prisma.checkupJudgmentRule.createMany({
        data: src.rules.map((r) => ({
          protocolId: created.id, testCode: r.testCode, sex: r.sex, ageMin: r.ageMin, ageMax: r.ageMax,
          normalLow: r.normalLow, normalHigh: r.normalHigh, gradeBands: (r.gradeBands as Prisma.InputJsonValue) ?? undefined,
          panicLow: r.panicLow, panicHigh: r.panicHigh, interpretDept: r.interpretDept, requiredInterpretation: r.requiredInterpretation,
        })),
      });
    }
    return this.get(created.id);
  }

  /** visit 적용 프로토콜 해소 — 프로그램 일치 우선, 성별/연령 조건 충족 ACTIVE 중 최신 버전 */
  async resolve(opts: { programId?: string; sex?: string; age?: number }) {
    const candidates = await this.prisma.checkupProtocol.findMany({
      where: { status: 'ACTIVE' },
      include: { rules: true },
      orderBy: [{ version: 'desc' }],
    });
    const sex = (opts.sex ?? 'ALL').toUpperCase();
    const age = opts.age;
    const match = (p: (typeof candidates)[number]) => {
      if (p.programId && opts.programId && p.programId !== opts.programId) return false;
      if (p.gender !== 'ALL' && sex !== 'ALL' && p.gender !== sex) return false;
      if (age != null) {
        if (p.ageMin != null && age < p.ageMin) return false;
        if (p.ageMax != null && age > p.ageMax) return false;
      }
      return true;
    };
    // 프로그램 바인딩 > 공통, 그 안에서 최신 버전
    const ranked = candidates.filter(match).sort((a, b) => {
      const aBound = a.programId === opts.programId ? 1 : 0;
      const bBound = b.programId === opts.programId ? 1 : 0;
      if (aBound !== bBound) return bBound - aBound;
      return b.version - a.version;
    });
    return ranked[0] ?? null;
  }

  /**
   * 판정 룰 엔진 — 항목 수치값을 등급(A~D2)·finding·위급값으로 판정.
   * 우선순위: 위급값(panic) → gradeBands(배열 순서) → normalLow/High 범위 → 룰 부재 시 PENDING.
   */
  judge(rule: { normalLow?: number | null; normalHigh?: number | null; gradeBands?: unknown; panicLow?: number | null; panicHigh?: number | null } | null, rawValue: string | number | null | undefined): Judgment {
    const v = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue ?? '').replace(/[^0-9.\-]/g, ''));
    if (!rule || rawValue == null || Number.isNaN(v)) return { finding: 'PENDING', grade: null, panic: false, matched: false };

    // 1) 위급값
    if ((rule.panicLow != null && v < rule.panicLow) || (rule.panicHigh != null && v > rule.panicHigh)) {
      return { finding: 'CRITICAL', grade: 'D1', panic: true, matched: true };
    }
    // 2) 등급 경계(gradeBands)
    const bands = Array.isArray(rule.gradeBands) ? (rule.gradeBands as GradeBand[]) : [];
    for (const b of bands) {
      let hit = false;
      if (b.op === '>' && b.value != null) hit = v > b.value;
      else if (b.op === '>=' && b.value != null) hit = v >= b.value;
      else if (b.op === '<' && b.value != null) hit = v < b.value;
      else if (b.op === '<=' && b.value != null) hit = v <= b.value;
      else if (b.op === 'between' && b.min != null && b.max != null) hit = v >= b.min && v <= b.max;
      if (hit) return { finding: this.findingOf(b.grade), grade: b.grade, panic: false, matched: true };
    }
    // 3) 정상 범위
    if (rule.normalLow != null || rule.normalHigh != null) {
      const inRange = (rule.normalLow == null || v >= rule.normalLow) && (rule.normalHigh == null || v <= rule.normalHigh);
      return inRange
        ? { finding: 'NORMAL', grade: 'A', panic: false, matched: true }
        : { finding: 'ABNORMAL', grade: 'B', panic: false, matched: true };
    }
    return { finding: 'PENDING', grade: null, panic: false, matched: false };
  }

  private findingOf(grade: string): Judgment['finding'] {
    if (grade === 'A') return 'NORMAL';
    if (['C2', 'D1', 'D2'].includes(grade)) return 'CRITICAL';
    return 'ABNORMAL';
  }

  /** testCode·성별·연령에 맞는 룰을 프로토콜에서 찾아 판정(미리보기/실행 공용) */
  async judgeByProtocol(protocolId: string, testCode: string, value: string | number, opts: { sex?: string; age?: number } = {}): Promise<Judgment> {
    const sex = (opts.sex ?? 'ALL').toUpperCase();
    const rules = await this.prisma.checkupJudgmentRule.findMany({ where: { protocolId, testCode } });
    const rule =
      rules.find((r) => r.sex === sex && this.ageOk(r, opts.age)) ??
      rules.find((r) => r.sex === 'ALL' && this.ageOk(r, opts.age)) ??
      null;
    return this.judge(rule, value);
  }

  private ageOk(r: { ageMin: number | null; ageMax: number | null }, age?: number): boolean {
    if (age == null) return true;
    if (r.ageMin != null && age < r.ageMin) return false;
    if (r.ageMax != null && age > r.ageMax) return false;
    return true;
  }
}
