import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * W7 화면 가드 — ESS·급여명세 화면이 "사실이 아닌 것"을 다시 말하게 되는 재유입을 막는다.
 * 렌더 테스트는 apps/web 쪽이지만, 여기 등재된 것은 되돌아오면 즉시 실패해야 하는 두 계약이다.
 *   ① 화면이 근태 인증수단을 선언하지 않는다(하지 않은 생체인증을 법정 기록에 적지 않기 위해).
 *   ② 미발행 급여명세를 금액(0원)으로 렌더하지 않는다.
 */
const WEB = join(__dirname, '../../../web/src/app');
const ESS_COMPONENTS = join(WEB, '(main)/ess/_components');
const read = (p: string) => readFileSync(p, 'utf8');
/** 결함 회고 주석에는 원래의 잘못된 코드가 그대로 적혀 있다 — 가드는 실행되는 코드만 본다 */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('W7 화면 가드 — ESS·급여명세', () => {
  describe('① 근태 인증수단은 화면이 정하지 않는다 (P16)', () => {
    const owned = [
      join(ESS_COMPONENTS, 'EssContent.tsx'),
      join(ESS_COMPONENTS, 'AttendanceSelfServiceSection.tsx'),
      join(ESS_COMPONENTS, 'PayslipSection.tsx'),
      join(ESS_COMPONENTS, 'PayrollBasicsSection.tsx'),
      join(ESS_COMPONENTS, 'PayExtrasSection.tsx'),
    ].filter(existsSync);

    it('소유 화면 파일이 실제로 존재한다(경로 변경 시 가드가 조용히 통과하지 않도록)', () => {
      expect(owned.length).toBeGreaterThanOrEqual(3);
      expect(owned.some((p) => p.endsWith('EssContent.tsx'))).toBe(true);
    });

    it.each(owned)('%s — attendance/clock 호출에 method 를 싣지 않는다', (file) => {
      const src = code(file);
      if (!src.includes('attendance/clock')) return;
      // 🔴 원래 결함: method:'BIO' 하드코딩 → 생체 절차가 없는데 근태에 '생체'로 기록됐다.
      expect(src).not.toMatch(/attendance\/clock['"`][^)]*method\s*:/s);
    });

    it.each(owned)('%s — BIO 를 화면에서 선언하지 않는다', (file) => {
      expect(code(file)).not.toMatch(/method\s*:\s*['"]BIO['"]/);
    });
  });

  describe('② 미발행 급여명세를 0원으로 렌더하지 않는다 (P1)', () => {
    const file = join(ESS_COMPONENTS, 'PayslipSection.tsx');
    const src = () => code(file);

    it('금액 렌더는 issued 게이트를 통과해야 한다', () => {
      // 🔴 원래 결함: `slip &&` 만 보고 렌더 → issued:false 응답에 won(undefined) = "0원"
      expect(src()).toMatch(/slip\s*&&\s*issued\s*&&/);
      expect(src()).toMatch(/const\s+issued\s*=/);
    });

    it('숫자가 아닌 값을 0원으로 만들지 않는다(정본 포맷터가 — 를 낸다)', () => {
      expect(src()).toMatch(/Number\.isFinite/);
      expect(src()).not.toMatch(/\(n\s*\?\?\s*0\)\.toLocaleString/);
    });

    it('ERP 장애와 미발행을 서로 다른 문구로 말한다', () => {
      const s = src();
      expect(s).toMatch(/erpDown/);
      expect(s).toMatch(/notIssued/);
      expect(s).toMatch(/확정\(발행\) 전/);
      // 🔴 R59(2026-09-23) — 장애 문장은 한 문장("연결하지 못해")이 아니라 서버가 가른 사유(`failure`)를 ErpFailureNote 가 읽는다
      expect(s).toMatch(/<ErpFailureNote failure=\{r\?\.failure\}/);
      expect(s).toMatch(/급여명세를 확인할 수 없습니다/);
    });

    it('원천징수영수증 라벨은 응답 연도를 쓴다(요청 연도로 단정 금지)', () => {
      const s = src();
      expect(s).toMatch(/whReturnedYear/);
      expect(s).toMatch(/whLabelYear/);
      expect(s).toMatch(/whMismatch/);
    });
  });

  describe('③ 연차 잔여는 출처를 함께 말한다 (P12)', () => {
    const src = () => code(join(ESS_COMPONENTS, 'EssContent.tsx'));

    it('표시 정본의 출처 라벨과 불일치 안내가 있다', () => {
      const s = src();
      expect(s).toMatch(/BALANCE_SOURCE_KO/);
      expect(s).toMatch(/discrepancy/);
      expect(s).toMatch(/enforceRemaining/);
    });
  });
});
