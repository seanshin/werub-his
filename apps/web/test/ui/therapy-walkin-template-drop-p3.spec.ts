/**
 * P3 (2026-09-15)
 *  ③ 워크인 치료 등록(PatientAddModal) — 치료 모드의 `instructions` 상태는 **고른 치료 유형**이다(자유 입력칸 없음).
 *     종전엔 아무것도 고르지 않으면 `'운동치료'` 로 채워 오더를 만들었다(고르지 않은 치료가 대기열에 섰다).
 *  ④ 치료일정 템플릿 저장 — 서버가 버린 항목(`droppedItems`)을 화면이 행 번호로 말한다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../src', p), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('③ 워크인 치료 — 고르지 않은 치료 유형을 지어내지 않는다', () => {
  const modal = src('components/workstation/PatientAddModal.tsx');
  const therapyPost = modal.slice(modal.indexOf("'/api/v1/workstation/therapy/orders'"), modal.indexOf("'/api/v1/workstation/therapy/orders'") + 420);

  it('대조군 — 치료 오더 전송부를 실제로 잘라냈다', () => {
    expect(therapyPost).toContain('therapyType');
    expect(therapyPost).toContain('stationId');
  });

  it('🔴 치료 유형·지시문에 문자열 기본값(`|| \'…\'`)을 붙이지 않는다', () => {
    expect(therapyPost).not.toMatch(/therapyType:\s*instructions\s*\|\|/);
    expect(therapyPost).not.toMatch(/instructions:\s*instructions\s*\|\|/);
    expect(therapyPost).not.toContain("'운동치료'");
  });

  it('🔴 유형을 고르기 전에는 제출이 막힌다 — 고른 값은 THERAPY_TYPES 안의 것만', () => {
    expect(modal).toMatch(/const therapyTypeChosen = THERAPY_TYPES\.includes\(instructions\)/);
    expect(modal).toMatch(/disabled=\{submitting \|\| \(stationType === 'therapy' && !therapyTypeChosen\)\}/);
    expect(modal).toMatch(/if \(!therapyTypeChosen\) throw new Error/);
  });
});

describe('④ 치료일정 템플릿 — 버린 항목을 말한다', () => {
  const page = src('app/(main)/admin/treatment-templates/page.tsx');

  it('저장 응답의 droppedItems 를 읽어 경고한다(성공 토스트만 띄우지 않는다)', () => {
    expect(page).toMatch(/const dropped = droppedItemsOf\(res\)/);
    expect(page).toMatch(/if \(dropped\.length\) toast\.warning\(/);
    expect(page).toContain("tAttr('제목이 비었거나 유형을 알 수 없어 저장하지 않은 항목')");
  });
});
