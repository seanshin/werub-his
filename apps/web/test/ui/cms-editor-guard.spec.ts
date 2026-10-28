import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseMetadataOrThrow, uploadCmsImage } from '@/components/admin/CategoryCmsPage';

/**
 * W9 가드 — CMS 편집 화면의 두 정본.
 *
 * 1) 구조화 데이터 파싱 실패는 **저장을 막는다**.
 *    원 결함: `catch { return {} }` — 텍스트에어리어 오타 한 글자가 metadata 를 통째로 `{}` 로 만들어
 *    공개 화면이 읽는 키(NEWS subType·진료과 departmentName)를 소거하는 PUT 을 보냈다.
 *    화면엔 '수정 완료' 만 떴다.
 *
 * 2) 홈페이지 이미지 업로드는 **미디어 라이브러리(`/media/*`)만** 쓴다.
 *    원 결함: `/api/v1/upload/image` → `/uploads/images/...`. `/uploads` 는 PHI 보호용 HMAC 서명
 *    (TTL 1시간) 게이트라 공개 홈페이지 ISR 캐시에서 만료되고, hospital.example.org 에는 `/uploads` 프록시조차 없다.
 */
describe('CMS 편집기 — 구조화 데이터 파싱', () => {
  it('빈 입력은 빈 객체(신규 작성 경로)', () => {
    expect(parseMetadataOrThrow('')).toEqual({});
    expect(parseMetadataOrThrow('   ')).toEqual({});
  });

  it('정상 JSON 은 그대로 통과', () => {
    expect(parseMetadataOrThrow('{"subType":"NOTICE"}')).toEqual({ subType: 'NOTICE' });
  });

  it('🔴 파싱 실패는 던진다 — `{}` 로 조용히 대체하지 않는다', () => {
    expect(() => parseMetadataOrThrow('{"subType":"NOTICE",}')).toThrow();
    expect(() => parseMetadataOrThrow('{subType: NOTICE}')).toThrow();
  });

  it('객체가 아닌 JSON(배열·숫자·null)도 거부한다', () => {
    expect(() => parseMetadataOrThrow('[1,2]')).toThrow();
    expect(() => parseMetadataOrThrow('42')).toThrow();
    expect(() => parseMetadataOrThrow('null')).toThrow();
  });

  // ── 역검증: 옛 구현을 재주입하면 소거 PUT 이 만들어지는가 ──
  it('역검증 — `catch { return {} }` 를 흉내내면 오타가 metadata 소거로 바뀐다', () => {
    const legacy = (s: string) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };
    expect(legacy('{"subType":"NOTICE",}')).toEqual({}); // 결함 재현: 소거 payload
    expect(() => parseMetadataOrThrow('{"subType":"NOTICE",}')).toThrow(); // 정본: 막는다
  });
});

describe('CMS 편집기 — 이미지 업로드 경로 정본', () => {
  let fetchSpy: any;

  beforeEach(async () => {
    const { apiClient } = await import('@/lib/api-client');
    fetchSpy = vi.spyOn(apiClient, 'fetch').mockResolvedValue({ data: { url: '/media/homepage/news/x.png' } } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('🔴 `/uploads` 가 아니라 미디어 업로드 EP 로 보낸다', async () => {
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await uploadCmsImage(file, '/homepage/news');
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url.startsWith('/api/v1/homepage/media/upload')).toBe(true);
    expect(url).not.toContain('/api/v1/upload/image');
  });

  it('폴더는 쿼리로 보낸다 (서버가 @Query 로 읽는다 — 본문에 넣으면 무시된다)', async () => {
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await uploadCmsImage(file, '/homepage/popup');
    expect(fetchSpy.mock.calls[0][0]).toContain(`folder=${encodeURIComponent('/homepage/popup')}`);
  });

  it('반환 URL 은 공개 정적 경로(`/media/`) — 서명 만료가 없는 경로', async () => {
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const url = await uploadCmsImage(file, '/homepage/news');
    expect(url.startsWith('/media/')).toBe(true);
    expect(url).not.toContain('/uploads/');
  });

  it('URL 없는 응답은 성공이라 하지 않는다', async () => {
    fetchSpy.mockResolvedValue({ data: {} } as never);
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await expect(uploadCmsImage(file, '/homepage/news')).rejects.toThrow();
  });
});
