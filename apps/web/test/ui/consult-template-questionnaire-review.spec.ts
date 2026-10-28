/**
 * 🔴 (2026-09-14) R4 화면 규약 — 소스 구조 가드.
 *  ① 상담 데스크 빠른답변은 입력칸에 넣기만 한다 — insertTemplate 본문에 전송 호출(apiClient.post/send) 없음
 *  ② 템플릿 조회 실패를 '등록된 빠른답변 없음'으로 그리지 않는다(실패 분기 문구가 따로 있다)
 *  ③ 팀장 콘솔 부서 이관은 route EP 를 부르고, 이관이 환자에게 보이지 않는다는 사실을 화면이 말한다
 *  ④ 문진 검토 — 환자 탭·외래 진료 패널 모두 "검토 완료 ≠ 임상 기록 확정" 문구와 검토자·시각 표시를 갖는다
 *  ⑤ 대조군 — 데스크의 실제 전송 함수(send)는 여전히 apiClient.post 를 부른다(탐지기가 죽지 않았다)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../../src/app/(main)');
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const bodyOf = (src: string, name: string) => {
  const i = src.indexOf(`const ${name} = `);
  if (i < 0) return '';
  const j = src.indexOf('\n  };\n', i);
  return src.slice(i, j < 0 ? i + 800 : j);
};

describe('R4 — 빠른답변·부서 이관·문진 검토 화면', () => {
  const desk = read('consult/page.tsx');
  const lead = read('consult/lead/page.tsx');

  it('① 빠른답변 삽입은 전송하지 않는다', () => {
    const b = bodyOf(desk, 'insertTemplate');
    expect(b).toContain('setInput(');
    expect(b).not.toMatch(/apiClient\.(post|put|patch)|send\(/);
  });

  it('⑤ 대조군 — 실제 전송 함수는 apiClient.post 를 부른다', () => {
    expect(bodyOf(desk, 'send')).toMatch(/apiClient\.post/);
  });

  it('② 템플릿 조회 실패와 0건을 다른 문구로 말한다', () => {
    expect(desk).toMatch(/['"]빠른답변을 불러오지 못했습니다['"]/);
    expect(desk).toMatch(/['"]등록된 빠른답변 없음['"]/);
    expect(desk).toMatch(/state: 'error'/);
  });

  it('③ 부서 이관은 route EP 를 부르고 환자 비노출을 말한다', () => {
    expect(lead).toMatch(/\/api\/v1\/consult\/lead\/sessions\/\$\{id\}\/route/);
    expect(lead).toContain('환자에게는 보이지 않습니다');
  });

  it('④ 문진 검토 — 두 화면 모두 확정 아님 문구·검토자·시각을 그린다', () => {
    for (const p of ['patients/[id]/components/QuestionnaireTab.tsx', 'patients/[id]/encounter/new/page.tsx']) {
      const s = read(p);
      expect(s, p).toContain('검토 완료는 응답을 읽었다는 표시이며 임상 기록 확정이 아닙니다');
      expect(s, p).toContain('검토 {검토자} · {시각}');
      expect(s, p).toMatch(/admin\/questionnaire\/review\//);
    }
  });
});
