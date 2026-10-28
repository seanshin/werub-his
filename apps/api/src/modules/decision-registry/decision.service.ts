import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { join } from 'path';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { AuditService } from '../audit/audit.service';
import { DECISION_REGISTRY, DECISION_TRACKS, LAYER_META, type DecisionDef } from './decision.registry';
import { GovernanceEnactmentService } from '../gld/governance-enactment.service';
import type { CommitteeDecisionLink } from './committee-resolution-record';
import { isNegativeChoice, configKeysOf, decidedConfigOf, sameConfigValue, mechanismOf, allowedRuleOf, enactConfigOf } from './decision-engine';
import { DecisionEngineService } from './decision-engine.service';
import { DEV_APPLY_IMPLEMENTED } from './dev-apply-baseline';
import {
  COMMITTEE_AUTHORITIES, COMMITTEE_CODES, decisionCommitteeOf, type CommitteeCode,
  committeeAuthorityConfigKey, committeeAuthoritySourceOf, readCommitteeAuthorityRecord, COMMITTEE_AUTHORITY_SEED_RE, type CommitteeAuthorityRecord,
  COMMITTEE_DECISION_STAGES, DECISION_DOMAINS, decisionDomainOf, decisionStageOf, upstreamChangedAfter,
  DECISION_MECHANISMS, type DecisionMechanism, joinPatientName, DEV_APPLY_STATUSES, devApplyStatusOf, type DevApplyStatus,
  type AgendaStatus, type CommitteeDecisionStage, type DecisionDomain, type DecisionStageResult,
} from '@hospital-run/shared';

/** 결정 ↔ 위원회 안건 연결(최신 1건) */
export interface DecisionAgendaLink {
  id: string; status: AgendaStatus; meetingId: string | null;
  committee: { code: string | null; name: string } | null; updatedAt: string;
}

/** 이행 상태 5종 — 🔴 `PENDING` 을 `ENACTED` 와 합치면 화면이 실제보다 진척된 것처럼 말한다 */
export interface EnactmentStatus {
  state: 'UNDECIDED' | 'ENACTED' | 'PENDING' | 'FAILED' | 'MANUAL_CONFIRMED';
  label: string;
  detail: string | null;
  actions: Array<{ kind: string; status: string; error: string | null; enactedAt: string | null; target: unknown }>;
}

/** 결정 기록 — 스키마를 늘리지 않고 `SystemConfig` 에 남긴다(스키마 변경 자체가 승인 대상이라) */
/** 🔴 허가 근거 문서 — 시스템은 **내용의 진위를 검증하지 못한다**. 무엇이 올라왔는지 기록할 뿐이다 */
export interface DecisionAttachment {
  id: string;
  fileName: string;
  /** `/uploads/decisions/...` — 응답 시점에 서명 URL 로 바뀐다(정적 서빙은 서명 없이는 401) */
  url: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByUserId: string;
  uploadedAt: string;
}

export interface DecisionRecord {
  choice: string;
  /** 🔴 법적 검토 근거. 없으면 기록 자체를 거부한다(fail-closed) */
  legalReviewRef: string;
  /** 결정자가 스스로 밝힌 직책·권한 근거 — 🔴 시스템이 검증하지 못한다(아래 주석) */
  authorityClaim: string;
  note?: string;
  decidedByUserId: string;
  decidedAt: string;
  /** 이 기록이 config 를 실제로 바꿨는가 */
  applied: boolean;
  appliedDetail?: string;
  /** 허가 근거 문서 — 🔴 `LICENSE_HOLDER` 층은 **1건 이상 없으면 기록 자체를 거부한다** */
  attachments?: DecisionAttachment[];
  /** 위원회 의결로 남은 기록 — 집행 상태는 이 위원회 결정의 액션을 읽는다(`committee-resolution-record.ts`) */
  committeeDecision?: CommitteeDecisionLink;
}

/** 결정이 건드리는 설정 하나의 자세한 모습(결정 화면 · 결정 문서) */
export interface DecisionSettingDetail {
  key: string;
  /** SETS = 선택지가 이 설정을 바꾼다 · RELATED = 바꾸지 않지만 기대는 설정 */
  role: 'SETS' | 'RELATED';
  description: string | null; category: string | null; registered: boolean;
  current: unknown; source: 'env' | 'db' | 'default' | 'unset'; defaultValue: unknown;
  /** 허용 값 규칙(설정 저장·집행이 같은 규칙) · null = 규칙 없음 */
  allowed: unknown;
  options: Array<{ value: string; label: string; sets: boolean; setValue: unknown }>;
  /** 기록된 선택이 이 설정에 정한 값 · 기록 없음·바꾸지 않는 선택이면 null */
  decidedValue: unknown; decidedSets: boolean;
  /** 결정 값과 현재 값 일치 · null = 비교할 결정 값 없음 */
  matchesDecision: boolean | null;
  /** 현재 값과 같은 값을 정하는 선택지(정확히 같을 때만) */
  currentOption: string | null;
  updatedAt: string | null; updatedByName: string | null;
}

const KEY = (k: string) => `decision.${k}`;
/** 결정 기록이 저장되는 키 — 설정이 아니라 결정 화면이 쓰는 기록(다른 모듈이 기록을 읽을 때 같은 규칙으로) */
export const decisionRecordKey = KEY;

/**
 * 개발 시드 결정 표식(2026-10-03) — 근거에 `DEV-SEED`·`개발 시드` 가 있으면 **실결정으로 세지 않는다**(go-live 와 같은 규칙).
 * 🔴 운영 DB 는 가상 병원 시드다. 시드 형태로 남긴 결정을 실결정으로 세면 "N건 결정 완료"가 아무도 정하지 않은 것을 가린다 —
 *    go-live 가 시드 결재 3건을 실결재로 세어 준비율 65% 를 그렸던 것과 같은 함정(실제 45%).
 *    시드 기록은 보이되(무엇으로 해 두었는지) 결정 수·선행 조건 충족·개원 단계 준비에는 들어가지 않는다.
 */
export const DEV_SEED_DECISION_RE = /DEV-SEED|개발 시드/i;
export function isSeedDecisionRecord(rec: { legalReviewRef?: string; authorityClaim?: string; note?: string } | null | undefined): boolean {
  return !!rec && DEV_SEED_DECISION_RE.test(`${rec.legalReviewRef ?? ''} ${rec.authorityClaim ?? ''} ${rec.note ?? ''}`);
}
/** 첨부는 결정 기록과 **분리 저장**한다 — 기록 전에 올려 두고, 기록 시 함께 봉인한다 */
const ATT_KEY = (k: string) => `decision.attachments.${k}`;

@Injectable()
export class DecisionService {
  private readonly logger = new Logger(DecisionService.name);

  /**
   * 🔴 `enactment` 는 **필수 주입**이다. `@Optional()` 로 두면 모듈이 `GldModule` 을 import 하지
   *    않았을 때 조용히 `undefined` 가 되어 **결정이 기록만 되고 영원히 반영되지 않는다**
   *    (같은 유형으로 안전 게이트 3종이 개통 이래 원장을 못 남기고 있었다 — 2026-08-26).
   *    빠지면 부팅이 실패하는 편이 낫다.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigRuntimeService,
    private readonly enactment: GovernanceEnactmentService,
    /** 🔴 필수 주입 — 빠지면 결정이 이력·전후 관계 없이 기록된다(빠지면 부팅이 실패하는 편이 낫다) */
    private readonly engine: DecisionEngineService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  private def(key: string): DecisionDef {
    const d = DECISION_REGISTRY.find((x) => x.key === key);
    if (!d) throw new NotFoundException(`등록되지 않은 결정입니다: ${key}`);
    return d;
  }

  /**
   * 🔴 (2026-09-17 L2) 조회 실패를 **"아직 결정되지 않음"** 으로 번역하지 않는다.
   *    `config.get()` 은 미설정 키에 `null` 을 돌려주고 **DB 실패에만 던진다**(`config-runtime.service.ts:734`) —
   *    그래서 종전 `.catch(() => null)` 은 오직 실패만 삼켰다. 이 값은 `unmetDependenciesFrom` 이
   *    **선행 조건 판정**에 쓴다: 실패가 null 이 되면 화면은 "선행 결정이 아직 안 됐다"고 단정하고
   *    하위 층 결정 기록을 막는다(막는 방향이라도 **이유가 거짓**이다 · §부분실패 §사람결정화면).
   */
  private async record(key: string): Promise<DecisionRecord | null> {
    const v = await this.config.get(KEY(key));
    return v && typeof v === 'object' ? (v as unknown as DecisionRecord) : null;
  }

  /**
   * 🔴 위원회 결정권한자 표 — **원내 채택 기록**(2026-10-12 기획 P3 G7).
   *    종전엔 이 표를 쓰는 경로가 없었다 — 개발 시드(DEV-SEED)만 들어가 있어, 원내 규정으로 정해도 남길 곳이 없었다(시드가 영원히 남는다).
   *    근거(위원회 규정 번호·의결 번호)가 필수이고, 시드 표식을 근거로 적으면 거부한다(채택을 시드로 위장하지 않는다).
   *    🔴 시스템은 규정 문서의 진위를 검증하지 못한다 — 적힌 근거·기록자·시각을 남길 뿐이다.
   */
  async recordCommitteeAuthority(code: string, userId: string, input: Omit<CommitteeAuthorityRecord, 'recordedAt' | 'recordedByUserId'>) {
    if (!(COMMITTEE_CODES as readonly string[]).includes(code)) throw new NotFoundException({ code: 'COMMITTEE_NOT_FOUND', message: '등록되지 않은 위원회입니다', details: { code } });
    const t = (s: string | undefined) => (s ?? '').trim();
    const rec: CommitteeAuthorityRecord = {
      chair: t(input.chair), secretary: t(input.secretary), verifier: t(input.verifier), votingRule: t(input.votingRule),
      exOfficio: (input.exOfficio ?? []).map((x) => t(x)).filter(Boolean),
      basisRef: t(input.basisRef), recordedAt: new Date().toISOString(), recordedByUserId: userId,
    };
    if (COMMITTEE_AUTHORITY_SEED_RE.test(rec.basisRef)) {
      throw new BadRequestException({ code: 'COMMITTEE_AUTHORITY_SEED_BASIS', message: '개발 시드 표식은 원내 채택 근거가 될 수 없습니다 — 위원회 규정·의결 번호를 적으세요' });
    }
    if (!readCommitteeAuthorityRecord(rec)) throw new BadRequestException({ code: 'COMMITTEE_AUTHORITY_INCOMPLETE', message: '위원장·간사·확인 담당·의결 요건·근거를 모두 적어야 합니다' });
    await this.config.set(committeeAuthorityConfigKey(code as CommitteeCode), rec as unknown as Record<string, unknown>, userId);
    return { code, source: committeeAuthoritySourceOf(rec), record: rec };
  }

  /**
   * 아직 기록되지 않은(=대기 중인) 첨부 목록.
   *
   * 🔴 (2026-09-17 L2) 여기서 실패를 `[]` 로 삼키면 **세 곳이 동시에 거짓말을 한다**:
   *    ① `addAttachment` 가 `[...list, att]` 로 다시 쓰므로 **기존 근거 문서 목록이 통째로 덮어써진다**
   *    ② `decide` 가 허가권자 층에 "근거 문서를 1건 이상 첨부해야 한다"며 막는다(첨부가 있는데도)
   *    ③ 다른 층은 근거 문서가 **결정 기록에 담기지 않은 채** 봉인된다(`attachments: undefined`).
   *    법적 근거 원장이라 조용한 유실을 허용하지 않는다 — 실패는 전파한다.
   */
  async pendingAttachments(key: string): Promise<DecisionAttachment[]> {
    const v = await this.config.get(ATT_KEY(key));
    return Array.isArray(v) ? (v as unknown as DecisionAttachment[]) : [];
  }

  /**
   * 허가 근거 문서 첨부. 🔴 파일은 `uploads/decisions/` 에 저장되고 정적 서빙은
   * **서명 없이는 401** 이다(`main.ts` 의 업로드 서명 게이트). 응답 URL 은 인터셉터가 서명한다.
   * 🔴 시스템은 문서의 **진위·유효성을 검증하지 못한다** — 무엇이 언제 누구에 의해 올라왔는지만 남긴다.
   */
  /**
   * 첨부의 서버 로컬 경로 — 🔴 **판독 EP 만** 쓴다(경로를 응답에 싣지 않는다).
   */
  async attachmentPath(key: string, attachmentId: string): Promise<{ path: string; fileName: string }> {
    this.def(key);
    const att = (await this.pendingAttachments(key)).find((a) => a.id === attachmentId);
    if (!att) throw new NotFoundException('첨부를 찾을 수 없습니다');
    return { path: join(process.cwd(), 'uploads', 'decisions', key, att.id), fileName: att.fileName };
  }

  async addAttachment(key: string, userId: string, file: { filename: string; originalName: string; mimetype: string; size: number }) {
    this.def(key); // 등록되지 않은 결정에는 붙일 수 없다
    const list = await this.pendingAttachments(key);
    const att: DecisionAttachment = {
      id: file.filename,
      fileName: file.originalName,
      url: `/uploads/decisions/${key}/${file.filename}`,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedByUserId: userId,
      uploadedAt: new Date().toISOString(),
    };
    await this.config.set(ATT_KEY(key), [...list, att] as unknown as Record<string, unknown>, userId);
    void this.audit?.log({
      userId, action: AuditAction.CREATE, resourceType: 'HumanDecisionAttachment', resourceId: key,
      changes: { attach: { old: null, new: `${att.fileName}(${att.mimeType}·${att.sizeBytes}B)` } },
    }).catch(() => {});
    return att;
  }

  async list() {
    const items: Array<DecisionDef & {
      decided: boolean;
      seeded: boolean;
      record: Awaited<ReturnType<DecisionService['record']>>;
      currentConfigValue: unknown;
      blockedBy: Array<{ key: string; title: string; reason: string }>;
      pendingAttachments: Awaited<ReturnType<DecisionService['pendingAttachments']>>;
      unlocks: Array<{ key: string; title: string; layer: DecisionDef['layer'] }>;
      readyToDecide: boolean;
      enactment: EnactmentStatus;
      /** 큰 분류(기본 설정·의료·운영·행정·정보보호) — shared `decision-domains` 정본 */
      domain: DecisionDomain | null;
      /** 연결된 최신 위원회 안건 · null = 없음 · 'UNKNOWN' = 조회 실패(없음으로 접지 않는다) */
      agenda: DecisionAgendaLink | null | 'UNKNOWN';
      /** 결정 과정 단계(원장에서 판정 · 시드는 앞당기지 않음 · 확인 단계는 판정하지 않음) */
      stage: DecisionStageResult;
      /** 주관·합동 위원회 — 원내 위원회 층만 · shared `decision-committees` 정본 */
      committee: { lead: CommitteeCode; joint: CommitteeCode[] } | null;
      /**
       * 🔴 재검토 필요 — 이 실결정 뒤에 선행 실결정이 바뀌었고 그 뒤 재검토 확인이 없다(바뀐 선행 키).
       *    `null` = 이력 조회 실패로 확인 불가(빈 배열 = 재검토 필요 없음 · 다른 사실이다)
       */
      needsReview: string[] | null;
      /** 이 결정이 정한 설정과 실제 값 — `matches:false` 면 결정 경로 밖에서 바뀐 것(결정과 다름) */
      governedConfig: Array<{ key: string; decided: unknown; current: unknown; matches: boolean }>;
      /** 이력 원장 건수 · `null` = 조회 실패 */
      logCount: number | null;
      /** 결정 방식 — 등록부에서 파생(shared `decision-mechanism`) */
      mechanism: DecisionMechanism;
      /**
       * 이 결정이 건드리는 설정의 자세한 모습 · `null` = 설정 조회 실패(확인 불가 — 없음으로 접지 않는다)
       *  · role SETS = 선택지가 이 설정 값을 바꾼다 · RELATED = 바꾸지 않지만 이 결정이 기대는 설정(선행·게이트)
       */
      settings: DecisionSettingDetail[] | null;
      /**
       * 개발 반영 이행(결정 방식 DEV_APPLY 만 · 그 밖은 null) — 원장에서 파생(기획 P2-2)
       *  · `status: null` = 이력 조회 실패로 확인 불가(미결로 접지 않는다)
       *  · `implementedChoice` = 판정표상 코드가 이미 이 선택대로 동작(실결정이 다르면 되돌림)
       */
      devApply: { status: DevApplyStatus | null; version: string | null; since: string | null; implementedChoice: string | null } | null;
    }> = [];
    /**
     * 🔴 결정에 연결된 위원회 안건을 **한 번에** 읽는다(sourceRef = {type:'DECISION', key}).
     *    조회 실패는 목록을 죽이지 않되 "안건 없음"으로 접지 않는다 — 항목마다 'UNKNOWN'.
     */
    let agendaByKey: Map<string, DecisionAgendaLink> | null = null;
    try {
      const rows = await this.prisma.committeeAgenda.findMany({
        where: { sourceRef: { path: ['type'], equals: 'DECISION' } },
        select: { id: true, status: true, meetingId: true, updatedAt: true, sourceRef: true, committee: { select: { code: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
      });
      agendaByKey = new Map();
      for (const r of rows) {
        const key = (r.sourceRef as { key?: unknown } | null)?.key;
        if (typeof key !== 'string' || agendaByKey.has(key)) continue; // 최신 1건
        agendaByKey.set(key, {
          id: r.id, status: r.status as AgendaStatus, meetingId: r.meetingId,
          committee: r.committee ? { code: r.committee.code ?? null, name: r.committee.name } : null,
          updatedAt: r.updatedAt.toISOString(),
        });
      }
    } catch (e) {
      this.logger.warn(`결정 연결 안건 조회 실패 — 항목 안건 상태를 '확인 불가'로 표시: ${e instanceof Error ? e.message : String(e)}`);
      agendaByKey = null;
    }
    // 🔴 액션 원장을 **한 번에** 읽는다(결정마다 조회하면 34번 왕복한다)
    const actions = await this.prisma.decisionAction.findMany({
      where: { registryKey: { in: DECISION_REGISTRY.map((d) => d.key) } },
      select: { registryKey: true, kind: true, status: true, error: true, enactedAt: true, target: true },
      orderBy: { createdAt: 'desc' },
    });
    const byKey = new Map<string, typeof actions>();
    for (const a of actions) {
      if (!a.registryKey) continue;
      const arr = byKey.get(a.registryKey) ?? [];
      arr.push(a); byKey.set(a.registryKey, arr);
    }
    /**
     * 🔴 설정 조회를 **한 번에** 모은다. 종전에는 항목마다 기록·첨부·현재값을 따로 읽어
     *    항목 수의 세 배만큼 왕복했다(38항목일 때 이미 100회 남짓, 56항목이 되며 더 늘었다).
     *    조회 실패는 여기서도 삼키지 않는다 — `getMany` 가 던지면 목록 자체가 실패한다
     *    (없음으로 번역해 "미결"로 그리면 결정된 것을 미결로 말하게 된다).
     */
    const cfg = await this.config.getMany([...new Set([
      ...DECISION_REGISTRY.map((d) => KEY(d.key)),
      ...DECISION_REGISTRY.map((d) => ATT_KEY(d.key)),
      // 결정이 건드릴 수 있는 설정 전부 — "결정과 다름" 판정용(configKey 하나만 보면 enact 대상이 빠진다)
      ...DECISION_REGISTRY.flatMap((d) => configKeysOf(d)),
    ])]);
    /** 설정 상세 — 한 번에 읽는다 · 실패는 항목마다 null(확인 불가) */
    let described: Awaited<ReturnType<ConfigRuntimeService['describeMany']>> | null = null;
    let updaterName = new Map<string, string>();
    try {
      described = await this.config.describeMany(DECISION_REGISTRY.flatMap((d) => configKeysOf(d)));
      const ids = [...new Set([...described.values()].map((v) => v.updatedBy).filter((x): x is string => !!x))];
      if (ids.length) {
        const us = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, familyName: true, givenName: true } });
        updaterName = new Map(us.map((u) => [u.id, joinPatientName(u.familyName, u.givenName)])); // 이름 조립 정본(외국인 원어 이름 띄어쓰기)
      }
    } catch (e) {
      this.logger.warn(`설정 상세 조회 실패 — 결정별 설정을 '확인 불가'로: ${e instanceof Error ? e.message : String(e)}`);
      described = null;
    }
    /** 엔진 신호 — 🔴 실패는 "재검토 필요 없음"으로 접지 않는다(null = 확인 불가) */
    let signals: Awaited<ReturnType<DecisionEngineService['listSignals']>> | null = null;
    try { signals = await this.engine.listSignals(); } catch (e) {
      this.logger.warn(`결정 이력 신호 조회 실패 — 재검토 필요·이력 수를 '확인 불가'로: ${e instanceof Error ? e.message : String(e)}`);
    }
    const recordOf = (key: string): DecisionRecord | null => {
      const v = cfg.get(KEY(key));
      return v && typeof v === 'object' ? (v as DecisionRecord) : null;
    };
    // 실결정만 — 시드 기록은 선행 조건·결정 수에 들어가지 않는다
    const realRecordOf = (key: string): DecisionRecord | null => { const r = recordOf(key); return isSeedDecisionRecord(r) ? null : r; };
    /**
     * 🔴 위원회 의결로 남은 기록은 집행 액션이 **위원회 결정 소속**이다(등록부 키가 아니다 — 액션 원장 불변식).
     *    여기서 함께 읽지 않으면 의결이 반영돼도 결정 화면은 "반영 대기"로 그린다.
     */
    const committeeDecisionIds = [...new Set(DECISION_REGISTRY
      .map((d) => recordOf(d.key)?.committeeDecision?.id)
      .filter((x): x is string => typeof x === 'string'))];
    const committeeActions = committeeDecisionIds.length
      ? await this.prisma.decisionAction.findMany({
          where: { decisionId: { in: committeeDecisionIds } },
          select: { decisionId: true, kind: true, status: true, error: true, enactedAt: true, target: true },
        })
      : [];
    const byDecisionId = new Map<string, typeof committeeActions>();
    for (const a of committeeActions) {
      if (!a.decisionId) continue;
      const arr = byDecisionId.get(a.decisionId) ?? [];
      arr.push(a); byDecisionId.set(a.decisionId, arr);
    }
    /**
     * 위원회 명부(임명 vs 시드) — 결정권한자 표 옆에 "실제로 누가 있는가"를 함께 말한다.
     * 🔴 조회 실패는 0명으로 접지 않는다(`null` = 확인 불가).
     */
    /**
     * 결정권한자 표의 기록(개발 시드 / 원내 채택) — 🔴 조회 실패는 "기록 없음"으로 접지 않는다(`null` = 확인 불가).
     */
    let authorityCfg: Map<string, unknown> | null = null;
    try {
      authorityCfg = await this.config.getMany(COMMITTEE_CODES.map((c) => committeeAuthorityConfigKey(c)));
    } catch (e) {
      this.logger.warn(`위원회 결정권한자 기록 조회 실패 — '확인 불가'로 표시: ${e instanceof Error ? e.message : String(e)}`);
    }
    let rosterByCode: Map<string, { active: number; manual: number; seed: number; chairAppointed: boolean }> | null = null;
    try {
      const cs = await this.prisma.committee.findMany({
        where: { code: { in: [...COMMITTEE_CODES] } },
        select: { code: true, members: { where: { isActive: true }, select: { role: true, source: true } } },
      });
      rosterByCode = new Map(cs.map((c) => [c.code!, {
        active: c.members.length,
        manual: c.members.filter((m) => m.source !== 'SEED').length,
        seed: c.members.filter((m) => m.source === 'SEED').length,
        chairAppointed: c.members.some((m) => m.role === 'CHAIR' && m.source !== 'SEED'),
      }]));
    } catch (e) {
      this.logger.warn(`위원회 명부 조회 실패 — 명부를 '확인 불가'로 표시: ${e instanceof Error ? e.message : String(e)}`);
    }

    for (const d of DECISION_REGISTRY) {
      const rec = recordOf(d.key);
      const seeded = isSeedDecisionRecord(rec);
      const real = seeded ? null : rec;
      const current = d.configKey ? (cfg.get(d.configKey) ?? null) : null;
      const blockedBy = this.unmetDependenciesFrom(d, realRecordOf);
      items.push({
        ...d,
        /** 🔴 기록이 없으면 "미결"이다 — 기본값이 곧 결정인 것처럼 말하지 않는다 · 시드 기록도 미결이다 */
        decided: !!real,
        /** 개발 시드 기록(DEV-SEED) — 보이되 결정으로 세지 않는다 */
        seeded,
        record: rec,
        currentConfigValue: d.configKey ? current : null,
        /** 🔴 상위 층 선행 조건이 미결이면 여기 담긴다 — 기록해도 적용되지 않는다 */
        blockedBy,
        /** 기록 전 올려 둔 근거 문서(기록 시 함께 봉인된다) */
        pendingAttachments: (Array.isArray(cfg.get(ATT_KEY(d.key))) ? cfg.get(ATT_KEY(d.key)) : []) as DecisionAttachment[],
        /** 🔴 "정했다"와 "그렇게 됐다"를 가른다 */
        enactment: real?.committeeDecision
          ? DecisionService.enactmentStatusOf(d, true, byDecisionId.get(real.committeeDecision.id) ?? [], real.committeeDecision.decisionNo)
          : DecisionService.enactmentStatusOf(d, !!real, byKey.get(d.key) ?? []),
        /** 🔴 주관·합동 위원회 — 원내 위원회 층만(허가권자·직원 층은 위원회를 거치지 않는다) */
        committee: d.layer === 'INTERNAL_COMMITTEE' ? decisionCommitteeOf(d.key) : null,
        needsReview: !real ? [] : signals
          ? upstreamChangedAfter({
              myDecidedAt: real.decidedAt, lastReviewConfirmedAt: signals.lastReview.get(d.key) ?? null,
              upstream: (d.dependsOn ?? []).map((u) => ({ key: u, decidedAt: realRecordOf(u)?.decidedAt ?? null })),
            })
          : null,
        governedConfig: rec
          ? decidedConfigOf(d, rec.choice).map((c) => {
              const current = cfg.get(c.key) ?? null;
              return { key: c.key, decided: c.value, current, matches: sameConfigValue(current, c.value) };
            })
          : [],
        logCount: signals ? (signals.counts.get(d.key) ?? 0) : null,
        mechanism: mechanismOf(d),
        devApply: mechanismOf(d) !== 'DEV_APPLY' ? null : {
          ...(signals
            ? devApplyStatusOf({ decision: real ? { choice: real.choice, decidedAt: real.decidedAt } : null, events: signals.devEvents.get(d.key) ?? [] })
            : { status: null, version: null, since: real?.decidedAt ?? null }),
          implementedChoice: DEV_APPLY_IMPLEMENTED[d.key] ?? null,
        },
        settings: described ? DecisionService.settingDetailsOf(d, rec, described, updaterName) : null,
        /**
         * 🔴 이 결정이 **직접 풀어주는** 하위 결정(dependsOn 의 역방향).
         * 허가권자가 "내가 지금 이걸 정하면 무엇이 움직이는가"를 알아야 순서를 잡을 수 있다.
         */
        unlocks: DECISION_REGISTRY.filter((x) => (x.dependsOn ?? []).includes(d.key))
          .map((x) => ({ key: x.key, title: x.title, layer: x.layer })),
        /** 🔴 지금 바로 결정할 수 있는가 — 미결이면서 선행 조건이 모두 풀린 것 */
        readyToDecide: !real && blockedBy.length === 0 && d.approvalPath !== 'PER_EVENT_DIALOG',
        domain: decisionDomainOf(d.key, d.track),
        agenda: agendaByKey ? (agendaByKey.get(d.key) ?? null) : 'UNKNOWN',
        stage: { stage: 'PREPARE', flags: [] },
      });
      const it = items[items.length - 1];
      const ag = it.agenda;
      it.stage = decisionStageOf({
        layer: d.layer, seeded, decided: !!real, readyToDecide: it.readyToDecide,
        agenda: ag === 'UNKNOWN' ? 'UNKNOWN' : ag ? ag.status : null,
        enactmentState: it.enactment.state,
      });
    }
    /**
     * 🔴 진행률은 **분모와 함께** 낸다. 층별로 따로 내는 이유는 세 층이 별개이기 때문이다 —
     * 합쳐 하나의 퍼센트로 내면 "위원회가 다 의결했으니 90%" 같은 거짓 안심이 생긴다.
     */
    const byLayer = (['LICENSE_HOLDER', 'INTERNAL_COMMITTEE', 'STAFF'] as const).map((layer) => {
      const rows = items.filter((i) => i.layer === layer);
      return {
        layer,
        total: rows.length,
        decided: rows.filter((i) => i.decided).length,
        seeded: rows.filter((i) => i.seeded).length,
        blocked: rows.filter((i) => !i.decided && i.blockedBy.length > 0).length,
        readyToDecide: rows.filter((i) => i.readyToDecide).length,
      };
    });
    /**
     * 🔴 축은 **층과 직교**한다 — 층은 "누가 정하는가", 축은 "무엇에 관한 것인가".
     *    항목이 56개가 되면서 층 셋만으로는 찾을 수 없게 됐다(사람이 자기 축을 먼저 고른다).
     *    🔴 항목이 하나도 없는 축은 내지 않는다 — 빈 필터는 "여기엔 없다"가 아니라
     *       "이 축이 있다"로 읽혀 없는 일감을 만든다.
     */
    const byTrack = (Object.keys(DECISION_TRACKS) as Array<keyof typeof DECISION_TRACKS>)
      .map((track) => {
        const rows = items.filter((i) => i.track === track);
        return {
          track,
          label: DECISION_TRACKS[track],
          total: rows.length,
          decided: rows.filter((i) => i.decided).length,
          seeded: rows.filter((i) => i.seeded).length,
          readyToDecide: rows.filter((i) => i.readyToDecide).length,
        };
      })
      .filter((r) => r.total > 0);

    return {
      items,
      layers: LAYER_META,
      tracks: DECISION_TRACKS,
      summary: {
        byLayer,
        byTrack,
        /** 개시 전 반드시 필요한 것 — go-live 관제와 같은 축 */
        goLiveRequired: {
          total: items.filter((i) => i.goLive === 'REQUIRED_BEFORE').length,
          decided: items.filter((i) => i.goLive === 'REQUIRED_BEFORE' && i.decided).length,
          seeded: items.filter((i) => i.goLive === 'REQUIRED_BEFORE' && i.seeded).length,
        },
        /** 개발 시드 기록 수 — 결정 수에 들어가지 않는다 */
        seeded: items.filter((i) => i.seeded).length,
        /** 🔴 큰 분류별 — 분모는 전체(거르지 않음) · 순서 = 결정 순서 안내(기본 설정부터) */
        byDomain: DECISION_DOMAINS.map((dm) => {
          const rows = items.filter((i) => i.domain === dm.key);
          return {
            domain: dm.key, label: dm.label, description: dm.description,
            total: rows.length,
            decided: rows.filter((i) => i.decided).length,
            seeded: rows.filter((i) => i.seeded).length,
            readyToDecide: rows.filter((i) => i.readyToDecide).length,
            blocked: rows.filter((i) => !i.decided && i.blockedBy.length > 0).length,
          };
        }),
        /** 위원회 층 결정의 과정 단계별 수 — 확인(VERIFIED)은 시스템이 세지 않는다(null) */
        byStage: COMMITTEE_DECISION_STAGES.map((st) => ({
          stage: st.key as CommitteeDecisionStage,
          count: st.key === 'VERIFIED' ? null : items.filter((i) => i.layer === 'INTERNAL_COMMITTEE' && i.stage.stage === st.key).length,
        })),
        /**
         * 🔴 위원회별 — 주관(lead)으로 센다(합동은 따로) · 명부는 임명/시드를 가른다(`null` = 확인 불가)
         *    시드 위원은 리허설용 구성이지 임명이 아니다.
         */
        byCommittee: COMMITTEE_CODES.map((code: CommitteeCode) => {
          const lead = items.filter((i) => i.committee?.lead === code);
          return {
            code, name: COMMITTEE_AUTHORITIES[code].name,
            lead: lead.length,
            joint: items.filter((i) => i.committee?.joint.includes(code)).length,
            decided: lead.filter((i) => i.decided).length,
            seeded: lead.filter((i) => i.seeded).length,
            inProcess: lead.filter((i) => ['SUBMITTED', 'DELIBERATION', 'RESOLVED'].includes(i.stage.stage)).length,
            /** 결정권한자 표 기록 — source: RECORDED(원내 채택)·DEV_SEED(개발 시드 확정)·NONE(정의만)·INVALID · `null` = 조회 실패 */
            authority: authorityCfg
              ? (() => {
                  const raw = authorityCfg.get(committeeAuthorityConfigKey(code)) ?? null;
                  return { source: committeeAuthoritySourceOf(raw), record: readCommitteeAuthorityRecord(raw) };
                })()
              : null,
            roster: rosterByCode ? (rosterByCode.get(code) ?? { active: 0, manual: 0, seed: 0, chairAppointed: false }) : null,
          };
        }),
        /** 결정 방식별 — 분모는 전체 · 순서 = shared 정본 */
        byMechanism: DECISION_MECHANISMS.map((m) => {
          const rows = items.filter((i) => i.mechanism === m);
          return { mechanism: m, total: rows.length, decided: rows.filter((i) => i.decided).length, seeded: rows.filter((i) => i.seeded).length };
        }).filter((r) => r.total > 0),
        /** 엔진 — 보호 수준 · 재검토 필요 수 · 결정과 다른 설정 수(`null` = 확인 불가) */
        engine: {
          protectionMode: signals?.protectionMode ?? null,
          reviewNeeded: signals ? items.filter((i) => !!i.needsReview?.length).length : null,
          configDrift: items.filter((i) => i.governedConfig.some((g) => !g.matches)).length,
          logTotal: signals ? [...signals.counts.values()].reduce((a, b) => a + b, 0) : null,
        },
        /**
         * 개발 반영 이행 상태별 수(기획 P2-2) — 분모 = 개발 반영 결정 전체 · 개시 전 필수는 따로 · `null` = 확인 불가
         * 🔴 시드는 이행 상태를 만들지 않는다(실결정이 없으면 미결)
         */
        devApply: signals ? (() => {
          const rows = items.filter((i) => i.devApply);
          const count = (xs: typeof rows) => Object.fromEntries(DEV_APPLY_STATUSES.map((st) => [st, xs.filter((i) => i.devApply!.status === st).length])) as Record<DevApplyStatus, number>;
          const req = rows.filter((i) => i.goLive === 'REQUIRED_BEFORE');
          return { total: rows.length, byStatus: count(rows), requiredBeforeGoLive: { total: req.length, byStatus: count(req) } };
        })() : null,
        /** 안건 조회 실패 — 단계 ②~④ 수는 이 경우 확인 불가다 */
        agendaUnknown: agendaByKey === null,
      },
      measuredAt: new Date().toISOString(),
      caveat:
        '🔴 이 시스템은 결정자의 **직책·허가권을 검증하지 못한다** — 본인이 밝힌 권한 근거를 기록할 뿐이다. ' +
        '🔴 세 층(허가권자 법적 요건 · 원내 위원회 정책 · 직원 건별 판단)은 별개이며 **하위가 상위를 대체하지 못한다**. ' +
        '위원회 의결 사항은 이 화면이 적용하지 않고 안건으로 넘긴다. 코드·스키마 변경은 기록만 하고 개발이 반영한다.',
    };
  }

  /**
   * 🔴 상위 층 선행 조건 중 **아직 결정되지 않았거나 부정 결정**인 것.
   * 있으면 하위 층 결정은 기록될 수 있어도 **적용되지 않는다** —
   * 원내 의결이 법적 요건을 앞지를 수 없기 때문이다.
   */
  private async unmetDependencies(d: DecisionDef): Promise<Array<{ key: string; title: string; reason: string }>> {
    const recs = new Map<string, DecisionRecord | null>();
    for (const dep of d.dependsOn ?? []) recs.set(dep, await this.record(dep));
    // 🔴 시드 기록은 선행 조건을 채우지 않는다(실결정이 아니다)
    return this.unmetDependenciesFrom(d, (k) => { const r = recs.get(k) ?? null; return isSeedDecisionRecord(r) ? null : r; });
  }

  /**
   * 🔴 판정 정본은 **여기 하나다**. 목록(배치 조회)과 기록(단건 조회)이 각자 판정하면
   *    "화면은 풀렸다는데 저장이 거부되는" 어긋남이 생긴다 — 조회 방식만 다르고 규칙은 같아야 한다.
   */
  private unmetDependenciesFrom(
    d: DecisionDef,
    recordOf: (key: string) => DecisionRecord | null,
  ): Array<{ key: string; title: string; reason: string }> {
    const out: Array<{ key: string; title: string; reason: string }> = [];
    for (const dep of d.dependsOn ?? []) {
      const def = DECISION_REGISTRY.find((x) => x.key === dep);
      if (!def) { out.push({ key: dep, title: dep, reason: '등록부에 없는 선행 조건' }); continue; }
      const rec = recordOf(dep);
      if (!rec) { out.push({ key: dep, title: def.title, reason: '아직 결정되지 않음' }); continue; }
      // 🔴 "확인했다/체결했다" 계열이 아닌 선택은 충족으로 세지 않는다 — 부정 결정도 결정이다
      const chosen = def.options.find((o) => o.value === rec.choice);
      const negative = isNegativeChoice(rec.choice); // 정본 `decision-engine.ts`
      if (negative) out.push({ key: dep, title: def.title, reason: `선행 결정이 "${chosen?.label ?? rec.choice}" 이다` });
    }
    return out;
  }

  /**
   * 결정 기록. 🔴 **법적 검토 근거 없이는 거부한다.**
   *
   * 적용 범위:
   *  · `AUTHORIZED_ROLE` + `configKey` → 기록 후 **적용**한다
   *  · `COMMITTEE`  → 적용하지 않는다. 위원회 안건으로 올려야 한다(화면이 권한을 가진 척하지 않는다)
   *  · `CODE_CHANGE` → 적용하지 않는다. 배포·마이그레이션으로만 반영된다
   */
  async decide(
    key: string,
    userId: string,
    dto: { choice: string; legalReviewRef: string; authorityClaim: string; note?: string },
  ) {
    const d = this.def(key);
    /** 바뀌기 전 기록 — 엔진이 "무엇에서 무엇으로"를 원장에 남긴다 */
    const prevRecord = await this.record(key);
    const opt = d.options.find((o) => o.value === dto.choice);
    if (!opt) throw new BadRequestException({ code: 'DECISION_INVALID_CHOICE', message: `선택지에 없는 값입니다: ${dto.choice}` });

    // 🔴 fail-closed — 근거 없는 결정은 기록하지 않는다. 나중에 "왜 켰는지" 물을 때 답이 없다.
    const legal = (dto.legalReviewRef ?? '').trim();
    if (legal.length < 4) {
      throw new BadRequestException({
        code: 'DECISION_LEGAL_REVIEW_REQUIRED',
        message: '법적 검토 근거를 입력해야 기록할 수 있습니다(문서번호·회신·의결번호 등).',
      });
    }
    const authority = (dto.authorityClaim ?? '').trim();
    if (authority.length < 2) {
      throw new BadRequestException({
        code: 'DECISION_AUTHORITY_REQUIRED',
        message: `허가권 근거를 입력해야 합니다(예: ${d.authority}).`,
      });
    }

    // 🔴 이 화면에서 결정하지 않는 층 — 직원 건별 판단은 업무 화면의 다이얼로그가 자리다
    if (d.approvalPath === 'PER_EVENT_DIALOG') {
      throw new BadRequestException({
        code: 'DECISION_PER_EVENT',
        message: '이 결정은 업무 화면의 승인 다이얼로그에서 건별로 이뤄집니다 — 관리 화면에서 미리 정할 수 없습니다.',
      });
    }

    // 🔴 상위 층 선행 조건이 미결이면 **적용하지 않는다**(기록은 남긴다 — 심의는 할 수 있다)
    const unmet = await this.unmetDependencies(d);

    // 🔴 허가권자 층은 **근거 문서 없이 기록할 수 없다.** 법적 요건의 근거가 말로만 남으면
    //    나중에 "무엇을 보고 판단했는가"에 답할 수 없다.
    const attachments = await this.pendingAttachments(key);
    if (d.layer === 'LICENSE_HOLDER' && attachments.length === 0) {
      throw new BadRequestException({
        code: 'DECISION_ATTACHMENT_REQUIRED',
        message: '허가 결정은 근거 문서를 1건 이상 첨부해야 기록할 수 있습니다(검토 회신·계약서·의견서 등).',
      });
    }

    let applied = false;
    let appliedDetail: string | undefined;
    if (unmet.length) {
      appliedDetail =
        `상위 층 선행 조건이 충족되지 않아 적용하지 않았다 — ${unmet.map((u) => `${u.title}(${u.reason})`).join(' · ')}`;
    } else if (d.approvalPath === 'AUTHORIZED_ROLE' && d.enactKind) {
      /**
       * 🔴 **집행은 집행 엔진이 한다**(2026-08-27). 종전에는 여기서 `config.set()` 을 직접 불렀다.
       *    그 경로에는 ①집행 전 스냅샷 ②실패 기록 이 둘 다 없었고, 무엇보다
       *    `config.set` 이 던지면 **결정 기록 자체가 남지 않았다**(try/catch 부재) —
       *    사람이 한 결정이 시스템 실패 때문에 사라졌다.
       *
       *    이제 결정 기록과 집행을 **분리**한다. 결정은 사람이 한 사실이고 집행은 시스템이 한 일이다.
       *    하나가 실패했다고 다른 하나를 지우지 않는다.
       */
      const target = this.enactTargetFor(d, dto.choice);
      if (target === undefined) {
        // 등록부가 선택지에 `enact` 를 빠뜨렸다 — 조용히 넘기지 않는다(가드가 잡지만 런타임도 말한다)
        appliedDetail = `🔴 이 선택('${dto.choice}')에 집행 바인딩이 없다 — 등록부를 고쳐야 반영된다`;
      } else if (target === null) {
        appliedDetail = '이 선택은 아무것도 바꾸지 않는다(등록부에 명시됨)';
      } else {
        const act = await this.prisma.decisionAction.create({
          data: { registryKey: d.key, kind: d.enactKind, target: target as never, status: 'PENDING' },
          select: { id: true },
        });
        try {
          const r = await this.enactment.enactRegistryDecision(d.key, userId);
          applied = r.enacted > 0 && r.failed === 0;
          appliedDetail = applied
            ? `집행됨 — ${d.enactKind} ${JSON.stringify(target)}`
            : r.failed > 0
              ? `🔴 집행 실패 — 액션 원장(${act.id})에 사유가 남아 있다`
              : `기록됨 · 반영 보류 — 잔여 ${r.remaining}건`;
        } catch (e) {
          // 🔴 게이트 OFF 등으로 집행이 거부돼도 **결정 기록은 남긴다**(사람의 결정은 이미 일어난 사실이다)
          applied = false;
          appliedDetail = `기록됨 · 반영 보류 — ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    } else if (d.approvalPath === 'COMMITTEE') {
      appliedDetail = '위원회 의결 사항이라 이 화면은 적용하지 않는다 — /admin/gld 에 안건으로 올려야 한다';
    } else if (d.approvalPath === 'CODE_CHANGE') {
      appliedDetail = '코드·스키마 변경이라 배포로만 반영된다 — 이 화면은 결정만 기록한다';
    } else {
      // 🔴 `PER_EVENT_DIALOG` 분기를 여기 두지 않는다 — 위(§decide 앞부분)에서 이미 거부하므로
      //    **도달 불가 코드**가 된다(TS 가 잡았다). 죽은 분기는 다음 사람에게 거짓 지도를 준다.

      /**
       * 🔴 허가권자 경로인데 바인딩이 없는 결정 — **바꿀 설정이 없는 것이 정상**이다.
       *    이 넷은 전부 법적 확인이다(적법 근거를 확인했는가 · 위탁계약을 체결했는가 ·
       *    의료기기 해당 여부를 확인했는가 · 채널을 도입했는가).
       *    확인 자체는 아무 스위치도 켜지 않고, **후속 결정을 여는 것**이 역할이다(`dependsOn`).
       *
       *    🔴 종전에는 이 경우에도 "코드·스키마 변경이라 배포로만 반영된다"고 적었다 — 사실이 아니다.
       *       그 문구를 본 사람은 배포를 기다리게 되는데, 실제로는 후속 결정을 하러 가야 한다.
       */
      // 🔴 새 필드를 만들지 않는다 — `dependsOn` 의 역방향이 이미 그 사실을 갖고 있다
      const unlocks = DECISION_REGISTRY.filter((x) => x.dependsOn?.includes(d.key)).map((x) => x.title);
      appliedDetail = unlocks.length
        ? `확인이 기록됐다(바꿀 설정 없음) — 이제 다음이 열린다: ${unlocks.join(' · ')}`
        : '확인이 기록됐다(바꿀 설정 없음) — 이 확인만으로는 아무것도 바뀌지 않는다';
    }

    const rec: DecisionRecord = {
      choice: dto.choice,
      legalReviewRef: legal,
      authorityClaim: authority,
      note: dto.note?.trim() || undefined,
      decidedByUserId: userId,
      decidedAt: new Date().toISOString(),
      applied,
      appliedDetail,
      attachments: attachments.length ? attachments : undefined,
    };
    await this.config.set(KEY(key), rec as unknown as Record<string, unknown>, userId);
    // 봉인 — 기록에 담았으므로 대기 목록은 비운다(같은 문서가 다음 결정에 재사용되지 않게)
    if (attachments.length) await this.config.set(ATT_KEY(key), [] as unknown as Record<string, unknown>, userId);

    void this.audit
      ?.log({
        userId,
        action: AuditAction.UPDATE,
        resourceType: 'HumanDecision',
        resourceId: key,
        changes: { decision: { old: null, new: `choice=${dto.choice};applied=${applied};legalRef=${legal.slice(0, 60)}` } },
      })
      .catch(() => {});

    this.logger.warn(`중요 결정 기록: ${key} = ${dto.choice} (적용 ${applied ? '함' : '안 함'}) by ${userId} · 근거 ${legal.slice(0, 40)}`);
    // 🔴 엔진 — 이력 원장 · 후행 실결정에 선행 변경 전파(원장 실패는 결정을 되돌리지 않고 응답이 말한다)
    const engine = await this.engine.onRecorded({ key, prev: prevRecord, next: rec, kind: 'RECORDED', actorUserId: userId });
    return { key, record: rec, option: opt, engine };
  }

  /**
   * 🔴 **"정했다"와 "그렇게 됐다"는 다른 사실이다.**
   *
   *    종전 화면은 `decided` 하나였다. 그러면 "34건 중 20건 결정 완료"가
   *    **실제로는 아무것도 바뀌지 않은 상태**를 가린다 — 위원회 사항은 안건이 남아 있고,
   *    코드 변경은 배포가 남아 있고, 게이트가 꺼져 있으면 반영 자체가 보류 중이다.
   *
   *    5상태로 가른다. 🔴 `PENDING`(반영대기)을 `ENACTED`(반영됨)와 같은 색으로 그리지 않는다.
   */
  /** 결정 하나가 건드리는 설정들의 상세 — 선택지별 값·현재 값과 같은 선택지·결정 값 일치·출처·마지막 변경 */
  static settingDetailsOf(
    d: DecisionDef,
    rec: DecisionRecord | null,
    described: Awaited<ReturnType<ConfigRuntimeService['describeMany']>>,
    updaterName: Map<string, string>,
  ): DecisionSettingDetail[] {
    return configKeysOf(d).map((key) => {
      const v = described.get(key);
      const options = d.options.map((o) => {
        const c = enactConfigOf(o.enact);
        return { value: o.value, label: o.label, sets: !!c && c.key === key, setValue: c && c.key === key ? c.value : null };
      });
      const role: 'SETS' | 'RELATED' = options.some((o) => o.sets) ? 'SETS' : 'RELATED';
      const current = v ? v.value : null;
      const decided = rec ? options.find((o) => o.value === rec.choice) : undefined;
      // 🔴 "지금 동작과 같은 선택지" — 값이 정확히 같은 선택지만(근사·라벨 추정 없음) · 여럿이면 첫 것
      const currentOption = options.find((o) => o.sets && sameConfigValue(o.setValue, current))?.value ?? null;
      return {
        key, role,
        description: v?.description ?? null, category: v?.category ?? null, registered: v?.registered ?? false,
        current, source: v?.source ?? 'unset', defaultValue: v?.defaultValue ?? null,
        allowed: allowedRuleOf(key),
        options,
        decidedValue: decided?.sets ? decided.setValue : null,
        decidedSets: !!decided?.sets,
        matchesDecision: decided?.sets ? sameConfigValue(current, decided.setValue) : null,
        currentOption,
        updatedAt: v?.updatedAt ?? null,
        updatedByName: v?.updatedBy ? (updaterName.get(v.updatedBy) ?? null) : null,
      };
    });
  }

  static enactmentStatusOf(
    d: DecisionDef,
    decided: boolean,
    actions: Array<{ kind: string; status: string; error: string | null; enactedAt: Date | null; target: unknown }>,
    /** 위원회 의결 번호 — 있으면 의결로 남은 기록이다(액션이 없을 때 이유가 다르다) */
    committeeDecisionNo?: string,
  ): EnactmentStatus {
    if (!decided) return { state: 'UNDECIDED', label: '미결', detail: null, actions: [] };
    const brief = actions.map((a) => ({
      kind: a.kind, status: a.status, error: a.error,
      enactedAt: a.enactedAt ? a.enactedAt.toISOString() : null, target: a.target,
    }));
    const failed = actions.find((a) => a.status === 'FAILED');
    if (failed) {
      return { state: 'FAILED', label: '결정·반영실패', detail: failed.error ?? '사유가 기록되지 않았다', actions: brief };
    }
    if (actions.some((a) => a.status === 'PENDING')) {
      return { state: 'PENDING', label: '결정·반영대기', detail: '집행이 아직 이뤄지지 않았다(게이트 OFF·시행일 전 등)', actions: brief };
    }
    if (actions.length && actions.every((a) => a.status === 'ENACTED')) {
      const manual = actions.every((a) => a.kind === 'MANUAL');
      return manual
        ? { state: 'MANUAL_CONFIRMED', label: '결정·수동확인', detail: '사람이 이행을 표시했다(자가신고)', actions: brief }
        : { state: 'ENACTED', label: '결정·반영됨', detail: null, actions: brief };
    }
    // 액션이 없는 결정 — 자동 반영 대상이 아니다. 🔴 그렇다고 "반영됨"이라 말하지 않는다.
    const why =
      committeeDecisionNo ? '의결된 선택은 자동으로 바꾸는 설정이 없다 — 이행은 사람이 확인한다'
      : d.approvalPath === 'COMMITTEE' ? '위원회 안건 상신·의결이 남았다'
      : d.approvalPath === 'CODE_CHANGE' ? '배포로만 반영된다'
      : d.approvalPath === 'PER_EVENT_DIALOG' ? '건별 승인이라 일괄 반영 대상이 아니다'
      : '집행 바인딩이 없다(기록만)';
    return { state: 'PENDING', label: '결정·반영대기', detail: why, actions: brief };
  }

  /**
   * 선택지 → 집행 target.
   *
   * 🔴 종전에는 이 자리에 **키를 손으로 나열**했다(`if (d.key === '...')`). 그래서 나열에서 빠진
   *    결정은 `configKey` 가 있어도 조용히 반영되지 않았다 — `billing.institutionType` 이 그랬다.
   *    이제 target 은 **선택지 자신이 들고 있고**, 가드가 "모든 선택지에 있다"를 강제한다.
   *
   * 반환 3상태: `object`(바꾼다) · `null`(바꾸지 않는다고 **명시**) · `undefined`(등록부가 빠뜨렸다)
   */
  private enactTargetFor(d: DecisionDef, choice: string): Record<string, unknown> | null | undefined {
    const opt = d.options.find((o) => o.value === choice);
    if (!opt || !('enact' in opt)) return undefined;
    return opt.enact ?? null;
  }
}
