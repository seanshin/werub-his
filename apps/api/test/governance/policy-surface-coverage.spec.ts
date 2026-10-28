import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULTS as CONFIG_DEFAULTS } from '../../src/modules/config/config-runtime.service';
import { DECISION_REGISTRY } from '../../src/modules/decision-registry/decision.registry';

/**
 * 정책성 표면 거버넌스 커버리지 (2026-08-28 · 계획서 §1.1-c · P1-b).
 *
 * 🔴 실측: 정책성(게이트형) 설정 36개 중 **27개가 담당도 결정 근거도 없이 동작 중**이었다.
 *    소비처를 하나씩 읽어 성격을 가르니 **21개가 결정 사안**이고 6개는 아니었다.
 *
 * 이 가드가 지키는 것:
 *   ① 21건의 **담당이 등재된 채로 있다**(빠지면 화면이 다시 `거버넌스 미등재` 로 침묵한다)
 *   ② 🔴 보안 강제 3건은 **결정 사안이 아니라 상시 ON 요구사항**이다 — 기본값이 내려가면 실패
 *   ③ 새로 등재한 결정 2건이 살아 있다
 */
const SVC = fs.readFileSync(
  path.join(__dirname, '../../src/modules/gld/governance.service.ts'), 'utf-8');

/** P1-b 로 담당을 등재한 21건 — 판정 결과 그대로 */
const GOVERNED_21 = [
  // 임상 안전 게이트 4
  'nursing.bcma.enforce', 'bloodBank.bedsideScan.enforce', 'surgery.preAnesthesiaGate', 'inpatient.dischargeGate',
  // AI 임상 기능 6
  'ai.server.enabled', 'scribe.enabled', 'voiceEmr.enabled',
  'voiceEmr.ambient.enabled', 'voiceEmr.ambient.aiDraft.enabled', 'nursing.aiAssist.enabled',
  // 기록 문서 전자결재 4
  'approval.clinicalNote.enabled', 'approval.clinicalCertificate.enabled',
  'approval.consent.enabled', 'approval.recordCopy.enabled',
  // 대외 전송 3 + 수신 1
  'pacs.exportEnabled', 'erp.webhookEnabled', 'ess.payrollRelay.enabled', 'fhir.serviceRequestInbound.enabled',
  // 청구 2 · 사업 1
  'billing.copayCap.preCoverageEnabled', 'inpatient.stayBilling.enabled', 'blockchain.selfIssuanceEnabled',
];

/**
 * 🔴 **결정 사안이 아닌 것 — 상시 ON 이어야 하는 보안 요구사항.**
 *
 * "끌지 말지를 위원회가 정한다"는 것 자체가 이상하다. 거버넌스 대상으로 올리면
 * *위원회가 끌 수도 있는 것*처럼 보이고, 그 표현 자체가 위험하다.
 * 2026-08-28 실측: 셋 다 기본값이 `false` 여서 **새 환경은 IDOR 차단이 꺼진 채 시작**했다.
 */
const ALWAYS_ON_SECURITY = ['erp.targetAuthEnforce', 'lis.targetAuthEnforce', 'erp.financeWebhookEnforce'];

describe('P1-b — 21건의 담당이 등재돼 있다', () => {
  it('🔴 21건 전부 표면 매핑 시드에 있다 — 빠지면 화면이 다시 침묵한다', () => {
    const missing = GOVERNED_21.filter((k) => !SVC.includes(`'config:${k}'`));
    expect(missing, `담당 미등재: ${missing.join(', ')}`).toEqual([]);
  });

  it('🔴 담당 등재는 결정이 아니다 — 등재만으로 "정해졌다"고 말하지 않는다', () => {
    // 등재는 `거버넌스 미등재` → `의결 근거 없음` 으로 바꿀 뿐이다(§3.3 basisState)
    const gov = fs.readFileSync(path.join(__dirname, '../../../../packages/shared/src/decision-basis.ts'), 'utf-8');
    expect(gov).toContain('NO_DECISION');
    expect(gov).toContain('NOT_GOVERNED');
  });
});

describe('🔴 보안 강제 3건 — 결정 사안이 아니라 상시 ON', () => {
  for (const k of ALWAYS_ON_SECURITY) {
    it(`${k} 기본값이 true 다 — 내려가면 새 환경이 열린 채 시작한다`, () => {
      const def = (CONFIG_DEFAULTS as Record<string, { value: unknown }>)[k];
      expect(def, `${k} 가 기본값 목록에 없다`).toBeTruthy();
      expect(def.value, `${k} 를 false 로 되돌리면 IDOR·fail-open 이 기본이 된다`).toBe(true);
    });
  }

  it('🔴 이 3건을 위원회 담당으로 등재하지 않았다 — 끌 수 있는 것처럼 보이면 안 된다', () => {
    const wrong = ALWAYS_ON_SECURITY.filter((k) => SVC.includes(`'config:${k}'`));
    expect(wrong, `보안 요구사항을 결정 대상으로 올렸다: ${wrong.join(', ')}`).toEqual([]);
  });
});

describe('P1-b — 한 번도 물어본 적 없던 결정 2건', () => {
  const keys = DECISION_REGISTRY.map((d) => d.key);

  it('🔴 진료 음성 녹음의 적법 근거 — 원음이 수집되는데 등재된 적이 없었다', () => {
    expect(keys).toContain('legal.voiceRecording.basis');
    const d = DECISION_REGISTRY.find((x) => x.key === 'legal.voiceRecording.basis')!;
    // 허가권자 층이다 — 위원회가 대신 정할 수 없다
    expect(d.layer).toBe('LICENSE_HOLDER');
    expect(d.legalReview.length).toBeGreaterThan(0);
    expect(d.goLive).toBe('REQUIRED_BEFORE');
  });

  it('🔴 AI 임상 기능 범위 — 자동실행 범위와 다른 질문이다', () => {
    expect(keys).toContain('policy.ai.clinicalFeatureScope');
    const d = DECISION_REGISTRY.find((x) => x.key === 'policy.ai.clinicalFeatureScope')!;
    expect(d.layer).toBe('INTERNAL_COMMITTEE');
    // 선행 결정에 종속된다 — 앞지르지 못한다
    expect(d.dependsOn).toContain('legal.ai.deviceClassification');
    expect(d.dependsOn).toContain('legal.voiceRecording.basis');
  });

  it('🔴 선행이 하위 층을 가리키지 않는다(층 규칙)', () => {
    const layerOf = new Map(DECISION_REGISTRY.map((d) => [d.key, d.layer]));
    const rank = { STAFF: 1, INTERNAL_COMMITTEE: 2, LICENSE_HOLDER: 3 } as const;
    for (const d of DECISION_REGISTRY) {
      for (const dep of d.dependsOn ?? []) {
        const dl = layerOf.get(dep);
        if (!dl) continue;
        expect(rank[dl], `${d.key} → ${dep}: 하위 층을 선행으로 둘 수 없다`).toBeGreaterThanOrEqual(rank[d.layer]);
      }
    }
  });
});
