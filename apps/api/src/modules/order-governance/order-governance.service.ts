import { Injectable } from '@nestjs/common';
import {
  ACTIVE_TRACK_PHASES, ORDER_GOVERNANCE_STANDARDS,
  type ConfigSource, type OrderStandardCheck,
} from '@hospital-run/shared';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { GovernanceService } from '../gld/governance.service';
import { OrderTrackingService } from '../order/order-tracking.service';

/** 점검에 걸린 오더를 화면에 싣는 상한 — 넘으면 수만 말한다 */
const OFFENDER_LIMIT = 50;

type TrackingResult = Awaited<ReturnType<OrderTrackingService['getTracking']>>;
type TrackItem = TrackingResult['orders'][number];

export type StandardCheckResult =
  | { state: 'CHECKED'; numerator: number; denominator: number; offenders: { id: string; department: string; name: string | null; priority: string; phase: string; patient: TrackItem['patient']; sinceOrderedMin: number | null }[]; offendersTruncated: boolean }
  | { state: 'UNSET' }        // 기준(설정)이 없어 점검하지 않았다
  | { state: 'NO_CHECK' };    // 이 화면의 기록으로 셀 수 있는 점검이 없다(기준 표시만)

/**
 * 오더 위원회 기준 점검(2026-10-06 · `/orders` '위원회 기준').
 *
 * 🔴 담당 위원회·결정은 **거버넌스 정본**(`GovernanceService.provenance` — 표면 매핑 + 집행 액션 체인)을 그대로 쓴다.
 *    3상태: DECIDED(의결·결정 있음) · NO_DECISION(담당 위원회는 있으나 의결 없음) · NOT_GOVERNED(담당 미지정).
 * 🔴 값은 설정 정본의 출처와 함께(db·env·default·unset) — 기본값을 의결된 권고처럼 말하지 않는다.
 * 🔴 점검은 **셀 수 있는 것만**(분자·분모) — 셀 기록이 없는 기준은 표시만 하고 "점검 없음"이라 말한다.
 *    모집단은 오더 실시간 추적과 같다(고른 날 발행분 + 끝나지 않은 오더).
 */
@Injectable()
export class OrderGovernanceService {
  constructor(
    private readonly tracking: OrderTrackingService,
    private readonly governance: GovernanceService,
    private readonly config: ConfigRuntimeService,
  ) {}

  private static check(kind: OrderStandardCheck | null, t: TrackingResult): StandardCheckResult {
    if (!kind) return { state: 'NO_CHECK' };
    let pool: TrackItem[]; let hit: (o: TrackItem) => boolean;
    switch (kind) {
      case 'ATTENTION':
        if (!t.attention.configured) return { state: 'UNSET' };
        pool = t.orders.filter((o) => o.phase === 'WAITING' || o.phase === 'IN_PROCESS');
        hit = (o) => o.attention === true;
        break;
      case 'DUR_OVERRIDE':
        pool = t.orders.filter((o) => o.dur?.warned === true);
        hit = (o) => o.dur?.overridden === true;
        break;
      case 'CRITICAL_UNACK':
        pool = t.orders.filter((o) => o.department === 'LAB' && o.critical);
        hit = (o) => o.phase === 'RESULT_UNACK';
        break;
    }
    const offenders = pool.filter(hit);
    return {
      state: 'CHECKED',
      numerator: offenders.length,
      denominator: pool.length,
      offenders: offenders.slice(0, OFFENDER_LIMIT).map((o) => ({
        id: o.id, department: o.department, name: o.name, priority: o.priority, phase: o.phase, patient: o.patient,
        sinceOrderedMin: (ACTIVE_TRACK_PHASES as readonly string[]).includes(o.phase) ? o.sinceOrderedMin : null,
      })),
      offendersTruncated: offenders.length > OFFENDER_LIMIT,
    };
  }

  async getCheck(date?: string, now: Date = new Date()) {
    const t = await this.tracking.getTracking(date, undefined, now);
    const standards = await Promise.all(ORDER_GOVERNANCE_STANDARDS.map(async (std) => {
      const [prov, value] = await Promise.all([
        this.governance.provenance(std.surfaceKey),
        std.surfaceKey.startsWith('config:') ? this.config.getWithSource(std.surfaceKey.slice('config:'.length)) : Promise.resolve(null),
      ]);
      const latest = prov.chain[0] ?? null;
      return {
        surfaceKey: std.surfaceKey,
        label: std.label,
        depts: std.depts,
        checkKind: std.check,
        value: value ? { value: value.value, source: value.source as ConfigSource } : null,
        basis: {
          state: prov.basisState,
          owners: prov.owners.map((o) => ({ code: o.code, name: o.name })),
          latest: latest ? {
            source: latest.source,
            registryKey: latest.registryKey ?? null,
            decisionNo: latest.decision?.decisionNo ?? null,
            status: latest.decision?.status ?? latest.action.status,
            resolvedAt: latest.decision?.resolvedAt ?? null,
            resolution: latest.decision?.resolution ? latest.decision.resolution.slice(0, 200) : null,
            committee: latest.decision?.committee ?? null,
          } : null,
          decisions: prov.chain.length,
        },
        check: OrderGovernanceService.check(std.check, t),
      };
    }));

    // 위원회별 묶음 — 합동 담당이면 두 위원회 모두에 나온다 · 담당 미지정은 따로
    const byCode = new Map<string, { code: string | null; name: string; standards: typeof standards }>();
    const unassigned: typeof standards = [];
    for (const s of standards) {
      if (!s.basis.owners.length) { unassigned.push(s); continue; }
      for (const o of s.basis.owners) {
        const key = o.code ?? o.name;
        const g = byCode.get(key) ?? { code: o.code, name: o.name, standards: [] };
        g.standards.push(s); byCode.set(key, g);
      }
    }
    const checked = standards.filter((s) => s.check.state === 'CHECKED');
    return {
      date: t.date,
      now: t.now,
      population: t.population,
      truncated: t.truncated,
      total: t.total,
      committees: [...byCode.values()],
      unassigned,
      summary: {
        standards: standards.length,
        decided: standards.filter((s) => s.basis.state === 'DECIDED').length,
        noDecision: standards.filter((s) => s.basis.state === 'NO_DECISION').length,
        notGoverned: standards.filter((s) => s.basis.state === 'NOT_GOVERNED').length,
        checked: checked.length,
        unset: standards.filter((s) => s.check.state === 'UNSET').length,
        withFindings: checked.filter((s) => s.check.state === 'CHECKED' && s.check.numerator > 0).length,
      },
    };
  }
}
