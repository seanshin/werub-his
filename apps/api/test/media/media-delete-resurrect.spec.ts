import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * W9 가드 — **삭제는 진짜 삭제여야 한다**.
 *
 * 원 결함: remove() 가 `try { unlinkSync } catch {}` 로 실패를 삼키고 DB 행만 지웠다.
 *  → 화면은 "삭제 완료" 인데 파일은 `/media/...`(무인증 공개 정적 서빙)로 계속 나가고,
 *    다음 API 재시작 때 onModuleInit → syncFilesystemToDb 가 그 파일을 **다시 등록**해
 *    지운 이미지가 라이브러리에 되살아났다.
 * self-healing 은 유실된 DB 를 복원하는 장치지, 삭제를 되돌리는 장치가 아니다.
 */
describe('MediaService — 삭제/자가복구 경계', () => {
  let dir: string;
  let MediaService: any;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-guard-'));
    process.env.MEDIA_DIR = dir;
    vi.resetModules();
    MediaService = (await import('../../src/modules/media/media.service')).MediaService;
  });

  afterEach(() => {
    delete process.env.MEDIA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const make = (prisma: any) => new MediaService(prisma);

  it('파일이 실제로 지워졌을 때만 DB 행을 지운다', async () => {
    fs.writeFileSync(path.join(dir, 'a.png'), 'x');
    const prisma = {
      mediaFile: {
        findUnique: vi.fn().mockResolvedValue({ id: 'm-1', url: '/media/a.png' }),
        delete: vi.fn().mockResolvedValue({ id: 'm-1' }),
      },
    };
    await make(prisma).remove('m-1');
    expect(fs.existsSync(path.join(dir, 'a.png'))).toBe(false);
    expect(prisma.mediaFile.delete).toHaveBeenCalled();
  });

  it('🔴 URL 이 /media 규약을 벗어나면 지웠다고 말하지 않는다 — DB 행을 남기고 400', async () => {
    const prisma = {
      mediaFile: {
        // 옛 upload() 가 folder 정규화를 안 해 만들어내던 깨진 URL 모양
        findUnique: vi.fn().mockResolvedValue({ id: 'm-2', url: '/mediapopup/b.png' }),
        delete: vi.fn(),
      },
    };
    await expect(make(prisma).remove('m-2')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.mediaFile.delete).not.toHaveBeenCalled();
  });

  it('경로 탈출 URL 도 삭제하지 않는다', async () => {
    const prisma = {
      mediaFile: {
        findUnique: vi.fn().mockResolvedValue({ id: 'm-3', url: '/media/../../etc/passwd' }),
        delete: vi.fn(),
      },
    };
    await expect(make(prisma).remove('m-3')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.mediaFile.delete).not.toHaveBeenCalled();
  });

  it('디스크에 파일이 없으면(이미 지워짐) DB 행 정리는 허용한다 — 유령 행을 남기지 않는다', async () => {
    const prisma = {
      mediaFile: {
        findUnique: vi.fn().mockResolvedValue({ id: 'm-4', url: '/media/gone.png' }),
        delete: vi.fn().mockResolvedValue({ id: 'm-4' }),
      },
    };
    await expect(make(prisma).remove('m-4')).resolves.toBeTruthy();
    expect(prisma.mediaFile.delete).toHaveBeenCalled();
  });

  it('업로드 URL·folder 는 선행 슬래시 없이 와도 정규화된다 (되살아남의 원인 차단)', async () => {
    const prisma = { mediaFile: { create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve(data)) } };
    const saved = await make(prisma).upload(
      { originalname: 'x.png', mimetype: 'image/png', buffer: Buffer.from('x'), size: 1 },
      'homepage/popup', // 🔴 옛 코드는 이 입력에서 `/mediahomepage/popup/...` 를 만들었다
      'u-1',
    );
    expect(saved.folder).toBe('/homepage/popup');
    expect(saved.url.startsWith('/media/homepage/popup/')).toBe(true);
  });

  // ── 역검증: 실패를 삼키는 옛 구현을 재주입하면 유령이 생기는가 ──
  it('역검증 — unlink 실패를 삼키면 파일이 남은 채 DB 행만 사라진다(= 재시작 시 부활)', () => {
    const file = path.join(dir, 'ghost.png');
    fs.writeFileSync(file, 'x');
    const legacyRemove = () => { try { fs.unlinkSync(path.join(dir, 'wrong-path.png')); } catch { /* 삼킴 */ } return 'db-row-deleted'; };
    expect(legacyRemove()).toBe('db-row-deleted');
    expect(fs.existsSync(file)).toBe(true); // 파일은 그대로 → self-healing 이 되살린다
  });
});
