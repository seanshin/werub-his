import { Injectable, Optional } from '@nestjs/common';
import { QI_FLOW_SETTING_KEYS, allowedAccreditationFrameworks, harmLevelsOf } from '@hospital-run/shared';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface QiFlowSettingRow {
  key: string;
  decisionKey: string;
  value: unknown;
  /** db = 의결·관리자가 정한 값 · default = 아무도 정하지 않아 기본값 · env = 환경 덮어쓰기 · unset = 값 없음 · error = 읽기 실패 */
  source: 'db' | 'default' | 'env' | 'unset' | 'error';
  /**
   * DB 값이 어떻게 들어왔나(2026-10-09) — 위원회 의결 집행(ENACTED) · 관리자 직접 변경(DIRECT) · 확인 불가(UNKNOWN).
   * 🔴 관리자가 범용 설정 화면에서 바꾼 값을 "정해짐"으로만 그리면 위원회가 의결한 것처럼 읽힌다(하위가 상위를 대체한 것을 가린다).
   */
  /** SEED — 개발 시드가 넣은 행(2026-10-27 · 관리자 직접 변경도 위원회 의결도 아니다) */
  provenance?: { by: 'ENACTED' | 'DIRECT' | 'SEED' | 'UNKNOWN'; at: string | null; decisionNo?: string | null; registryKey?: string | null };
}

/**
 * QI 흐름 사람 결정 현황(읽기만 · 2026-10-08).
 * 화면이 "결정 전이라 닫혀 있다·기본값으로 떨어져 있다"를 그 자리에서 말하게 한다.
 * 🔴 읽기 실패를 기본값으로 접지 않는다(source 'error') · 바꾸는 길은 위원회 의결(집행 엔진)뿐 — 여기엔 쓰기가 없다.
 */
@Injectable()
export class QiFlowSettingsService {
  constructor(
    @Optional() private readonly config?: ConfigRuntimeService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  /** DB 값의 출처 — 마지막 변경과 같은 값을 마지막으로 집행한 의결이 있으면 ENACTED, 아니면 DIRECT */
  private async provenance(key: string, value: unknown): Promise<QiFlowSettingRow['provenance']> {
    if (!this.prisma) return { by: 'UNKNOWN', at: null };
    try {
      const [row, action] = await Promise.all([
        this.prisma.systemConfig.findUnique({ where: { key }, select: { updatedAt: true } }),
        this.prisma.decisionAction.findFirst({
          where: { kind: 'CONFIG_CHANGE', status: 'ENACTED', target: { path: ['key'], equals: key } },
          orderBy: { enactedAt: 'desc' },
          select: { enactedAt: true, target: true, registryKey: true, decision: { select: { decisionNo: true } } },
        }),
      ]);
      const at = row?.updatedAt ?? null;
      const enactedValue = (action?.target as { newValue?: unknown } | null)?.newValue;
      // 집행은 설정 저장 직후 원장을 갱신한다 — 집행 시각이 마지막 변경 이후(오차 1분)이고 값이 같을 때만 의결 반영으로 본다
      if (action?.enactedAt && at && action.enactedAt.getTime() >= at.getTime() - 60_000 && JSON.stringify(enactedValue) === JSON.stringify(value)) {
        return { by: 'ENACTED', at: action.enactedAt.toISOString(), decisionNo: action.decision?.decisionNo ?? null, registryKey: action.registryKey ?? null };
      }
      return { by: 'DIRECT', at: at ? at.toISOString() : null };
    } catch {
      return { by: 'UNKNOWN', at: null };
    }
  }

  async read() {
    const rows: QiFlowSettingRow[] = await Promise.all(
      QI_FLOW_SETTING_KEYS.map(async ({ key, decisionKey }) => {
        if (!this.config) return { key, decisionKey, value: null, source: 'error' as const };
        try {
          const r = await this.config.getWithSource(key);
          const source = r.source as QiFlowSettingRow['source'];
          // 🔴 개발 시드 행을 "관리자 직접 변경"으로 말하지 않는다(종전 27행이 그렇게 보였다)
          const provenance = source !== 'db' ? null : r.seeded ? { by: 'SEED' as const, at: null } : await this.provenance(key, r.value);
          return { key, decisionKey, value: r.value ?? null, source, ...(provenance ? { provenance } : {}) };
        } catch {
          return { key, decisionKey, value: null, source: 'error' as const };
        }
      }),
    );
    const val = (k: string) => rows.find((r) => r.key === k && r.source !== 'error')?.value ?? null;
    // 기구 원장 전수 기록 시작일 — 결정이 아니라 감염관리실이 선언하는 운영 사실(설정) · 실패는 'error'
    let deviceLedgerCoverage: { value: unknown; source: QiFlowSettingRow['source'] } = { value: null, source: 'error' };
    if (this.config) {
      try { const c = await this.config.getWithSource('qi.deviceLedger.coverageFrom'); deviceLedgerCoverage = { value: c.value ?? null, source: c.source as QiFlowSettingRow['source'] }; } catch { /* 'error' 유지 */ }
    }
    return {
      rows,
      deviceLedgerCoverage,
      harmLevels: harmLevelsOf(val('safety.harmLevelScale')),
      accreditationFrameworks: allowedAccreditationFrameworks(val('accreditation.framework')),
    };
  }
}
