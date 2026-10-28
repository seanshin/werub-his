import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 **EP 를 만들면 부르는 화면까지가 한 벌이다.**
 *
 * 2026-08-26 사람이 앱을 훑으며 **같은 유형을 네 번** 신고했다 —
 * 서버에 등록 EP 가 있는데 그 이름을 단 화면은 **조회·확인만** 할 수 있었다:
 *   · `/handoffs` 인수인계 등록 없음(`POST /handoffs` 는 있고 다른 3화면이 부름)
 *   · `/consultations` 협진 의뢰 없음(`POST /consultations` 존재)
 *   · `/nutrition` 식이처방 등록이 **필수 2필드를 갖지 않아 항상 400**
 *   · `/rounds` 는 **본인 회진만** 보임
 *
 * 이 가드는 그 네 화면이 **다시 조회 전용으로 되돌아가지 않게** 못박는다.
 */
const WEB = join(process.cwd(), '../web/src/app/(main)');

const CASES: { screen: string; files: string[]; mustCall: RegExp; why: string }[] = [
  {
    screen: '/handoffs',
    files: ['handoffs/page.tsx', 'handoffs/new-handoff-form.tsx'],
    mustCall: /post\(\s*['"`]\/api\/v1\/handoffs['"`]/,
    why: '인수인계 화면이 등록을 못 하면 확인만 하는 화면이 된다',
  },
  {
    screen: '/consultations',
    files: ['consultations/page.tsx', 'consultations/new-consultation-form.tsx'],
    mustCall: /post\(\s*['"`]\/api\/v1\/consultations['"`]/,
    why: '협진 화면이 의뢰를 못 하면 받은 것만 처리하는 화면이 된다',
  },
  {
    screen: '/nutrition',
    files: ['nutrition/components/NutritionAdvanced.tsx'],
    mustCall: /post\(\s*['"`]\/api\/v1\/nutrition\/diet-orders['"`]/,
    why: '급양 화면이 식이처방을 못 내면 주방이 기본식만 낸다',
  },
  {
    screen: '/rounds',
    files: ['rounds/page.tsx', 'rounds/all-rounds-board.tsx'],
    mustCall: /['"`]\/api\/v1\/doctors\/rounds\/today\/all['"`]/,
    why: '회진 화면이 본인 것만 보이면 병동이 전체 진행을 알 수 없다',
  },
];

describe('등록 경로가 있는 화면', () => {
  it.each(CASES.map((c) => [c.screen, c] as const))('%s 는 쓰기 경로를 부른다', (_s, c) => {
    const src = c.files
      .map((f) => join(WEB, f))
      .filter((p) => existsSync(p))
      .map((p) => readFileSync(p, 'utf8'))
      .join('\n');
    expect(src.length, `${c.screen} 파일을 찾지 못했다`).toBeGreaterThan(0);
    expect(c.mustCall.test(src), `${c.screen}: ${c.why}`).toBe(true);
  });

  it('🔴 식이처방은 서버 필수 필드를 전부 보낸다 — 종전엔 두 개가 없어 항상 400 이었다', () => {
    const src = readFileSync(join(WEB, 'nutrition/components/NutritionAdvanced.tsx'), 'utf8');
    // 🔴 **payload 블록 안만** 본다. 첫 가드는 파일 전체를 훑어 폼 상태·select 에 있는 같은 이름을
    //    세는 바람에 **payload 에서 `admissionId` 를 지워도 통과**했다(가드가 헛돈 사례).
    const i = src.indexOf("post('/api/v1/nutrition/diet-orders'");
    expect(i, '식이처방 등록 호출을 찾지 못했다').toBeGreaterThan(0);
    const payload = src.slice(i, src.indexOf('}),', i));
    for (const k of ['admissionId', 'startDate', 'calorieTarget', 'proteinTarget']) {
      expect(payload, `식이처방 payload 에 ${k} 가 없다`).toMatch(new RegExp(`\\b${k}:`));
    }
    // 대조군: whitelist 가 지우던 옛 이름으로 되돌아가지 않았다
    expect(payload).not.toMatch(/\bcalories:/);
    expect(payload).not.toMatch(/\bprotein:/);
    // 대조군: 스프레드로 통째 보내지 않는다(폼 전용 키가 섞이면 조용히 지워진다)
    expect(payload).not.toMatch(/\.\.\.dietForm/);
  });

  it('🔴 회진 전체 현황은 담당의 미지정을 숨기지 않는다', () => {
    const src = readFileSync(join(WEB, 'rounds/all-rounds-board.tsx'), 'utf8');
    expect(src).toMatch(/담당의 미지정/);
    const svc = readFileSync(
      join(process.cwd(), 'src/modules/doctors/doctors.service.ts'),
      'utf8',
    );
    expect(svc).toMatch(/UNASSIGNED/);
  });

  it('🔴 협진 의뢰는 인라인 @Body 가 아니라 DTO 를 쓴다(검증이 실행된다)', () => {
    const ctrl = readFileSync(
      join(process.cwd(), 'src/modules/consultation/consultation.controller.ts'),
      'utf8',
    );
    expect(ctrl).toMatch(/@Body\(\)\s*dto:\s*CreateConsultationDto/);
    expect(existsSync(join(process.cwd(), 'src/modules/consultation/dto/create-consultation.dto.ts'))).toBe(true);
  });
});
