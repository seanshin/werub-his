import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { configEnvOverride } from '../../common/config-env-overrides';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { aiEgressFetch } from '../../common/util/ai-egress-fetch';
import { registerAiCallLogSink, type AiCallLogRecord } from '../../common/util/ai-call-log-sink';
import {
  REQUIRED_MODEL_TAGS,
  REQUIRED_MODEL_TAG_LIST,
  computeMissingTags,
} from './required-model-tags';

/**
 * AI 호출 원장 + 모델 릴리즈 레지스트리 — 기획서 §2.2.
 *
 * 🔴 이 서비스가 하는 일은 셋뿐이다.
 *   ① 부트 시 `aiEgressFetch` 의 싱크에 자기를 꽂는다(그 파일은 DI 를 가질 수 없다).
 *   ② `AiCallLog` 를 **배치 없이 바로** 쓴다(큐를 만들지 않는다 — 큐는 유실을 숨긴다).
 *   ③ 관리 화면이 볼 수 있게 분포·상류 보유 모델을 낸다.
 *
 * 🔴 여기서 **판정하지 않는 것**: `source`/`reasonCode`/`verifyFailed`/`proposalId` 는 egress 층이
 *    알 수 없는 값이라 항상 null 로 남는다. 스킬 층이 채우기 전까지 그 컬럼의 0/공백은
 *    "그런 일이 없었다"가 아니라 **"이 층은 모른다"**이다.
 */
@Injectable()
export class AiCallLogService implements OnModuleInit {
  private readonly logger = new Logger(AiCallLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    registerAiCallLogSink((rec) => this.record(rec));
    this.logger.log('AiCallLog 싱크 등록 완료 — aiEgressFetch 호출마다 1행이 남습니다.');
  }

  /** 🔴 본문은 담기지 않는다(레코드 타입에 필드가 없다). 실패는 싱크가 삼키고 호출을 막지 않는다. */
  private async record(rec: AiCallLogRecord): Promise<void> {
    await this.prisma.aiCallLog.create({
      data: {
        skill: rec.skill,
        client: rec.client,
        requestedModel: rec.requestedModel,
        modelRef: rec.modelRef,
        latencyMs: rec.latencyMs,
        httpStatus: rec.httpStatus,
        bytes: rec.bytes,
        mode: rec.mode,
        // source·reasonCode·verifyFailed·proposalId 는 이 층이 모른다 → null(0 으로 채우지 않는다)
      },
    });
  }

  // ── 호출 분포 ───────────────────────────────────────────────────────────────
  /**
   * 기간별 모델×스킬 분포. 🔴 **분모(sample)를 함께 낸다** — 표본 0 이면 비율은 산출 불가다.
   * 자동 업데이트가 없다는 것은 문서가 아니라 이 분포가 증명한다(기획서 §2.2).
   */
  async callStats(days: number) {
    const windowDays = Math.min(Math.max(Number.isFinite(days) ? days : 7, 1), 90);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const grouped = await this.prisma.aiCallLog.groupBy({
      by: ['skill', 'requestedModel', 'modelRef', 'httpStatus'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });

    type Row = {
      skill: string;
      requestedModel: string | null;
      modelRef: string | null;
      calls: number;
      ok: number;
      failed: number;
      unknownStatus: number;
      /** 🔴 요청한 태그와 상류가 답한 태그가 다르다 — 다르면 그것이 사실이다 */
      mismatch: boolean;
    };
    const rows = new Map<string, Row>();
    const statusCounts = new Map<string, number>();
    let sample = 0;

    for (const g of grouped) {
      const n = g._count._all;
      sample += n;
      const key = JSON.stringify([g.skill, g.requestedModel, g.modelRef]);
      const row =
        rows.get(key) ??
        {
          skill: g.skill,
          requestedModel: g.requestedModel,
          modelRef: g.modelRef,
          calls: 0,
          ok: 0,
          failed: 0,
          unknownStatus: 0,
          mismatch:
            g.requestedModel != null && g.modelRef != null && g.requestedModel !== g.modelRef,
        };
      row.calls += n;
      if (g.httpStatus == null) row.unknownStatus += n;
      else if (g.httpStatus >= 200 && g.httpStatus < 300) row.ok += n;
      else row.failed += n;
      rows.set(key, row);

      const label =
        g.httpStatus == null
          ? '응답 없음(전송 실패·타임아웃)'
          : `${Math.floor(g.httpStatus / 100)}xx`;
      statusCounts.set(label, (statusCounts.get(label) ?? 0) + n);
    }

    return {
      windowDays,
      since: since.toISOString(),
      generatedAt: new Date().toISOString(),
      /** 🔴 분모. 0 이면 비율은 **산출 불가**이지 0% 가 아니다 */
      sample,
      rows: [...rows.values()].sort((a, b) => b.calls - a.calls),
      byStatusClass: [...statusCounts.entries()]
        .map(([label, calls]) => ({ label, calls }))
        .sort((a, b) => b.calls - a.calls),
      note:
        '이 원장은 aiEgressFetch 를 지난 호출만 담는다. 상류 태그(modelRef)는 응답이 JSON 이고 model/model_used 를 보고했을 때만 채워진다 — null 은 "모름"이지 "미보고 모델"이 아니다.',
    };
  }

  // ── 모델 릴리즈 레지스트리 ───────────────────────────────────────────────────
  async listReleases(includeRetired: boolean) {
    const items = await this.prisma.aiModelRelease.findMany({
      where: includeRetired ? {} : { retiredAt: null },
      orderBy: [{ deployedAt: 'desc' }],
      take: 200,
    });
    return { items, count: items.length, includeRetired };
  }

  async createRelease(input: {
    provider: string;
    modelTag: string;
    digest?: string | null;
    deployedAt?: string | null;
    approvalRef?: string | null;
    notes?: string | null;
    approvedBy: string | null;
  }) {
    try {
      return await this.prisma.aiModelRelease.create({
        data: {
          provider: input.provider,
          modelTag: input.modelTag,
          digest: input.digest ?? null,
          deployedAt: input.deployedAt ? new Date(input.deployedAt) : new Date(),
          approvedBy: input.approvedBy,
          // 🔴 승인 근거가 없으면 null — 있는 척하지 않는다(스키마 주석 규약)
          approvalRef: input.approvalRef ?? null,
          notes: input.notes ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          '같은 provider·modelTag·배포시각의 릴리즈가 이미 있습니다(같은 사실을 두 번 적지 않습니다).',
        );
      }
      throw e;
    }
  }

  /** 폐기 = 행을 지우는 것이 아니라 `retiredAt` 을 적는 것이다(일어난 일은 소급하지 않는다). */
  async retireRelease(id: string, notes?: string | null) {
    const cur = await this.prisma.aiModelRelease.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('릴리즈를 찾을 수 없습니다');
    if (cur.retiredAt) throw new ConflictException('이미 폐기된 릴리즈입니다');
    return this.prisma.aiModelRelease.update({
      where: { id },
      data: {
        retiredAt: new Date(),
        notes: notes ? `${cur.notes ? `${cur.notes}\n` : ''}[폐기] ${notes}` : cur.notes,
      },
    });
  }

  // ── 상류 보유 모델 실측 ──────────────────────────────────────────────────────
  /**
   * 🔴 **AI 서버에 실제로 물어본다.** 실패는 `{ available: null, reason }` 이다 —
   *    0 개로 접으면 "모든 모델이 없다"는 거짓 경보가 되고, 빈 배열로 접으면 판정이 뒤집힌다.
   *    `available` 이 null 이면 `missing` 도 null(판정 불가)이다.
   */
  async upstreamModels() {
    const checkedAt = new Date().toISOString();
    const base = {
      required: REQUIRED_MODEL_TAGS.map((t) => ({ tag: t.tag, sites: t.sites, note: t.note })),
      checkedAt,
      note: 'required 는 코드 상수 스냅샷(설정 ai.model 은 번역 1곳만 소비한다 — 나머지는 코드 고정).',
    };
    const row = await this.prisma.systemConfig.findFirst({ where: { key: 'ai.server.url' } });
    // 🔴 배포 환경변수가 DB 설정을 이긴다 — 정본 `common/config-env-overrides`
    const url = (configEnvOverride('ai.server.url') ?? String((row?.value as string | undefined) ?? '')).trim();
    if (!url) {
      return {
        ...base,
        available: null,
        missing: null,
        reason: 'ai.server.url 미설정 — AI 서버에 물어보지 않았습니다(판정 불가).',
      };
    }
    try {
      const res = await aiEgressFetch(url, '/api/tags', { method: 'GET' }, {
        client: 'admin/ai-model-registry',
        timeoutMs: 10_000,
      });
      if (!res.ok) {
        return { ...base, available: null, missing: null, reason: `AI 서버 응답 ${res.status}` };
      }
      const body = (await res.json()) as { models?: Array<{ name?: unknown; model?: unknown }> };
      const list = Array.isArray(body?.models) ? body.models : null;
      if (!list) {
        return {
          ...base,
          available: null,
          missing: null,
          reason: '응답에 models 배열이 없습니다(형식 불일치 — 빈 목록으로 읽지 않습니다).',
        };
      }
      const available = list
        .map((m) => (typeof m?.name === 'string' ? m.name : typeof m?.model === 'string' ? m.model : null))
        .filter((n): n is string => !!n);
      return { ...base, available, missing: computeMissingTags(available), reason: null };
    } catch (e) {
      // 🔴 3상태로 말한다 — 실패를 "없음"으로 번역하지 않는다.
      return {
        ...base,
        available: null,
        missing: null,
        reason: (e as Error)?.message ?? 'AI 서버 조회 실패(사유 미상)',
      };
    }
  }

  /** 화면 대조용 — 코드가 요구하는 태그 목록만(상류에 묻지 않는다). */
  requiredTags(): readonly string[] {
    return REQUIRED_MODEL_TAG_LIST;
  }
}
