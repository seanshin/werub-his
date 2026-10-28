import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 자동 매핑이 **다섯 가지 사실을 하나로 뭉치고** 있었다(2026-08-26 사람 신고).
 *
 * 실측: 진단코드 `5A11 제2형 당뇨병` 에 자동 매핑을 걸면 SNOMED CT·LOINC·MedDRA 가 전부 "해당 없음".
 *  · LOINC(검사 관찰)·ICD10PCS(시술)는 **애초에 진단에 해당하지 않는다** — 갭이 아닌데 갭으로 셌다
 *  · SNOMED CT 는 실재하는 개념인데 못 찾았다 — 그것이 "해당 없음"과 같은 얼굴이었다
 *  · AI 호출 실패도 `catch → []` 로 삼켜져 같은 "해당 없음"이 됐다
 *
 * 🔴 그리고 **검증할 표준 코드 사전이 이 저장소에 없다**(SNOMED/LOINC/MedDRA 마스터 모델 부재).
 *    AI 가 낸 코드가 실재하는지 확인할 수 없으므로 **자동 확정하지 않는다**.
 */
const SVC = join(process.cwd(), 'src/modules/code-master/auto-mapper.service.ts');
const src = readFileSync(SVC, 'utf8');

describe('자동 매핑은 모르는 것을 없다고 말하지 않는다', () => {
  it('상태가 다섯으로 갈려 있다(FAILED 하나로 뭉치지 않는다)', () => {
    for (const st of ['NOT_APPLICABLE', 'NO_CANDIDATE', 'LOW_CONFIDENCE', 'ERROR', 'PENDING']) {
      expect(src, `${st} 상태가 없다`).toContain(`'${st}'`);
    }
  });

  it('🔴 AI 실패를 삼키지 않는다 — 빈 배열로 돌려주지 않는다', () => {
    const ai = src.slice(src.indexOf('private async aiBasedMap'), src.indexOf('private async aiBasedMap') + 2200);
    expect(ai, 'catch 에서 빈 배열을 돌려주고 있다').not.toMatch(/catch[\s\S]{0,200}return \[\];/);
    expect(ai).toMatch(/throw e instanceof Error/);
  });

  it('🔴 실패 사유가 결과에 실린다(화면이 그대로 말할 수 있게)', () => {
    expect(src).toMatch(/reason\?: string/);
    expect(src).toContain('자동 매핑을 수행하지 못했습니다');
  });

  it('🔴 범주가 맞지 않으면 묻지 않고 NOT_APPLICABLE 로 말한다', () => {
    expect(src).toContain('private isApplicable');
    expect(src).toMatch(/isApplicable\(params\.sourceTable, targetSystem\)/);
  });

  it('진단에는 LOINC 을 묻지 않는다(범주 표가 실제로 그렇게 돼 있다)', () => {
    const fn = src.slice(src.indexOf('private isApplicable'), src.indexOf('private isApplicable') + 900);
    const diag = fn.slice(fn.indexOf("includes('diagnosis')"), fn.indexOf("includes('diagnosis')") + 120);
    expect(diag).not.toContain('LOINC');
    expect(diag).toContain('SNOMED_CT');
  });

  it('🔴 검증할 마스터가 없는 AI 제안은 자동 확정하지 않는다', () => {
    expect(src).toMatch(/const verifiable = best\.method !== 'AI_LLM'/);
    expect(src).toContain('사람 승인이 필요합니다');
  });

  it('🔴 대조군 — 규칙 기반(마스터 대조) 결과는 여전히 자동 확정된다(전부 막지 않았다)', () => {
    expect(src).toMatch(/verifiable && \(params\.autoConfirm \?\? true\)/);
    expect(src).toContain("status = 'CONFIRMED'");
  });

  it('대조군 — 모르는 소스 종류는 막지 않는다(새 코드종이 조용히 빠지지 않게)', () => {
    const fn = src.slice(src.indexOf('private isApplicable'), src.indexOf('private isApplicable') + 900);
    expect(fn).toMatch(/return true;/);
  });
});
