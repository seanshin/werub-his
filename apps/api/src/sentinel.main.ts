import { NestFactory } from '@nestjs/core';
import { Logger, Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { SentinelService } from './sentinel/sentinel.service';
import { SentinelReadService } from './sentinel/sentinel-read.service';
import { SENTINEL_INTERVAL_MIN } from './sentinel/sentinel-read.service';

/**
 * 상시 감시자 — **별도 프로세스**(pm2 `sentinel`). `dist/sentinel.js`.
 *
 * 🔴 왜 API 안이 아닌가(기획 §2 · 전부 형상 실측):
 *    - API 는 pm2 fork **단일 프로세스**다. 감시자가 그 안에 있으면 대상이 죽을 때 함께 죽는다.
 *    - 67 불변식은 전 테이블 조인이다. API 메모리 상한 1GB 를 밀면 재시작되고 그것이 곧 진료 중단이다.
 *    - 감시 규칙은 자주 바뀌는데 API 재배포는 빌드+부트 검증까지 무겁다.
 *
 * 🔴 컨트롤러를 띄우지 않는다(HTTP 없음). 화면은 API 가 원장을 읽어 준다.
 * 🔴 스윕이 실패해도 **프로세스는 살아 있어야 한다** — 죽으면 그 다음부터 아무것도 안 보인다.
 *    실패는 원장(`SentinelRun.error`)에 남고, 화면은 '마지막 성공 시각'으로 그 사실을 드러낸다.
 */
@Module({
  imports: [PrismaModule],
  providers: [SentinelService, SentinelReadService],
})
class SentinelAppModule {}

/** 저장소 루트 — dist/sentinel.js 기준 `apps/api/dist` → 상위 3단계 */
function repoRoot(): string {
  return process.env.SENTINEL_REPO_ROOT || resolve(__dirname, '../../..');
}

async function bootstrap() {
  const logger = new Logger('Sentinel');
  const app = await NestFactory.createApplicationContext(SentinelAppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const svc = app.get(SentinelService);
  const prisma = app.get(PrismaService);
  const root = repoRoot();
  const intervalMs = SENTINEL_INTERVAL_MIN * 60_000;

  logger.log(`감시자 기동 — 주기 ${SENTINEL_INTERVAL_MIN}분 · 저장소 ${root}`);

  /**
   * 프로브 읽기 — API 가 10분마다 원장에 적어 둔 것을 읽는다(HTTP 아님·토큰 불요).
   *
   * 🔴 행이 **낡으면 관측 불가**다. 그 낡음 자체가 "API 가 멈췄다"는 신호이므로
   *    '정상'으로 접지 않는다(그 구분이 이 감시자의 존재 이유다).
   */
  const PROBE_MAX_AGE_MIN = 30; // 적재 주기 10분 × 3
  const readProbe = async <T,>(key: string): Promise<{ value: T | null; reason: string | null }> => {
    try {
      const row = await prisma.sentinelProbe.findUnique({ where: { key } });
      if (!row) return { value: null, reason: `프로브 '${key}' 가 아직 적재되지 않았습니다(API 기동 후 10분 이내일 수 있습니다)` };
      const ageMin = Math.floor((Date.now() - row.capturedAt.getTime()) / 60_000);
      if (ageMin > PROBE_MAX_AGE_MIN) {
        return { value: null, reason: `프로브 '${key}' 가 ${ageMin}분 낡았습니다 — API 가 멈췄을 수 있습니다` };
      }
      return { value: row.payload as T, reason: null };
    } catch (e) {
      return { value: null, reason: `프로브 '${key}' 조회 실패: ${e instanceof Error ? e.message : e}` };
    }
  };

  /**
   * 등록 기대 크론 수 — 이보다 적으면 사라진 것이다.
   * 🔴 실측(2026-09-02) 54개 + 감시자 적재 1개. 늘리는 것은 자유지만 **줄이려면 왜 줄었는지 먼저 안다.**
   */
  const EXPECTED_CRONS = Number(process.env.SENTINEL_EXPECTED_CRONS || 50);

  let stopping = false;
  const runOnce = async () => {
    if (stopping) return;
    try {
      const r = await svc.sweepData(root);
      if (!r.ok) logger.warn(`축 A 부분 실패 — 저장 실패 ${r.failed}건(원장에 사유 기록)`);
    } catch (e) {
      // 🔴 삼키지 않는다 — 원장에는 서비스가 이미 남겼고, 여기서는 프로세스를 살린다
      logger.error(`축 A 스윕 실패(다음 주기에 재시도): ${e instanceof Error ? e.message : e}`);
    }
    try {
      const cron = await readProbe<never>('cron');
      const site = await readProbe<never>('publicSite');
      if (cron.reason) logger.warn(cron.reason);
      if (site.reason) logger.warn(site.reason);
      const r = await svc.sweepPipe(root, {
        cron: cron.value, publicSite: site.value, expectedCrons: EXPECTED_CRONS,
        cronReason: cron.reason, publicSiteReason: site.reason,
      });
      if (!r.ok) logger.warn(`축 D 부분 실패 — 저장 실패 ${r.failed}건`);
    } catch (e) {
      logger.error(`축 D 스윕 실패(다음 주기에 재시도): ${e instanceof Error ? e.message : e}`);
    }
    try {
      const r = await svc.sweepContract();
      if (!r.ok) logger.warn(`축 C 부분 실패 — 저장 실패 ${r.failed}건`);
    } catch (e) {
      logger.error(`축 C 스윕 실패(다음 주기에 재시도): ${e instanceof Error ? e.message : e}`);
    }
    try {
      const r = await svc.sweepFlow();
      if (!r.ok) logger.warn(`축 B 부분 실패 — 저장 실패 ${r.failed}건`);
    } catch (e) {
      logger.error(`축 B 스윕 실패(다음 주기에 재시도): ${e instanceof Error ? e.message : e}`);
    }
  };

  /**
   * 실시간 틱 — **1분마다**. 딥 스윕(60분)과 다른 층이다.
   * 🔴 값싼 지표만 본다(실측 1~12ms). 이 틱이 무거워지면 별도 프로세스로 뺀 의미가 사라진다.
   */
  let pruneCounter = 0;
  const tick = async () => {
    if (stopping) return;
    try {
      const r = await svc.tickPulse();
      if (r.failed) logger.warn(`펄스 틱 부분 실패 ${r.failed}건(원장에 0 을 쌓지 않았습니다)`);
    } catch (e) {
      logger.error(`펄스 틱 실패(다음 분에 재시도): ${e instanceof Error ? e.message : e}`);
    }
    // 60틱(1시간)마다 오래된 펄스 정리 — 시계열이 무한히 자라지 않게
    pruneCounter += 1;
    if (pruneCounter % 60 === 0) {
      try { await svc.prunePulse(); } catch (e) { logger.warn(`펄스 정리 실패: ${e instanceof Error ? e.message : e}`); }
    }
  };

  await runOnce();                       // 기동 즉시 1회 — 배포 직후 화면이 '미판정'으로 남지 않게
  await tick();                          // 실시간 축도 즉시 1점
  const timer = setInterval(runOnce, intervalMs);
  const pulseTimer = setInterval(tick, 60_000);

  const shutdown = async (sig: string) => {
    stopping = true;
    clearInterval(timer);
    clearInterval(pulseTimer);
    logger.log(`감시자 종료(${sig})`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap();
