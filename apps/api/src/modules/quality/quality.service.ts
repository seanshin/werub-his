import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { QI_SUPPLIERS, qiSourceKeyOf, qiSupplierByName, type QiMeasurementSource, type QiPrecedence } from '@hospital-run/shared';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { normalizeIndicatorKey,
  IndicatorDirection,
  IndicatorPolicyMeta,
  MEASUREMENT_VALUE_MAX,
  achievementPercent,
  computeMeasurementValue,
  evaluateMeetTarget,
  normalizeIndicatorDirection,
  resolveIndicatorPolicy,
  resolveRegistryDirection,
  undeterminedReason,
  valueDerivedFromRatio,
} from './indicator-policy';
import { collectIndicatorLedgers } from './indicator-ledger';
import { ACTIVE_MEASUREMENT, primaryPerPeriod, readQiPrecedence } from './measurement-read';

/** 배율의 출처를 사람 말로 — 거절 메시지가 '가정'을 '등재'처럼 말하지 않게 한다. */
const SCALE_SOURCE_TEXT: Record<IndicatorPolicyMeta['valueScaleSource'], string> = {
  COLUMN: '지표에 등재된 배율',
  FORMULA: '산출공식에서 읽은 배율',
  ASSUMED: '🔴 등재도 산출공식도 없어 백분율로 **가정한** 배율',
};

/**
 * 질 지표(QI) 서비스.
 *
 * 🔴 달성/미달 판정은 `indicator-policy.ts` **한 곳**에서만 나온다. 종전에는 seed·서버·화면이
 *    서로 다른(그리고 방향이 반대인) 규칙을 각자 갖고 있었다 — 상세는 정본 파일 주석 참조.
 *    읽기 경로도 저장된 `meet_target` 을 그대로 믿지 않고 정본으로 다시 판정한다
 *    (옛 규칙으로 기록된 행이 화면에서 되살아나지 않도록).
 *
 * 🔴 방향·단위·배율의 우선순위는 **DB 컬럼 → 코드 등재표 → 미등재** 다(정본 주석: indicator-policy.ts 상단).
 *    이 파일은 그 순서를 재정의하지 않는다 — 반드시 `resolveIndicatorPolicy` 를 통해서만 읽는다.
 */
@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /**
   * 화면에서 지표 정의·목표를 직접 바꾸는 것(결정 qi.indicator.directEdit) — **화면 경로에만** 건다.
   * 위원회 의결 집행(quality-indicator 바인딩)은 서비스 함수를 직접 불러 이 검사를 지나지 않는다(기록 ≠ 적용 · 의결이 정본).
   * AGENDA_ONLY → 409 · ALLOW_WITH_REASON(기본) → 정의·목표 변경엔 사유 필수.
   */
  async guardDirectEdit(change: { create?: boolean; fields: string[]; changeReason?: string }): Promise<{ policy: string; definitionChange: boolean }> {
    let policy = 'ALLOW_WITH_REASON';
    try { const v = this.config ? await this.config.get('qi.indicator.directEdit') : null; if (v === 'AGENDA_ONLY') policy = v; } catch { /* 읽기 실패 = 기본(현행) — 막지 않되 사유는 받는다 */ }
    const DEF = ['targetValue', 'direction', 'unit', 'valueScale', 'supplierKey'];
    const definitionChange = !!change.create || change.fields.some((f) => DEF.includes(f));
    if (!definitionChange) return { policy, definitionChange };
    if (policy === 'AGENDA_ONLY') {
      throw new ConflictException({ code: 'QI_DIRECT_EDIT_BLOCKED', message: '질 지표 정의·목표는 위원회 안건으로만 바꿉니다(결정 qi.indicator.directEdit)' });
    }
    if (!change.changeReason || change.changeReason.trim().length < 5) {
      throw new BadRequestException({ code: 'QI_CHANGE_REASON_REQUIRED', message: '정의·목표를 바꾸는 사유를 5자 이상 적어 주십시오 — 변경 이력과 함께 위원회에 통지됩니다' });
    }
    return { policy, definitionChange };
  }

  /** 같은 달 수기·자동 값 중 정본(결정 qi.autoManual.precedence) — 읽기 실패는 기본 BOTH(수기 정본·자동 병기) */
  async precedence(): Promise<QiPrecedence> {
    return readQiPrecedence(this.config);
  }

  async getIndicators() {
    const rows = await this.prisma.qualityIndicator.findMany({ where: { isActive: true } });
    // policy 가 뒤에 와서 컬럼값(폴백 전)을 해석값으로 덮는다. 등재 원본은 registered* 로 함께 나간다.
    return rows.map((r) => ({ ...r, ...resolveIndicatorPolicy(r) }));
  }

  async createIndicator(data: {
    name: string;
    category: string;
    formula: string;
    targetValue: number;
    direction?: string | null;
    unit?: string | null;
    valueScale?: number | null;
    ownerId?: string | null;
    committeeCode?: string | null;
    supplierKey?: string | null;
  }) {
    const direction = this.normalizeDirectionInput(data.direction);
    const created = await this.prisma.qualityIndicator.create({
      data: {
        name: data.name,
        category: data.category,
        formula: data.formula,
        targetValue: data.targetValue,
        direction,
        unit: data.unit?.trim() || null,
        valueScale: data.valueScale ?? null,
        ownerId: data.ownerId ?? null,
        committeeCode: data.committeeCode?.trim() || null,
        supplierKey: data.supplierKey ?? null,
      },
    });
    return { ...created, ...resolveIndicatorPolicy(created) };
  }

  /**
   * 지표 메타 수정 — **방향·단위·배율을 등재하는 유일한 경로**.
   *
   * 🔴 종전에는 방향이 코드 등재표에만 있어 관리자가 화면에서 만든 새 지표는 측정 입력이 422 로 막혔고,
   *    풀려면 코드 배포가 필요했다. 이제 여기서 등재하면 즉시 판정된다.
   * 🔴 `null` 을 명시하면 **등재 해제**(다시 코드 등재표/미등재로 내려간다) — 지우는 것도 의도적 행위다.
   */
  async updateIndicator(
    id: string,
    patch: {
      direction?: string | null;
      unit?: string | null;
      valueScale?: number | null;
      targetValue?: number;
      isActive?: boolean;
      ownerId?: string | null;
      committeeCode?: string | null;
      supplierKey?: string | null;
    },
  ) {
    const indicator = await this.prisma.qualityIndicator.findUnique({ where: { id } });
    if (!indicator) throw new NotFoundException('질 지표를 찾을 수 없습니다');

    const data: Record<string, unknown> = {};
    if (patch.direction !== undefined) data.direction = this.normalizeDirectionInput(patch.direction);
    if (patch.unit !== undefined) data.unit = patch.unit?.trim() || null;
    if (patch.valueScale !== undefined) {
      if (patch.valueScale !== null && !(Number.isInteger(patch.valueScale) && patch.valueScale > 0)) {
        throw new BadRequestException('배율(valueScale)은 1 이상의 정수여야 합니다');
      }
      data.valueScale = patch.valueScale;
    }
    if (patch.targetValue !== undefined) data.targetValue = patch.targetValue;
    if (patch.isActive !== undefined) data.isActive = patch.isActive;
    if (patch.ownerId !== undefined) data.ownerId = patch.ownerId;
    if (patch.committeeCode !== undefined) data.committeeCode = patch.committeeCode?.trim() || null;
    if (patch.supplierKey !== undefined) data.supplierKey = patch.supplierKey;
    if (Object.keys(data).length === 0) throw new BadRequestException('변경할 항목이 없습니다');

    const updated = await this.prisma.qualityIndicator.update({ where: { id }, data });
    const policy = resolveIndicatorPolicy(updated);
    return {
      ...updated,
      ...policy,
      /**
       * 🔴 이미 저장된 측정값의 `meet_target` 은 **다시 쓰지 않는다**. 읽기 경로가 매번 정본으로
       *    재판정하므로(getMeasurements/getDashboard) 화면은 즉시 새 방향으로 보인다.
       *    저장값을 소급 수정하면 "언제 무엇으로 판정했는지"가 사라진다.
       */
      note: '저장된 측정값은 읽는 시점에 재판정됩니다(과거 meet_target 은 원본 그대로 보존).',
    };
  }

  /** 방향 입력 정규화 — 해석되지 않는 문자열은 **거절**한다(오타를 방향으로 지어내지 않는다). */
  private normalizeDirectionInput(raw?: string | null): IndicatorDirection | null {
    if (raw === undefined || raw === null || raw === '') return null;
    const normalized = normalizeIndicatorDirection(raw);
    if (!normalized) {
      throw new BadRequestException(
        `지표 방향을 알 수 없는 값입니다: ${raw}. LOWER_IS_BETTER 또는 HIGHER_IS_BETTER 여야 합니다`,
      );
    }
    return normalized;
  }

  /**
   * 분자/분모 → 저장 가능한 값. **산출식과 한도 검사가 여기 한 곳에만 있다**(입력·정정 공용).
   *
   * 🔴 저장 한도 초과는 **거절**한다. 종전에는 Prisma `numeric field overflow` 로 500 이 나가
   *    화면이 원인을 말할 수 없었고, 값을 잘라 넣으면 잘린 줄 모르는 수치가 원장에 남는다.
   *
   * 🔴 실측(2026-08-18·운영 25지표 300측정): 한도 999.99 에 걸리는 지표 **0건**(최대 99.77).
   *    ×100 지표 11종은 비율이 10 을 넘어야(=1000%), ×1000 지표 7종은 사건수가 유치일수와
   *    같아야 걸린다 — 임상적으로 도달 불가. 남은 노출은 **배율이 '가정'인 신규 지표**다:
   *    산출공식에 배율 힌트가 없으면 ×100 으로 가정하므로 **건수 10건이 1000 이 되어 거절**된다.
   *    그래서 메시지가 배율의 **출처**를 함께 말한다 — '가정'을 '등재'처럼 말하면
   *    담당자는 자기 입력이 틀렸다고 오해하고 진짜 원인(미등재 배율)을 못 찾는다(P1).
   */
  private computeStorableValue(
    numerator: number,
    denominator: number,
    policy: IndicatorPolicyMeta,
  ): number {
    const scale = policy.valueScale;
    const value = computeMeasurementValue(numerator, denominator, scale);
    if (value === null) {
      throw new BadRequestException('측정값을 산출할 수 없습니다 — 분자·분모를 확인하십시오(분모 0 은 값 0 이 아닙니다)');
    }
    if (Math.abs(value) > MEASUREMENT_VALUE_MAX) {
      const source = SCALE_SOURCE_TEXT[policy.valueScaleSource];
      const hint =
        policy.valueScaleSource === 'ASSUMED'
          ? ` 이 지표는 배율이 등재돼 있지 않아 ×${scale} 로 가정했습니다 — 건수 지표라면 지표 수정(PATCH /quality/indicators/:id)에서 valueScale=1 을 등재하십시오.`
          : ' 분자·분모 또는 지표 배율(valueScale)을 확인하십시오.';
      throw new BadRequestException(
        `산출값 ${value}(= ${numerator} / ${denominator} × ${scale} · ${source})이 저장 한도 ${MEASUREMENT_VALUE_MAX} 를 벗어납니다.` +
          `${hint} 값을 잘라 저장하지 않습니다`,
      );
    }
    return value;
  }

  /**
   * 측정값 입력.
   * - 분모 0 은 '값 0' 이 아니라 **산출 불가**다(표본 부재를 0 으로 적지 않는다).
   * - 🔴 방향 미등재는 **막지 않는다**. `meet_target = null`(판정 불가)로 저장하고 응답이 그 사실을
   *   말한다. 종전에는 422 로 거절해 **측정 자체가 유실**됐다 — 측정값은 사실이고, 모르는 것은
   *   '달성'도 '미달'도 아니다. 모르는 것을 달성으로 접지 않는다.
   */
  async addMeasurement(data: {
    indicatorId: string;
    period: string;
    numerator: number;
    denominator: number;
    direction?: string;
    /** 이 행이 어떻게 만들어졌는가 — 화면 입력은 MANUAL(기본) · 월 마감 AUTO · 처방 원장 CPOE */
    source?: QiMeasurementSource;
    computedBy?: string;
    evidence?: Record<string, unknown>;
    createdBy?: string;
    /** 층 — 병원 전체 '' */
    stratumKey?: string;
  }) {
    const source: QiMeasurementSource = data.source ?? 'MANUAL';
    const sourceKey = qiSourceKeyOf(source);
    const stratumKey = data.stratumKey ?? '';
    const indicator = await this.prisma.qualityIndicator.findUnique({ where: { id: data.indicatorId } });
    if (!indicator) throw new NotFoundException('질 지표를 찾을 수 없습니다');

    if (!(data.denominator > 0)) {
      throw new BadRequestException('분모가 0 입니다 — 측정값을 산출할 수 없습니다(표본 부재는 0 이 아닙니다)');
    }

    let policy = resolveIndicatorPolicy(indicator);

    /**
     * 🔴 요청에 실려온 방향은 **그 한 건만 판정하고 버리는 값이 아니라 '등재'** 다.
     *    일회성으로 쓰면 저장된 meet_target 은 true 인데 읽는 시점 재판정은 null 이 되어
     *    같은 사실에 답이 둘이 된다(P12). → 컬럼에 등재하고, 이후 읽기도 같은 답을 낸다.
     */
    let directionRegistered = false;
    if (data.direction) {
      const requested = this.normalizeDirectionInput(data.direction);
      if (policy.registeredDirection && policy.registeredDirection !== requested) {
        throw new BadRequestException(
          `이미 등재된 지표 방향(${policy.registeredDirection})과 다릅니다. 방향을 바꾸려면 지표 수정(PATCH /quality/indicators/:id)으로 하십시오`,
        );
      }
      const registry = resolveRegistryDirection(indicator.name);
      if (!policy.registeredDirection && registry.source === 'REGISTRY' && registry.direction !== requested) {
        // 코드 등재표에 임상적으로 확정된 지표다 — 측정 입력이 옆문으로 뒤집지 못하게 막는다.
        throw new BadRequestException(
          `코드 등재표의 방향(${registry.direction})과 다릅니다: ${indicator.name}. 지표 수정 경로에서 근거와 함께 변경하십시오`,
        );
      }
      if (!policy.registeredDirection) {
        const updated = await this.prisma.qualityIndicator.update({
          where: { id: indicator.id },
          data: { direction: requested },
        });
        policy = resolveIndicatorPolicy(updated);
        directionRegistered = true;
      }
    }

    // 🔴 종전에는 지표와 무관하게 항상 × 100 이었다(건수 지표는 100배, × 1000 지표는 1/10 로 기록).
    //    산출식은 정본 한 곳(`computeMeasurementValue`)에서만 — 입력/정정이 다른 값을 내지 않게.
    const scale = policy.valueScale;
    const value = this.computeStorableValue(data.numerator, data.denominator, policy);

    const target = Number(indicator.targetValue);
    const meetTarget = evaluateMeetTarget(value, target, policy.direction);
    const reason = undeterminedReason(value, target, policy.direction);

    /**
     * 🔴 지표×기간은 하나다. 종전엔 같은 기간을 다시 넣으면 **별도 행**으로 쌓여
     *    어느 것이 맞는지 화면도 집계도 알 수 없었다. 이제 중복은 거절하고 **정정 경로를 안내**한다
     *    (조용히 덮어쓰지 않는다 — 덮어쓰면 이전 값이 무엇이었는지 사라진다).
     */
    const existing = await this.prisma.qiMeasurement.findUnique({
      where: { indicatorId_period_stratumKey_sourceKey: { indicatorId: data.indicatorId, period: data.period, stratumKey, sourceKey } },
      select: { id: true, value: true, voidedAt: true },
    });
    if (existing && !existing.voidedAt) {
      throw new ConflictException({
        code: 'QI_MEASUREMENT_EXISTS',
        message: `${data.period} 측정이 이미 있습니다(값 ${Number(existing.value)}). 정정하려면 수정(PATCH /quality/measurements/${existing.id})을, 취소하려면 무효화를 쓰십시오.`,
        measurementId: existing.id,
      });
    }

    const created = existing
      // 무효화된 같은 기간 행이 있으면 그 자리를 되살린다(유니크 제약과 충돌하지 않게)
      ? await this.prisma.qiMeasurement.update({
          where: { id: existing.id },
          data: {
            numerator: data.numerator, denominator: data.denominator, value, meetTarget,
            measuredAt: new Date(), voidedAt: null, voidedBy: null, voidReason: null,
            source, computedBy: data.computedBy ?? null, evidence: (data.evidence ?? undefined) as never, createdBy: data.createdBy ?? null,
          },
        })
      : await this.prisma.qiMeasurement.create({
          data: {
            indicatorId: data.indicatorId,
            period: data.period,
            numerator: data.numerator,
            denominator: data.denominator,
            value,
            // 🔴 null = 판정 불가. false(미달)로 뭉개지 않는다.
            meetTarget,
            measuredAt: new Date(),
            source, sourceKey, stratumKey,
            computedBy: data.computedBy ?? null,
            evidence: (data.evidence ?? undefined) as never,
            createdBy: data.createdBy ?? null,
          },
        });
    return {
      ...created,
      direction: policy.direction,
      directionSource: policy.directionSource,
      unit: policy.unit,
      valueScale: scale,
      valueScaleKnown: policy.valueScaleKnown,
      valueScaleSource: policy.valueScaleSource,
      target,
      undetermined: meetTarget === null,
      undeterminedReason: reason,
      directionRegistered,
    };
  }

  /** 지표별 측정 추이 — 저장값이 아니라 정본 규칙으로 다시 판정해 내려준다. */
  async getMeasurements(indicatorId: string, includeVoided = false) {
    const indicator = await this.prisma.qualityIndicator.findUnique({ where: { id: indicatorId } });
    if (!indicator) throw new NotFoundException('질 지표를 찾을 수 없습니다');

    const policy = resolveIndicatorPolicy(indicator);
    const target = Number(indicator.targetValue);
    // 무효화된 측정은 기본으로 빠진다(이력으로는 남는다 — `includeVoided` 로만 보인다)
    const rows = await this.prisma.qiMeasurement.findMany({
      where: { indicatorId, stratumKey: '', ...(includeVoided ? {} : { voidedAt: null }) },
      orderBy: [{ period: 'desc' }, { sourceKey: 'asc' }],
      take: 24,
    });

    return rows.map((m) => {
      const value = m.value === null || m.value === undefined ? null : Number(m.value);
      const meetTarget = evaluateMeetTarget(value, target, policy.direction);
      return {
        ...m,
        value,
        unit: policy.unit,
        direction: policy.direction,
        directionSource: policy.directionSource,
        /**
         * 🔴 배율은 **행마다 다를 수 있는 사실이 아니라 지금 지표에 적용되는 값**이다.
         *    같은 분자/분모라도 배율이 바뀌면 값이 달라지므로, 화면이 값만 보여주고 배율을 감추면
         *    과거 행이 어떤 배율로 기록된 것인지 말할 수 없다 → 현재 배율을 함께 내려 화면이 밝히게 한다.
         */
        valueScale: policy.valueScale,
        valueScaleKnown: policy.valueScaleKnown,
        valueScaleSource: policy.valueScaleSource,
        target,
        // 정본 재판정(null = 방향 미상 → 판정 불가). storedMeetTarget 은 옛 기록과의 차이를 확인하기 위해 남긴다.
        meetTarget,
        storedMeetTarget: m.meetTarget,
        /**
         * 🔴 저장 당시 판정과 **읽는 시점 재판정이 갈렸다**. 어느 한쪽을 조용히 지우지 않고 드러낸다
         *    (방향이 나중에 등재/변경됐거나, 옛 규칙으로 기록된 행이다). 정본은 재판정 쪽이다.
         */
        storedDiverges: (m.meetTarget ?? null) !== meetTarget,
        /**
         * 🔴 이 행의 값이 **분자/분모 × 현재 배율에서 나온 값인가**.
         *    운영 실측 300건 중 273건(91%)이 아니다 — 시드가 값을 먼저 정하고 분자/분모를
         *    ×100 가정으로 역산했다(×1000 지표는 10배·배율 1 지표는 1/100 로 갈린다).
         *    화면이 분자·분모와 값을 나란히 보여주면서 이 사실을 감추면 **같은 사실에 정본이 둘**
         *    이 된다(P12). 값을 고치지 않고 사실만 드러낸다(시드 품질 결함을 코드로 교정하지 않는다).
         */
        valueDerived: valueDerivedFromRatio(value, m.numerator, m.denominator, policy.valueScale),
        ratioValue: computeMeasurementValue(m.numerator, m.denominator, policy.valueScale),
        undetermined: meetTarget === null,
        undeterminedReason: undeterminedReason(value, target, policy.direction),
      };
    });
  }

  /**
   * 측정값 정정 — 분자·분모·비고를 고치고 **값과 판정을 다시 산출**한다.
   *
   * 🔴 기간(period)·지표는 바꾸지 않는다. 기간을 옮기려면 무효화하고 새로 넣는다 —
   *    같은 행의 기간을 갈아끼우면 그 기간에 무엇이 기록됐었는지 추적할 수 없다.
   *    (변이는 기본 감사 ON 이므로 누가 언제 고쳤는지는 AuditLog 에 남는다.)
   */
  async updateMeasurement(id: string, data: { numerator?: number; denominator?: number; notes?: string }) {
    const m = await this.prisma.qiMeasurement.findUnique({ where: { id }, include: { indicator: true } });
    if (!m) throw new NotFoundException('측정 기록을 찾을 수 없습니다');
    if (m.voidedAt) throw new BadRequestException('무효화된 측정은 정정할 수 없습니다 — 새 측정으로 입력하십시오');

    const policy = resolveIndicatorPolicy(m.indicator);
    const previousValue = m.value === null || m.value === undefined ? null : Number(m.value);
    const ratioChanged =
      (data.numerator !== undefined && data.numerator !== m.numerator) ||
      (data.denominator !== undefined && data.denominator !== m.denominator);
    const notesChanged = data.notes !== undefined && data.notes !== m.notes;

    /**
     * 🔴 **아무것도 안 바꾸는 정정은 거절한다.** 화면의 [정정] 폼은 현재 분자/분모를 프리필하므로
     *    그대로 [정정 저장] 을 누르는 일이 흔하다. 종전 구현은 그때도 값을 재산출했는데,
     *    운영 측정 300건 중 **273건(91%)** 은 저장된 값이 그 행의 분자/분모에서 나온 값이 아니다
     *    (시드가 값을 먼저 정하고 분자/분모를 ×100 가정으로 역산했다).
     *    그래서 **손대지 않은 행을 누르기만 해도 낙상률이 0.79 → 7.95(10배)** 로 바뀌고
     *    달성 판정까지 뒤집혔다 — 고친 적 없는 수치가 원장에서 조용히 바뀌는 것이다.
     */
    if (!ratioChanged && !notesChanged) {
      throw new BadRequestException(
        '정정할 내용이 없습니다 — 분자·분모·비고 중 실제로 바뀌는 값을 보내십시오(누르기만 해도 값이 재산출되지는 않습니다)',
      );
    }

    /** 비고만 고치는 정정 — 값·판정은 **손대지 않는다**(측정을 다시 하지 않았으므로). */
    if (!ratioChanged) {
      const updatedNotes = await this.prisma.qiMeasurement.update({
        where: { id },
        data: { notes: data.notes ?? m.notes },
      });
      const target = Number(m.indicator.targetValue);
      return {
        ...updatedNotes,
        value: previousValue,
        unit: policy.unit,
        direction: policy.direction,
        valueScale: policy.valueScale,
        valueScaleSource: policy.valueScaleSource,
        target,
        valueRecomputed: false,
        previousValue,
        undetermined: evaluateMeetTarget(previousValue, target, policy.direction) === null,
        undeterminedReason: undeterminedReason(previousValue, target, policy.direction),
      };
    }

    const numerator = data.numerator ?? m.numerator;
    const denominator = data.denominator ?? m.denominator;
    // 🔴 분모 0 은 '값 0'이 아니라 산출 불가다 — 0 으로 나눈 수를 원장에 넣지 않는다
    if (!(denominator > 0)) throw new BadRequestException('분모는 0보다 커야 합니다 — 표본 부재는 값 0 이 아닙니다');

    // 산출·한도 검사는 입력 경로와 **같은 한 곳**을 쓴다(정정했더니 값이 달라지는 일이 없게).
    const value = this.computeStorableValue(numerator, denominator, policy);
    const target = Number(m.indicator.targetValue);
    const meetTarget = evaluateMeetTarget(value, target, policy.direction);

    const updated = await this.prisma.qiMeasurement.update({
      where: { id },
      data: { numerator, denominator, value, meetTarget, notes: data.notes ?? m.notes, measuredAt: new Date() },
    });
    return {
      ...updated,
      value: Number(updated.value),
      unit: policy.unit,
      direction: policy.direction,
      valueScale: policy.valueScale,
      valueScaleSource: policy.valueScaleSource,
      target,
      valueRecomputed: true,
      previousValue,
      /**
       * 🔴 **정정 전 값이 그 행의 분자/분모에서 나온 값이 아니었다** — 재산출이 값을 크게 옮긴다.
       *    감추면 담당자는 자기가 고친 것보다 훨씬 큰 변화를 모른 채 넘어간다.
       *    (`false` 여도 정정은 진행한다 — 막으면 오기를 고칠 방법이 다시 사라진다.)
       */
      previousValueDerived: valueDerivedFromRatio(previousValue, m.numerator, m.denominator, policy.valueScale),
      undetermined: meetTarget === null,
      undeterminedReason: undeterminedReason(value, target, policy.direction),
    };
  }

  /**
   * 측정값 무효화 — **지우지 않는다.**
   *
   * 🔴 QI 측정은 인증·대외 보고의 근거가 된다. 하드 삭제하면 "무엇이 있었는지"가 사라져
   *    나중에 그 기간이 애초에 미측정이었는지, 잘못 넣었다가 지운 것인지 구분할 수 없다.
   *    무효화된 행은 조회·집계에서 빠지되 사유·시각·행위자와 함께 남는다.
   */
  async voidMeasurement(id: string, userId: string, reason: string) {
    const m = await this.prisma.qiMeasurement.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('측정 기록을 찾을 수 없습니다');
    if (m.voidedAt) throw new BadRequestException('이미 무효화된 측정입니다');
    if (!reason?.trim()) throw new BadRequestException('무효화 사유는 필수입니다 — 왜 취소했는지가 남아야 합니다');

    return this.prisma.qiMeasurement.update({
      where: { id },
      data: { voidedAt: new Date(), voidedBy: userId, voidReason: reason.trim() },
    });
  }

  /**
   * QI 대시보드 — 지표별 최신 측정값 + 정본 판정.
   * 응답은 **배열**을 유지한다(대시보드 위젯이 배열로 읽는다).
   * `meetTarget: null` 은 '미달'이 아니라 **판정 불가/미측정**이다 — 화면에서 뭉개지 말 것.
   */
  /**
   * QI 대시보드.
   *
   * 🔴 측정값은 **사람이 넣는 수기 원장**이고 임상 사건 기록과 자동 대조되지 않는다(2026-09-02 종단 검토).
   *    그 사실을 말하지 않아 "손위생 98.48% 달성"이 원내 관찰 기록에 근거한 것처럼 읽혔다 —
   *    같은 시점 `hand_hygiene_observations` 는 **0행**이었고 안전·질 보드는 '산출 불가'라고 말하고 있었다(P12).
   *    판정하지 않고 **대조 근거를 나란히 놓는다** — 수기 입력이 틀렸다고 단정하지 않는다.
   */
  async getDashboard() {
    const indicators = await this.prisma.qualityIndicator.findMany({
      where: { isActive: true },
      include: { measurements: { where: ACTIVE_MEASUREMENT, orderBy: { period: 'desc' }, take: 4 } },
    });
    const precedence = await this.precedence();
    const ledgers = await collectIndicatorLedgers(this.prisma, indicators.map((i) => ({ name: i.name, period: i.measurements[0]?.period ?? null })));

    return indicators.map((i) => {
      const policy = resolveIndicatorPolicy(i);
      const target = Number(i.targetValue);
      // 최신 기간의 정본 한 행(같은 달 수기·자동이 있으면 결정된 정본 · 다른 쪽은 병기)
      const head = primaryPerPeriod(i.measurements, precedence)[0] ?? null;
      const latest = head?.primary ?? null;
      const latestValue = latest ? Number(latest.value) : null;
      const { measurements: _measurements, ...indicatorFields } = i;
      return {
        ...indicatorFields,
        ...policy,
        latestValue,
        latestPeriod: latest?.period ?? null,
        measuredAt: latest?.measuredAt ?? null,
        latestSource: latest?.source ?? null,
        alternate: head?.alternate ? { value: Number(head.alternate.value), source: head.alternate.source ?? null, numerator: head.alternate.numerator, denominator: head.alternate.denominator } : null,
        precedence,
        meetTarget: evaluateMeetTarget(latestValue, target, policy.direction),
        undeterminedReason: undeterminedReason(latestValue, target, policy.direction),
        achievementPercent: achievementPercent(latestValue, target, policy.direction),
        /**
         * 원내 구조화 원장과의 대조 근거. 매핑이 없거나 세지 못했으면 `null` —
         * 그 지표에 대해서는 화면이 아무 말도 하지 않는다(추정한 원장은 거짓 경보가 된다).
         */
        ledger: ledgers.get(normalizeIndicatorKey(i.name)) ?? null,
        /** 실제로 쓰이는 공급원(등재된 키 우선 · 없으면 이름 정규형) — 월 마감·미리보기와 같은 규칙(2026-10-10) */
        effectiveSupplierKey: i.supplierKey && i.supplierKey in QI_SUPPLIERS ? i.supplierKey : qiSupplierByName(normalizeIndicatorKey(i.name)),
      };
    });
  }
}
