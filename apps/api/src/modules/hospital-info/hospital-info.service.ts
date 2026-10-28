import * as path from 'path';
import { Injectable, Logger, NotFoundException, BadRequestException, BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { spawn, execFile } from 'child_process';
import * as fs from 'fs';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { safeFetch, EgressBlockedError } from '../../common/util/safe-fetch';
import { readBuildInfo, parseBuildInfo } from '../health/build-info';

/** 공백만 있는 본문은 "있다"고 치지 않는다(리치텍스트의 `<p></p>` 포함) */
export function hasText(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  return v.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
}

/**
 * 구조화 데이터 부분 갱신 — 최상위 키 병합. `null` 로 보낸 키만 제거한다.
 * 🔴 전체 치환이면 클라이언트가 모르는 키(공개 화면이 읽는 subType·departmentName 등)가 조용히 사라진다.
 */
export function mergeMetadata(
  old: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(old && typeof old === 'object' ? old : {}) };
  for (const [k, v] of Object.entries(incoming ?? {})) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  return base;
}

/** 값이 "빈 컨테이너"인가 — `[]`·`{}`·`''` */
function isEmptyContainer(v: unknown): boolean {
  if (v === '' ) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (v && typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/**
 * 🔴 병합만으로는 못 막는 것: 클라이언트가 **키를 보내되 값을 빈 컨테이너로** 보내는 경우.
 * (W8 /admin/forms 의 `fields: []` 가 정확히 이 모양이었다 — 병합해도 빈 배열이 덮여
 *  "본문은 있는데 화면은 비는" 그림자 결함이 된다.) 지우려면 null 로 명시하게 강제한다.
 * 반환값은 문제가 된 키 목록(비면 통과).
 */
export function emptiedKeys(
  old: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
): string[] {
  const base = (old && typeof old === 'object' ? old : {}) as Record<string, unknown>;
  return Object.entries(incoming ?? {})
    .filter(([k, v]) => isEmptyContainer(v) && k in base && !isEmptyContainer(base[k]) && base[k] != null)
    .map(([k]) => k);
}

@Injectable()
export class HospitalInfoService {
  private readonly logger = new Logger(HospitalInfoService.name);

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  /**
   * 공개 사이트 기준 주소 — **기본값을 두지 않는다.**
   *
   * 🔴 종전에는 미설정이면 `https://hospital.example.org`(특정 기관 도메인)로 떨어졌다. 감시자 크론이
   *    10분마다 최신성 확인을 부르므로, **다른 기관의 설치본이 우리 도메인으로 계속 나간다**
   *    (2026-09-13 격리망 설치 시험에서 지적 — 격리 해제 전에 주소를 바꾸라는 안내가 필요했다).
   *    미설정은 "확인하지 않는다"이지 "hospital.example.org 을 본다"가 아니다.
   */
  private homepageBaseUrl(): string {
    return (this.config.get<string>('HOMEPAGE_PUBLIC_URL') || '').trim().replace(/\/$/, '');
  }

  /**
   * 홈페이지(hospital.example.org) 콘텐츠 즉시 반영 — On-demand ISR. 재빌드 없이 ISR 캐시 무효화.
   * HOMEPAGE_PUBLIC_URL(기본 https://hospital.example.org)/revalidate 로 시크릿과 함께 POST.
   */
  async revalidateHomepage(opts: { paths?: string[]; all?: boolean } = {}) {
    const url = this.homepageBaseUrl();
    if (!url) throw new BadRequestException('HOMEPAGE_PUBLIC_URL 미설정(서버 .env) — 공개 사이트 주소를 정한 뒤 실행하세요');
    const secret = this.config.get<string>('HOMEPAGE_REVALIDATE_SECRET') || '';
    if (!secret) throw new BadRequestException('HOMEPAGE_REVALIDATE_SECRET 미설정(서버 .env)');
    let res: Response;
    try {
      res = await safeFetch(
        `${url}/revalidate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
          body: JSON.stringify({ paths: opts.paths, all: opts.all === true }),
        },
        { timeoutMs: 8000 },
      );
    } catch (e) {
      // 차단은 연결 실패와 다른 사실 — 요약 응답은 유지하되 원인을 구분해 남긴다.
      if (e instanceof EgressBlockedError) {
        this.logger.error(`홈페이지 revalidate 송신 차단(SSRF 방어): ${e.message}. 요청이 나가지 않았습니다.`);
        throw new BadGatewayException('홈페이지 반영 요청이 차단되었습니다(대상 URL 검증 실패)');
      }
      // 원본 fetch 에러 메시지는 내부 URL·네트워크 힌트를 담으므로 로그로만 남기고 응답은 요약(2026-07 에러 노출 전수).
      this.logger.warn(`홈페이지 revalidate 연결 실패: ${e instanceof Error ? e.message : String(e)}`);
      throw new BadGatewayException('홈페이지 서버에 연결하지 못했습니다');
    }
    if (!res.ok) throw new BadGatewayException(`홈페이지 반영 실패(HTTP ${res.status})`);
    const data = await res.json().catch(() => ({}));
    this.logger.log(`홈페이지 즉시 반영: ${JSON.stringify((data as { revalidated?: unknown })?.revalidated ?? data)}`);
    return data;
  }

  // 기본값은 실행 위치(pm2 cwd=apps/api)에서 유도 — 서버 이전(2026-09-09)으로 절대경로 하드코딩이 죽은 경로가 됐다
  private buildScript() { return this.config.get<string>('HOMEPAGE_BUILD_SCRIPT') || path.resolve(process.cwd(), '../../infra/scripts/build-homepage.sh'); }
  private buildStatusFile() { return this.config.get<string>('HOMEPAGE_BUILD_STATUS') || '/home/deploy/homepage-build-status.json'; }

  /**
   * 홈페이지 배포(코드/디자인 변경) — HIS 서버에서 격리 빌드 → S3 발행(백그라운드).
   * 서버 SSM 배포(blue-green)는 인프라 측. 재빌드 경로. 동시 빌드 방지.
   */
  async deployHomepage() {
    const script = this.buildScript();
    if (!fs.existsSync(script)) throw new BadRequestException('빌드 스크립트 미배치(deploy.sh --homepage 로 서버 동기화 필요)');
    // 진행 중이면 거부
    const cur = this.readBuildStatus();
    if (cur?.status === 'building') {
      const age = Date.now() - new Date(cur.startedAt || 0).getTime();
      if (age < 10 * 60 * 1000) throw new BadRequestException('이미 빌드가 진행 중입니다');
    }
    const startedAt = new Date().toISOString();
    fs.writeFileSync(this.buildStatusFile(), JSON.stringify({ status: 'building', startedAt }));
    const child = spawn('bash', [script], {
      detached: true, stdio: 'ignore',
      env: { ...process.env, HOMEPAGE_BUILD_STATUS: this.buildStatusFile() },
    });
    // 🔴 W9(P16 — 실행하지 않고 진행 중이라 기록): 'building' 을 **spawn 전에** 써놓고 실패는 안 들었다.
    //    bash 기동이 실패해도(ENOENT/EACCES) 상태 파일은 영원히 'building' 이라, 화면은 '빌드 중…' 을
    //    무한히 보여주고 재시도 버튼까지 10분간 잠긴다(= 아무것도 안 하는데 하고 있다고 말한다).
    child.on('error', (e) => {
      this.logger.error(`홈페이지 빌드 기동 실패: ${e instanceof Error ? e.message : String(e)}`);
      try {
        fs.writeFileSync(this.buildStatusFile(), JSON.stringify({
          status: 'failed', stage: 'spawn', startedAt, ts: new Date().toISOString(),
        }));
      } catch { /* 상태 파일 기록 실패는 로그로 충분 */ }
    });
    child.unref();
    this.logger.log('홈페이지 서버 빌드 트리거(백그라운드)');
    return { ok: true, triggeredAt: startedAt };
  }

  private readBuildStatus(): Record<string, any> | null {
    try { return JSON.parse(fs.readFileSync(this.buildStatusFile(), 'utf8')); } catch { return null; }
  }

  private lastPublishedFile() {
    return this.config.get<string>('HOMEPAGE_LAST_PUBLISHED') || path.join(path.dirname(this.buildStatusFile()), 'homepage-last-published.json');
  }
  private homepageSourceDir() { return path.resolve(path.dirname(this.buildScript()), '../../apps/homepage'); }

  /**
   * 마지막으로 **S3 발행에 성공한** 빌드. 상태 파일은 마지막 *시도*라 실패하면 덮인다 —
   * 🔴 2026-09-15 실측: S3 에서 실패한 1506 을 "최신 발행(1506)"이라 부르며 라이브와 대조했다(발행된 적 없는 빌드).
   * 기록 파일 도입 전 빌드는 상태 파일이 성공/전환 트리거일 때만 발행으로 친다.
   */
  readLastPublished(): { ts: string; sourceCommit?: string | null } | null {
    let pub: { ts?: string; sourceCommit?: string | null } | null = null;
    try { pub = JSON.parse(fs.readFileSync(this.lastPublishedFile(), 'utf8')); } catch { pub = null; }
    const st = this.readBuildStatus();
    const stPub = st && (st.status === 'success' || st.status === 'deploy_triggered') && typeof st.ts === 'string' ? st : null;
    const cands = [pub, stPub].filter((x): x is { ts: string } => !!x && typeof x.ts === 'string' && /^\d{8}-\d{4}$/.test(x.ts));
    if (cands.length === 0) return null;
    return cands.sort((a, b) => (a.ts < b.ts ? 1 : -1))[0];
  }

  /**
   * 발행 전 점검 — 🔴 종전 `configured` 는 **스크립트 파일이 있는가**만 봤다. 2026-09-15 AWS 키가 만료돼
   * 발행이 매번 S3 에서 실패하는데도 화면은 '설정됨'이었다. 버튼을 막지는 않는다(막으면 방치된다) — 말한다.
   * 자격 확인은 빌드 스크립트와 **같은 환경**(이 프로세스의 env)으로 한다 — env 키가 credentials 파일보다 우선한다.
   */
  private awsCheckCache: { at: number; value: { state: 'OK' | 'FAILED' | 'UNKNOWN'; detail: string } } | null = null;
  async checkAwsCredentials(): Promise<{ state: 'OK' | 'FAILED' | 'UNKNOWN'; detail: string }> {
    if (this.awsCheckCache && Date.now() - this.awsCheckCache.at < 60_000) return this.awsCheckCache.value;
    const bin = this.config.get<string>('HOMEPAGE_AWS_BIN')
      || (fs.existsSync('/home/deploy/.local/bin/aws') ? '/home/deploy/.local/bin/aws' : 'aws');
    const value = await new Promise<{ state: 'OK' | 'FAILED' | 'UNKNOWN'; detail: string }>((resolve) => {
      execFile(bin, ['sts', 'get-caller-identity', '--output', 'json'], { timeout: 10_000, env: process.env }, (err, _stdout, stderr) => {
        if (!err) return resolve({ state: 'OK', detail: 'AWS 자격 확인됨(sts get-caller-identity)' });
        const e = err as NodeJS.ErrnoException & { killed?: boolean };
        if (e.code === 'ENOENT') return resolve({ state: 'FAILED', detail: 'aws CLI 를 찾지 못했습니다 — 발행(S3 업로드)이 실패합니다' });
        if (e.killed) return resolve({ state: 'UNKNOWN', detail: 'AWS 자격 확인이 시간 안에 끝나지 않았습니다 — 확인 불가' });
        const msg = String(stderr || '');
        if (/InvalidClientTokenId|InvalidAccessKeyId|SignatureDoesNotMatch|ExpiredToken|Unable to locate credentials/i.test(msg)) {
          return resolve({ state: 'FAILED', detail: 'AWS 자격이 거부되었습니다(키 만료·무효 또는 미설정) — 발행(S3 업로드)이 실패합니다' });
        }
        this.logger.warn(`AWS 자격 확인 실패(분류 불가): ${msg.slice(0, 200)}`);
        return resolve({ state: 'UNKNOWN', detail: 'AWS 자격 확인에 실패했습니다(네트워크 등) — 확인 불가' });
      });
    });
    this.awsCheckCache = { at: Date.now(), value };
    return value;
  }

  /** 최근 홈페이지 배포(서버 빌드) 상태 */
  async homepageDeployStatus() {
    const script = this.buildScript();
    const scriptPresent = fs.existsSync(script);
    const last = this.readBuildStatus();
    // 버튼이 빌드할 소스가 어느 커밋인가 — HIS 가 지금 떠 있는 커밋과 대조한다(모르면 null)
    let source: { commit: string | null; syncedAt: string | null } = { commit: null, syncedAt: null };
    try {
      const info = parseBuildInfo(fs.readFileSync(path.join(this.homepageSourceDir(), 'SOURCE_INFO.json'), 'utf8'));
      source = { commit: info.commit, syncedAt: info.builtAt };
    } catch { /* 기록 없음 = 모름(null) */ }
    const hisCommit = readBuildInfo().commit;
    const sourceMatchesHis = source.commit && hisCommit ? source.commit === hisCommit : null;
    const aws = scriptPresent ? await this.checkAwsCredentials() : { state: 'UNKNOWN' as const, detail: '빌드 스크립트가 없어 확인하지 않았습니다' };
    const ssmConfigured = !!(this.config.get<string>('HOMEPAGE_SSM_DOCUMENT') && this.config.get<string>('HOMEPAGE_SSM_TARGET'));
    return {
      // 🔴 '설정됨'은 스크립트 존재가 아니라 발행이 실제로 갈 수 있는가(자격 거부면 false)
      configured: scriptPresent && aws.state !== 'FAILED',
      mode: 'server-build',
      preflight: { script: scriptPresent, awsCredentials: aws.state, awsDetail: aws.detail, ssmConfigured },
      source: { ...source, hisCommit, matchesHis: sourceMatchesHis },
      last,
      lastPublished: this.readLastPublished(),
      live: await this.homepageLiveFreshness(),
      liveSource: await this.homepageLiveSourceCommit(),
    };
  }

  /** 라이브가 어느 소스 커밋인가 — `/build-source.txt`(2026-09-15 도입). 404 = 기록 도입 전 빌드 · 실패 = 확인 불가 */
  async homepageLiveSourceCommit(): Promise<{ checked: boolean; commit: string | null }> {
    const base = this.homepageBaseUrl();
    if (!base) return { checked: false, commit: null }; // 미설정 = 확인하지 않음(다른 기관 도메인으로 나가지 않는다)
    try {
      const res = await safeFetch(`${base}/build-source.txt`, { method: 'GET' }, { timeoutMs: 6000 });
      if (res.status === 404) return { checked: true, commit: null };
      if (!res.ok) return { checked: false, commit: null };
      const c = (await res.text()).trim();
      return /^[0-9a-f]{7,40}$/.test(c) ? { checked: true, commit: c } : { checked: false, commit: null };
    } catch {
      return { checked: false, commit: null };
    }
  }

  /**
   * 공개 사이트가 **지금 무엇을 서비스하고 있는가** — 트리거 기록과는 다른 사실이다.
   *
   * 🔴 2026-09-02 실측: 상태 파일은 2026-06-17 `deploy_triggered` 에 멈춰 있었고 화면은 그 기록을
   *    그대로 "배포 전환 중 … 잠시 후 hospital.example.org 반영"이라고 **77일째** 말하고 있었다. 그 사이 라이브
   *    사이트는 08-14 W9 수정(진료시간 09:00~17:30 — 라이브는 아직 18:00), 08-19 AI 표기 병기
   *    (AI기본법 §31), 09-01 booking·XSS 수정을 **하나도 받지 못했다.**
   *    "무엇을 시켰는가"는 배포를 증명하지 않는다 — 살아 있는 것을 직접 본다.
   *
   * 🔴 조회 실패는 '낡음'이 아니다 — `checked:false` 로 돌려 화면이 단정하지 못하게 한다.
   */
  /**
   * 🔴 2026-09-03 표본 교체: 종전 표본(예약 페이지 AI 표기)은 그 페이지 본문이 Suspense 셸이라
   *    초기 HTML 에 **구조적으로 나올 수 없었다** — 발행이 성공해도(청크 대조로 실증) 영원히
   *    '낡음'을 말하는 감지기였다(실제보다 덜 좋게 말하는 것도 사실이 아니다).
   *    이제 빌드가 심는 `/build-stamp.txt`(빌드 TS)를 읽어 트리거 기록의 ts 와 기계 대조한다.
   */
  async homepageLiveFreshness(): Promise<{ checked: boolean; fresh: boolean | null; url: string; detail: string }> {
    const base = this.homepageBaseUrl();
    if (!base) {
      return {
        checked: false, fresh: null, url: '',
        detail: '공개 사이트 주소(HOMEPAGE_PUBLIC_URL)가 설정되지 않았습니다 — 최신 여부를 확인하지 않습니다',
      };
    }
    const url = `${base}/build-stamp.txt`;
    try {
      const res = await safeFetch(url, { method: 'GET' }, { timeoutMs: 6000 });
      if (res.status === 404) {
        return {
          checked: true, fresh: false, url,
          detail: '🔴 라이브에 빌드 스탬프가 없습니다 — 스탬프 도입(2026-09-03) 이전 빌드가 서비스 중입니다. \'빌드·발행\'이 필요합니다.',
        };
      }
      if (!res.ok) {
        return { checked: false, fresh: null, url, detail: `공개 사이트 응답 HTTP ${res.status} — 최신 여부를 확인하지 못했습니다` };
      }
      const liveTs = (await res.text()).trim().slice(0, 20);
      if (!/^\d{8}-\d{4}$/.test(liveTs)) {
        return { checked: false, fresh: null, url, detail: `빌드 스탬프 형식이 예상과 다릅니다('${liveTs}') — 최신 여부를 판정하지 않습니다` };
      }
      const lastTs = this.readLastPublished()?.ts;
      if (!lastTs) {
        return { checked: true, fresh: null, url, detail: `라이브 빌드 ${liveTs} — 발행 성공 기록이 없어 최신 여부를 비교할 대상이 없습니다` };
      }
      const fresh = liveTs === lastTs;
      return {
        checked: true, fresh, url,
        detail: fresh
          ? `표본 확인 — 라이브가 최신 발행 빌드(${liveTs})를 서비스 중입니다.`
          : `🔴 라이브 빌드(${liveTs})가 최신 발행(${lastTs})과 다릅니다 — 전환이 아직/실패했거나 다른 빌드가 서비스 중입니다.`,
      };
    } catch (e) {
      if (e instanceof EgressBlockedError) {
        this.logger.warn(`공개 사이트 최신성 확인 차단(SSRF 방어): ${e.message}`);
        return { checked: false, fresh: null, url, detail: '대상 URL 검증에 걸려 확인 요청이 나가지 않았습니다 — 최신 여부 확인 불가' };
      }
      this.logger.warn(`공개 사이트 최신성 확인 실패: ${e instanceof Error ? e.message : String(e)}`);
      return { checked: false, fresh: null, url, detail: '공개 사이트에 연결하지 못했습니다 — 최신 여부 확인 불가' };
    }
  }

  /** 5분마다 예약 발행/만료 처리 */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleScheduledPublish() {
    const result = await this.processScheduledPublish();
    if (result.published > 0 || result.archived > 0) {
      this.logger.log(`Scheduled publish: ${result.published} published, ${result.archived} archived`);
    }
  }

  // ══════════════════════════════════════════════
  // 관리자 CRUD
  // ══════════════════════════════════════════════

  async findAll(query: { category?: string; isActive?: boolean; search?: string; includeDeleted?: boolean }) {
    const where: Prisma.HospitalInfoContentWhereInput = {};
    if (!query.includeDeleted) where.deletedAt = null; // 소프트 삭제 제외
    if (query.category) where.category = query.category;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { content: { contains: query.search, mode: 'insensitive' } },
        { tags: { hasSome: [query.search] } },
      ];
    }
    return this.prisma.hospitalInfoContent.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { title: 'asc' }],
    });
  }

  /** 소프트 삭제 */
  async softDelete(id: string, userId: string) {
    return this.prisma.hospitalInfoContent.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: userId, isActive: false },
    });
  }

  /** 복원 */
  async restore(id: string) {
    return this.prisma.hospitalInfoContent.update({
      where: { id },
      data: { deletedAt: null, deletedBy: null, isActive: true },
    });
  }

  /** 상태 변경 */
  async updateStatus(id: string, status: string, publishFrom?: string, publishUntil?: string) {
    return this.prisma.hospitalInfoContent.update({
      where: { id },
      data: {
        status,
        publishFrom: publishFrom ? new Date(publishFrom) : undefined,
        publishUntil: publishUntil ? new Date(publishUntil) : undefined,
        isActive: status === 'PUBLISHED',
      },
    });
  }

  /** 예약 발행 처리 (cron에서 호출) */
  async processScheduledPublish() {
    const now = new Date();
    // SCHEDULED → PUBLISHED (시작일 도래)
    const toPublish = await this.prisma.hospitalInfoContent.updateMany({
      where: { status: 'SCHEDULED', publishFrom: { lte: now }, deletedAt: null },
      data: { status: 'PUBLISHED', isActive: true },
    });
    // PUBLISHED → ARCHIVED (종료일 도래)
    const toArchive = await this.prisma.hospitalInfoContent.updateMany({
      where: { status: 'PUBLISHED', publishUntil: { lte: now, not: null }, deletedAt: null },
      data: { status: 'ARCHIVED', isActive: false },
    });
    return { published: toPublish.count, archived: toArchive.count };
  }

  async findBySlug(category: string, slug: string) {
    const item = await this.prisma.hospitalInfoContent.findUnique({
      where: { category_slug: { category, slug } },
    });
    if (!item) throw new NotFoundException('콘텐츠를 찾을 수 없습니다');
    return item;
  }

  async findById(id: string) {
    const item = await this.prisma.hospitalInfoContent.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('콘텐츠를 찾을 수 없습니다');
    return item;
  }

  async create(data: {
    category: string; slug: string; title: string; content: string;
    metadata?: Record<string, unknown>; sortOrder?: number; tags?: string[];
    imageUrl?: string; publishFrom?: string; publishUntil?: string;
    isPinned?: boolean; editableDepts?: string[];
  }, userId: string) {
    const item = await this.prisma.hospitalInfoContent.create({
      data: {
        category: data.category,
        slug: data.slug,
        title: data.title,
        content: data.content,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
        sortOrder: data.sortOrder ?? 0,
        tags: data.tags ?? [],
        imageUrl: data.imageUrl,
        publishFrom: data.publishFrom ? new Date(data.publishFrom) : null,
        publishUntil: data.publishUntil ? new Date(data.publishUntil) : null,
        isPinned: data.isPinned ?? false,
        editableDepts: data.editableDepts ?? [],
        createdBy: userId,
      },
    });
    await this.logAudit(item.id, 'CREATE', {}, this.toSnapshot(item), userId);
    return item;
  }

  async update(id: string, data: {
    title?: string; content?: string; metadata?: Record<string, unknown>;
    sortOrder?: number; tags?: string[]; imageUrl?: string;
    publishFrom?: string; publishUntil?: string; isPinned?: boolean;
    editableDepts?: string[];
  }, userId: string) {
    const old = await this.findById(id);
    const updateData: Record<string, unknown> = { updatedBy: userId };
    const changes: Record<string, { old: unknown; new: unknown }> = {};

    const trackField = (field: string, newVal: unknown) => {
      const oldVal = (old as Record<string, unknown>)[field];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes[field] = { old: oldVal, new: newVal };
        updateData[field] = newVal;
      }
    };

    if (data.title !== undefined) trackField('title', data.title);
    if (data.content !== undefined) {
      // 🔴 W8/W9 정본: **본문 소거는 거부한다**(400). 목록 응답으로 상세를 덮어쓰는 사고
      // (/admin/forms 가 목록 select 에 schema 가 없어 문항을 전부 날린 건)와 같은 구조가
      // CMS 편집 화면 전체에 깔려 있다. 서버가 막지 않으면 스크립트·구버전 FE 가 같은 PUT 을 반복한다.
      if (!hasText(data.content) && hasText(old.content)) {
        throw new BadRequestException('본문을 빈 값으로 덮어쓸 수 없습니다 — 삭제하려면 콘텐츠를 삭제(휴지통)하세요');
      }
      trackField('content', data.content);
    }
    if (data.metadata !== undefined) {
      // 🔴 W9 실결함: 관리 화면의 '고급: 구조화 데이터' 텍스트에어리어는 JSON 파싱 실패 시
      //    조용히 `{}` 를 보낸다(오타 한 글자 = 구조화 데이터 전멸). 서버는 그걸 그대로 덮어썼다.
      //    → **최상위 키 병합**으로 바꾸고, 기존 키가 있는데 빈 객체가 오면 거부한다.
      //    (병합만 하면 `{"subType":""}` 같은 빈 컨테이너가 남아 '값이 있는데 화면은 빈' 그림자 결함이
      //     생기므로, 명시적으로 null 을 보낸 키만 제거한다.)
      const oldMeta = old.metadata as Record<string, unknown> | null;
      const emptied = emptiedKeys(oldMeta, data.metadata);
      if (emptied.length > 0) {
        throw new BadRequestException(
          `구조화 데이터 항목을 빈 값으로 덮어쓸 수 없습니다 (${emptied.join(', ')}) — 지우려면 해당 키를 null 로 지정하세요`,
        );
      }
      const merged = mergeMetadata(oldMeta, data.metadata);
      updateData.metadata = merged as Prisma.InputJsonValue;
      changes.metadata = { old: old.metadata, new: merged };
    }
    if (data.sortOrder !== undefined) trackField('sortOrder', data.sortOrder);
    if (data.tags !== undefined) trackField('tags', data.tags);
    if (data.imageUrl !== undefined) trackField('imageUrl', data.imageUrl);
    if (data.publishFrom !== undefined) { const v = data.publishFrom ? new Date(data.publishFrom) : null; updateData.publishFrom = v; }
    if (data.publishUntil !== undefined) { const v = data.publishUntil ? new Date(data.publishUntil) : null; updateData.publishUntil = v; }
    if (data.isPinned !== undefined) trackField('isPinned', data.isPinned);
    if (data.editableDepts !== undefined) trackField('editableDepts', data.editableDepts);

    const updated = await this.prisma.hospitalInfoContent.update({ where: { id }, data: updateData as Prisma.HospitalInfoContentUpdateInput });
    if (Object.keys(changes).length > 0) {
      await this.logAudit(id, 'UPDATE', changes, this.toSnapshot(old), userId);
    }
    return updated;
  }

  async toggle(id: string, userId: string) {
    const item = await this.findById(id);
    const updated = await this.prisma.hospitalInfoContent.update({
      where: { id },
      data: { isActive: !item.isActive, updatedBy: userId },
    });
    await this.logAudit(id, 'TOGGLE', { isActive: { old: item.isActive, new: !item.isActive } }, this.toSnapshot(item), userId);
    return updated;
  }

  async remove(id: string, userId?: string) {
    const item = await this.findById(id);
    if (userId) await this.logAudit(id, 'DELETE', {}, this.toSnapshot(item), userId);
    return this.prisma.hospitalInfoContent.delete({ where: { id } });
  }

  async bulkCreate(items: Array<{
    category: string; slug: string; title: string; content: string;
    metadata?: Record<string, unknown>; sortOrder?: number; tags?: string[];
  }>, userId: string) {
    const results = await this.prisma.$transaction(
      items.map(item =>
        this.prisma.hospitalInfoContent.upsert({
          where: { category_slug: { category: item.category, slug: item.slug } },
          create: {
            category: item.category, slug: item.slug, title: item.title,
            content: item.content, metadata: (item.metadata ?? {}) as Prisma.InputJsonValue,
            sortOrder: item.sortOrder ?? 0, tags: item.tags ?? [], createdBy: userId,
          },
          update: {
            title: item.title, content: item.content,
            metadata: (item.metadata ?? {}) as Prisma.InputJsonValue,
            tags: item.tags ?? [], updatedBy: userId,
          },
        })
      ),
    );
    return { created: results.length };
  }

  // ══════════════════════════════════════════════
  // 공개 API (환자포털·AI)
  // ══════════════════════════════════════════════

  /**
   * 공개 노출 조건 정본 — 발행(PUBLISHED)·활성·휴지통 아님·발행창 안.
   * 🔴 W9: 기존 공개 조회는 isActive+발행창만 봤다. DRAFT/SCHEDULED/ARCHIVED 를 관리자가
   *    '활성 토글'로 되살리면(toggle 은 status 를 보지 않는다) 미발행 글이 공개로 샌다.
   *    소프트삭제(휴지통) 도 deletedAt 만 찍고 목록에서 제외되지 않았다. 조건을 한 곳으로 모은다.
   */
  static publicVisibilityWhere(now: Date): Prisma.HospitalInfoContentWhereInput {
    return {
      isActive: true,
      status: 'PUBLISHED',
      deletedAt: null,
      AND: [
        { OR: [{ publishFrom: null }, { publishFrom: { lte: now } }] },
        { OR: [{ publishUntil: null }, { publishUntil: { gte: now } }] },
      ],
    };
  }

  async findPublic(category?: string) {
    const now = new Date();
    const where: Prisma.HospitalInfoContentWhereInput = HospitalInfoService.publicVisibilityWhere(now);
    if (category) where.category = category;

    return this.prisma.hospitalInfoContent.findMany({
      where,
      select: { id: true, category: true, slug: true, title: true, content: true, metadata: true, sortOrder: true, imageUrl: true, tags: true, isPinned: true, updatedAt: true },
      orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }, { title: 'asc' }],
    });
  }

  async searchPublic(q: string) {
    const now = new Date();
    const keywords = q.split(/\s+/).filter(Boolean);
    return this.prisma.hospitalInfoContent.findMany({
      where: {
        ...HospitalInfoService.publicVisibilityWhere(now),
        OR: [
          { tags: { hasSome: keywords } },
          { title: { contains: q, mode: 'insensitive' } },
          { content: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, category: true, slug: true, title: true, content: true, metadata: true, tags: true, isPinned: true },
      orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }],
      take: 10,
    });
  }

  // AI 도우미용: 키워드 매칭
  async findByTags(keywords: string[]) {
    const now = new Date();
    return this.prisma.hospitalInfoContent.findMany({
      where: {
        ...HospitalInfoService.publicVisibilityWhere(now),
        tags: { hasSome: keywords },
      },
      orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }],
      take: 3,
    });
  }

  /**
   * 공개 상세(슬러그) — 공개 화면 전용.
   * 🔴 W9: `/api/v1/public/departments/:slug` 가 findBySlug(관리자용)를 그대로 썼다.
   *    미발행(DRAFT)·보관(ARCHIVED)·휴지통 진료과 페이지가 슬러그만 알면 공개로 열렸다.
   */
  async findPublicBySlug(category: string, slug: string) {
    const item = await this.prisma.hospitalInfoContent.findFirst({
      where: { ...HospitalInfoService.publicVisibilityWhere(new Date()), category, slug },
      select: { id: true, category: true, slug: true, title: true, content: true, metadata: true, sortOrder: true, imageUrl: true, tags: true, isPinned: true, updatedAt: true },
    });
    if (!item) throw new NotFoundException('콘텐츠를 찾을 수 없습니다');
    return item;
  }

  // ══════════════════════════════════════════════
  // 의사 프로필
  // ══════════════════════════════════════════════

  async getDoctorProfiles(department?: string) {
    const where: Prisma.DoctorProfileWhereInput = { isPublic: true };
    if (department) where.user = { department };
    return this.prisma.doctorProfile.findMany({
      where,
      include: {
        user: { select: { id: true, familyName: true, givenName: true, department: true, specialty: true } },
      },
      orderBy: { user: { department: 'asc' } },
    });
  }

  async getDoctorProfile(userId: string) {
    return this.prisma.doctorProfile.findUnique({
      where: { userId },
      include: {
        user: { select: { id: true, familyName: true, givenName: true, department: true, specialty: true, email: true } },
      },
    });
  }

  /**
   * 공개 의료진 목록 — 공개(isPublic)이면서 재직 중인 사람만.
   * 🔴 W9: 기존 공개 목록은 user.isActive 를 보지 않아 퇴직자가 홈페이지에 계속 남았다.
   */
  async getPublicDoctorProfiles(department?: string) {
    const where: Prisma.DoctorProfileWhereInput = { isPublic: true, user: { isActive: true } };
    if (department) where.user = { department, isActive: true };
    return this.prisma.doctorProfile.findMany({
      where,
      select: {
        id: true, userId: true, position: true, education: true, career: true,
        certifications: true, research: true, languages: true, introduction: true,
        photoUrl: true, scheduleNote: true, isPublic: true, createdAt: true, updatedAt: true,
        user: { select: { id: true, familyName: true, givenName: true, department: true, specialty: true } },
      },
      orderBy: { user: { department: 'asc' } },
    });
  }

  /**
   * 공개 의료진 상세.
   * 🔴 W9(실측): `/api/v1/public/doctors/:userId` 가 isPublic 을 보지 않고 user.email 까지 실어 보냈다.
   *    운영에서 비공개 프로필 2건(건강검진센터·영상의학과 판독)이 직원 이메일과 함께 무인증 노출됨.
   *    → isPublic·재직 필터 + email 제거. 없으면 404(존재 여부도 흘리지 않는다).
   */
  async getPublicDoctorProfile(userId: string) {
    const doc = await this.prisma.doctorProfile.findFirst({
      where: { userId, isPublic: true, user: { isActive: true } },
      select: {
        id: true, userId: true, position: true, education: true, career: true,
        certifications: true, research: true, languages: true, introduction: true,
        photoUrl: true, scheduleNote: true, isPublic: true, createdAt: true, updatedAt: true,
        user: { select: { id: true, familyName: true, givenName: true, department: true, specialty: true } },
      },
    });
    if (!doc) throw new NotFoundException('의료진 정보를 찾을 수 없습니다');
    return doc;
  }

  async upsertDoctorProfile(userId: string, data: {
    position?: string; education?: string[]; career?: string[];
    certifications?: string[]; research?: string[]; languages?: string[];
    introduction?: string; photoUrl?: string; scheduleNote?: string; isPublic?: boolean;
  }) {
    return this.prisma.doctorProfile.upsert({
      where: { userId },
      create: {
        userId,
        position: data.position,
        education: data.education ?? [],
        career: data.career ?? [],
        certifications: data.certifications ?? [],
        research: data.research ?? [],
        languages: data.languages ?? ['한국어'],
        introduction: data.introduction,
        photoUrl: data.photoUrl,
        scheduleNote: data.scheduleNote,
        isPublic: data.isPublic ?? true,
      },
      update: data as Prisma.DoctorProfileUpdateInput,
    });
  }

  // ══════════════════════════════════════════════
  // CMS 변경이력 (Audit)
  // ══════════════════════════════════════════════

  private toSnapshot(item: Record<string, unknown>) {
    const { creator, updater, audits, ...rest } = item as Record<string, unknown>;
    return rest;
  }

  private async logAudit(contentId: string, action: string, changes: Record<string, unknown>, snapshot: Record<string, unknown>, userId: string) {
    await this.prisma.hospitalInfoAudit.create({
      data: {
        contentId,
        action,
        changes: changes as Prisma.InputJsonValue,
        snapshot: snapshot as Prisma.InputJsonValue,
        changedBy: userId,
      },
    });
  }

  async getHistory(contentId: string) {
    return this.prisma.hospitalInfoAudit.findMany({
      where: { contentId },
      include: { changer: { select: { id: true, familyName: true, givenName: true } } },
      orderBy: { changedAt: 'desc' },
      take: 50,
    });
  }

  async restoreVersion(contentId: string, auditId: string, userId: string) {
    /**
     * 🔴 (2026-09-16) 스냅샷을 id 로만 찾아, **다른 콘텐츠의 스냅샷으로 이 콘텐츠를 덮어쓸 수 있었다**
     *    (공개 사이트에 나가는 CMS 본문이다 — 제목·본문·게시기간이 남의 버전으로 바뀐다).
     *    스냅샷은 그 콘텐츠의 이력일 때만 복원 대상이다.
     */
    const audit = await this.prisma.hospitalInfoAudit.findFirst({ where: { id: auditId, contentId } });
    if (!audit || !audit.snapshot) throw new NotFoundException('스냅샷을 찾을 수 없습니다');
    const snap = audit.snapshot as Record<string, unknown>;

    const current = await this.findById(contentId);
    await this.logAudit(contentId, 'RESTORE', { restoredFrom: { old: null, new: auditId } }, this.toSnapshot(current), userId);

    /**
     * 🔴 (2026-09-03 재검증) 종전 복원은 두 겹으로 부분 복원이었다 —
     *    ① 버전에 담기는 publishFrom/publishUntil/editableDepts 를 **아예 쓰지 않아** 게시 기간·
     *       편집 권한은 복원되지 않은 채 "복원 완료"로 보였다.
     *    ② 스냅샷에 없는 키는 undefined 캐스팅으로 Prisma 가 조용히 건너뛰었다(구형 스냅샷).
     *    복원 못 한 필드를 지어내지 않고(막지도 않고) 응답에 밝힌다 — 부분 복원을 완전 복원처럼 말하지 않는다.
     */
    const FIELDS = ['title', 'content', 'metadata', 'sortOrder', 'tags', 'imageUrl', 'isPinned', 'isActive', 'publishFrom', 'publishUntil', 'editableDepts'] as const;
    const missing = FIELDS.filter((k) => !(k in snap));
    const dateOrNull = (v: unknown) => (typeof v === 'string' ? new Date(v) : v == null ? null : (v as Date));

    const restored = await this.prisma.hospitalInfoContent.update({
      where: { id: contentId },
      data: {
        title: snap.title as string,
        content: snap.content as string,
        metadata: snap.metadata as Prisma.InputJsonValue,
        sortOrder: snap.sortOrder as number,
        tags: snap.tags as string[],
        imageUrl: snap.imageUrl as string | null,
        isPinned: snap.isPinned as boolean,
        isActive: snap.isActive as boolean,
        // JSON 스냅샷의 DateTime 은 문자열로 온다 — 그대로 캐스팅하면 타입만 맞고 값이 깨진다
        publishFrom: 'publishFrom' in snap ? dateOrNull(snap.publishFrom) : undefined,
        publishUntil: 'publishUntil' in snap ? dateOrNull(snap.publishUntil) : undefined,
        editableDepts: Array.isArray(snap.editableDepts) ? (snap.editableDepts as string[]) : undefined,
        updatedBy: userId,
      },
    });
    return { ...restored, restoreSkippedFields: missing };
  }

  // ══════════════════════════════════════════════
  // CMS 내보내기/가져오기
  // ══════════════════════════════════════════════

  async exportAll() {
    const contents = await this.prisma.hospitalInfoContent.findMany({
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    });
    const doctors = await this.prisma.doctorProfile.findMany({
      include: { user: { select: { familyName: true, givenName: true, department: true, specialty: true } } },
    });
    return {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      contents: contents.map(c => ({
        category: c.category, slug: c.slug, title: c.title, content: c.content,
        metadata: c.metadata, sortOrder: c.sortOrder, isActive: c.isActive,
        imageUrl: c.imageUrl, tags: c.tags, isPinned: c.isPinned,
        publishFrom: c.publishFrom, publishUntil: c.publishUntil,
      })),
      doctorCount: doctors.length,
    };
  }

  async importAll(data: {
    contents: Array<{
      category: string; slug: string; title: string; content: string;
      metadata?: Record<string, unknown>; sortOrder?: number; isActive?: boolean;
      imageUrl?: string; tags?: string[]; isPinned?: boolean;
    }>;
  }, userId: string) {
    let created = 0;
    let updated = 0;
    for (const item of data.contents) {
      const existing = await this.prisma.hospitalInfoContent.findUnique({
        where: { category_slug: { category: item.category, slug: item.slug } },
      });
      if (existing) {
        await this.prisma.hospitalInfoContent.update({
          where: { id: existing.id },
          data: {
            title: item.title, content: item.content,
            metadata: (item.metadata ?? {}) as Prisma.InputJsonValue,
            sortOrder: item.sortOrder ?? 0, tags: item.tags ?? [],
            imageUrl: item.imageUrl, isPinned: item.isPinned ?? false,
            isActive: item.isActive ?? true, updatedBy: userId,
          },
        });
        await this.logAudit(existing.id, 'UPDATE', { source: { old: null, new: 'import' } }, this.toSnapshot(existing as unknown as Record<string, unknown>), userId);
        updated++;
      } else {
        const created_item = await this.prisma.hospitalInfoContent.create({
          data: {
            category: item.category, slug: item.slug, title: item.title,
            content: item.content, metadata: (item.metadata ?? {}) as Prisma.InputJsonValue,
            sortOrder: item.sortOrder ?? 0, tags: item.tags ?? [],
            imageUrl: item.imageUrl, isPinned: item.isPinned ?? false,
            isActive: item.isActive ?? true, createdBy: userId,
          },
        });
        await this.logAudit(created_item.id, 'CREATE', { source: { old: null, new: 'import' } }, {}, userId);
        created++;
      }
    }
    return { created, updated, total: data.contents.length };
  }

  // ══════════════════════════════════════════════
  // SEO 메타데이터 관리 (SystemConfig 기반)
  // ══════════════════════════════════════════════

  async getSeoEntries(): Promise<Array<{
    path: string; title: string; description: string;
    keywords: string; ogImage: string; ogType: string;
    canonical: string; noIndex: boolean; jsonLd: string;
    h1: string; score: number;
  }>> {
    const configs = await this.prisma.systemConfig.findMany({
      where: { category: 'seo' },
      orderBy: { key: 'asc' },
    });

    const entries: Record<string, Record<string, unknown>> = {};
    for (const c of configs) {
      // key format: seo.{path}.{field} e.g. seo./home.title
      const parts = c.key.replace('seo.', '').split('.');
      const field = parts.pop()!;
      const path = parts.join('.');
      if (!entries[path]) entries[path] = { path };
      entries[path][field] = c.value;
    }

    return Object.values(entries).map(e => ({
      path: String(e.path ?? ''),
      title: String(e.title ?? ''),
      description: String(e.description ?? ''),
      keywords: String(e.keywords ?? ''),
      ogImage: String(e.ogImage ?? ''),
      ogType: String(e.ogType ?? 'website'),
      canonical: String(e.canonical ?? ''),
      noIndex: e.noIndex === true || e.noIndex === 'true',
      jsonLd: String(e.jsonLd ?? ''),
      h1: String(e.h1 ?? ''),
      score: this.calculateSeoScore(e),
    }));
  }

  async upsertSeoEntry(path: string, data: Record<string, unknown>): Promise<void> {
    const fields = ['title', 'description', 'keywords', 'ogImage', 'ogType', 'canonical', 'noIndex', 'jsonLd', 'h1'];
    for (const field of fields) {
      if (data[field] === undefined) continue;
      const key = `seo.${path}.${field}`;
      await this.prisma.systemConfig.upsert({
        where: { key },
        create: { category: 'seo', key, value: data[field] as string, label: `SEO ${path} ${field}` },
        update: { value: data[field] as string },
      });
    }
  }

  async getSeoForPath(path: string): Promise<Record<string, unknown>> {
    const configs = await this.prisma.systemConfig.findMany({
      where: { category: 'seo', key: { startsWith: `seo.${path}.` } },
    });
    const result: Record<string, unknown> = { path };
    for (const c of configs) {
      const field = c.key.replace(`seo.${path}.`, '');
      result[field] = c.value;
    }
    return result;
  }

  private calculateSeoScore(entry: Record<string, unknown>): number {
    let score = 0;
    const title = String(entry.title ?? '');
    const desc = String(entry.description ?? '');
    const keywords = String(entry.keywords ?? '');

    // Title (30점)
    if (title.length > 0) score += 10;
    if (title.length >= 30 && title.length <= 60) score += 15;
    else if (title.length > 0 && title.length < 70) score += 8;
    if (title.includes('|') || title.includes('—')) score += 5;

    // Description (25점)
    if (desc.length > 0) score += 10;
    if (desc.length >= 80 && desc.length <= 160) score += 15;
    else if (desc.length > 0 && desc.length < 200) score += 8;

    // Keywords (10점)
    if (keywords.length > 0) score += 5;
    if (keywords.split(',').length >= 3) score += 5;

    // OG Image (15점)
    if (String(entry.ogImage ?? '').length > 0) score += 15;

    // Canonical (5점)
    if (String(entry.canonical ?? '').length > 0) score += 5;

    // JSON-LD (10점)
    if (String(entry.jsonLd ?? '').length > 0) score += 10;

    // H1 (5점)
    if (String(entry.h1 ?? '').length > 0) score += 5;

    return Math.min(100, score);
  }
}
