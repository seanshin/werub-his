import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TranslationOverrideStatus, UserRole } from '@prisma/client';
import * as crypto from 'crypto';
import {
  I18N_VALUE_ORIGIN_TEXT,
  getLocalePack,
  localeCoverage,
  type I18nReviewState,
  type I18nValueOrigin,
} from '@hospital-run/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { areaCodes, codeEntriesFor, contextGapSet, usageIndex } from './catalog-source';
import { classifySafetyKey } from './safety-keys';
import { buildExportText } from './export-shape';
import type { ProposeDto, RejectKeyDto, ReviewFilter } from './dto/i18n-review.dto';

export interface ActorLike {
  id?: string;
  role?: UserRole | string;
}

/** 권한 판정 결과 — 🔴 못 하는 이유를 **말한다**(숨김 ≠ 권한 회수) */
export interface ReviewPermission {
  locale: string;
  canPropose: boolean;
  canApprove: boolean;
  canMarkMerged: boolean;
  /** 왜 되는가/왜 안 되는가 — 화면이 그대로 보여준다 */
  reason: string;
  /** 설정에 등록된 이 언어의 검수자 수. null = 설정 조회 실패(0 과 다른 사실) */
  reviewerCount: number | null;
  configKey: string;
}

export interface ReviewRow {
  /** 오버레이 행이 아직 없으면 null */
  id: string | null;
  locale: string;
  key: string;
  /** 표시용 원문(문맥 꼬리 제거) */
  source: string;
  /** `원문@문맥` 의 문맥. 없으면 null — 🔴 왜 갈렸는지가 검수의 핵심 정보다 */
  context: string | null;
  area: string;
  /** 코드 초안값. null = 코드에 번역이 없다 */
  codeValue: string | null;
  codeVerified: boolean;
  overlayValue: string | null;
  status: I18nReviewState;
  /** 지금 화면에 나가는 값 */
  effectiveValue: string | null;
  effectiveOrigin: I18nValueOrigin;
  effectiveOriginText: string;
  safetyKey: boolean;
  safetyReason: string | null;
  /**
   * 🔴 무문맥은 번역돼 있는데 문맥 변형이 없는 자리 = 뜻이 틀린 번역이 나가는 자리.
   *    `null` = 그 언어 팩이 없어 **산출 불가**(false 로 그리면 "결손 아님"과 구분되지 않는다).
   */
  contextGap: boolean | null;
  /** 제안 당시 코드 값이 그 뒤 바뀌었는가 */
  baseChanged: boolean;
  baseValue: string | null;
  /** 제안자가 적은 근거. 🔴 승인·반려가 이 칸을 덮지 않는다 */
  note: string | null;
  /** 최신 결정(승인·반려·코드반영)의 사유 — 전이 원장 파생. 결정 전이거나 사유 미기재면 null */
  decisionReason: string | null;
  decisionAt: string | null;
  proposedBy: string | null;
  proposedByName: string | null;
  proposedAt: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  mergedAt: string | null;
  /** 🔴 제안자 = 승인자. 막지 않고 **사실을 싣는다**(4-eyes) */
  selfApproved: boolean;
  /**
   * 🔴 **"번역하지 않는다"로 판정된 키**(§2.4 · 키만으로 반려). 빈 `draftValue` 가 그 표현이다.
   *    `overlayValue: ''` 를 화면이 "값 있음"으로 읽지 않도록 서버가 어휘를 준다(FE 가 지어내지 않게).
   */
  noTranslate: boolean;
  /** 이 키를 쓰는 화면. null = 셀 수 없었다(빈 배열 = 쓰는 곳 없음과 다른 사실) */
  usedIn: string[] | null;
}

const CONFIG_KEY = 'i18n.reviewers';

/**
 * 언어팩 사람 검수 — 오버레이 원장 서비스
 * (정본 `docs/01-plan/features/i18n-human-review.plan.md`).
 *
 * 🔴 **일괄 승인이 없다**(§2.3). 이 서비스에도 다건 승인 메서드를 두지 않는다 —
 *    EP 만 막고 서비스에 남겨두면 다음 갈래가 그것을 부른다.
 * 🔴 **코드 초안값은 shared 에서 읽는다**(`catalog-source.ts`). DB 에 복제하지 않는다.
 */
@Injectable()
export class I18nReviewService {
  private readonly logger = new Logger(I18nReviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  /* ── 권한 ──────────────────────────────────────────────────────────────── */

  /**
   * 설정 `i18n.reviewers` — 언어 → userId[]. 등록부 결정 `i18n.reviewOwnership` 과 연결된다.
   * 🔴 조회 실패를 "검수자 없음"으로 번역하지 않는다 — null 을 돌려주고 화면이 그 사실을 말한다.
   */
  async reviewersOf(locale: string): Promise<string[] | null> {
    let row: { value: Prisma.JsonValue } | null;
    try {
      row = await this.prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY }, select: { value: true } });
    } catch (e) {
      this.logger.warn(`${CONFIG_KEY} 조회 실패: ${(e as Error).message}`);
      return null; // 실패는 없음이 아니다
    }
    if (!row) return []; // 미설정 = 지정된 검수자 0명(조회는 성공했다)
    const v = row.value as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') return [];
    const list = (v as Record<string, unknown>)[locale];
    if (!Array.isArray(list)) return [];
    return list.filter((x): x is string => typeof x === 'string');
  }

  async permissionFor(user: ActorLike, locale: string): Promise<ReviewPermission> {
    const isAdmin = user?.role === UserRole.ADMIN;
    const reviewers = await this.reviewersOf(locale);
    const isReviewer = !!user?.id && !!reviewers && reviewers.includes(user.id);
    const reviewerCount = reviewers ? reviewers.length : null;
    let reason: string;
    if (isAdmin) {
      reason = `ADMIN — 전 언어 검수·승인·코드 반영 표시가 가능합니다(설정 ${CONFIG_KEY} 무관).`;
    } else if (isReviewer) {
      reason = `설정 ${CONFIG_KEY} 에 ${locale} 검수자로 등록되어 있습니다. 제안·승인·반려가 가능하고, 코드 반영 표시는 ADMIN 몫입니다.`;
    } else if (reviewers === null) {
      reason = `설정 ${CONFIG_KEY} 를 읽지 못했습니다 — 권한을 판정할 수 없어 쓰기를 막습니다(권한이 없다는 뜻이 아닙니다).`;
    } else if (reviewers.length === 0) {
      reason = `설정 ${CONFIG_KEY} 에 ${locale} 검수자가 아직 지정되지 않았습니다. 지정은 사람 결정입니다(등록부 i18n.reviewOwnership) — 관리자에게 등록을 요청하세요.`;
    } else {
      reason = `설정 ${CONFIG_KEY} 의 ${locale} 검수자 ${reviewers.length}명에 포함되어 있지 않습니다. 읽기는 열려 있고 쓰기만 막힙니다.`;
    }
    return {
      locale,
      canPropose: isAdmin || isReviewer,
      canApprove: isAdmin || isReviewer,
      canMarkMerged: isAdmin,
      reason,
      reviewerCount,
      configKey: CONFIG_KEY,
    };
  }

  private async assertCanWrite(user: ActorLike, locale: string, kind: 'propose' | 'decide' | 'merged'): Promise<ReviewPermission> {
    const p = await this.permissionFor(user, locale);
    const ok = kind === 'merged' ? p.canMarkMerged : kind === 'propose' ? p.canPropose : p.canApprove;
    if (!ok) {
      throw new ForbiddenException({
        code: kind === 'merged' ? 'I18N_MERGE_REQUIRES_ADMIN' : 'I18N_NOT_REVIEWER',
        message: p.reason,
        details: { locale, configKey: CONFIG_KEY, reviewerCount: p.reviewerCount },
      });
    }
    return p;
  }

  /* ── 런타임 오버레이 ───────────────────────────────────────────────────── */

  /**
   * 🔴 **런타임에 나가는 것은 `APPROVED` 만이다**(기획서 §2.2).
   *    상태를 **인자로도 받지 않는다** — 받으면 언젠가 소비처가 `PROPOSED` 를 넘긴다.
   *    검수 화면의 미리보기는 `review()` 행의 `overlayValue` 가 담당한다.
   */
  async listOverrides(locale: string) {
    const status = TranslationOverrideStatus.APPROVED;
    const rows = await this.prisma.translationOverride.findMany({
      where: { locale, status },
      select: { key: true, draftValue: true, updatedAt: true },
      orderBy: { key: 'asc' },
    });
    const entries = rows.map((r) => ({ key: r.key, value: r.draftValue }));
    const latest = rows.reduce<Date | null>((m, r) => (m == null || r.updatedAt > m ? r.updatedAt : m), null);
    const etag = `"i18n-${locale}-${status}-${rows.length}-${crypto
      .createHash('sha1')
      .update(`${latest?.toISOString() ?? '0'}|${rows.map((r) => r.key).join('')}`)
      .digest('hex')
      .slice(0, 16)}"`;
    return { locale, status, entries, count: entries.length, latestAt: latest?.toISOString() ?? null, etag };
  }

  /* ── 검수 목록 ─────────────────────────────────────────────────────────── */

  async review(
    user: ActorLike,
    q: { locale: string; area?: string; filter?: ReviewFilter; q?: string; limit?: number; offset?: number },
  ) {
    const locale = q.locale;
    if (locale === 'ko') {
      throw new BadRequestException({
        code: 'I18N_KO_NOT_REVIEWABLE',
        message: '한국어는 검수 대상이 아닙니다 — 원문이 곧 키이자 정본입니다(원문을 바꾸면 전 화면이 미등록이 됩니다).',
      });
    }
    const code = codeEntriesFor(locale);
    const gaps = contextGapSet(locale);
    const overlays = await this.prisma.translationOverride.findMany({ where: { locale } });
    const byKey = new Map(overlays.map((o) => [o.key, o]));

    const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    const offset = Math.max(q.offset ?? 0, 0);
    const needle = (q.q ?? '').trim();

    // 전집을 한 번 훑어 행을 만든다(카탈로그는 만 단위라 필터 후 자른다)
    const all: ReviewRow[] = [];
    for (const [key, ce] of code) {
      if (q.area && ce.area !== q.area) continue;
      const o = byKey.get(key);
      const safety = classifySafetyKey(key);
      const at = key.lastIndexOf('@');
      const overlayValue = o ? o.draftValue : null;
      const status: I18nReviewState = (o?.status as I18nReviewState) ?? 'NONE';
      const approved = o?.status === TranslationOverrideStatus.APPROVED;
      const effectiveValue = approved ? overlayValue : ce.value;
      const effectiveOrigin: I18nValueOrigin = approved
        ? 'REVIEW_APPROVED'
        : ce.value == null
          ? 'UNTRANSLATED'
          : ce.codeVerified
            ? 'CODE_VERIFIED'
            : 'CODE_AI_DRAFT';
      const row: ReviewRow = {
        id: o?.id ?? null,
        locale,
        key,
        source: at > 0 ? key.slice(0, at) : key,
        context: at > 0 ? key.slice(at + 1) : null,
        area: ce.area,
        codeValue: ce.value,
        codeVerified: ce.codeVerified,
        overlayValue,
        status,
        effectiveValue,
        effectiveOrigin,
        effectiveOriginText: I18N_VALUE_ORIGIN_TEXT[effectiveOrigin],
        safetyKey: safety.safety,
        safetyReason: safety.reason,
        contextGap: gaps ? gaps.has(key) : null,
        baseChanged: !!o && o.baseValue !== ce.value,
        baseValue: o?.baseValue ?? null,
        note: o?.note ?? null,
        decisionReason: null, // 전이 원장에서 채운다(페이지 행에 한해)
        decisionAt: null,
        proposedBy: o?.proposedBy ?? null,
        proposedByName: null,
        proposedAt: o?.proposedAt?.toISOString() ?? null,
        reviewedBy: o?.reviewedBy ?? null,
        reviewedByName: null,
        reviewedAt: o?.reviewedAt?.toISOString() ?? null,
        mergedAt: o?.mergedAt?.toISOString() ?? null,
        selfApproved: !!o?.proposedBy && !!o?.reviewedBy && o.proposedBy === o.reviewedBy,
        noTranslate: o?.status === TranslationOverrideStatus.REJECTED && o.draftValue.trim() === '',
        usedIn: null,
      };
      if (needle && !key.includes(needle) && !(row.effectiveValue ?? '').includes(needle)) continue;
      if (!matchesFilter(row, q.filter ?? 'all')) continue;
      all.push(row);
    }

    // 워크리스트 정렬 — 🔴 **줄어드는 목록**: 안전 키 → 문맥 결손 → 제안됨 → 미검수 순으로 먼저 처리한다
    all.sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key));

    const page = all.slice(offset, offset + limit);
    const usage = usageIndex();
    for (const r of page) {
      r.usedIn = usage.index ? (usage.index.map.get(r.key) ?? []) : null;
    }
    await this.attachNames(page);
    await this.attachDecisionReasons(page);

    const permission = await this.permissionFor(user, locale);
    return {
      rows: page,
      meta: {
        // 🔴 자르면 잘랐다고 말한다
        total: all.length,
        returned: page.length,
        offset,
        limit,
        truncated: offset + page.length < all.length,
        catalogTotal: code.size,
        filter: q.filter ?? 'all',
        areas: areaCodes(),
        contextGapAvailable: gaps != null,
        contextGapUnavailableReason: gaps == null ? `${locale} 언어 팩이 없어 문맥 결손을 산출할 수 없습니다(0 이 아닙니다).` : null,
        usage: {
          available: usage.index != null,
          scannedFiles: usage.index?.scannedFiles ?? null,
          unavailableReason: usage.reason,
        },
        permission,
      },
    };
  }

  private async attachNames(rows: ReviewRow[]): Promise<void> {
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.proposedBy) ids.add(r.proposedBy);
      if (r.reviewedBy) ids.add(r.reviewedBy);
    }
    if (ids.size === 0) return;
    // 🔴 User 에 `name` 컬럼은 없다 — 환자·직원 이름은 familyName/givenName 이다(ADR-002)
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, familyName: true, givenName: true },
    });
    const nameOf = new Map(users.map((u) => [u.id, `${u.familyName}${u.givenName}`]));
    for (const r of rows) {
      // 🔴 이름을 못 찾으면 null 로 둔다 — id 를 이름인 척 그리지 않는다
      r.proposedByName = r.proposedBy ? (nameOf.get(r.proposedBy) ?? null) : null;
      r.reviewedByName = r.reviewedBy ? (nameOf.get(r.reviewedBy) ?? null) : null;
    }
  }

  /**
   * 결정 사유는 **전이 원장이 정본**이다(행의 `note` 는 제안자 몫이라 덮지 않는다).
   * 🔴 결정 전이가 없으면 `null` 이다 — "사유 없음"을 지어내지 않는다.
   */
  private async attachDecisionReasons(rows: ReviewRow[]): Promise<void> {
    const ids = rows.map((r) => r.id).filter((x): x is string => !!x);
    if (ids.length === 0) return;
    const trs = await this.prisma.translationOverrideTransition.findMany({
      where: {
        overrideId: { in: ids },
        toStatus: {
          in: [TranslationOverrideStatus.APPROVED, TranslationOverrideStatus.REJECTED, TranslationOverrideStatus.MERGED],
        },
      },
      orderBy: { at: 'desc' },
      select: { overrideId: true, reason: true, at: true },
    });
    const latest = new Map<string, { reason: string | null; at: Date }>();
    for (const t of trs) if (!latest.has(t.overrideId)) latest.set(t.overrideId, { reason: t.reason, at: t.at });
    for (const r of rows) {
      const hit = r.id ? latest.get(r.id) : undefined;
      r.decisionReason = hit?.reason ?? null;
      r.decisionAt = hit?.at.toISOString() ?? null;
    }
  }

  /* ── 쓰기 ──────────────────────────────────────────────────────────────── */

  async propose(user: ActorLike, dto: ProposeDto) {
    await this.assertCanWrite(user, dto.locale, 'propose');
    const code = codeEntriesFor(dto.locale);
    const ce = code.get(dto.key);
    if (!ce) {
      throw new BadRequestException({
        code: 'I18N_UNKNOWN_KEY',
        message: '카탈로그에 없는 키입니다. 원문(키)은 코드가 정본이라 검수 화면에서 만들 수 없습니다.',
        details: { key: dto.key, locale: dto.locale },
      });
    }
    /**
     * 🔴 **check-then-act 는 원자성이 아니다**(이 저장소의 멱등성 전수검토 결론).
     *    종전 구현은 트랜잭션 **밖에서** 조회하고 안에서 create 했다 — 같은 키를 두 사람이 동시에
     *    제안하면 `@@unique([locale,key])` 위반으로 한쪽이 500 이 된다(사용자에게는 "저장 실패").
     *    조회를 트랜잭션 안으로 넣고, 그래도 경합하면 **한 번 다시 돈다**(두 번째엔 기존 행을 본다).
     */
    const now = new Date();
    const attempt = () => this.runProposeTx(user, dto, ce.area, ce.value, now);
    let result: { row: { id: string; status: TranslationOverrideStatus }; previousStatus: TranslationOverrideStatus | null };
    try {
      result = await attempt();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      result = await attempt();
    }
    return {
      id: result.row.id,
      status: result.row.status,
      // 🔴 기록 ≠ 적용 — 저장은 됐고 화면에는 아직 안 나간다는 사실을 응답이 말한다
      appliedToRuntime: false,
      appliedNote: '저장되었습니다. 승인(APPROVED) 전에는 화면에 반영되지 않습니다.',
      previousStatus: result.previousStatus,
    };
  }

  private async runProposeTx(
    user: ActorLike,
    dto: ProposeDto,
    area: string,
    baseValue: string | null,
    now: Date,
  ): Promise<{ row: { id: string; status: TranslationOverrideStatus }; previousStatus: TranslationOverrideStatus | null }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.translationOverride.findUnique({
        where: { locale_key: { locale: dto.locale, key: dto.key } },
      });
      if (!existing) {
        const created = await tx.translationOverride.create({
          data: {
            locale: dto.locale,
            key: dto.key,
            area,
            draftValue: dto.value,
            baseValue,
            status: TranslationOverrideStatus.PROPOSED,
            note: dto.note ?? null,
            proposedBy: user.id ?? null,
            proposedAt: now,
          },
        });
        await tx.translationOverrideTransition.create({
          data: { overrideId: created.id, fromStatus: null, toStatus: TranslationOverrideStatus.PROPOSED, actorId: user.id ?? null, reason: dto.note ?? null },
        });
        return { row: created, previousStatus: null };
      }
      // 재수정은 같은 행을 갱신하고 이력은 전이 원장에 — 🔴 승인분을 고치면 다시 PROPOSED 로 내려간다
      const updated = await tx.translationOverride.update({
        where: { id: existing.id },
        data: {
          draftValue: dto.value,
          baseValue,
          area,
          note: dto.note ?? existing.note,
          status: TranslationOverrideStatus.PROPOSED,
          proposedBy: user.id ?? existing.proposedBy,
          proposedAt: now,
          reviewedBy: null,
          reviewedAt: null,
          mergedAt: null,
        },
      });
      await tx.translationOverrideTransition.create({
        data: {
          overrideId: existing.id,
          fromStatus: existing.status,
          toStatus: TranslationOverrideStatus.PROPOSED,
          actorId: user.id ?? null,
          reason: dto.note ?? '재수정',
        },
      });
      return { row: updated, previousStatus: existing.status };
    });
  }

  async decide(user: ActorLike, id: string, to: 'APPROVED' | 'REJECTED', reason?: string) {
    const row = await this.prisma.translationOverride.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'I18N_OVERRIDE_NOT_FOUND', message: '검수 항목을 찾지 못했습니다.' });
    await this.assertCanWrite(user, row.locale, 'decide');
    const target = to === 'APPROVED' ? TranslationOverrideStatus.APPROVED : TranslationOverrideStatus.REJECTED;
    /**
     * 🔴 **빈 값을 승인으로 내보내지 않는다.** `rejectKey`(키만으로 반려)가 만든 행은
     *    `draftValue` 가 비어 있다 — 그것이 "번역하지 않음"의 표현이다. 그 행을 나중에 승인하면
     *    **빈 문자열이 런타임 오버레이로 나가** 화면 문구가 사라진다(`applyReviewOverlay` 가
     *    빈 값을 걸러내지만, 그 방어를 유일한 방어로 두지 않는다 — 쓰기가 표시보다 위험하다).
     *    승인하려면 먼저 교정값을 제안해야 한다.
     */
    if (target === TranslationOverrideStatus.APPROVED && row.draftValue.trim() === '') {
      throw new BadRequestException({
        code: 'I18N_APPROVE_REQUIRES_VALUE',
        message:
          '번역 값이 비어 있어 승인할 수 없습니다 — 이 행은 "번역하지 않음"(키만으로 반려) 기록입니다. 승인하려면 먼저 교정값을 저장하세요.',
        details: { id, status: row.status },
      });
    }
    /**
     * 🔴 **4-eyes**: 제안자 = 승인자여도 **막지 않는다**(막으면 검수자가 한 명인 언어는 아무것도
     *    승인할 수 없고, 그러면 두 번째 계정으로 우회한다). 대신 그 사실을 응답·전이 원장·화면이
     *    말한다 — 봉쇄가 아니라 기록과 가시화.
     */
    const selfApproved = !!row.proposedBy && !!user.id && row.proposedBy === user.id;
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.translationOverride.update({
        where: { id },
        /**
         * 🔴 `note` 를 **덮지 않는다.** 이 칸은 제안자가 왜 이렇게 고쳤는지 적은 자리이고,
         *    승인·반려 사유는 전이 원장(`TranslationOverrideTransition.reason`)에 남는다.
         *    종전 구현은 `note: reason ?? row.note` 로 승인자의 사유가 제안자의 근거를
         *    **되돌릴 수 없게 지웠다**(전이 원장에도 옛 note 는 없다).
         *    화면은 `decisionReason`(최신 전이 파생)으로 결정 사유를 읽는다.
         */
        data: { status: target, reviewedBy: user.id ?? null, reviewedAt: new Date() },
      });
      await tx.translationOverrideTransition.create({
        data: {
          overrideId: id,
          fromStatus: row.status,
          toStatus: target,
          actorId: user.id ?? null,
          reason: selfApproved ? `${reason ?? ''}${reason ? ' · ' : ''}[SELF_REVIEW] 제안자와 승인자가 같습니다`.slice(0, 500) : (reason ?? null),
        },
      });
      return u;
    });
    return {
      id: updated.id,
      status: updated.status,
      fourEyes: {
        satisfied: !selfApproved,
        selfApproved,
        message: selfApproved
          ? '🔴 제안자와 승인자가 같습니다(4-eyes 미충족). 막지 않았고, 이 사실이 전이 원장과 목록에 남습니다.'
          : '제안자와 승인자가 다릅니다.',
      },
      appliedToRuntime: target === TranslationOverrideStatus.APPROVED,
      appliedNote:
        target === TranslationOverrideStatus.APPROVED
          ? '승인되었습니다. 각 사용자의 다음 화면 진입(오버레이 재조회) 시점부터 반영됩니다.'
          : '반려되었습니다. 코드 초안값(또는 원문+티)이 그대로 나갑니다.',
    };
  }

  /**
   * **"이 키는 번역하지 않는다"를 키만으로 남긴다** (기획서 §2.4 · `RejectKeyDto` 주석).
   *
   * 🔴 이 경로가 없으면 §2.4 는 **실행 불가**다: 반려하려면 오버레이 행이 있어야 하고,
   *    행을 만들려면 검수자가 쓰지도 않은 `draftValue` 를 지어내야 했다.
   * 🔴 **기록 ≠ 적용** — 이 판정은 "앞으로 번역하지 말라"는 사람의 결정이지, 코드에 이미 든
   *    AI 초안을 지우지 않는다. 초안이 남아 있으면 화면에는 **그 초안이 계속 나간다**.
   *    응답이 그 사실(`codeStillShows`)을 그 자리에서 말하고, 통계도 분모와 함께 센다.
   */
  async rejectKey(user: ActorLike, dto: RejectKeyDto) {
    await this.assertCanWrite(user, dto.locale, 'decide');
    const code = codeEntriesFor(dto.locale);
    const ce = code.get(dto.key);
    if (!ce) {
      // 🔴 `propose` 와 **같은 판정·같은 코드**다 — 원문(키)은 코드가 정본이라 화면에서 만들 수 없다
      throw new BadRequestException({
        code: 'I18N_UNKNOWN_KEY',
        message: '카탈로그에 없는 키입니다. 원문(키)은 코드가 정본이라 검수 화면에서 만들 수 없습니다.',
        details: { key: dto.key, locale: dto.locale },
      });
    }
    // 경합 처리는 `propose` 와 같다(트랜잭션 안 조회 + `@@unique` 위반 시 1회 재시도)
    const attempt = () => this.runRejectKeyTx(user, dto, ce.area, ce.value);
    let created: { id: string; existingId: null } | { id: null; existingId: string };
    try {
      created = await attempt();
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      created = await attempt();
    }
    const codeStillShows = ce.value != null;
    const applied = {
      appliedToRuntime: false,
      codeStillShows,
      codeValue: ce.value,
      appliedNote: codeStillShows
        ? '🔴 판정은 기록됐지만 **적용되지는 않았습니다** — 코드 카탈로그에 AI 초안이 남아 있어 화면에는 그 초안이 계속 나갑니다. 원문+티로 두려면 개발자가 카탈로그에서 그 키를 빼야 합니다(§2.5 코드 수렴).'
        : '기록됐습니다. 이 언어의 코드 카탈로그에 값이 없어 화면에는 원문+티가 나갑니다.',
    };
    if (created.existingId) {
      // 🔴 기존 행은 **draftValue 를 덮지 않고** 기존 결정 경로로 흘려보낸다(제안자 근거 보존 규칙 그대로)
      const decided = await this.decide(user, created.existingId, 'REJECTED', dto.reason);
      return { ...decided, ...applied, createdRow: false, noTranslate: false };
    }
    return {
      id: created.id!,
      status: TranslationOverrideStatus.REJECTED,
      ...applied,
      createdRow: true,
      /** 🔴 이 행의 빈 `draftValue` 는 "번역하지 않음"의 표현이다 — 승인으로 갈 수 없다(decide 가 400) */
      noTranslate: true,
    };
  }

  private async runRejectKeyTx(
    user: ActorLike,
    dto: RejectKeyDto,
    area: string,
    baseValue: string | null,
  ): Promise<{ id: string; existingId: null } | { id: null; existingId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.translationOverride.findUnique({
        where: { locale_key: { locale: dto.locale, key: dto.key } },
      });
      if (existing) return { id: null, existingId: existing.id };
      const row = await tx.translationOverride.create({
        data: {
          locale: dto.locale,
          key: dto.key,
          area,
          /**
           * 🔴 빈 문자열이 **"번역하지 않음"의 표현**이다(스키마가 non-null 이라 null 을 쓸 수 없다).
           *    이 값이 승인으로 새지 않게 `decide()` 가 막고, 런타임 오버레이도 빈 값을 얹지 않는다.
           */
          draftValue: '',
          baseValue,
          status: TranslationOverrideStatus.REJECTED,
          /** 🔴 교정값이 없으니 **사유가 곧 본문**이다(§2.1) */
          note: dto.reason,
          /**
           * 🔴 `proposedBy` 는 **null 이다 — 제안이 없었기 때문이다.** 판정자를 제안자 칸에도 적으면
           *    "제안자=승인자"(4-eyes 미충족)라는 **없던 사실**이 생긴다. 행위자는 `reviewedBy` 와
           *    전이 원장 `actorId` 에 남는다.
           */
          proposedBy: null,
          reviewedBy: user.id ?? null,
          reviewedAt: new Date(),
        },
      });
      await tx.translationOverrideTransition.create({
        data: {
          overrideId: row.id,
          fromStatus: null, // 이전 상태가 없다(제안 없이 바로 판정)
          toStatus: TranslationOverrideStatus.REJECTED,
          actorId: user.id ?? null,
          reason: dto.reason,
        },
      });
      return { id: row.id, existingId: null };
    });
  }

  async markMerged(user: ActorLike, id: string, reason?: string) {
    const row = await this.prisma.translationOverride.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'I18N_OVERRIDE_NOT_FOUND', message: '검수 항목을 찾지 못했습니다.' });
    await this.assertCanWrite(user, row.locale, 'merged');
    if (row.status !== TranslationOverrideStatus.APPROVED && row.status !== TranslationOverrideStatus.MERGED) {
      throw new BadRequestException({
        code: 'I18N_MERGE_REQUIRES_APPROVED',
        message: '승인된 항목만 코드 반영으로 표시할 수 있습니다.',
        details: { status: row.status },
      });
    }
    const code = codeEntriesFor(row.locale);
    const codeValue = code.get(row.key)?.value ?? null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.translationOverride.update({
        where: { id },
        data: { status: TranslationOverrideStatus.MERGED, mergedAt: new Date() },
      });
      await tx.translationOverrideTransition.create({
        data: { overrideId: id, fromStatus: row.status, toStatus: TranslationOverrideStatus.MERGED, actorId: user.id ?? null, reason: reason ?? null },
      });
      return u;
    });
    return {
      id: updated.id,
      status: updated.status,
      /**
       * 🔴 표시는 사람의 주장이다 — **코드가 실제로 같은지**를 함께 답한다.
       *    다르면 "표시는 됐지만 코드에는 아직 없다"는 사실이 그 자리에서 드러난다.
       */
      codeMatches: codeValue === row.draftValue,
      codeValue,
      appliedToRuntime: false,
      appliedNote:
        codeValue === row.draftValue
          ? '코드 값과 일치합니다 — 다음 배포부터는 오버레이 없이도 같은 값이 나갑니다.'
          : '🔴 표시했지만 이 서버의 코드 값은 아직 다릅니다(배포 전이거나 반영이 누락됐습니다).',
    };
  }

  /* ── 내보내기 ──────────────────────────────────────────────────────────── */

  async exportText(locale: string, area?: string) {
    const rows = await this.prisma.translationOverride.findMany({
      where: { locale, status: TranslationOverrideStatus.APPROVED, ...(area ? { area } : {}) },
      orderBy: [{ area: 'asc' }, { key: 'asc' }],
      select: { key: true, draftValue: true },
    });
    const code = codeEntriesFor(locale);
    const alreadyInCode = rows.filter((r) => code.get(r.key)?.value === r.draftValue).length;
    return {
      text: buildExportText({
        locale,
        area: area ?? 'ALL',
        entries: rows.map((r) => ({ key: r.key, value: r.draftValue })),
        generatedAt: new Date().toISOString(),
        alreadyInCode,
      }),
      count: rows.length,
      alreadyInCode,
    };
  }

  /* ── 통계 ──────────────────────────────────────────────────────────────── */

  /**
   * 🔴 **분모를 병기하고, 표본 0 은 `null` + "산출 불가"** 로 답한다(0% 도 100% 도 아니다).
   */
  async stats(locale: string) {
    const code = codeEntriesFor(locale);
    const gaps = contextGapSet(locale);
    const pack = getLocalePack(locale);
    /**
     * 🔴 **분자와 분모의 모집단을 맞춘다.** 분모(`catalogTotal`)는 현재 카탈로그 키 전집인데
     *    종전 구현은 분자를 `groupBy` 로 **오버레이 전건**에서 셌다 — 코드에서 사라진 옛 키의
     *    검수 기록까지 세어 "검수율"이 실제보다 높게 나오고, 극단적으로는 분자가 분모를 넘는다
     *    (`Math.max(...,0)` 이 그 모순을 가려 주고 있었다).
     *    카탈로그에 없는 행은 **따로 센다**(`orphanOverrides`) — 지우지 않고 드러낸다.
     */
    const allRows = await this.prisma.translationOverride.findMany({
      where: { locale },
      select: { key: true, status: true, draftValue: true },
    });
    const inCatalog = allRows.filter((r) => code.has(r.key));
    const orphanOverrides = allRows.length - inCatalog.length;
    const count = (s: TranslationOverrideStatus) => inCatalog.filter((r) => r.status === s).length;
    const proposed = count(TranslationOverrideStatus.PROPOSED);
    const approved = count(TranslationOverrideStatus.APPROVED);
    const rejected = count(TranslationOverrideStatus.REJECTED);
    const merged = count(TranslationOverrideStatus.MERGED);

    const catalogTotal = code.size;
    let translated = 0;
    let safetyTotal = 0;
    for (const ce of code.values()) {
      if (ce.value != null) translated++;
      if (classifySafetyKey(ce.key).safety) safetyTotal++;
    }
    // 🔴 "검수됨"은 사람이 판정을 남긴 키다 — 승인·반려·코드반영 전부 사람 판정이다
    const reviewed = approved + rejected + merged;
    const unreviewed = catalogTotal - reviewed;

    // 승인분 중 코드와 아직 다른 것 — "N건이 아직 코드에 없다"
    // (카탈로그에서 사라진 승인분도 '코드에 없다'는 사실이 같으므로 전건에서 센다)
    const notInCode = allRows.filter(
      (r) => r.status === TranslationOverrideStatus.APPROVED && code.get(r.key)?.value !== r.draftValue,
    ).length;

    /**
     * 🔴 **"번역하지 않는다"는 기록이지 적용이 아니다**(§2.4). 반려는 코드에 이미 든 AI 초안을
     *    지우지 않는다 — 초안이 남아 있으면 화면에는 **그 초안이 계속 나간다**.
     *    그 수를 분모(`noTranslate`)와 함께 드러낸다. 안 드러내면 검수 화면은
     *    "N건 번역하지 않기로 함"이라 말하고 화면은 그대로 번역을 보여주는 모순이 된다(P17).
     */
    const noTranslateRows = inCatalog.filter(
      (r) => r.status === TranslationOverrideStatus.REJECTED && r.draftValue.trim() === '',
    );
    const noTranslate = noTranslateRows.length;
    const noTranslateButCodeStillShows = noTranslateRows.filter((r) => code.get(r.key)?.value != null).length;

    const cov = localeCoverage(locale);
    return {
      locale,
      packPresent: !!pack,
      /** 분모 — 이 언어에서 검수 대상인 키 전집 */
      catalogTotal,
      translated,
      untranslated: catalogTotal - translated,
      safetyTotal,
      contextGaps: gaps ? gaps.size : null,
      contextGapsUnavailableReason: gaps == null ? `${locale} 언어 팩이 없어 문맥 결손을 산출할 수 없습니다(0 이 아닙니다).` : null,
      review: { proposed, approved, rejected, merged, reviewed, unreviewed },
      /**
       * 🔴 카탈로그에 더 이상 없는 키의 검수 기록 수 — 검수율 분자에서 **뺐다**.
       *    0 이 아니면 코드에서 그 원문이 바뀌었거나 사라졌다는 뜻이다(지우지 않고 드러낸다).
       */
      orphanOverrides,
      /** 🔴 승인했지만 코드에 아직 없는 것 — 오버레이가 끄면 사라지는 값 */
      approvedNotInCode: notInCode,
      /** "이 키는 번역하지 않는다"로 판정된 키 수(§2.4 · 빈 draftValue 가 그 표현) */
      noTranslate,
      /**
       * 🔴 그중 **코드에 AI 초안이 남아 화면에는 여전히 번역이 나가는** 키 수.
       *    0 이 아니면 §2.5 코드 수렴(개발자가 카탈로그에서 그 키를 뺌)이 남아 있다는 뜻이다.
       */
      noTranslateButCodeStillShows,
      /** 비율은 분모와 함께. 분모 0 이면 값은 null 이고 이유를 말한다 */
      reviewedRatio: ratio(reviewed, catalogTotal, '검수 대상 키 전집이 0 입니다 — 카탈로그 미조립'),
      translatedRatio: ratio(translated, catalogTotal, '검수 대상 키 전집이 0 입니다 — 카탈로그 미조립'),
      coverage: cov,
      /**
       * 🔴 코드 카탈로그의 `*_VERIFIED` 는 전 영역이 빈 집합이다(2026-09-09 실측).
       *    "검수 0"은 검수를 안 했다는 뜻이기도 하고 기록 자리가 코드에만 있었다는 뜻이기도 하다.
       */
      codeVerifiedCount: [...code.values()].filter((c) => c.codeVerified).length,
    };
  }
}

/** `@@unique([locale,key])` 위반(P2002)인가 — 동시 제안 경합의 신호 */
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

function ratio(n: number, d: number, whyIfZero: string): { value: number | null; numerator: number; denominator: number; unavailableReason: string | null } {
  if (d <= 0) return { value: null, numerator: n, denominator: d, unavailableReason: `산출 불가 — ${whyIfZero}` };
  return { value: Math.round((n / d) * 1000) / 10, numerator: n, denominator: d, unavailableReason: null };
}

function matchesFilter(r: ReviewRow, f: ReviewFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'unreviewed':
      return r.status === 'NONE' || r.status === 'PROPOSED';
    case 'proposed':
      return r.status === 'PROPOSED';
    case 'approved':
      return r.status === 'APPROVED';
    case 'rejected':
      return r.status === 'REJECTED';
    case 'merged':
      return r.status === 'MERGED';
    case 'contextGap':
      // 🔴 팩이 없어 산출 불가(null)일 때 전건을 통과시키면 "결손 0"과 구분이 안 된다 — 아무것도 통과시키지 않는다
      return r.contextGap === true;
    case 'safety':
      return r.safetyKey;
    case 'untranslated':
      return r.effectiveValue == null;
    case 'baseChanged':
      return r.baseChanged;
    default:
      return true;
  }
}

/** 워크리스트 우선순위 — 먼저 처리해야 하는 것이 위로 */
function rank(r: ReviewRow): number {
  if (r.status === 'PROPOSED') return 0; // 사람이 기다리고 있다
  if (r.baseChanged) return 1; // 원본이 바뀌었다 — 재검수 필요
  if (r.safetyKey && r.status === 'NONE') return 2;
  if (r.contextGap === true) return 3;
  if (r.effectiveValue == null) return 4;
  if (r.status === 'NONE') return 5;
  return 6; // 승인·반려·반영됨 = 끝난 것
}
