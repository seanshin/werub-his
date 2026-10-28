import { describe, it, expect } from 'vitest';
import { lastValueFrom, of } from 'rxjs';
import {
  normalizeUploadPath,
  signUploadUrl,
  verifyUploadSignature,
  UPLOAD_TOKEN_TTL_MS,
} from '../../src/common/util/upload-url';
import { UploadUrlSignInterceptor } from '../../src/common/interceptors/upload-url-sign.interceptor';

const NOW = 1_800_000_000_000;

describe('업로드 파일 접근 서명', () => {
  describe('경로 정규화 — traversal 차단', () => {
    it('정상 경로는 통과한다', () => {
      expect(normalizeUploadPath('/uploads/voc/a.png')).toBe('/uploads/voc/a.png');
      expect(normalizeUploadPath('/uploads//voc///a.png')).toBe('/uploads/voc/a.png');
    });

    it('상위 경로 탈출은 거부한다(인코딩 포함)', () => {
      expect(normalizeUploadPath('/uploads/../../etc/passwd')).toBeNull();
      expect(normalizeUploadPath('/uploads/voc/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
      expect(normalizeUploadPath('/uploads/a%00.png')).toBeNull();
      expect(normalizeUploadPath('/etc/passwd')).toBeNull();
    });
  });

  describe('서명·검증', () => {
    it('서명한 URL 은 검증을 통과한다', () => {
      const url = signUploadUrl('/uploads/patients/p1/photo.jpg', NOW);
      const [pathname, qs] = url.split('?');
      const q = new URLSearchParams(qs);

      expect(pathname).toBe('/uploads/patients/p1/photo.jpg');
      expect(verifyUploadSignature(pathname, q.get('uexp'), q.get('ut'), NOW)).toBe(true);
    });

    it('만료된 서명은 거부한다', () => {
      const url = signUploadUrl('/uploads/voc/a.png', NOW);
      const q = new URLSearchParams(url.split('?')[1]);

      expect(
        verifyUploadSignature('/uploads/voc/a.png', q.get('uexp'), q.get('ut'), NOW + UPLOAD_TOKEN_TTL_MS + 1),
      ).toBe(false);
    });

    it('다른 파일의 서명은 재사용할 수 없다', () => {
      const url = signUploadUrl('/uploads/voc/a.png', NOW);
      const q = new URLSearchParams(url.split('?')[1]);

      // 같은 exp·token 으로 다른 환자 사진을 요청 → 거부
      expect(verifyUploadSignature('/uploads/patients/p1/photo.jpg', q.get('uexp'), q.get('ut'), NOW)).toBe(false);
    });

    it('위조 토큰·만료 조작을 거부한다', () => {
      expect(verifyUploadSignature('/uploads/voc/a.png', NOW + 1000, 'deadbeef', NOW)).toBe(false);
      expect(verifyUploadSignature('/uploads/voc/a.png', 'not-a-number', 'x', NOW)).toBe(false);
      expect(verifyUploadSignature('/uploads/voc/a.png', undefined, undefined, NOW)).toBe(false);
    });

    it('uploads 경로가 아니면 서명하지 않는다', () => {
      expect(signUploadUrl('/media/logo.png', NOW)).toBe('/media/logo.png');
      expect(signUploadUrl('https://example.com/a.png', NOW)).toBe('https://example.com/a.png');
    });
  });

  describe('응답 인터셉터', () => {
    const run = (body: unknown) =>
      lastValueFrom(new UploadUrlSignInterceptor().intercept({} as any, { handle: () => of(body) } as any));

    it('중첩된 업로드 URL 전부에 서명을 붙인다', async () => {
      const out: any = await run({
        data: {
          photoUrl: '/uploads/patients/p1/photo.jpg',
          attachments: [{ url: '/uploads/voc/a.png' }, { url: '/uploads/consult/b.pdf' }],
        },
      });

      expect(out.data.photoUrl).toMatch(/^\/uploads\/patients\/p1\/photo\.jpg\?uexp=\d+&ut=[0-9a-f]{32}$/);
      expect(out.data.attachments[0].url).toContain('ut=');
      expect(out.data.attachments[1].url).toContain('ut=');
    });

    it('업로드 URL 이 없으면 응답을 그대로 통과시킨다(동일 참조)', async () => {
      const body = { data: { id: 'x', name: '홍길동', url: '/media/logo.png' } };
      expect(await run(body)).toBe(body);
    });

    it('Date 등 비-plain 객체는 변형하지 않는다', async () => {
      const d = new Date(NOW);
      const out: any = await run({ data: { at: d, photoUrl: '/uploads/patients/p1/photo.jpg' } });
      expect(out.data.at).toBe(d);
    });
  });
});
