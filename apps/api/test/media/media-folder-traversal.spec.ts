import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';

const mkdirSync = vi.fn();
const writeFileSync = vi.fn();
vi.mock('fs', async (importActual) => {
  const actual = await importActual<typeof import('fs')>();
  return { ...actual, mkdirSync: (...a: unknown[]) => mkdirSync(...a), writeFileSync: (...a: unknown[]) => writeFileSync(...a) };
});

const { MediaService } = await import('../../src/modules/media/media.service');

/**
 * 2026-07 파일 접근 권한 전수검토 회귀 — 업로드 폴더 경로 탈출 차단.
 * `folder` 는 쿼리로 들어오는 사용자 입력이라, 검증 없이 join 하면 미디어 디렉터리
 * **밖에 파일을 쓸 수 있었다**(ADMIN 이라도 서버 파일시스템 임의 쓰기는 부여된 권한이 아니다).
 */
describe('MediaService — 업로드 폴더 경로 탈출 차단', () => {
  let service: InstanceType<typeof MediaService>;
  const file = { originalname: 'a.png', mimetype: 'image/png', buffer: Buffer.from('x'), size: 1 };

  beforeEach(() => {
    mkdirSync.mockReset();
    writeFileSync.mockReset();
    service = new MediaService({ mediaFile: { create: vi.fn().mockResolvedValue({ id: 'm1' }) } } as any);
  });

  it.each(['../../../tmp', '/../..', 'a/../../..', '..'])('상위 경로 탈출을 거부한다: %s', async (folder) => {
    await expect(service.upload(file, folder, 'u1')).rejects.toThrow('폴더 경로가 올바르지 않습니다');
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  // 2026-07 업로드 콘텐츠 검증 전수 — /media 는 공개 정적 서빙(확장자로 Content-Type 결정)이라
  // SVG·HTML 업로드 시 저장형 XSS. 서비스 확장자 이중 방어(controller fileFilter 우회 시에도).
  it.each(['x.svg', 'x.html', 'x.htm', 'x.js', 'evil.png.svg'])('이미지 아닌 확장자를 거부한다: %s', async (name) => {
    const bad = { originalname: name, mimetype: 'image/png', buffer: Buffer.from('x'), size: 1 };
    await expect(service.upload(bad, '/news', 'u1')).rejects.toThrow('이미지 파일만');
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it.each(['pic.jpg', 'pic.PNG', 'a.webp', 'b.gif'])('이미지 확장자는 허용: %s', async (name) => {
    const ok = { originalname: name, mimetype: 'image/png', buffer: Buffer.from('x'), size: 1 };
    await service.upload(ok, '/news', 'u1');
    expect(writeFileSync).toHaveBeenCalled();
  });

  it('정상 폴더는 미디어 루트 하위에 저장한다', async () => {
    await service.upload(file, '/news', 'u1');

    const written = writeFileSync.mock.calls[0][0] as string;
    const root = path.resolve(process.env.MEDIA_DIR || path.join(process.cwd(), '..', 'web', 'public', 'images'));
    expect(written.startsWith(root + path.sep)).toBe(true);
    expect(written).toContain(`${path.sep}news${path.sep}`);
  });
});
