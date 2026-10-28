import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BASIS_KINDS, type BasisKind } from '@hospital-run/shared';

/**
 * 표준 발효 거버넌스 — "프로세스·프로토콜·CP 가 **무엇이 있어야 발효되는가**" (2026-08-27).
 *
 * 사람 지시: *"실제 의료기관의 프로세스와 프로토콜, CP가 동작되기 위한 위원회의 의사결정과정을
 * 정의하고 구성을 선택할 수 있는 관리기능이 효과적으로 구성되어야 함."*
 *
 * 🔴 발단(운영 실측 2026-08-27): 발효 중인 진료 표준 **9건 전부 의결 근거가 없었다.**
 *    임상경로 5건은 `@Roles(ADMIN)` 클릭 한 번으로 ACTIVE 가 됐고 **발행자 컬럼조차 없었다.**
 *
 * 🔴 **막지 않는다.** 지금 5개 임상경로가 환자에게 적용 중이다. 근거가 없다는 이유로
 *    즉시 중단시키면 그것은 안전측이 아니라 **진료 중단**이다.
 *    기본 `WARN` — 발효는 되지만 "근거 없이 발효했다"가 기록되고 목록에 남는다.
 *    `BLOCK` 승격은 **위원회가 정한다**(그 자체가 결정 사안이다).
 *
 * 🔴 담당(누가 이 표준의 주인인가)은 이 서비스가 갖지 않는다 — `CommitteeSurfaceMap` 정본이다.
 */

export type StandardKind = 'PATHWAY' | 'PROTOCOL' | 'PROCESS';
export type StandardAction = 'ENACT' | 'AMEND' | 'RETIRE';

/** 행위별 요건 — `COMMITTEE`(의결 필수) · `DELEGATED`(위원회가 위임한 경미개정) · `NONE` */
export type ActionRequirement = 'COMMITTEE' | 'DELEGATED' | 'NONE';

export const STANDARD_KIND_LABEL: Record<StandardKind, string> = {
  PATHWAY: '임상경로(CP)',
  PROTOCOL: '프로토콜',
  PROCESS: '프로세스',
};

/** 표면 키 — `CommitteeSurfaceMap` 과 같은 어휘를 쓴다(여기서 지어내지 않는다) */
export function standardSurfaceKey(kind: StandardKind, code: string): string {
  return `${kind === 'PATHWAY' ? 'pathway' : kind === 'PROTOCOL' ? 'protocol' : 'process'}:${code}`;
}

/** 🔴 유형 전체 기본 규칙의 범위 표식 — 표준 코드로 쓸 수 없는 값을 골랐다(어휘가 아니라 범위다) */
export const RULE_SCOPE_ALL = '*';

export interface StandardRule {
  standardKind: StandardKind;
  standardCode: string;
  requireAll: boolean;
  actions: Partial<Record<StandardAction, ActionRequirement>>;
  requireBasis: BasisKind[];
  reviewCycleM: number | null;
  gateMode: 'OFF' | 'WARN' | 'BLOCK';
  delegationRef: string | null;
}

/**
 * 🔴 규칙이 없을 때의 기본값 — **"규칙 미설정"과 다르다.**
 *    평가는 해야 하므로 기본을 쓰되, 화면에는 `ruleSource: 'DEFAULT'` 로 그 사실을 밝힌다.
 *    기본값을 정책인 척하지 않는다.
 */
export const DEFAULT_RULE: Omit<StandardRule, 'standardKind' | 'standardCode'> = {
  requireAll: true,
  actions: { ENACT: 'COMMITTEE', AMEND: 'COMMITTEE', RETIRE: 'COMMITTEE' },
  requireBasis: [],          // 🔴 근거를 기본으로 요구하지 않는다(강제하면 아무 문장이나 채워진다)
  reviewCycleM: null,        // 🔴 주기를 지어내지 않는다
  gateMode: 'WARN',          // 🔴 막지 않는다
  delegationRef: null,
};

export type EnactVerdict =
  /** 요건을 충족했다 */
  | { ok: true; level: 'PASS'; reasons: string[]; gateMode: string; ruleSource: 'RULE' | 'DEFAULT' }
  /** 요건 미충족 — 그러나 `WARN` 이라 막지 않는다(사실만 남는다) */
  | { ok: true; level: 'WARN'; reasons: string[]; gateMode: string; ruleSource: 'RULE' | 'DEFAULT' }
  /** 요건 미충족 + `BLOCK` — 발효를 막는다 */
  | { ok: false; level: 'BLOCK'; reasons: string[]; gateMode: string; ruleSource: 'RULE' | 'DEFAULT' };

@Injectable()
export class StandardGovernanceService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  /** 유형 전체 기본 규칙 ← 표준별 예외 순으로 찾는다(예외가 이긴다) */
  async ruleFor(kind: StandardKind, code: string): Promise<{ rule: StandardRule; source: 'RULE' | 'DEFAULT' }> {
    const rows = await this.prisma?.standardGovernanceRule.findMany({
      where: { standardKind: kind, standardCode: { in: [code, RULE_SCOPE_ALL] } },
    }).catch(() => []);
    // 표준별 예외가 유형 기본을 이긴다
    const hit = (rows ?? []).find((r) => r.standardCode === code) ?? (rows ?? []).find((r) => r.standardCode === RULE_SCOPE_ALL);
    if (!hit) return { rule: { standardKind: kind, standardCode: RULE_SCOPE_ALL, ...DEFAULT_RULE }, source: 'DEFAULT' };
    return {
      rule: {
        standardKind: kind,
        standardCode: hit.standardCode,
        requireAll: hit.requireAll,
        actions: (hit.actions ?? {}) as Partial<Record<StandardAction, ActionRequirement>>,
        requireBasis: (hit.requireBasis ?? []).filter((b): b is BasisKind => (BASIS_KINDS as readonly string[]).includes(b)),
        reviewCycleM: hit.reviewCycleM,
        gateMode: (hit.gateMode as StandardRule['gateMode']) ?? 'WARN',
        delegationRef: hit.delegationRef,
      },
      source: 'RULE',
    };
  }

  /**
   * 발효 요건 평가.
   *
   * 🔴 **판정만 한다.** 발효 여부는 호출부가 정하고, 이 결과는 어느 쪽이든 **기록된다** —
   *    "근거 없이 발효했다"가 남아야 목록이 줄어드는 것을 볼 수 있다.
   */
  async evaluate(input: {
    kind: StandardKind;
    code: string;
    action: StandardAction;
    /** 근거로 제시된 의결번호 — 없으면 의결 근거 없음 */
    decisionNo?: string | null;
  }): Promise<EnactVerdict> {
    const { rule, source } = await this.ruleFor(input.kind, input.code);
    const reasons: string[] = [];
    const need = rule.actions[input.action] ?? 'COMMITTEE';

    if (need === 'NONE') {
      return { ok: true, level: 'PASS', reasons: ['이 행위는 의결을 요구하지 않습니다.'], gateMode: rule.gateMode, ruleSource: source };
    }

    if (need === 'DELEGATED') {
      /**
       * 🔴 위임은 **위원회가 의결한 적이 있어야** 성립한다.
       *    이것이 없으면 "부서장 전결"이 되고, 그건 결정 3층 고정 원칙을 깬다
       *    (하위가 상위를 대체 — 계획서 재검토에서 정정한 지점이다).
       */
      if (!rule.delegationRef) {
        reasons.push('위임 근거 의결번호가 없습니다 — 위원회가 위임을 의결한 적이 없으면 전결할 수 없습니다.');
      } else {
        return { ok: true, level: 'PASS', reasons: [`위임 근거 ${rule.delegationRef}`], gateMode: rule.gateMode, ruleSource: source };
      }
    }

    if (need === 'COMMITTEE' && !input.decisionNo) {
      reasons.push('위원회 의결 근거가 없습니다.');
    }

    if (input.decisionNo) {
      const decision = await this.prisma?.committeeDecision.findUnique({
        where: { decisionNo: input.decisionNo },
        select: { decisionNo: true, status: true, actions: { select: { basis: true } } },
      }).catch(() => null);
      if (!decision) {
        reasons.push(`의결 ${input.decisionNo} 을 찾을 수 없습니다.`);
      } else {
        if (['REVOKED', 'SUPERSEDED', 'EXPIRED'].includes(decision.status)) {
          reasons.push(`의결 ${input.decisionNo} 은 ${decision.status} 상태입니다.`);
        }
        // 근거 요건 — 🔴 요구하지 않는 것이 기본이다
        if (rule.requireBasis.length) {
          const have = new Set<string>();
          for (const a of decision.actions ?? []) {
            const b = (a.basis ?? {}) as Record<string, unknown>;
            for (const k of BASIS_KINDS) if (Array.isArray(b[k]) && (b[k] as unknown[]).length) have.add(k);
          }
          const missing = rule.requireBasis.filter((k) => !have.has(k));
          if (missing.length) reasons.push(`필요한 근거가 없습니다: ${missing.join(', ')}`);
        }
      }
    }

    // 합동 의결(담당 복수 + requireAll) — 🔴 여기서는 **판정하지 않는다.**
    // 두 위원회가 각각 의결했는지는 표면 매핑과 의결 원장을 함께 봐야 하고,
    // 불일치(CONFLICT) 처리는 사람이 조정하는 영역이다(계획서 §3.5.1). 미구현임을 밝힌다.
    if (rule.requireAll) {
      // 🔴 (2026-09-14) 종전 `.catch(() => [])` — 표면 매핑 **조회 실패**가 "합동 아님"으로 번역돼
      //    reasons 가 비면 `PASS · 발효합니다` 로 떨어졌다. 모르면 사람 확인 사유로 남긴다(안전측).
      let maps: { committeeId: string }[] | undefined;
      try {
        maps = await this.prisma?.committeeSurfaceMap.findMany({
          where: { surfaceKey: standardSurfaceKey(input.kind, input.code) },
          select: { committeeId: true },
        });
      } catch {
        reasons.push('🔴 합동 의결 대상 여부를 조회하지 못했습니다 — 담당 위원회 매핑을 사람이 확인하세요.');
      }
      if ((maps ?? []).length > 1) {
        reasons.push('🔴 합동 의결 대상입니다 — 전원 의결 여부는 아직 자동 판정하지 않습니다(사람이 확인하세요).');
      }
    }

    if (reasons.length === 0) {
      return { ok: true, level: 'PASS', reasons: [`의결 ${input.decisionNo} 근거로 발효합니다.`], gateMode: rule.gateMode, ruleSource: source };
    }
    if (rule.gateMode === 'BLOCK') {
      return { ok: false, level: 'BLOCK', reasons, gateMode: rule.gateMode, ruleSource: source };
    }
    if (rule.gateMode === 'OFF') {
      return { ok: true, level: 'PASS', reasons: ['게이트 OFF — 요건을 평가하지 않았습니다.'], gateMode: rule.gateMode, ruleSource: source };
    }
    return { ok: true, level: 'WARN', reasons, gateMode: rule.gateMode, ruleSource: source };
  }

  /**
   * 관리 화면용 — 표준 목록과 **지금 상태**.
   *
   * 🔴 3상으로 말한다: `DECIDED`(의결로 발효) / `NO_BASIS`(발효돼 있으나 근거 없음) /
   *    `NO_RULE`(요건이 아직 정의되지 않음). 뒤의 둘은 **다른 사실**이다.
   */
  async listStandards() {
    const [pathways, protocols, rules, maps, committees] = await Promise.all([
      this.prisma?.clinicalPathway.findMany({
        select: { id: true, code: true, name: true, department: true, status: true, version: true, publishedAt: true, publishedBy: true, governanceRef: true },
        orderBy: { code: 'asc' },
      }) ?? [],
      this.prisma?.protocolTemplate.findMany({
        select: { id: true, code: true, name: true, domain: true, status: true, version: true, publishedAt: true, publishedBy: true },
        orderBy: [{ code: 'asc' }, { version: 'desc' }],
      }) ?? [],
      this.prisma?.standardGovernanceRule.findMany() ?? [],
      this.prisma?.committeeSurfaceMap.findMany({ where: { surfaceKey: { contains: ':' } } }) ?? [],
      this.prisma?.committee.findMany({ select: { id: true, code: true, name: true } }) ?? [],
    ]);
    const cmtById = new Map(committees.map((c) => [c.id, c]));
    const ownersOf = (surfaceKey: string) =>
      maps.filter((m) => m.surfaceKey === surfaceKey).map((m) => cmtById.get(m.committeeId)).filter(Boolean);
    const ruleOf = (kind: StandardKind, code: string) =>
      rules.find((r) => r.standardKind === kind && r.standardCode === code)
      ?? rules.find((r) => r.standardKind === kind && r.standardCode === RULE_SCOPE_ALL)
      ?? null;

    const row = (kind: StandardKind, x: { code: string; name: string; status: string; version?: number; publishedAt?: Date | null; publishedBy?: string | null; governanceRef?: string | null; department?: string; domain?: string }) => {
      const surfaceKey = standardSurfaceKey(kind, x.code);
      const rule = ruleOf(kind, x.code);
      const active = x.status === 'ACTIVE';
      return {
        kind, code: x.code, name: x.name, status: x.status, version: x.version ?? null,
        scope: x.department ?? x.domain ?? null,
        publishedAt: x.publishedAt ?? null,
        publishedBy: x.publishedBy ?? null,
        governanceRef: x.governanceRef ?? null,
        surfaceKey,
        owners: ownersOf(surfaceKey),
        rule: rule ? { gateMode: rule.gateMode, actions: rule.actions, requireBasis: rule.requireBasis, reviewCycleM: rule.reviewCycleM, delegationRef: rule.delegationRef, scopeIsCode: rule.standardCode === x.code } : null,
        /** 🔴 세 상태 — "근거 없음"과 "규칙 미설정"은 다른 사실이다 */
        state: !active ? 'NOT_ACTIVE' : (x.governanceRef ? 'DECIDED' : 'NO_BASIS'),
        ruleState: rule ? 'RULE' : 'NO_RULE',
      };
    };

    return {
      standards: [
        ...pathways.map((p) => row('PATHWAY', p)),
        ...protocols.map((p) => row('PROTOCOL', p)),
      ],
      /** 🔴 분모를 함께 낸다 — "근거 없음 N건"만 보면 전체 규모를 모른다 */
      summary: {
        total: pathways.length + protocols.length,
        active: pathways.filter((p) => p.status === 'ACTIVE').length + protocols.filter((p) => p.status === 'ACTIVE').length,
        withBasis: pathways.filter((p) => p.status === 'ACTIVE' && p.governanceRef).length,
        rulesDefined: rules.length,
      },
    };
  }

  /** 규칙 정의·수정 — 유형 기본 또는 표준별 예외 */
  async upsertRule(dto: {
    standardKind: StandardKind; standardCode?: string | null;
    requireAll?: boolean; actions?: Record<string, string>;
    requireBasis?: string[]; reviewCycleM?: number | null;
    gateMode?: string; delegationRef?: string | null; note?: string;
  }, userId?: string) {
    if (!this.prisma) throw new BadRequestException('저장소를 사용할 수 없습니다');
    const gateMode = ['OFF', 'WARN', 'BLOCK'].includes(dto.gateMode ?? '') ? dto.gateMode! : 'WARN';
    /**
     * 🔴 `DELEGATED` 는 **위임 근거 없이 저장할 수 없다.**
     *    저장을 허용하면 화면이 "전결 가능"으로 보이고, 그 순간 3층 원칙이 깨진다.
     */
    const acts = dto.actions ?? {};
    if (Object.values(acts).includes('DELEGATED') && !dto.delegationRef?.trim()) {
      throw new BadRequestException({
        code: 'DELEGATION_REF_REQUIRED',
        message: '위임(경미개정 전결)은 위원회가 위임을 의결한 근거 의결번호가 필요합니다.',
      });
    }
    const data = {
      requireAll: dto.requireAll ?? true,
      actions: acts as never,
      requireBasis: (dto.requireBasis ?? []).filter((b) => (BASIS_KINDS as readonly string[]).includes(b)),
      reviewCycleM: dto.reviewCycleM ?? null,
      gateMode,
      delegationRef: dto.delegationRef?.trim() || null,
      note: dto.note ?? null,
      updatedBy: userId ?? null,
    };
    return this.prisma.standardGovernanceRule.upsert({
      where: { standardKind_standardCode: { standardKind: dto.standardKind, standardCode: dto.standardCode || RULE_SCOPE_ALL } },
      create: { standardKind: dto.standardKind, standardCode: dto.standardCode || RULE_SCOPE_ALL, ...data },
      update: data,
    });
  }

  /** 발효를 막아야 하면 던진다 — WARN 은 던지지 않는다(사실만 남는다) */
  assertOrWarn(v: EnactVerdict): void {
    if (!v.ok) {
      throw new BadRequestException({
        code: 'STANDARD_GOVERNANCE_BLOCKED',
        message: `발효 요건 미충족 — ${v.reasons.join(' · ')}`,
      });
    }
  }
}
