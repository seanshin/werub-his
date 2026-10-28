import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ENT 진료 폼 정직성 가드 (2026-08-25 · 입력 보조 P3 심사에서 적발 → 봉합)
 *
 * 🔴 결함 1 (P16): 청력도가 정상 청력(20~30dB)으로, 고막·비강·인후가 '정상'류로 **채워진 채** 시작 —
 *    측정·검진하지 않으면 정상 소견이 저장됐다(간호초기평가 '전부 정상'과 동일 유형).
 * 🔴 결함 2 (P11): 폼 키(ptaOd·septum·tonsilGrade·plan…)가 DTO(ptaRight·nasalEndoscopy·pharynxExam·notes)와
 *    달라 전역 whitelist 가 **조용히 지웠다** — PTA·어음·비강·인후·계획이 성공 토스트와 함께 사라졌다.
 */
const SRC = path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'patients', '[id]', 'encounter', 'new', 'components', 'EntEncounterLayout.tsx');
const src = fs.readFileSync(SRC, 'utf8');

describe('초기값은 미측정/미검진 (P16 재주입 차단)', () => {
  it("🔴 defaultForm 에 '정상'·'없음'·Grade 초기값이 없다", () => {
    const block = src.match(/const defaultForm[\s\S]*?\};/)?.[0] ?? '';
    expect(block).not.toContain("'정상'");
    expect(block).not.toContain("'없음'");
    expect(block).not.toContain("'Grade"); // 값 리터럴만 — 키 이름 tonsilGrade 는 정당
    expect(block).not.toContain("lightReflex: '+'");
  });

  it('🔴 청력도가 빈 차트로 시작한다 — 정상값 배열로 되돌리면 실패', () => {
    expect(src).not.toMatch(/DEFAULT_AUDIO/);
    const block = src.match(/const defaultForm[\s\S]*?\};/)?.[0] ?? '';
    expect(block).toContain('audiogramRight: []');
    expect(block).toContain('audiogramLeft: []');
  });

  it('대조군 — 미검진 옵션이 각 select 에 있다(미검진≠정상을 고를 수 있다)', () => {
    // 🔴 UI 언어 전환(P2c-1)으로 라벨이 `<T k="미검진" />` 렌더 부품을 지난다 — **표기 형태만** 넓히고
    //    조준(빈 value + '미검진' 라벨 · 8개 이상)은 그대로다. 옵션을 지우거나 value 를 바꾸면 여전히 실패한다.
    const n = (src.match(/<option value="">(?:미검진|<T k="미검진" \/>)<\/option>/g) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(8);
  });
});

describe('페이로드가 서버 계약(DTO)대로 나간다 (P11 재주입 차단)', () => {
  it('🔴 PTA·어음이 DTO 키로 매핑된다 — 폼 키를 그대로 보내면 whitelist 가 지운다', () => {
    expect(src).toMatch(/set\('ptaRight', num\(f\.ptaOd\)\)/);
    expect(src).toMatch(/set\('ptaLeft', num\(f\.ptaOs\)\)/);
    expect(src).toMatch(/set\('speechRight', num\(f\.speechOd\)\)/);
    expect(src).toMatch(/set\('speechLeft', num\(f\.speechOs\)\)/);
  });

  it('🔴 비강·인후가 DTO JSON 필드로, 내부 키는 읽는 쪽 정본(turbinate{left,right})으로', () => {
    expect(src).toContain('out.nasalEndoscopy = nasal');
    expect(src).toContain('out.pharynxExam = pharynx');
    expect(src).toMatch(/left: f\.turbinateLeft, right: f\.turbinateRight/);
  });

  it('plan → notes 매핑 · DTO 에 없는 soap 키를 보내지 않는다(어차피 버려졌고 SOAP 정본은 진료 차트 경로)', () => {
    expect(src).toMatch(/out\.notes = f\.plan/);
    expect(src).not.toMatch(/soap: soapCombined/);
  });

  it('대조군 — 미검진(빈 값)은 보내지 않는다: 검진했는데 무소견과 구분돼야 한다', () => {
    expect(src).toMatch(/filter\(\[?\(?,? ?i?v?\]?\)? ?=> ?iv !== ''\)|filter\(\(\[, iv\]\) => iv !== ''\)/);
    expect(src).toContain("if (f.diagnosis !== '') out.diagnosis = f.diagnosis");
  });
});
