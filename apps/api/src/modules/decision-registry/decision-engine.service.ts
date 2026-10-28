import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { DECISION_REGISTRY, type DecisionDef } from './decision.registry';
import {
  configKeysOf, decidedConfigOf, downstreamOf, governedConfigMap, isNegativeChoice, mechanismOf, sameConfigValue,
} from './decision-engine';
import { DEV_APPLY_IMPLEMENTED } from './dev-apply-baseline';
import {
  DECISION_CONFIG_GUARD_DEFAULT, DECISION_CONFIG_GUARD_KEY, DECISION_LOG_KINDS, RELEASE_VERSION_RE, upstreamChangedAfter,
  type DecisionLogKind, type DevApplyEvent,
} from '@hospital-run/shared';

/** 결정 기록의 모양(엔진이 읽는 칸만) — 정본 타입은 `decision.service.ts` `DecisionRecord` */
export interface EngineRecord {
  choice: string; legalReviewRef?: string; authorityClaim?: string; note?: string;
  decidedAt?: string; applied?: boolean; appliedDetail?: string;
  committeeDecision?: { id: string; decisionNo: string };
}

const SEED_RE = /DEV-SEED|개발 시드/i;
const isSeed = (r: EngineRecord | null | undefined) => !!r && SEED_RE.test(`${r.legalReviewRef ?? ''} ${r.authorityClaim ?? ''} ${r.note ?? ''}`);
const KEY = (k: string) => `decision.${k}`;

/** 설정 화면 → 엔진 이벤트(설정 모듈은 결정 모듈을 import 하지 못한다 — 순환) */
export const CONFIG_GUARD_EVENT = 'decision.configGuard';
export interface ConfigGuardEvent {
  phase: 'check' | 'blocked' | 'changed';
  key: string; value: unknown; prev?: unknown; actorUserId?: string;
}
export interface ConfigGuardVerdict {
  mode: 'OFF' | 'WARN' | 'BLOCK';
  governing: Array<{ key: string; title: string; seeded: boolean; decidedValue: unknown; matches: boolean }>;
  block: boolean;
}
/** 위원회 의결 → 등록부 기록 이벤트(거버넌스 모듈은 결정 모듈을 import 하지 못한다 — 순환) */
export const COMMITTEE_RECORDED_EVENT = 'decision.committeeRecorded';

/**
 * 결정 엔진 — 결정이 **기록된 뒤** 무엇이 따라 움직이는가.
 *
 *  · 이력: 결정·의결·선행 변경·설정 직접 변경을 원장에 **덧붙인다**(고치지도 지우지도 않는다)
 *  · 전후 관계: 결정이 바뀌면 그 결정에 기대는 후행 실결정에 "선행 결정 변경"을 남긴다 → 화면은 "재검토 필요"
 *    🔴 후행 결정을 **자동으로 되돌리지 않는다** — 끊는 방향의 자동은 사람 판단이다(표시하고 기록할 뿐)
 *  · 보호: 결정에 묶인 설정을 결정 경로 밖에서 바꾸면 기록(WARN) 또는 차단(BLOCK · 실결정만)
 *  · 영향 미리보기: 고르기 **전에** 무엇이 바뀌는지(설정·후행·선행)
 * 🔴 원장 쓰기 실패는 결정을 되돌리지 않는다 — 결정은 이미 일어난 사실이다. 대신 실패를 돌려준다(없음으로 접지 않는다).
 */
@Injectable()
export class DecisionEngineService {
  private readonly logger = new Logger(DecisionEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigRuntimeService,
  ) {}

  private def(key: string): DecisionDef {
    const d = DECISION_REGISTRY.find((x) => x.key === key);
    if (!d) throw new NotFoundException({ code: 'DECISION_NOT_FOUND', message: '등록되지 않은 결정입니다', details: { key } });
    return d;
  }

  private async append(e: {
    decisionKey: string; kind: DecisionLogKind; choice?: string | null; prevChoice?: string | null;
    basisRef?: string | null; authorityClaim?: string | null; actorUserId?: string | null; sourceKey?: string | null;
    committeeDecisionId?: string | null; detail?: Record<string, unknown>; occurredAt?: Date;
  }) {
    if (!(DECISION_LOG_KINDS as readonly string[]).includes(e.kind)) throw new Error(`DECISION_LOG_KIND_UNKNOWN ${e.kind}`); // 원장 어휘 밖 사건 — 내부 오류(화면 문장 아님)
    const uuidOrNull = (v: string | null | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
    return this.prisma.decisionLogEntry.create({
      data: {
        decisionKey: e.decisionKey, kind: e.kind,
        choice: e.choice?.slice(0, 80) ?? null, prevChoice: e.prevChoice?.slice(0, 80) ?? null,
        basisRef: e.basisRef ?? null, authorityClaim: e.authorityClaim ?? null,
        actorUserId: uuidOrNull(e.actorUserId), sourceKey: e.sourceKey ?? null,
        committeeDecisionId: uuidOrNull(e.committeeDecisionId),
        detail: (e.detail ?? undefined) as never,
        occurredAt: e.occurredAt ?? new Date(),
      },
    });
  }

  private async records(keys: string[]): Promise<Map<string, EngineRecord | null>> {
    const cfg = await this.config.getMany(keys.map(KEY));
    const out = new Map<string, EngineRecord | null>();
    for (const k of keys) {
      const v = cfg.get(KEY(k));
      out.set(k, v && typeof v === 'object' && typeof (v as EngineRecord).choice === 'string' ? (v as EngineRecord) : null);
    }
    return out;
  }

  /**
   * 결정이 기록됐다 — 원장에 남기고 후행 실결정에 선행 변경을 전파한다.
   * 반환: 원장에 남겼는가 · 전파한 후행 결정 키
   */
  async onRecorded(input: {
    key: string; prev: EngineRecord | null; next: EngineRecord;
    kind: 'RECORDED' | 'COMMITTEE_RESOLVED'; actorUserId?: string | null;
  }): Promise<{ logged: boolean; propagatedTo: string[]; error?: string }> {
    const { key, prev, next } = input;
    const propagatedTo: string[] = [];
    try {
      await this.append({
        decisionKey: key, kind: input.kind, choice: next.choice, prevChoice: prev?.choice ?? null,
        basisRef: next.legalReviewRef ?? null, authorityClaim: next.authorityClaim ?? null,
        actorUserId: input.actorUserId ?? null, committeeDecisionId: next.committeeDecision?.id ?? null,
        detail: {
          applied: next.applied ?? null, appliedDetail: next.appliedDetail ?? null,
          ...(next.note ? { note: next.note } : {}),
          ...(prev ? { replaced: { choice: prev.choice, seeded: isSeed(prev), decidedAt: prev.decidedAt ?? null } } : {}),
        },
      });
      // 🔴 개발 반영 결정 — 실결정이 이미 구현된 시드 동작과 다르면 "되돌림 필요"를 시스템이 남긴다(기획 P2-1)
      //    시드 기록은 실결정이 아니라 남기지 않는다 · 같은 선택이면 남기지 않는다(반영 확인은 사람이)
      const implemented = DEV_APPLY_IMPLEMENTED[key];
      if (implemented !== undefined && !isSeed(next) && next.choice !== implemented && mechanismOf(this.def(key)) === 'DEV_APPLY') {
        await this.append({
          decisionKey: key, kind: 'DEV_REVERT_NEEDED', choice: next.choice, actorUserId: null,
          detail: { implementedChoice: implemented, note: '판정표(docs/05-reference/decision-dev-apply-baseline.md): 코드는 이미 다른 선택대로 동작한다 — 되돌리는 개발이 필요하다' },
        });
      }
      // 🔴 선택이 그대로면 후행에 전파하지 않는다(근거만 다시 적은 기록이 후행을 흔들지 않게)
      if (prev && prev.choice === next.choice && !isSeed(prev)) return { logged: true, propagatedTo };
      const downs = downstreamOf(key);
      if (!downs.length) return { logged: true, propagatedTo };
      const recs = await this.records(downs.map((d) => d.key));
      for (const d of downs) {
        const r = recs.get(d.key) ?? null;
        if (!r || isSeed(r)) continue; // 후행이 미결이거나 시드면 흔들 결정이 없다(시드는 실결정이 아니다)
        await this.append({
          decisionKey: d.key, kind: 'UPSTREAM_CHANGED', choice: r.choice, sourceKey: key,
          detail: {
            upstreamPrev: prev?.choice ?? null, upstreamNext: next.choice,
            // 🔴 선행이 부정 결정이 됐다 — 이 결정은 이제 적용 근거를 잃었다(자동으로 되돌리지 않는다)
            upstreamNegative: isNegativeChoice(next.choice),
          },
        });
        propagatedTo.push(d.key);
      }
      return { logged: true, propagatedTo };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`결정 이력 원장 쓰기 실패(key=${key}) — 결정 기록은 남았다: ${msg}`);
      return { logged: false, propagatedTo, error: '결정 이력 원장에 남기지 못했다' };
    }
  }

  /** 위원회 의결 이벤트 — 거버넌스 모듈이 보낸다 */
  @OnEvent(COMMITTEE_RECORDED_EVENT, { promisify: true })
  async onCommitteeRecorded(p: { key: string; prev: EngineRecord | null; next: EngineRecord; actorUserId?: string | null }) {
    return this.onRecorded({ ...p, kind: 'COMMITTEE_RESOLVED' });
  }

  private async guardMode(): Promise<'OFF' | 'WARN' | 'BLOCK'> {
    const v = await this.config.get(DECISION_CONFIG_GUARD_KEY);
    return v === 'OFF' || v === 'WARN' || v === 'BLOCK' ? v : DECISION_CONFIG_GUARD_DEFAULT;
  }

  /**
   * 설정 화면 경로 — 결정에 묶인 설정인지 판정(check) · 막힘/변경을 원장에 남김(blocked/changed).
   * 🔴 결정이 정한 값으로 되돌리는 변경은 막지 않는다(보호는 결정과 갈라지는 것을 막는 것이다).
   */
  @OnEvent(CONFIG_GUARD_EVENT, { promisify: true })
  async onConfigGuard(ev: ConfigGuardEvent): Promise<ConfigGuardVerdict | null> {
    const decisionKeys = governedConfigMap().get(ev.key) ?? [];
    if (!decisionKeys.length) return null;
    const mode = await this.guardMode();
    const recs = await this.records(decisionKeys);
    const governing = decisionKeys.flatMap((k) => {
      const r = recs.get(k) ?? null;
      if (!r) return []; // 미결 결정은 아직 아무것도 정하지 않았다
      const d = this.def(k);
      const decided = decidedConfigOf(d, r.choice).find((c) => c.key === ev.key);
      const decidedValue = decided ? decided.value : null;
      return [{ key: k, title: d.title, seeded: isSeed(r), decidedValue, matches: decided ? sameConfigValue(decided.value, ev.value) : false, hasValue: !!decided }];
    });
    const verdict: ConfigGuardVerdict = {
      mode,
      governing: governing.map(({ hasValue: _h, ...g }) => g),
      block: mode === 'BLOCK' && governing.some((g) => !g.seeded && g.hasValue && !g.matches),
    };
    if (ev.phase === 'check' || mode === 'OFF' || !governing.length) return verdict;
    try {
      for (const g of governing) {
        await this.append({
          decisionKey: g.key, kind: ev.phase === 'blocked' ? 'CONFIG_OVERRIDE_BLOCKED' : 'CONFIG_OVERRIDE',
          sourceKey: ev.key, actorUserId: ev.actorUserId ?? null,
          detail: { configKey: ev.key, prev: ev.prev ?? null, value: ev.value ?? null, decidedValue: g.decidedValue, matchesDecision: g.matches, seeded: g.seeded, mode },
        });
      }
    } catch (e) {
      this.logger.error(`설정 직접 변경 원장 쓰기 실패(${ev.key}): ${e instanceof Error ? e.message : String(e)}`);
    }
    return verdict;
  }

  /** 고르기 전 영향 — 설정·후행·선행 */
  async impact(key: string, choice: string) {
    const d = this.def(key);
    if (!d.options.some((o) => o.value === choice)) {
      throw new BadRequestException({ code: 'DECISION_INVALID_CHOICE', message: '선택지에 없는 값입니다' });
    }
    const downs = downstreamOf(key);
    const recs = await this.records([key, ...downs.map((x) => x.key), ...(d.dependsOn ?? [])]);
    const cur = recs.get(key) ?? null;
    const changes = decidedConfigOf(d, choice);
    const cfg = changes.length ? await this.config.getMany(changes.map((c) => c.key)) : new Map<string, unknown>();
    const mode = await this.guardMode();
    const negative = isNegativeChoice(choice);
    return {
      key, choice, currentChoice: cur?.choice ?? null, currentSeeded: isSeed(cur),
      /** 이 선택이 바꾸는 설정(현재 값 → 바뀔 값) · 경로상 지금 적용되는지는 approvalPath 가 정한다 */
      configChanges: changes.map((c) => ({ key: c.key, current: cfg.get(c.key) ?? null, next: c.value, changes: !sameConfigValue(cfg.get(c.key), c.value) })),
      appliesNow: d.approvalPath === 'AUTHORIZED_ROLE',
      approvalPath: d.approvalPath,
      /** 이 결정이 정하는 설정 — 기록 뒤 보호 대상 */
      protectedKeys: configKeysOf(d),
      protectionMode: mode,
      /** 후행 결정에 미치는 영향 */
      downstream: downs.map((x) => {
        const r = recs.get(x.key) ?? null;
        const real = !!r && !isSeed(r);
        return {
          key: x.key, title: x.title, layer: x.layer, decided: real, choice: r?.choice ?? null,
          // REVIEW = 이미 실결정이 있어 재검토 대상이 된다 · BLOCKS = 아직 미결인데 이 선택이면 열리지 않는다 · UNLOCKS = 열린다
          effect: real ? 'REVIEW' : negative ? 'BLOCKS' : 'UNLOCKS',
          loseBasis: real && negative,
        };
      }),
      /** 이 결정의 선행 — 미결·부정이면 기록해도 적용되지 않는다 */
      upstream: (d.dependsOn ?? []).map((u) => {
        const r = recs.get(u) ?? null;
        const real = !!r && !isSeed(r);
        return { key: u, title: DECISION_REGISTRY.find((x) => x.key === u)?.title ?? u, decided: real, choice: r?.choice ?? null, satisfied: real && !isNegativeChoice(r!.choice) };
      }),
    };
  }

  /** 결정 하나의 이력 — 오래된 것부터(문서는 경과 순서로 읽는다) */
  async logFor(key: string) {
    this.def(key);
    return this.prisma.decisionLogEntry.findMany({ where: { decisionKey: key }, orderBy: { occurredAt: 'asc' }, take: 500 });
  }

  /** 전체 이력 — 최신부터 · 커서(`<ISO>|<id>`) · 🔴 자르면 잘랐다고 말한다(`nextCursor`) */
  async log(q: { limit?: number; cursor?: string; kind?: string; key?: string }) {
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    const where: Record<string, unknown> = {};
    if (q.kind) {
      if (!(DECISION_LOG_KINDS as readonly string[]).includes(q.kind)) throw new BadRequestException({ code: 'DECISION_LOG_KIND', message: '이력 종류가 아닙니다' });
      where.kind = q.kind;
    }
    if (q.key) where.decisionKey = q.key;
    if (q.cursor) {
      const [at, id] = q.cursor.split('|');
      const t = new Date(at);
      if (!id || Number.isNaN(t.getTime())) throw new BadRequestException({ code: 'DECISION_LOG_CURSOR', message: '커서 형식이 아닙니다' });
      where.OR = [{ occurredAt: { lt: t } }, { occurredAt: t, id: { lt: id } }];
    }
    const [rows, total] = await Promise.all([
      this.prisma.decisionLogEntry.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: limit + 1 }),
      this.prisma.decisionLogEntry.count({ where: { ...(q.kind ? { kind: q.kind } : {}), ...(q.key ? { decisionKey: q.key } : {}) } }),
    ]);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({ ...r, title: DECISION_REGISTRY.find((d) => d.key === r.decisionKey)?.title ?? null })),
      total,
      nextCursor: rows.length > limit && last ? `${last.occurredAt.toISOString()}|${last.id}` : null,
    };
  }

  /** 목록 신호 — 결정별 최신 재검토 확인 시각 · 이력 건수 · 보호 수준(한 번에 읽는다) */
  async listSignals(): Promise<{ lastReview: Map<string, string>; counts: Map<string, number>; protectionMode: 'OFF' | 'WARN' | 'BLOCK'; devEvents: Map<string, DevApplyEvent[]> }> {
    const [lastReview, grouped, protectionMode, devRows] = await Promise.all([
      this.lastReviewConfirmedAt(),
      this.prisma.decisionLogEntry.groupBy({ by: ['decisionKey'], _count: { _all: true } }),
      this.guardMode(),
      this.prisma.decisionLogEntry.findMany({
        where: { kind: { in: ['DEV_ENACTED', 'DEV_NOT_REQUIRED', 'DEV_REVERT_NEEDED'] } },
        select: { decisionKey: true, kind: true, choice: true, occurredAt: true, detail: true },
      }),
    ]);
    const devEvents = new Map<string, DevApplyEvent[]>();
    for (const r of devRows) {
      const version = (r.detail as { version?: unknown } | null)?.version;
      devEvents.set(r.decisionKey, [...(devEvents.get(r.decisionKey) ?? []), {
        kind: r.kind, choice: r.choice, occurredAt: r.occurredAt.toISOString(), version: typeof version === 'string' ? version : null,
      }]);
    }
    return { lastReview, counts: new Map(grouped.map((g) => [g.decisionKey, g._count._all])), protectionMode, devEvents };
  }

  /**
   * 개발 반영 기록 — 개발이 실결정 선택대로 반영했다(DEV_ENACTED) / 실결정 = 현행이라 할 일 없다(DEV_NOT_REQUIRED).
   * 🔴 개발 반영 결정에만 · 실결정(시드 아님)이 있을 때만 · 근거 필수 · 반영 확인은 릴리즈 버전 필수.
   * 🔴 "되돌림 필요"가 남은 결정에 "할 일 없음"을 남기지 못한다(코드가 다른 선택대로 돈다 — 되돌리고 반영 확인으로 닫는다).
   */
  async recordDevEnactment(key: string, userId: string, input: { kind: 'DEV_ENACTED' | 'DEV_NOT_REQUIRED'; version?: string | null; note: string }) {
    const d = this.def(key);
    if (mechanismOf(d) !== 'DEV_APPLY') throw new BadRequestException({ code: 'DEV_APPLY_NOT_APPLICABLE', message: '개발 반영 방식의 결정이 아닙니다' });
    const note = (input.note ?? '').trim();
    if (note.length < 2) throw new BadRequestException({ code: 'DEV_APPLY_NOTE_REQUIRED', message: '근거를 적어야 합니다' });
    const version = (input.version ?? '').trim();
    if (input.kind === 'DEV_ENACTED' && !RELEASE_VERSION_RE.test(version)) {
      throw new BadRequestException({ code: 'DEV_APPLY_VERSION_REQUIRED', message: '반영 확인에는 릴리즈 버전(vX.Y.Z)이 필요합니다' });
    }
    const me = (await this.records([key])).get(key) ?? null;
    if (!me || isSeed(me)) throw new BadRequestException({ code: 'DEV_APPLY_NOT_DECIDED', message: '실결정이 없는 결정은 반영 기록 대상이 아닙니다(개발 시드는 결정이 아닙니다)' });
    if (input.kind === 'DEV_NOT_REQUIRED') {
      const implemented = DEV_APPLY_IMPLEMENTED[key];
      if (implemented !== undefined && implemented !== me.choice) {
        throw new BadRequestException({ code: 'DEV_APPLY_REVERT_PENDING', message: '코드가 다른 선택대로 동작합니다 — 되돌린 뒤 반영 확인으로 남기세요' });
      }
    }
    return this.append({
      decisionKey: key, kind: input.kind, choice: me.choice, actorUserId: userId,
      detail: { note, ...(input.kind === 'DEV_ENACTED' ? { version } : {}) },
    });
  }

  /** 결정별 최신 재검토 확인 시각 — 목록이 한 번에 읽는다 */
  async lastReviewConfirmedAt(): Promise<Map<string, string>> {
    const rows = await this.prisma.decisionLogEntry.findMany({
      where: { kind: 'REVIEW_CONFIRMED' }, select: { decisionKey: true, occurredAt: true }, orderBy: { occurredAt: 'asc' },
    });
    return new Map(rows.map((r) => [r.decisionKey, r.occurredAt.toISOString()]));
  }

  /**
   * 재검토 확인 — 선행 결정이 바뀐 뒤 사람이 "이 결정은 그대로 유효하다"고 남긴다.
   * 🔴 바꿔야 하면 결정을 다시 기록한다 — 확인은 선택을 바꾸지 않는다. 재검토 대상이 아니면 거부(빈 확인을 쌓지 않는다).
   */
  async reviewConfirm(key: string, userId: string, note: string) {
    const d = this.def(key);
    const text = (note ?? '').trim();
    if (text.length < 2) throw new BadRequestException({ code: 'DECISION_REVIEW_NOTE_REQUIRED', message: '재검토 근거를 적어야 합니다' });
    const recs = await this.records([key, ...(d.dependsOn ?? [])]);
    const me = recs.get(key) ?? null;
    if (!me || isSeed(me)) throw new BadRequestException({ code: 'DECISION_REVIEW_NOT_DECIDED', message: '실결정이 없는 항목은 재검토 확인 대상이 아닙니다' });
    const last = (await this.lastReviewConfirmedAt()).get(key) ?? null;
    const changed = upstreamChangedAfter({
      myDecidedAt: me.decidedAt, lastReviewConfirmedAt: last,
      upstream: (d.dependsOn ?? []).map((u) => { const r = recs.get(u) ?? null; return { key: u, decidedAt: r && !isSeed(r) ? r.decidedAt : null }; }),
    });
    if (!changed.length) throw new BadRequestException({ code: 'DECISION_REVIEW_NOT_NEEDED', message: '선행 결정이 이 결정 뒤에 바뀌지 않았습니다' });
    return this.append({
      decisionKey: key, kind: 'REVIEW_CONFIRMED', choice: me.choice, actorUserId: userId,
      detail: { note: text, upstreamChanged: changed.map((u) => ({ key: u, choice: recs.get(u)?.choice ?? null })) },
    });
  }
}
