import { Injectable } from '@nestjs/common';
import { Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigRuntimeService } from '../config/config-runtime.service';
import { GoLiveService } from '../go-live/go-live.service';
import { DecisionService } from '../decision-registry/decision.service';
import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { msgException } from '../../common/msg-exception';
import { join } from 'path';
import { signUploadUrl } from '../../common/util/upload-url';
import { dateOnlyValue } from '../../common/day-range';
import { randomBytes } from 'crypto';
import { serverMsg, renderServerMessageKo, type ServerMessage } from '@hospital-run/shared';
import {
  OPENING_REGISTRY, PHASE_ORDER, PHASE_LABEL, PHASE_NOTE, PHASE_STAGE,
  DUE_LABEL, CYCLE_LABEL, REGISTRY_CAVEAT, COUNTRY_META, COUNTRY_ORDER, DEFAULT_COUNTRY,
  INSTITUTION_KEY_PREFIX, isCountryCode, isOpeningPhase, isOpeningDue, isOpeningCycle,
  type OpeningTaskDef, type OpeningPhase, type CountryCode,
} from './opening.registry';

/**
 * 개원 단계 상태 — **4상**.
 *
 * 🔴 `NOT_RECORDED` 를 "미완료"라 부르지 않는다. 병원이 이미 했는데 시스템에 안 적었을 수
 *    있다 — 모르는 것과 안 한 것은 다른 사실이다. 화면도 "기록 없음"이라 쓴다.
 */
export type OpeningState = 'DERIVED' | 'RECORDED' | 'NOT_RECORDED' | 'NOT_APPLICABLE';

/**
 * 항목이 **어디서 왔는가** — 🔴 섞으면 두 방향으로 거짓말한다.
 *  · 기관 항목이 코드 항목처럼 보이면 → 기관이 정한 것을 법정 의무로 읽는다
 *  · 코드 항목이 기관 항목처럼 보이면 → 지울 수 있는 것으로 읽는다
 */
export type OpeningOrigin = 'REGISTRY' | 'INSTITUTION';

export interface OpeningTaskView extends OpeningTaskDef {
  origin: OpeningOrigin;
  /** 기관 항목만 — 비활성 여부(코드 항목은 내릴 수 없다: `NOT_APPLICABLE` 기록으로 표시한다) */
  inactive?: { reason: string | null };
  state: OpeningState;
  /** 파생 항목의 원본 상태(그대로 옮긴다 — 여기서 재해석하지 않는다) */
  /** 🔴 `detail` 은 **없을 수 있다**(원본이 안 주는 항목이 있다) — `null` 로 명시한다.
   *    `undefined` 로 두면 직렬화에서 키가 통째로 사라져 소비처가 터진다(운영에서 실제로 겪었다).
   *    `detailMsg`(2026-09-15 I2)가 정본 — 화면 `<ServerText>` 가 카탈로그로 조립한다. `detail` 은 그 한국어 파생(구 번들용). */
  derived: { source: 'GO_LIVE' | 'DECISION' | 'COMMITTEE'; status: string; detail: string | null; detailMsg: ServerMessage | null; href: string } | null;
  /** 선행 항목 중 아직 완료로 읽히지 않는 것 — 🔴 **막지 않는다**. 순서를 보여줄 뿐 */
  waitingOn: Array<{ key: string; title: string }>;
  /** 사람이 남긴 기록 — 연결 키가 없는 항목만 가질 수 있다 */
  record: {
    state: 'RECORDED' | 'NOT_APPLICABLE';
    evidenceRef: string | null;
    evidenceDate: string | null;
    note: string | null;
    recordedAt: string;
    attachments: OpeningAttachment[];
  } | null;
}

/** 표시 사유 — `detailMsg` 가 정본, `detail` 은 같은 정본의 한국어 파생(템플릿 조립이 아니다) */
function withMsg(detailMsg: ServerMessage | null): { detail: string | null; detailMsg: ServerMessage | null } {
  return { detail: detailMsg ? renderServerMessageKo(detailMsg) : null, detailMsg };
}

/**
 * 주기 → **현재 주기의 구간**. 🔴 `AD_HOC`·미설정은 `null`(판정 대상 아님).
 *
 * 🔴 경계는 로컬 달력 기준이다. 회의는 "8월에 했다"로 세는 것이지 UTC 로 세는 것이 아니다.
 */
export function cyclePeriod(
  cycle: string | null | undefined,
  now: Date,
): { from: Date; to: Date; label: string; labelMsg: ServerMessage } | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  // 🔴 라벨은 `{ k, params }` 가 정본(2026-09-15 I2) — `label` 은 그 한국어 파생이다(조립 템플릿이 아니다)
  const at = (from: Date, to: Date, labelMsg: ServerMessage) => ({ from, to, label: renderServerMessageKo(labelMsg), labelMsg });
  switch (cycle) {
    case 'MONTHLY':
      return at(new Date(y, m, 1), new Date(y, m + 1, 1), serverMsg('{연}년 {월}월', { 연: y, 월: m + 1 }));
    case 'QUARTERLY': {
      const q = Math.floor(m / 3);
      return at(new Date(y, q * 3, 1), new Date(y, q * 3 + 3, 1), serverMsg('{연}년 {분기}분기', { 연: y, 분기: q + 1 }));
    }
    case 'SEMIANNUAL': {
      const h = m < 6 ? 0 : 1;
      return at(
        new Date(y, h * 6, 1), new Date(y, h * 6 + 6, 1),
        h === 0 ? serverMsg('{연}년 상반기', { 연: y }) : serverMsg('{연}년 하반기', { 연: y }),
      );
    }
    case 'ANNUAL':
      return at(new Date(y, 0, 1), new Date(y + 1, 0, 1), serverMsg('{연}년', { 연: y }));
    default:
      return null;
  }
}

/** 마지막으로 **개최된**(COMPLETED) 회의 — 예정은 아니다. 없으면 `null`(0 이 아니다) */
function lastCompleted(meetings: { scheduledAt: Date; status: string }[]): string | null {
  const done = meetings.filter((m) => m.status === 'COMPLETED').sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime())[0];
  return done ? done.scheduledAt.toISOString() : null;
}

/** 증빙 첨부 한 건 */
export interface OpeningAttachment {
  id: string; fileName: string; url: string; mimeType: string; sizeBytes: number;
  uploadedBy: string; uploadedAt: string;
}

/** 저장된 Json 을 첨부 배열로 — 모양이 아니면 **버린다**(지어내지 않는다) */
export function readAttachments(raw: unknown): OpeningAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is OpeningAttachment =>
    !!a && typeof a === 'object'
    && typeof (a as OpeningAttachment).id === 'string'
    && typeof (a as OpeningAttachment).url === 'string'
    && typeof (a as OpeningAttachment).fileName === 'string');
}

/** 파생 상태 중 "된 것"으로 읽는 값 — 원본 어휘를 그대로 쓴다(번역하면 갈라진다) */
const GO_LIVE_DONE = new Set(['READY', 'DONE']);

@Injectable()
export class OpeningService {
  constructor(
    private prisma: PrismaService,
    private goLive: GoLiveService,
    private decisions: DecisionService,
    @Optional() private readonly config?: ConfigRuntimeService,
  ) {}

  /**
   * 개원 단계 전체.
   *
   * 🔴 항목은 **자기 상태를 갖지 않는다.** 연결 키가 있으면 기존 정본에서 읽고,
   *    없으면 사람 기록(P1)에서 읽는다. 여기 저장하면 정본이 둘이 된다.
   */
  /**
   * 기관이 어느 나라에서 운영되는가 — 🔴 설정이 없으면 **기본값을 명시**하고 그 사실을 응답에 싣는다
   *    (조용히 한국으로 두면 UAE 기관이 자기 항목을 못 본다).
   */
  async country(): Promise<{ code: CountryCode; fromConfig: boolean }> {
    // 🔴 (2026-10-01) "설정에서 왔다"는 **기관이 넣은 값**(db/env)일 때만 — 카탈로그 기본값(KR)을 설정값으로 말하지 않는다.
    //    종전엔 config 가 주입되지 않아(모듈 미import) 설정한 국가가 늘 무시되고 늘 기본(KR)이었다.
    const r = await this.config?.getWithSource('hospital.country').catch(() => null);
    const set = r?.source === 'db' || r?.source === 'env';
    return set && isCountryCode(r?.value) ? { code: r!.value as CountryCode, fromConfig: true } : { code: DEFAULT_COUNTRY, fromConfig: false };
  }

  async overview(countryOverride?: string) {
    // 파생 원천 셋을 한 번씩만 읽는다(항목마다 부르면 46번 왕복한다)
    const [goLiveRollup, decisionList, committees, records, customRows] = await Promise.all([
      this.goLive.rollup(),
      this.decisions.list(),
      // 🔴 **코드 없는 위원회까지** 읽는다. 정본(코드 있는 것)만 보면 같은 이름이
      //    따로 존재한다는 사실이 화면에서 사라진다 — 그 사실이 정리 방향을 바꾼다.
      this.prisma.committee.findMany({
        where: { isActive: true },
        select: {
          code: true, name: true, quorum: true,
          // 🔴 **출처를 함께 읽는다.** 시드 구성으로 채워진 명부를 "임명 완료"로 세면
          //    화면이 거짓 안심을 준다(시드 결재를 실결재로 세어 65%를 표시한 전례).
          members: { where: { isActive: true }, select: { source: true } },
        },
      }),
      this.prisma.openingTaskRecord.findMany(),
      // 🔴 **비활성까지 읽는다.** 목록에서는 빼지만 "몇 건을 내렸는지"는 화면이 말해야 한다 —
      //    조용히 사라지면 "그런 항목이 없다"로 읽힌다(0건과 내려둔 것은 다른 사실).
      this.prisma.openingCustomTask.findMany({ orderBy: { createdAt: 'asc' } }),
    ]);
    const recordByKey = new Map(records.map((r) => [r.taskKey, r]));

    const goLiveByKey = new Map(
      (goLiveRollup.items as Array<{ key: string; status: string; detailMsg?: ServerMessage | null }>).map((i) => [i.key, i]),
    );
    const decisionByKey = new Map(
      (decisionList.items as Array<{ key: string; decided: boolean; seeded?: boolean; enactment: { label: string } }>).map((i) => [i.key, i]),
    );
    const committeeByCode = new Map(committees.filter((c) => c.code).map((c) => [c.code as string, c]));
    // 🔴 **정확히 같은 이름**만 중복으로 본다. '질향상위원회' 와 '질향상·환자안전위원회' 가
    //    같은 위원회인지는 **사람이 판단할 일**이다 — 내가 비슷하다고 묶으면 그것이 판정이 된다.
    const sameName = new Map<string, typeof committees>();
    for (const c of committees) {
      const list = sameName.get(c.name) ?? [];
      list.push(c);
      sameName.set(c.name, list);
    }
    /** 코드 없는 활성 위원회 — 정본(`COMMITTEE_SEED`)에 없는 잔재. 위원 명부가 여기 있을 수 있다 */
    const codeless = committees.filter((c) => !c.code);

    const chosen = isCountryCode(countryOverride) ? countryOverride : (await this.country()).code;

    /**
     * 🔴 **출처를 갈라서 합친다.** 한 목록에 놓되 어느 쪽에서 왔는지는 항목마다 들고 다닌다.
     *    기관 항목은 **연결 키를 가질 수 없으므로**(표에 컬럼이 없다) 언제나 사람 기록이다.
     */
    const custom = customRows.filter((r) => r.isActive);
    const merged: Array<{ def: OpeningTaskDef; origin: OpeningOrigin }> = [
      ...OPENING_REGISTRY.map((d) => ({ def: d, origin: 'REGISTRY' as const })),
      ...custom.map((r) => ({ def: this.customToDef(r), origin: 'INSTITUTION' as const })),
    ];
    // 🔴 국가로 거른다 — 다른 나라 항목이 섞이면 "안 한 일"로 보인다
    const inCountry = merged.filter((m) => m.def.countries.includes(chosen));

    const tasks: OpeningTaskView[] = inCountry.map(({ def: d, origin }) => {
      const derived = origin === 'INSTITUTION'
        ? null
        : this.derive(d, goLiveByKey, decisionByKey, committeeByCode, sameName);
      const rec = derived ? null : recordByKey.get(d.key) ?? null;
      return {
        ...d,
        origin,
        state: derived
          ? 'DERIVED'
          : rec ? (rec.state as 'RECORDED' | 'NOT_APPLICABLE') : 'NOT_RECORDED',
        derived,
        waitingOn: [],
        record: rec ? {
          state: rec.state as 'RECORDED' | 'NOT_APPLICABLE',
          evidenceRef: rec.evidenceRef,
          // 🔴 date-only 는 날짜만 돌려준다 — 시각을 붙이면 소비처가 타임존으로 하루를 민다
          evidenceDate: rec.evidenceDate ? rec.evidenceDate.toISOString().slice(0, 10) : null,
          note: rec.note,
          recordedAt: rec.recordedAt.toISOString(),
          // 🔴 응답 시점에 서명한다 — 저장 URL 을 그대로 내보내면 누구나 내려받는다
          attachments: readAttachments(rec.attachments).map((a) => ({ ...a, url: signUploadUrl(a.url) })),
        } : null,
      };
    });

    // 선행 관계 — 🔴 보여주기만 한다. 앞 항목이 안 끝나도 뒤 항목을 막지 않는다
    const byKey = new Map(tasks.map((t) => [t.key, t]));
    for (const t of tasks) {
      t.waitingOn = (t.dependsOn ?? [])
        .map((k) => byKey.get(k))
        .filter((p): p is OpeningTaskView => !!p && !this.looksDone(p))
        .map((p) => ({ key: p.key, title: p.title }));
    }

    const phases = PHASE_ORDER.map((p) => {
      const list = tasks.filter((t) => t.phase === p);
      return {
        phase: p,
        label: PHASE_LABEL[p],
        note: PHASE_NOTE[p],
        stage: PHASE_STAGE[p],
        total: list.length,
        // 🔴 분모와 함께. "완료"가 아니라 **"완료로 읽히는 것"** 이다 —
        //    파생 항목만 판정할 수 있고, 기록 없는 것은 판정하지 않는다.
        knownDone: list.filter((t) => this.looksDone(t)).length,
        /** 🔴 판정 불가(연결도 기록도 없다) — 0 으로 뭉개면 "안 한 것"으로 읽힌다 */
        unknown: list.filter((t) => t.state === 'NOT_RECORDED').length,
        /** 🔴 해당 없음은 완료가 아니다 — 분모에 남기되 따로 센다 */
        notApplicable: list.filter((t) => t.state === 'NOT_APPLICABLE').length,
        /**
         * 🔴 이 단계의 분모 중 **기관이 추가한 것**이 몇 건인가.
         *    안 밝히면 "법정 항목 N건 중 M건 완료"로 읽힌다 — 분모의 성격이 다르다.
         */
        institutional: list.filter((t) => t.origin === 'INSTITUTION').length,
        tasks: list,
      };
    });

    return {
      phases,
      /**
       * 🔴 정본에 없는 활성 위원회 — 지우면 **위원 명부가 함께 사라진다.**
       *    실측(2026-08-28): 잔재 6건이 위원 30명을 들고 있고 정본 9건은 위원 0명이었다.
       *    그래서 정리는 삭제가 아니라 **이관**이다. 화면이 이 사실을 말한다.
       */
      codelessCommittees: codeless.map((c) => ({ name: c.name, members: c.members.length })),
      dueLabel: DUE_LABEL,
      /** 지금 보고 있는 나라 + 고를 수 있는 나라 — 화면이 전환한다 */
      country: chosen,
      countryNote: COUNTRY_META[chosen].note,
      countries: COUNTRY_ORDER.map((c) => ({ code: c, label: COUNTRY_META[c].label })),
      /** 🔴 설정에서 온 값인가 — 아니면 기본값으로 떨어진 것이고, 그 사실을 화면이 말한다 */
      countryFromConfig: isCountryCode(countryOverride) ? true : (await this.country()).fromConfig,
      caveat: REGISTRY_CAVEAT,
      /**
       * 🔴 기관이 **내려둔** 항목 — 목록에서는 빠졌지만 없는 것이 아니다.
       *    개수를 안 밝히면 "그런 항목이 없다"로 읽힌다.
       */
      inactiveCustom: customRows
        .filter((r) => !r.isActive && r.countries.includes(chosen))
        .map((r) => ({ key: r.key, title: r.title, phase: r.phase, reason: r.inactiveReason })),
      /** 화면이 기관 항목 폼을 그릴 때 쓰는 어휘 — 🔴 FE 가 자기 목록을 두면 갈라진다 */
      cycleLabel: CYCLE_LABEL,
      phaseOptions: PHASE_ORDER.map((p) => ({ phase: p, label: PHASE_LABEL[p], stage: PHASE_STAGE[p] })),
      measuredAt: new Date().toISOString(),
    };
  }

  /**
   * 기관 항목 행 → **레지스트리와 같은 모양**. 🔴 연결 키는 붙이지 않는다(표에 컬럼이 없다).
   *
   * 🔴 저장된 국가·단계·기한이 어휘를 벗어나면 **버리지 않고 그대로 둔다**. 버리면 항목이
   *    조용히 사라지고, 사람은 자기가 만든 것이 없어졌다고 본다. 생성·수정에서 막는다.
   */
  private customToDef(r: {
    key: string; countries: string[]; phase: string; title: string; owner: string;
    authority: string | null; dueBy: string; cycle: string | null; note: string | null; dependsOn: string[];
  }): OpeningTaskDef {
    return {
      phase: r.phase as OpeningPhase,
      key: r.key,
      countries: r.countries as CountryCode[],
      title: r.title,
      owner: r.owner,
      ...(r.authority ? { authority: r.authority } : {}),
      dueBy: r.dueBy as OpeningTaskDef['dueBy'],
      ...(r.cycle ? { cycle: r.cycle as OpeningTaskDef['cycle'] } : {}),
      ...(r.note ? { note: r.note } : {}),
      dependsOn: r.dependsOn,
    };
  }

  /**
   * 🔴 기록이 없는 항목은 "안 한 것"이 아니라 **모르는 것**이다.
   *    `NOT_APPLICABLE`(해당 없음)은 **완료가 아니다** — 따로 센다(합치면 분모가 거짓이 된다).
   */
  private looksDone(t: OpeningTaskView): boolean {
    if (t.state === 'DERIVED') return !!t.derived && GO_LIVE_DONE.has(t.derived.status);
    return t.state === 'RECORDED';
  }

  private derive(
    d: OpeningTaskDef,
    goLive: Map<string, { status: string; detailMsg?: ServerMessage | null }>,
    decisions: Map<string, { decided: boolean; seeded?: boolean; enactment: { label: string } }>,
    committees: Map<string, { name: string; quorum: number | null; members: { source: string }[] }>,
    sameName: Map<string, Array<{ code: string | null; name: string; members: { source: string }[] }>>,
  ): OpeningTaskView['derived'] {
    if (d.goLiveKey) {
      const it = goLive.get(d.goLiveKey);
      // 🔴 연결 키가 정본에 없으면 **지어내지 않는다** — 가드가 이 경우를 0으로 유지한다
      if (!it) return null;
      // 🔴 go-live 의 `detailMsg`(정본)를 그대로 옮긴다 — 종전 `it.detail`(한국어 파생 문자열)은 더 읽지 않는다
      return { source: 'GO_LIVE', status: it.status, ...withMsg(it.detailMsg ?? null), href: '/admin/go-live' };
    }
    if (d.decisionKey) {
      const it = decisions.get(d.decisionKey);
      if (!it) return null;
      return {
        source: 'DECISION',
        // 🔴 "정했다"와 "그렇게 됐다"는 다른 사실 — 집행 라벨을 함께 옮긴다
        status: it.decided ? 'READY' : 'NOT_READY',
        // 집행 라벨은 결정 정본(`DecisionService.enactmentStatusOf`)의 낱말 — 조각으로 옮긴다
        // 시드 기록(DEV-SEED)은 준비가 아니다 — 그렇게 해 두었다는 사실만 말한다
        ...withMsg(it.decided ? serverMsg('결정됨 · {집행}', { 집행: { k: it.enactment.label } }) : it.seeded ? serverMsg('개발 시드 기록 — 실결정 아님') : serverMsg('미결정')),
        href: `/admin/decisions/${d.decisionKey}`,
      };
    }
    if (d.committeeCode) {
      const c = committees.get(d.committeeCode);
      if (!c) return { source: 'COMMITTEE', status: 'NOT_READY', ...withMsg(serverMsg('위원회 없음')), href: '/admin/governance' };
      const n = c.members.length;
      const need = c.quorum ?? 0;
      const appointed = c.members.filter((m) => m.source !== 'SEED').length;
      // 🔴 **같은 이름의 다른 위원회**가 있으면 그 사실을 말한다. 위원 명부가 그쪽에
      //    있으면 "위원 0명"은 사실이지만 **오해를 부르는 사실**이다 — 정리가 삭제가
      //    아니라 이관이어야 한다는 것을 사람이 알아야 한다.
      const twins = (sameName.get(c.name) ?? []).filter((o) => o.code !== d.committeeCode);
      // 🔴 문장을 이어 붙이지 않는다 — 조각마다 키를 두고 `{앞} · {뒤}` 로 잇는다(화면이 조각별로 번역)
      const parts: ServerMessage[] = [
        need > 0 ? serverMsg('위원 {위원}명 / 정족수 {정족수}', { 위원: n, 정족수: need }) : serverMsg('위원 {위원}명 (정족수 미설정)', { 위원: n }),
      ];
      if (n > 0 && appointed === 0) parts.push(serverMsg('전원 시드 구성(실제 임명 기록 없음)'));
      if (appointed > 0 && appointed < n) parts.push(serverMsg('실제 임명 {임명}명', { 임명: appointed }));
      if (twins.length) {
        parts.push(serverMsg('⚠ 같은 이름의 위원회가 따로 있다(코드 없음 · 위원 {위원}명)', { 위원: twins.reduce((a, o) => a + o.members.length, 0) }));
      }
      const filled = n > 0 && (need === 0 || n >= need);
      return {
        source: 'COMMITTEE',
        // 🔴 명부가 찼어도 **전원이 시드면 아직 임명이 아니다** — 그때는 완료로 읽지 않는다
        status: filled && appointed > 0 ? 'READY' : 'IN_PROGRESS',
        ...withMsg(parts.reduce((head, tail) => serverMsg('{head} · {tail}', { head, tail }))),
        href: '/admin/governance',
      };
    }
    return null;
  }

  /**
   * 사람 기록 — 완료했다 / 이 기관에 해당 없다.
   *
   * 🔴 **연결 키가 있는 항목에는 쓰지 않는다.** 상태를 두 곳에서 말하는 순간 정본이 둘이
   *    되고, 그러면 파생이 "미준비"인데 기록은 "완료"인 상태가 생긴다.
   * 🔴 `NOT_APPLICABLE` 에는 **사유를 강제**한다. 사유 없이 지우면 "빠뜨린 것"과
   *    구분되지 않는다.
   * 🔴 증빙은 강제하지 않는다 — 필수로 만들면 아무 값이나 채워진다.
   */
  async record(
    taskKey: string,
    dto: { state: string; evidenceRef?: string; evidenceDate?: string; note?: string },
    userId: string,
  ) {
    const { def, origin, isActive } = await this.resolveTask(taskKey);
    if (def.goLiveKey || def.decisionKey || def.committeeCode) {
      throw new BadRequestException({
        code: 'OPENING_DERIVED_TASK',
        message: '이 항목의 상태는 다른 정본이 말합니다 — 여기서 기록하지 않습니다.',
      });
    }
    // 🔴 내려둔 기관 항목에는 새 기록을 받지 않는다(철회는 된다 — 이미 남은 것은 지울 수 있어야 한다)
    if (origin === 'INSTITUTION' && !isActive) {
      throw new BadRequestException({
        code: 'OPENING_CUSTOM_INACTIVE',
        message: '내려둔 항목입니다 — 기록하려면 먼저 다시 올리세요.',
      });
    }
    const state = String(dto.state ?? '').toUpperCase();
    if (state !== 'RECORDED' && state !== 'NOT_APPLICABLE') {
      throw new BadRequestException('상태는 RECORDED 또는 NOT_APPLICABLE 이어야 합니다');
    }
    const note = dto.note?.trim() || null;
    if (state === 'NOT_APPLICABLE' && !note) {
      throw new BadRequestException('해당 없음으로 표시하려면 사유가 필요합니다');
    }
    // 🔴 date-only 정본 — 로컬 자정을 넣으면 KST 에서 UTC 전날이 된다
    let evidenceDate: Date | null = null;
    if (dto.evidenceDate) {
      evidenceDate = dateOnlyValue(dto.evidenceDate);
      if (!evidenceDate) throw new BadRequestException('증빙 일자 형식이 올바르지 않습니다(YYYY-MM-DD)');
    }
    const data = {
      state,
      evidenceRef: dto.evidenceRef?.trim() || null,
      evidenceDate,
      note,
      recordedBy: userId,
    };
    return this.prisma.openingTaskRecord.upsert({
      where: { taskKey },
      update: data,
      create: { taskKey, ...data },
    });
  }

  /**
   * 증빙 첨부 — 🔴 **기록이 있어야 붙일 수 있다.** 기록 없이 파일만 있으면
   *    "무엇에 대한 증빙인지"가 없다.
   */
  async addAttachment(
    taskKey: string,
    file: { filename: string; originalName: string; mimetype: string; size: number },
    userId: string,
  ): Promise<OpeningAttachment> {
    const { def } = await this.resolveTask(taskKey);
    if (def.goLiveKey || def.decisionKey || def.committeeCode) {
      throw new BadRequestException({
        code: 'OPENING_DERIVED_TASK',
        message: '이 항목의 상태는 다른 정본이 말합니다 — 증빙을 붙이지 않습니다.',
      });
    }
    const rec = await this.prisma.openingTaskRecord.findUnique({ where: { taskKey } });
    if (!rec) throw new BadRequestException('먼저 기록을 저장한 뒤 증빙을 첨부하세요');

    const att: OpeningAttachment = {
      id: file.filename,
      fileName: file.originalName,
      url: `/uploads/opening/${taskKey}/${file.filename}`,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy: userId,
      uploadedAt: new Date().toISOString(),
    };
    const list = [...readAttachments(rec.attachments), att];
    await this.prisma.openingTaskRecord.update({
      where: { taskKey }, data: { attachments: list as never },
    });
    // 🔴 목록에는 서명해서 돌려준다(저장 URL 을 화면에 그대로 주면 인증이 없다)
    return { ...att, url: signUploadUrl(att.url) };
  }

  /** 첨부 제거 — 목록에서 뺀다(파일 자체는 남는다: 지웠다고 말하지 않는다) */
  async removeAttachment(taskKey: string, attachmentId: string) {
    const rec = await this.prisma.openingTaskRecord.findUnique({ where: { taskKey } });
    if (!rec) throw new NotFoundException('기록이 없습니다');
    const list = readAttachments(rec.attachments).filter((a) => a.id !== attachmentId);
    await this.prisma.openingTaskRecord.update({ where: { taskKey }, data: { attachments: list as never } });
    return { taskKey, attachmentId, removed: true };
  }

  /** 첨부 파일의 서버 로컬 경로 — 🔴 판독 EP 만 쓴다(경로를 밖으로 내보내지 않는다) */
  async attachmentPath(taskKey: string, attachmentId: string): Promise<{ path: string; fileName: string }> {
    const rec = await this.prisma.openingTaskRecord.findUnique({ where: { taskKey } });
    const att = readAttachments(rec?.attachments).find((a) => a.id === attachmentId);
    if (!att) throw new NotFoundException('첨부를 찾을 수 없습니다');
    // `url` 은 우리가 만든 값이고 id 는 uuid+확장자다 — 경로 조작 여지가 없다
    return { path: join(process.cwd(), 'uploads', 'opening', taskKey, att.id), fileName: att.fileName };
  }

  /** 기록 철회 — 🔴 지우는 것이 "완료 아님"이다(거짓을 남기는 것보다 낫다) */
  async clearRecord(taskKey: string) {
    await this.resolveTask(taskKey);
    await this.prisma.openingTaskRecord.deleteMany({ where: { taskKey } });
    return { taskKey, cleared: true };
  }


  // ══════════════════════════════════════════════════════════════════
  // 기관이 추가한 항목 (P3)
  //
  // 🔴 발단: 레지스트리는 스스로 "기본 목록이며 전수가 아니다"라고 말하고,
  //    개원 직후(O9)는 아예 비운 채 "기관이 정한다"고 적어 뒀다. 그런데 **정하는
  //    통로가 없었다** — 화면이 약속만 하고 방법을 주지 않았다.
  //
  // 🔴 여기서 하지 않는 것 둘:
  //  ① **연결 키를 받지 않는다.** 파생은 코드 정본만 한다(표에 컬럼조차 없다).
  //  ② **레지스트리 항목을 내리지 않는다.** 코드 항목을 "해당 없음"으로 내리는 길은
  //     이미 있다(`record(NOT_APPLICABLE)` · 사유 필수). 여기서 또 내리면 정본이 둘이 된다.
  // ══════════════════════════════════════════════════════════════════

  /**
   * 항목 하나를 **두 출처에서** 찾는다 — 코드 레지스트리와 기관 항목.
   * 기록·증빙 경로가 공통으로 쓴다(한쪽만 고치면 기관 항목이 조용히 404 가 된다).
   */
  private async resolveTask(
    taskKey: string,
  ): Promise<{ def: OpeningTaskDef; origin: OpeningOrigin; isActive: boolean }> {
    const reg = OPENING_REGISTRY.find((d) => d.key === taskKey);
    if (reg) return { def: reg, origin: 'REGISTRY', isActive: true };
    // 🔴 접두어가 아니면 DB 를 보지도 않는다 — 아무 키나 조회하게 두지 않는다
    if (taskKey.startsWith(INSTITUTION_KEY_PREFIX)) {
      const row = await this.prisma.openingCustomTask.findUnique({ where: { key: taskKey } });
      if (row) return { def: this.customToDef(row), origin: 'INSTITUTION', isActive: row.isActive };
    }
    throw msgException(HttpStatus.NOT_FOUND, serverMsg('개원 항목을 찾을 수 없습니다: {항목}', { 항목: taskKey }));
  }

  /**
   * 항목 제목 — 증빙 판독이 "무엇에 대한 문서인가"로 쓴다. **없는 항목**이면 `null`(지어내지 않는다).
   * 🔴 (2026-09-15) 종전 `.catch(() => null)` 은 DB 조회 실패까지 '항목 없음'과 같은 null 로 접었다 —
   *    판독이 조용히 '행정 증빙 문서'로 떨어졌다. 없음(404)만 null, 그 밖의 실패는 전파한다.
   */
  async taskTitle(taskKey: string): Promise<string | null> {
    try {
      return (await this.resolveTask(taskKey)).def.title;
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() === HttpStatus.NOT_FOUND) return null;
      throw e;
    }
  }

  /** 선행으로 걸 수 있는 항목 → 국가. 🔴 활성 기관 항목만(내려둔 것을 기다리게 하지 않는다) */
  private async dependableKeys(): Promise<Map<string, string[]>> {
    const m = new Map<string, string[]>();
    for (const d of OPENING_REGISTRY) m.set(d.key, d.countries);
    const rows = await this.prisma.openingCustomTask.findMany({
      where: { isActive: true }, select: { key: true, countries: true },
    });
    for (const r of rows) m.set(r.key, r.countries);
    return m;
  }

  /**
   * 기관 항목 입력 검증.
   *
   * 🔴 **강제하는 것과 강제하지 않는 것을 가른다.** 어휘(단계·기한·주기·국가)는 정본이
   *    정한 것이라 벗어나면 막는다. 반면 제출처·비고·증빙은 **강제하지 않는다** —
   *    필수로 만들면 아무 값이나 채워진다(전 술식 laterality 전례).
   */
  private async validateCustom(
    input: {
      phase?: string; title?: string; owner?: string; countries?: string[];
      dueBy?: string; authority?: string; cycle?: string; note?: string; dependsOn?: string[];
    },
    selfKey?: string,
  ) {
    const title = input.title?.trim();
    const owner = input.owner?.trim();
    if (!title) throw new BadRequestException('항목 이름이 필요합니다');
    if (!owner) throw new BadRequestException('담당(역할·부서)이 필요합니다');

    if (!isOpeningPhase(input.phase)) {
      throw msgException(HttpStatus.BAD_REQUEST, serverMsg('단계가 올바르지 않습니다: {단계}', { 단계: String(input.phase) }));
    }
    if (!isOpeningDue(input.dueBy)) {
      throw msgException(HttpStatus.BAD_REQUEST, serverMsg('기한 구분이 올바르지 않습니다: {기한}', { 기한: String(input.dueBy) }));
    }

    // 🔴 국가는 비울 수 없다 — 비면 "모든 나라"인지 "아직 안 정했는지" 구분되지 않는다
    const countries = [...new Set(input.countries ?? [])];
    if (countries.length === 0) throw new BadRequestException('어느 나라의 항목인지 정해야 합니다');
    const badCountry = countries.filter((c) => !isCountryCode(c));
    if (badCountry.length) throw msgException(HttpStatus.BAD_REQUEST, serverMsg('모르는 국가 코드입니다: {국가}', { 국가: badCountry.join(', ') }));

    const cycle = input.cycle?.trim() || null;
    if (cycle && !isOpeningCycle(cycle)) throw msgException(HttpStatus.BAD_REQUEST, serverMsg('주기가 올바르지 않습니다: {주기}', { 주기: cycle }));
    // 🔴 주기 반복이 아닌데 주기를 들면 모순이다. 반대(주기 반복인데 주기 미설정)는 **막지 않는다** —
    //    주기를 모를 수 있고, 그때는 "주기 미설정"으로 판정 대상에서 빠지는 것이 정직하다.
    if (cycle && input.dueBy !== 'RECURRING') {
      throw new BadRequestException('주기는 "주기 반복" 항목에만 붙일 수 있습니다');
    }

    const dependsOn = [...new Set(input.dependsOn ?? [])].filter(Boolean);
    if (selfKey && dependsOn.includes(selfKey)) {
      throw new BadRequestException('자기 자신을 선행으로 걸 수 없습니다');
    }
    if (dependsOn.length) {
      const targets = await this.dependableKeys();
      const missing = dependsOn.filter((k) => !targets.has(k));
      if (missing.length) throw msgException(HttpStatus.BAD_REQUEST, serverMsg('선행 항목이 없습니다: {항목}', { 항목: missing.join(', ') }));
      // 🔴 **국가 간에 선행을 걸지 않는다.** UAE 항목이 한국 항목을 기다리면 영영 안 풀린다
      //    (레지스트리에서 실제로 겪었다 — `open.system.hospitalInfo` 가 요양기관 기호를 선행으로 들고 있었다).
      const crossed = dependsOn.filter((k) => !(targets.get(k) ?? []).some((c) => countries.includes(c)));
      if (crossed.length) {
        throw msgException(
          HttpStatus.BAD_REQUEST,
          serverMsg('선행 항목이 다른 나라의 것입니다(국가 간 선행은 걸지 않습니다): {항목}', { 항목: crossed.join(', ') }),
        );
      }
    }

    return {
      phase: input.phase,
      title,
      owner,
      countries,
      dueBy: input.dueBy,
      authority: input.authority?.trim() || null,
      cycle,
      note: input.note?.trim() || null,
      dependsOn,
    };
  }

  /**
   * 기관 항목 추가.
   *
   * 🔴 **키는 사람이 짓지 않는다** — `inst.<hex>` 로 발급한다. 사람이 지으면 레지스트리
   *    키와 부딪히거나 의미를 담아버린다(의미가 담기면 그것이 정책이 된다).
   */
  async createCustomTask(input: Parameters<OpeningService['validateCustom']>[0], userId: string) {
    const data = await this.validateCustom(input);
    const key = `${INSTITUTION_KEY_PREFIX}${randomBytes(5).toString('hex')}`;
    return this.prisma.openingCustomTask.create({ data: { ...data, key, createdBy: userId } });
  }

  /** 기관 항목 수정 — 🔴 코드 항목은 여기 오지 않는다(키 접두어로 갈린다) */
  async updateCustomTask(key: string, input: Parameters<OpeningService['validateCustom']>[0]) {
    await this.requireCustom(key);
    const data = await this.validateCustom(input, key);
    return this.prisma.openingCustomTask.update({ where: { key }, data });
  }

  /**
   * 기관 항목 **내리기/올리기**.
   *
   * 🔴 삭제가 아니다. 기록·증빙이 붙어 있을 수 있으므로 표에서 지우지 않고 내린다.
   * 🔴 내릴 때는 **사유가 필수**다 — 사유 없이 사라지면 "빠뜨린 것"과 구분되지 않는다.
   */
  async setCustomTaskActive(key: string, isActive: boolean, reason?: string) {
    await this.requireCustom(key);
    const note = reason?.trim() || null;
    if (!isActive && !note) throw new BadRequestException('항목을 내리려면 사유가 필요합니다');
    return this.prisma.openingCustomTask.update({
      where: { key },
      // 🔴 다시 올릴 때 사유를 지운다 — 내려둔 사유가 남아 있으면 "아직 내려간 것"으로 읽힌다
      data: { isActive, inactiveReason: isActive ? null : note },
    });
  }

  /**
   * 기관 항목 삭제 — 🔴 **기록이 하나도 없을 때만.** 오타로 만든 항목을 회수하는 길이다.
   *    기록이 있으면 지우지 않는다(지우면 그 기록이 무엇에 대한 것이었는지 사라진다).
   */
  async deleteCustomTask(key: string) {
    await this.requireCustom(key);
    const rec = await this.prisma.openingTaskRecord.findUnique({ where: { taskKey: key } });
    if (rec) {
      throw new BadRequestException({
        code: 'OPENING_CUSTOM_HAS_RECORD',
        message: '기록이 있는 항목은 지우지 않습니다 — 내리기(비활성)를 쓰세요.',
      });
    }
    // 🔴 이 항목을 선행으로 걸고 있는 것이 있으면 알린다(끊고 지우면 순서가 조용히 사라진다)
    const users = await this.prisma.openingCustomTask.findMany({
      where: { dependsOn: { has: key } }, select: { title: true },
    });
    if (users.length) {
      throw msgException(
        HttpStatus.BAD_REQUEST,
        serverMsg('이 항목을 선행으로 걸고 있는 항목이 있습니다: {항목}', { 항목: users.map((u) => u.title).join(', ') }),
      );
    }
    await this.prisma.openingCustomTask.delete({ where: { key } });
    return { key, deleted: true };
  }

  /** 🔴 코드 항목에는 이 경로를 열지 않는다 — 레지스트리는 화면에서 고치는 것이 아니다 */
  private async requireCustom(key: string) {
    if (!key.startsWith(INSTITUTION_KEY_PREFIX)) {
      throw new BadRequestException({
        code: 'OPENING_NOT_CUSTOM',
        message: '기본 목록의 항목은 화면에서 고치거나 지우지 않습니다 — "해당 없음"으로 기록하세요.',
      });
    }
    const row = await this.prisma.openingCustomTask.findUnique({ where: { key } });
    if (!row) throw msgException(HttpStatus.NOT_FOUND, serverMsg('기관 항목을 찾을 수 없습니다: {항목}', { 항목: key }));
    return row;
  }

  /**
   * 위원회 **주기 준수** — 개원 후 축의 첫 항목 (P2).
   *
   * 🔴 발단: `Committee.meetingCycle` 은 저장·표시만 되고 **준수를 계산하는 코드가 0개**였다.
   *    "월간 위원회"라고 적혀 있어도 이번 달에 열렸는지 아무도 세지 않았다.
   *
   * 🔴 이 함수가 지키는 것 넷:
   *  ① **`AD_HOC`(수시)는 판정하지 않는다** — 주기가 없는 것을 "미준수"라 부르면 거짓 경보다.
   *  ② **"예정"과 "개최"는 다른 사실이다** — `COMPLETED` 만 개최로 센다.
   *     미래 일정을 개최로 세면 "이번 달 했다"가 거짓이 된다.
   *  ③ 🔴 **기록이 없는 것을 "위반"이라 부르지 않는다** — 회의를 했는데 시스템에 안 적었을
   *     수 있다. `heldThisPeriod: false` 는 **"기록 없음"** 이지 "안 열렸다"가 아니다.
   *  ④ **분모를 함께 낸다** — "주기 있는 위원회 N개 중 이번 주기 기록 M개".
   */
  async committeeCycleCompliance(now: Date = new Date()) {
    const committees = await this.prisma.committee.findMany({
      where: { isActive: true, code: { not: null } },
      select: {
        id: true, code: true, name: true, meetingCycle: true,
        meetings: { select: { scheduledAt: true, status: true }, orderBy: { scheduledAt: 'desc' }, take: 50 },
      },
    });

    const rows = committees.map((c) => {
      const period = cyclePeriod(c.meetingCycle, now);
      if (!period) {
        // ① 주기가 없거나 수시 — 판정하지 않는다
        return {
          code: c.code as string, name: c.name, cycle: c.meetingCycle ?? null,
          periodLabel: null as string | null,
          periodLabelMsg: null as ServerMessage | null,
          heldThisPeriod: null as boolean | null,
          lastHeldAt: lastCompleted(c.meetings),
          reason: c.meetingCycle === 'AD_HOC' ? '수시 — 주기 판정 대상이 아니다' : '주기 미설정',
        };
      }
      // ② COMPLETED 만 개최로 센다(예정은 개최가 아니다)
      const held = c.meetings.some(
        (m) => m.status === 'COMPLETED' && m.scheduledAt >= period.from && m.scheduledAt < period.to,
      );
      return {
        code: c.code as string, name: c.name, cycle: c.meetingCycle ?? null,
        periodLabel: period.label,
        periodLabelMsg: period.labelMsg,
        heldThisPeriod: held,
        lastHeldAt: lastCompleted(c.meetings),
        reason: null as string | null,
      };
    }).sort((a, b) => a.code.localeCompare(b.code));

    // ④ 분모 — 판정 가능한 것만 분모에 넣는다(판정 못 하는 것을 분모에 넣으면 비율이 거짓이 된다)
    const judged = rows.filter((r) => r.heldThisPeriod !== null);
    return {
      rows,
      summary: {
        judged: judged.length,
        withRecord: judged.filter((r) => r.heldThisPeriod).length,
        /** 🔴 "미개최"가 아니라 **기록 없음** */
        withoutRecord: judged.filter((r) => !r.heldThisPeriod).length,
        notJudged: rows.length - judged.length,
      },
      caveat:
        '이번 주기에 **회의 기록이 있는가**를 센다. 기록이 없는 것은 "열리지 않았다"가 아니라 '
        + '"시스템에 남지 않았다"일 수 있다. 예정(SCHEDULED)은 개최로 세지 않는다. '
        + '수시(AD_HOC)·주기 미설정 위원회는 판정하지 않는다.',
      measuredAt: now.toISOString(),
    };
  }

  /** 레지스트리 연결 키가 실재하는지 — 🔴 화면이 아니라 **가드와 헬스체크**가 쓴다 */
  async linkHealth(): Promise<{ orphans: Array<{ key: string; link: string; value: string }>; checked: number }> {
    const [rollup, list, committees] = await Promise.all([
      this.goLive.rollup(),
      this.decisions.list(),
      this.prisma.committee.findMany({ select: { code: true } }),
    ]);
    const gl = new Set((rollup.items as Array<{ key: string }>).map((i) => i.key));
    const dc = new Set((list.items as Array<{ key: string }>).map((i) => i.key));
    const cm = new Set(committees.map((c) => c.code).filter(Boolean) as string[]);
    const orphans: Array<{ key: string; link: string; value: string }> = [];
    for (const d of OPENING_REGISTRY) {
      if (d.goLiveKey && !gl.has(d.goLiveKey)) orphans.push({ key: d.key, link: 'goLiveKey', value: d.goLiveKey });
      if (d.decisionKey && !dc.has(d.decisionKey)) orphans.push({ key: d.key, link: 'decisionKey', value: d.decisionKey });
      if (d.committeeCode && !cm.has(d.committeeCode)) orphans.push({ key: d.key, link: 'committeeCode', value: d.committeeCode });
    }
    return { orphans, checked: OPENING_REGISTRY.length };
  }
}
