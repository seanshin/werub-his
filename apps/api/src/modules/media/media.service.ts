import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// 영구 저장소: 배포와 무관하게 유지 (MEDIA_DIR 환경변수로 지정 가능)
const UPLOAD_DIR = process.env.MEDIA_DIR || path.join(process.cwd(), '..', 'web', 'public', 'images');

const SUPPORTED_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 모듈 초기화 시 파일시스템과 DB를 자동 동기화
   * DB 레코드가 없지만 디스크에 파일이 있으면 자동 등록
   */
  async onModuleInit() {
    try {
      await this.syncFilesystemToDb();
    } catch (e) {
      this.logger.warn('Media filesystem sync failed (non-fatal)', e);
    }
  }

  /**
   * 파일시스템 → DB 자동 동기화 (self-healing)
   * 디스크에 존재하지만 DB에 없는 파일을 자동으로 등록
   */
  async syncFilesystemToDb(): Promise<{ added: number; existing: number }> {
    if (!fs.existsSync(UPLOAD_DIR)) {
      this.logger.log(`Media directory not found: ${UPLOAD_DIR}`);
      return { added: 0, existing: 0 };
    }

    // DB에 등록된 모든 파일의 URL을 Set으로 가져오기
    const dbFiles = await this.prisma.mediaFile.findMany({ select: { url: true } });
    const dbUrls = new Set(dbFiles.map(f => f.url));

    // 시스템 유저 (업로더) — ADMIN 우선, 없으면 첫 번째 유저
    const systemUser = await this.prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true },
    }) || await this.prisma.user.findFirst({ select: { id: true } });

    if (!systemUser) {
      this.logger.warn('No user found for media sync — skipping');
      return { added: 0, existing: 0 };
    }

    // 디스크 파일 재귀 스캔
    const diskFiles = this.scanDirectory(UPLOAD_DIR, '/');
    let added = 0;

    for (const file of diskFiles) {
      if (dbUrls.has(file.url)) continue; // 이미 DB에 있음

      try {
        await this.prisma.mediaFile.create({
          data: {
            fileName: file.fileName,
            originalName: file.fileName,
            mimeType: file.mimeType,
            fileSize: file.fileSize,
            url: file.url,
            folder: file.folder,
            uploadedBy: systemUser.id,
          },
        });
        added++;
      } catch {
        // unique constraint 등 — 무시
      }
    }

    const existing = dbUrls.size;
    if (added > 0) {
      this.logger.log(`Media sync complete: ${added} files added, ${existing} already in DB`);
    }
    return { added, existing };
  }

  /**
   * 디렉토리를 재귀적으로 스캔하여 미디어 파일 목록 반환
   */
  private scanDirectory(dirPath: string, relativeFolder: string): Array<{
    fileName: string; mimeType: string; fileSize: number; url: string; folder: string;
  }> {
    const results: Array<{ fileName: string; mimeType: string; fileSize: number; url: string; folder: string }> = [];

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const subFolder = relativeFolder === '/' ? `/${entry.name}` : `${relativeFolder}/${entry.name}`;
        results.push(...this.scanDirectory(fullPath, subFolder));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const mimeType = SUPPORTED_EXTENSIONS[ext];
        if (!mimeType) continue; // 지원하지 않는 확장자

        try {
          const stat = fs.statSync(fullPath);
          const folder = relativeFolder;
          const url = `/media${folder === '/' ? '' : folder}/${entry.name}`;
          results.push({
            fileName: entry.name,
            mimeType,
            fileSize: stat.size,
            url,
            folder,
          });
        } catch {
          // stat 실패 — 무시
        }
      }
    }

    return results;
  }

  async findAll(query: { folder?: string; mimeType?: string; search?: string }) {
    const where: any = {};
    if (query.folder && query.folder !== '/') where.folder = query.folder;
    if (query.mimeType) where.mimeType = { startsWith: query.mimeType };
    if (query.search) where.originalName = { contains: query.search, mode: 'insensitive' };
    return this.prisma.mediaFile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * 업로드 폴더 정규화 — `folder` 는 쿼리로 들어오는 사용자 입력이다.
   * 검증 없이 join 하면 `../../..` 로 미디어 디렉터리 **밖에 파일을 쓸 수 있다**(ADMIN 이라도
   * 서버 파일시스템 임의 쓰기는 부여된 권한이 아니다). resolve 후 UPLOAD_DIR 하위인지 확인한다.
   */
  private resolveFolder(folder: string): string {
    const raw = typeof folder === 'string' ? folder : '/';
    if (raw.includes('\0')) throw new BadRequestException('폴더 경로가 올바르지 않습니다');
    const rel = raw.split('/').filter((p) => p !== '' && p !== '.');
    if (rel.some((p) => p === '..')) throw new BadRequestException('폴더 경로가 올바르지 않습니다');
    const abs = path.resolve(UPLOAD_DIR, rel.join('/'));
    const root = path.resolve(UPLOAD_DIR);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new BadRequestException('폴더 경로가 올바르지 않습니다');
    }
    return abs;
  }

  /**
   * 폴더 표기 정규화 — 항상 `/` 또는 `/a/b`.
   * 🔴 W9: URL 을 `/media${folder === '/' ? '' : folder}` 로 만들면서 folder 를 **날것 그대로** 썼다.
   *    호출자가 `popup`(선행 슬래시 없음)을 보내면 URL 이 `/mediapopup/...` 이 되어 이미지가 영영 404 이고,
   *    저장된 folder 값도 폴더 필터(`where.folder` 정확 일치)와 어긋나 목록에서 사라진다.
   *    저장 URL·저장 folder·디스크 경로를 같은 정규화 하나에서 만든다.
   */
  private normalizeFolder(folder: string): string {
    const rel = (typeof folder === 'string' ? folder : '/').split('/').filter((p) => p !== '' && p !== '.');
    return rel.length ? `/${rel.join('/')}` : '/';
  }

  async upload(file: { originalname: string; mimetype: string; buffer: Buffer; size: number }, folder: string, userId: string) {
    // 폴더 생성 (경로 탈출 차단)
    const folderPath = this.resolveFolder(folder);
    fs.mkdirSync(folderPath, { recursive: true });

    // 파일 저장 — 확장자 이중 방어(controller fileFilter 를 우회한 호출에도 유효).
    // /media 는 확장자로 Content-Type 이 정해지므로 이미지 확장자만 허용(SVG·HTML 차단).
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      throw new BadRequestException('이미지 파일만 업로드할 수 있습니다 (jpg/png/gif/webp)');
    }
    const fileName = `${randomUUID()}${ext}`;
    const filePath = path.join(folderPath, fileName);
    fs.writeFileSync(filePath, file.buffer);

    // 이미지 크기 (간단히 — 실제로는 sharp 사용)
    const width: number | null = null;
    const height: number | null = null;

    const normFolder = this.normalizeFolder(folder);
    const url = `/media${normFolder === '/' ? '' : normFolder}/${fileName}`;

    return this.prisma.mediaFile.create({
      data: {
        fileName,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        url,
        folder: normFolder,
        width,
        height,
        uploadedBy: userId,
      },
    });
  }

  /**
   * 삭제 — **디스크에서 먼저 지우고, 지워진 것을 확인한 뒤에만 DB 행을 지운다.**
   *
   * 🔴 W9 실결함: 기존 구현은 `try { unlinkSync } catch {}` 로 실패를 통째로 삼키고 DB 행만 지웠다.
   *    그러면 (1) 화면은 "삭제 완료" 라 말하는데 파일은 `/media/...`(무인증 공개 정적 서빙)로 계속 나가고,
   *    (2) 다음 API 재시작 때 `onModuleInit → syncFilesystemToDb` 가 그 파일을 **다시 등록**해
   *    지운 이미지가 라이브러리에 되살아난다(업로더는 시스템 ADMIN, 원본 파일명은 UUID 로 바뀐 채).
   *    self-healing 은 "유실된 DB 를 복원"하는 장치지 "삭제를 되돌리는" 장치가 아니다.
   */
  async remove(id: string) {
    const file = await this.prisma.mediaFile.findUnique({ where: { id } });
    if (!file) return null;

    const filePath = this.diskPathOf(file.url);
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        this.logger.warn(`미디어 파일 삭제 실패(DB 행 유지): ${file.url} — ${e instanceof Error ? e.message : String(e)}`);
        throw new BadRequestException('파일을 삭제하지 못했습니다 — 목록에서만 지우면 공개 경로로 계속 노출됩니다');
      }
    } else if (filePath === null) {
      // URL 이 /media/ 규약을 벗어났다 → 어떤 파일을 지워야 하는지 모른다. 모르면 지웠다고 하지 않는다.
      this.logger.warn(`미디어 URL 규약 이탈 — 디스크 경로를 특정할 수 없음: ${file.url}`);
      throw new BadRequestException('파일 경로를 확인할 수 없어 삭제하지 않았습니다 (관리자 확인 필요)');
    }

    return this.prisma.mediaFile.delete({ where: { id } });
  }

  /** 저장 URL(`/media/...`) → 디스크 절대경로. 규약 이탈·경로 탈출은 null */
  private diskPathOf(url: string): string | null {
    if (typeof url !== 'string' || !url.startsWith('/media/')) return null;
    const rel = url.slice('/media/'.length).split('/').filter((p) => p !== '' && p !== '.');
    if (!rel.length || rel.some((p) => p === '..' || p.includes('\0'))) return null;
    const abs = path.resolve(UPLOAD_DIR, rel.join('/'));
    const root = path.resolve(UPLOAD_DIR);
    return abs.startsWith(root + path.sep) ? abs : null;
  }

  async getStats() {
    const files = await this.prisma.mediaFile.findMany({ select: { fileSize: true, mimeType: true } });
    const totalSize = files.reduce((s, f) => s + f.fileSize, 0);
    const imageCount = files.filter(f => f.mimeType.startsWith('image/')).length;
    return { totalFiles: files.length, totalSize, imageCount };
  }

  async getFolders() {
    const files = await this.prisma.mediaFile.findMany({ select: { folder: true }, distinct: ['folder'] });
    return files.map(f => f.folder).sort();
  }
}
