import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **자기게이팅 화면도 대조 대상이다** (2026-08-31 · 발굴 34회차).
 *
 * 역할×EP 스캔은 "화면이 스스로 역할 분기한다"는 이유로 44화면을 제외했는데,
 * **그 분기가 서버와 일치하는지**는 아무도 확인한 적이 없었다. 미검증 16화면을
 * 기계 대조 + 수동 판독으로 훑어 셋을 찾았다:
 *
 * ① `/orders` "처방 완료 (서명+수납)" — 서명(의사 전용)이 먼저라 **의사만 누를 수 있는
 *    버튼**인데, 뒤이은 수납 생성 EP 에 DOCTOR 가 없어 **언제나 403** 이었고
 *    `catch {}` 가 그것을 삼켜 "수납"까지 됐다고 말했다(P16 — 실행 없이 성공 기록).
 *    운영 실측: 최근 3달 의사 서명 178건 중 무청구 8건.
 * ② 수납 생성 EP 에 DOCTOR 를 열었다 — 서명=청구 트리거(encounter.service 규약),
 *    금액은 서버 자동 산정, 중복은 `Billing already exists` 로 차단돼 있다.
 * ③ `/inpatient` "전동" 버튼 — 게이팅 없이 의사에게도 보였는데 서버는 `[NURSE, ADMIN]`.
 *    병상 이동은 병동 운용이라 서버가 옳다(/beds 상태 변경과 같은 판정) — 화면이 숨긴다.
 *
 * 오탐으로 접은 것(가드 없음): `/consult` 는 `ConsultAgentGuard`(전용 자격 축) ·
 * `/quality` 는 `@RequirePermission(QI_MEASURE_WRITE)` · `/remote-consult`·`/my-certificate` 의
 * ADMIN 분기는 부가 패널용이라 정당.
 */
const api = (p: string) => readFileSync(join(process.cwd(), 'src/modules', p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const web = (p: string) => readFileSync(join(process.cwd(), '..', 'web', 'src', p), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('🔴 처방 완료가 수납 실패를 삼키지 않는다', () => {
  const s = web('app/(main)/orders/page.tsx');

  it('billing 호출 실패가 catch {} 로 사라지지 않는다', () => {
    expect(s, '실패를 삼키는 catch 가 되살아났다')
      .not.toMatch(/billing`, \{\}\); \} catch \{\}/);
    expect(s).toContain('수납 생성 실패');
  });

  /**
   * 🔴 **UI 언어 배선(2026-09-09)이 이 가드를 죽일 뻔했다.** 문구가 `<T k="원문" />`·`tAttr('원문')`
   *    으로 감싸이면 ① 긍정 단언은 패턴이 어긋나 실패하고 ② **부정 단언은 조용히 통과한다**
   *    (`toast.success('…')` 형태가 사라졌을 뿐 문구는 그대로 남아 있는데 가드는 초록).
   *    그래서 둘 다 **호출 형태가 아니라 문구 자체**를 본다 — 원문이 곧 i18n 키라 항상 검색된다.
   */
  it('서명과 수납을 갈라 말한다 — "서명+수납" 뭉뚱그린 성공 문구를 쓰지 않는다', () => {
    // 어떤 형태로도(생문자열·tAttr·<T k>) 뭉뚱그린 문구가 없어야 한다
    expect(s, '뭉뚱그린 "서명+수납" 문구가 되살아났다').not.toContain('처방 완료 (서명+수납)');
    // 서명 성공 토스트가 수납 결과(billingMsg)를 함께 말한다 — 감싸기와 무관하게 같은 줄에서 확인
    expect(s).toMatch(/처방 서명 완료[^\n]*\$\{billingMsg\}/);
  });

  it('이미 수납이 있으면 실패가 아니라 그 사실을 말한다', () => {
    expect(s).toContain('수납 이미 존재');
  });
});

describe('🔴 수납 생성 EP — 의사가 서명하며 트리거할 수 있다', () => {
  it('DOCTOR 가 열려 있다', () => {
    const b = api('billing/billing.controller.ts');
    const i = b.indexOf("@Post('encounters/:encounterId/billing')");
    expect(i).toBeGreaterThan(-1);
    expect(b.slice(i, i + 300)).toMatch(/UserRole\.DOCTOR/);
  });

  it('🔴 중복 생성은 서버가 막는다(대조군 — 이것이 있어 의사를 열 수 있었다)', () => {
    const svc = api('billing/billing.service.ts');
    expect(svc).toContain('Billing already exists for this encounter');
  });
});

describe('🔴 병상 이동(전동)은 간호 버튼이다', () => {
  it('화면이 isNurse 로 감싼다 — 의사에게 403 버튼을 띄우지 않는다', () => {
    const s = web('app/(main)/inpatient/page.tsx');
    expect(s).toMatch(/isNurse && <button\s*\n\s*onClick=\{\(\) => handleTransfer/);
  });

  it('서버는 그대로 NURSE·ADMIN 이다(대조군 — 화면 때문에 서버를 넓히지 않았다)', () => {
    const c = api('inpatient/inpatient.controller.ts');
    const i = c.indexOf("@Patch('inpatient/:id/transfer')");
    const blk = c.slice(i, i + 200);
    expect(blk).toMatch(/@Roles\(UserRole\.NURSE, UserRole\.ADMIN\)/);
    expect(blk).not.toMatch(/UserRole\.DOCTOR/);
  });
});
