/**
 * 🔴 외부 AI 가 가져갈 수 없는 URL 은 보내지 않는다.
 * 원 결함: 판독 워크스테이션이 상대경로 `/api/v1/pacs/wado?...` 를 `vision/analyze` 로 넘겼고,
 * WeRU.B 가 해석/인증에 실패한 응답이 "판독 소견"으로 렌더됐다(보지 않은 영상의 소견).
 */
import { describe, it, expect } from 'vitest';
import { unfetchableByExternalAi } from '../../src/modules/medical-ai/image-url-reachability';

describe('unfetchableByExternalAi', () => {
  it('🔴 상대경로는 막는다 — 스킴·호스트가 없어 외부가 해석할 수 없다', () => {
    expect(unfetchableByExternalAi('/api/v1/pacs/wado?studyUID=1.2.3')).toMatch(/상대경로/);
  });

  it('🔴 절대경로여도 HIS 인증 API 경로면 막는다 — 외부 주체는 401 을 받는다', () => {
    expect(unfetchableByExternalAi('https://his.example.org/api/v1/pacs/wado?studyUID=1.2.3')).toMatch(/401/);
    expect(unfetchableByExternalAi('https://his.example.org/fhir/R4/Binary/abc')).toMatch(/401/);
  });

  it('빈 값은 막는다', () => {
    expect(unfetchableByExternalAi('')).toBeTruthy();
    expect(unfetchableByExternalAi('   ')).toBeTruthy();
  });

  it('http(s) 아닌 스킴은 막는다', () => {
    expect(unfetchableByExternalAi('file:///tmp/x.png')).toMatch(/스킴/);
  });

  it('외부에서 가져갈 수 있는 URL 은 통과시킨다 — 애매하면 막지 않는다', () => {
    expect(unfetchableByExternalAi('https://cdn.example.com/study/1.jpg')).toBeNull();
    expect(unfetchableByExternalAi('https://his.example.org/uploads/signed/abc.jpg?sig=1')).toBeNull();
  });
});
