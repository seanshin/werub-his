import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { EligibilityProvider, EligibilityInput, EligibilityResult } from './eligibility.types';
import { ageOf } from '@hospital-run/shared';

/**
 * 자격조회 시뮬레이션 어댑터 — 환자 데이터 기반 **결정적** 응답.
 * 실 환자로 다양한 케이스(의료급여 종별·차상위·산정특례·자격상실·미발견)를 재현.
 * 실연동(NHIS) 전까지 접수→자격→본인부담→영수 전체 흐름 검증용. source=SIMULATION 명시.
 */
@Injectable()
export class SimulationEligibilityProvider implements EligibilityProvider {
  readonly source = 'SIMULATION' as const;

  async check(input: EligibilityInput): Promise<EligibilityResult> {
    // 결정적 시드: patientId(+보험번호 있으면 가산). insuranceType이 1차 신호(환자는 해당 자격으로 등록됨).
    const seed = parseInt(
      createHash('sha256').update(`${input.patientId}:${input.insuranceNumber ?? 'enrolled'}`).digest('hex').slice(0, 8),
      16,
    );
    const bucket = seed % 100;
    const today = new Date();
    const startDate = new Date(today.getFullYear() - 2, 0, 1).toISOString().slice(0, 10);

    // 소수(3%) 자격 미발견 시나리오(가입정보 불일치 검증용)
    if (bucket < 3) {
      return { status: 'NOT_FOUND', copayCategory: 'NHI', message: '보험 가입정보를 찾을 수 없습니다(시뮬레이션).', source: this.source };
    }

    // 산재/자보/자비는 제3자/비급여 — 그대로 통과
    if (input.insuranceType === 'INDUSTRIAL') return this.ok('INDUSTRIAL', startDate, '산재보험(시뮬레이션)');
    if (input.insuranceType === 'AUTO') return this.ok('AUTO', startDate, '자동차보험(시뮬레이션)');
    if (input.insuranceType === 'SELF_PAY') return this.ok('SELF_PAY', startDate, '자비(시뮬레이션)');

    // 의료급여 → 보험번호 해시 짝/홀로 1종/2종 교번
    if (input.insuranceType === 'MEDICAID') {
      const cat = bucket % 2 === 0 ? 'MA_TYPE1' : 'MA_TYPE2';
      return this.ok(cat, startDate, `의료급여 ${cat === 'MA_TYPE1' ? '1종' : '2종'}(시뮬레이션)`);
    }

    // 건강보험(NHI)
    /**
     * 🔴 종전 계산은 **연도 차이만** 봤다(생일 전이면 한 살 많게 나온다) — `age >= 65` 가
     *    산정특례를 정하므로 **본인부담 경계에서 한 살이 어긋났다.**
     * 🔴 그리고 생년월일이 없으면 `0`(신생아)으로 떨어졌다 — **모르는 것과 0세는 다른 사실**이고,
     *    0세는 완전히 다른 자격 규칙을 탄다. 정본은 모르면 `null` 로 답한다.
     */
    const age = ageOf(input.dateOfBirth ?? null);

    // 자격상실 시나리오(bucket 3~7, 검증용) — 전액 본인부담 유도
    if (bucket < 8) {
      const endDate = new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
      return { status: 'EXPIRED', copayCategory: 'NHI', coverageStartDate: startDate, coverageEndDate: endDate, message: '건강보험 자격이 상실되었습니다(시뮬레이션).', source: this.source };
    }
    // 산정특례(암 V027 등) — 고령 또는 특정 해시
    // 🔴 나이를 모르면 고령 특례로 넘기지 않는다(모르는 것을 근거로 혜택을 정하지 않는다)
    if ((age !== null && age >= 65) || (bucket >= 90)) {
      const expiry = new Date(today.getFullYear() + 3, today.getMonth(), today.getDate()).toISOString().slice(0, 10);
      return {
        status: 'VERIFIED', copayCategory: 'SPECIAL_EXEMPTION', coverageStartDate: startDate,
        specialExemption: 'V027', exemptionExpiry: expiry, message: '산정특례 등록자(시뮬레이션)', source: this.source,
      };
    }
    // 차상위 일부
    if (bucket >= 80) return this.ok('NEAR_POOR', startDate, '차상위계층(시뮬레이션)');
    // 기본 건강보험
    return this.ok('NHI', startDate, '건강보험 자격확인(시뮬레이션)');
  }

  private ok(copayCategory: EligibilityResult['copayCategory'], startDate: string, message: string): EligibilityResult {
    return { status: 'VERIFIED', copayCategory, coverageStartDate: startDate, message, source: this.source };
  }
}
