'use client';

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { VitalSignsGrid, VitalSignsStrip } from '@/components/vitals/VitalSigns';
import StatusBadge, { statusLabelOf, type StatusDomain } from '@/components/ui/StatusBadge';
import { T, useTAttr } from '@/components/ui/i18n-text';
// 🔴 flag 판정은 shared 정본 하나 — 로컬 `r.flag !== 'N'` 은 `'NORMAL'` 을 이상으로 세고
//    미판정(null)을 정상과 같은 모양으로 그렸다(2026-09-21 외부 점검).
import { isAbnormalFlag, isJudgedFlag, LAB_FLAG_UNJUDGED_TEXT, LAB_FLAG_UNJUDGED_HINT, formatNum } from '@hospital-run/shared';

type Soap = { S?: string; O?: string; A?: string; P?: string };
type Dar = { D?: string; A?: string; R?: string; E?: string };
/** SBAR — 범용 간호기록(외래·응급·PACU·수술) 서식. SOAP·DAR 과 섞지 않는다 */
type Sbar = { S?: string | null; B?: string | null; A?: string | null; R?: string | null };
/** 범용 간호기록 컨텍스트 표시명 — 응급 기록을 '외래'라 부르지 않는다 */
const NURSING_CONTEXT_LABEL: Record<string, string> = {
  OUTPATIENT: '외래', EMERGENCY: '응급', PACU: '회복실', SURGERY: '수술', LAB: '검사', IMAGING: '영상', PROCEDURE: '처치',
};
export type TrackType = 'ENCOUNTER' | 'NURSING' | 'LAB' | 'IMAGING' | 'PRESCRIPTION' | 'VITALS' | 'SURGERY' | 'ADMISSION' | 'PROGRESS_NOTE' | 'MAR' | 'DISCHARGE_SUMMARY' | 'AI_PROPOSAL' | 'CONVERSATION';
/** AI 제안 항목의 `at` 이 어느 시각에서 왔는가 — 생성만 된 제안을 결정 시각처럼 그리지 않기 위해 */
const AT_BASIS_LABEL: Record<string, string> = {
  DECIDED: '결정 시각', PRESENTED: '노출 시각', CREATED: '생성 시각',
};
export interface TItem {
  type: TrackType; id: string; at: string; status?: string | null;
  visitType?: string; title?: string | null; soap?: Soap;
  diagnoses?: { code?: string; name?: string; type?: string }[]; rxCount?: number;
  noteType?: string; shift?: string; focus?: string; priority?: string; dar?: Dar; content?: string; outpatient?: boolean;
  sbar?: Sbar; context?: string; canonBypass?: boolean;
  results?: { name: string; value: string; unit: string; flag?: string | null; refLow?: number | null; refHigh?: number | null }[]; abnormalCount?: number;
  finding?: string | null; impression?: string | null;
  rxType?: string; dosage?: string | null; frequency?: string | null; duration?: number | null; instructions?: string | null;
  vitals?: { bp?: string | null; hr?: number | null; temp?: number | null; spo2?: number | null; rr?: number | null; pain?: number | null; weight?: number | null; bmi?: number | null };
  bodySite?: string | null; preOpDiagnosis?: string | null; postOpDiagnosis?: string | null; findings?: string | null;
  subType?: 'ADMIT' | 'DISCHARGE'; admissionId?: string;
  /* AI 제안 트랙 — 🔴 본문(초안 내용)은 서버가 싣지 않는다. 요약만 온다 */
  atBasis?: 'DECIDED' | 'PRESENTED' | 'CREATED';
  aiKind?: string; source?: string | null; reasonCode?: string | null;
  modelRef?: string | null; promptVersion?: string | null;
  /** null = **재지 않았다**(0 이 아니다) */
  editDistance?: number | null;
  rejectReason?: string | null; version?: number; supersedesId?: string | null;
  targetType?: string; targetId?: string; targetKey?: string | null;
  createdAt?: string | null; presentedAt?: string | null; decidedAt?: string | null;
  lastTransition?: { from: string | null; to: string; at: string; reason: string | null; actor: string | null } | null;
  /* 대화(스크라이브) 트랙 — 🔴 대화 원문·초안 본문은 서버가 싣지 않는다. 숫자와 상태만 온다 */
  scribeSource?: string | null;
  /** null = 그 축이 없다(녹음 사후는 발화 단위로 저장하지 않는다) · 숫자 = 실측 */
  utterances?: number | null;
  deletedUtterances?: number | null;
  /** null = **재지 않았다**(0 = 놓친 구간이 없었다와 다른 사실) */
  droppedSec?: number | null;
  transcriptPresent?: boolean;
  audioPresent?: boolean; audioDeletedAt?: string | null; legalHold?: boolean;
  /** 반영된 SOAP 필드 **키만**(본문 없음) · null = 반영 기록이 없다(0 필드가 아니다) */
  appliedFields?: string[] | null; appliedAt?: string | null;
  sttTier?: string | null; resolverKind?: string | null;
  admitDiagnosis?: string | null; dischargeDiagnosis?: string | null; hospitalCourse?: string | null; followUpPlan?: string | null;
  scheduledAt?: string | null; administeredAt?: string | null;
  author?: string | null; authorRole?: string | null; verifier?: string | null;
  link?: string | null; reason?: string | null; code?: string | null; route?: string | null;
  collectedAt?: string | null; completedAt?: string | null; verifiedAt?: string | null;
  acquiredAt?: string | null; reportedAt?: string | null; startedAt?: string | null; endedAt?: string | null;
}
export type Resp = {
  items: TItem[]; counts: Record<string, number>; total: number; hasMore: boolean;
  truncatedTracks: string[]; tracks: { type: TrackType; label: string }[]; nextCursor?: string | null;
};

export const PERIODS: [string, number | null][] = [['1개월', 1], ['3개월', 3], ['6개월', 6], ['1년', 12], ['전체', null]];

/** 세그먼트 컨트롤 — 라벨 묶음을 하나의 인셋 그룹으로(개별 테두리 버튼 나열보다 조밀하고 관계가 읽힌다) */
export function Segmented<T>({ items, value, onChange, className = '' }: {
  items: { v: T; label: string; title?: string }[];
  value: T; onChange: (v: T) => void; className?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5 ${className}`}>
      {items.map((it) => (
        <button
          key={String(it.v)}
          onClick={() => onChange(it.v)}
          title={it.title}
          aria-pressed={value === it.v}
          className={`h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
            value === it.v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
/**
 * 상태 표기는 **shared 라벨 정본 + StatusBadge(domain)** 를 쓴다(UX 규약: 로컬 Record 재정의 금지).
 * 정본 도메인이 없는 축(활력 정상/이상 판정·투약 실행상태·영상 판독단계)만 config 로 부분 오버라이드.
 */
const TRACK_STATUS: Partial<Record<TrackType, { domain?: StatusDomain; config?: Record<string, { label: string; bg: string; text: string }> }>> = {
  ENCOUNTER: { domain: 'encounter' },
  PRESCRIPTION: { domain: 'prescription' },
  LAB: { domain: 'labResult' },
  ADMISSION: { domain: 'admission' },
  DISCHARGE_SUMMARY: { domain: 'encounter' },
  NURSING: { domain: 'encounter' },
  SURGERY: { domain: 'plan', config: { SCHEDULED: { label: '예정', bg: 'bg-amber-100', text: 'text-amber-700' } } },
  IMAGING: { config: { REPORTED: { label: '판독완료', bg: 'bg-emerald-100', text: 'text-emerald-700' }, PENDING: { label: '판독대기', bg: 'bg-amber-100', text: 'text-amber-700' } } },
  // 활력은 '상태'가 아니라 이상치 판정 — 정상은 굳이 강조하지 않고(회색), 이상은 눈에 걸리게
  VITALS: { config: { NORMAL: { label: '정상', bg: 'bg-gray-100', text: 'text-gray-500' }, ABNORMAL: { label: '이상', bg: 'bg-rose-100', text: 'text-rose-700' } } },
  AI_PROPOSAL: { domain: 'aiProposal' },
  // 🔴 APPLIED(진료기록 반영)만 초록 — DRAFTED 를 같은 색으로 그리면 "N건 완료"가 아무것도 안 들어간 상태를 가린다
  CONVERSATION: { config: {
    RECORDING: { label: '기록 중', bg: 'bg-indigo-100', text: 'text-indigo-700' },
    UPLOADED: { label: '전사 대기', bg: 'bg-gray-100', text: 'text-gray-600' },
    TRANSCRIBING: { label: '전사 중', bg: 'bg-indigo-100', text: 'text-indigo-700' },
    TRANSCRIBED: { label: '전사 완료(초안 없음)', bg: 'bg-gray-100', text: 'text-gray-600' },
    DRAFTED: { label: '초안(미반영)', bg: 'bg-amber-100', text: 'text-amber-700' },
    APPLIED: { label: '기록 반영됨', bg: 'bg-emerald-100', text: 'text-emerald-700' },
    FAILED: { label: '실패', bg: 'bg-rose-100', text: 'text-rose-700' },
    DELETED: { label: '파기됨', bg: 'bg-gray-100', text: 'text-gray-500' },
  } },
  MAR: { config: {
    SCHEDULED: { label: '예정', bg: 'bg-gray-100', text: 'text-gray-600' },
    ADMINISTERED: { label: '투여', bg: 'bg-emerald-100', text: 'text-emerald-700' },
    HELD: { label: '보류', bg: 'bg-amber-100', text: 'text-amber-700' },
    REFUSED: { label: '거부', bg: 'bg-rose-100', text: 'text-rose-700' },
    MISSED: { label: '누락', bg: 'bg-rose-100', text: 'text-rose-700' },
  } },
};
/** 기록 상태 라벨(색 없는 표면용 — 인쇄본) · 상태가 없으면 null */
export function trackStatusLabel(it: Pick<TItem, 'type' | 'status'>): string | null {
  if (!it.status) return null;
  const t = TRACK_STATUS[it.type];
  return statusLabelOf(it.status, t?.domain, t?.config);
}
export const fmt = (iso: string) => { try { return kdate(new Date(iso), 'datetime'); } catch { return iso; } };

/** 트랙별 시각 언어 — 좌측 색 띠 + 제목 색으로 한눈에 도메인 구분 */
export const TRACK_UI: Record<TrackType, { bar: string; text: string; label: string; dot: string; short: string }> = {
  ENCOUNTER: { bar: 'border-blue-400', text: 'text-blue-700', label: '진료기록', dot: 'bg-blue-400', short: '진료' },
  CONVERSATION: { bar: 'border-sky-400', text: 'text-sky-700', label: '대화 기록', dot: 'bg-sky-400', short: '대화' },
  NURSING: { bar: 'border-violet-400', text: 'text-violet-700', label: '간호기록', dot: 'bg-violet-400', short: '간호' },
  LAB: { bar: 'border-teal-400', text: 'text-teal-700', label: '검사결과', dot: 'bg-teal-400', short: '검사' },
  IMAGING: { bar: 'border-cyan-500', text: 'text-cyan-700', label: '영상판독', dot: 'bg-cyan-500', short: '영상' },
  PRESCRIPTION: { bar: 'border-amber-400', text: 'text-amber-700', label: '처방', dot: 'bg-amber-400', short: '처방' },
  VITALS: { bar: 'border-sky-400', text: 'text-sky-700', label: '활력징후', dot: 'bg-sky-400', short: '활력' },
  SURGERY: { bar: 'border-rose-400', text: 'text-rose-700', label: '수술', dot: 'bg-rose-400', short: '수술' },
  ADMISSION: { bar: 'border-gray-400', text: 'text-gray-700', label: '입퇴원', dot: 'bg-gray-400', short: '입퇴원' },
  PROGRESS_NOTE: { bar: 'border-indigo-400', text: 'text-indigo-700', label: '경과기록', dot: 'bg-indigo-400', short: '경과' },
  MAR: { bar: 'border-orange-400', text: 'text-orange-700', label: '투약실행', dot: 'bg-orange-400', short: '투약' },
  DISCHARGE_SUMMARY: { bar: 'border-emerald-500', text: 'text-emerald-700', label: '퇴원요약', dot: 'bg-emerald-500', short: '퇴원요약' },
  // 임상 기록이 아니라 'AI 가 낸 초안과 사람의 결정' 트랙 — 임상 트랙 색과 섞이지 않게 중성 회보라
  AI_PROPOSAL: { bar: 'border-slate-400', text: 'text-slate-700', label: 'AI 제안', dot: 'bg-slate-400', short: 'AI제안' },
};


/**
 * 원본 자료를 **별도 창**으로 띄운다(탭 아님).
 * 창 이름은 트랙별로 고정 — 같은 트랙을 여러 번 눌러도 창이 쌓이지 않고 그 창이 갱신·포커스되며,
 * 검사 창과 영상 창은 서로 독립이라 나란히 비교할 수 있다.
 */
export function openDetailWindow(url: string, track: TrackType) {
  const w = Math.min(1280, typeof window === 'undefined' ? 1280 : Math.round(window.screen.availWidth * 0.8));
  const h = Math.min(900, typeof window === 'undefined' ? 900 : Math.round(window.screen.availHeight * 0.9));
  const left = typeof window === 'undefined' ? 0 : Math.max(0, Math.round((window.screen.availWidth - w) / 2));
  const top = typeof window === 'undefined' ? 0 : Math.max(0, Math.round((window.screen.availHeight - h) / 2));
  const win = window.open(
    url,
    `record-detail-${track}`,
    `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`,
  );
  win?.focus();
}

function Shell({ it, extra, children, detail, defaultOpen = false, onOpenDetail }: { it: TItem; extra?: string; children?: React.ReactNode; detail?: React.ReactNode; defaultOpen?: boolean; onOpenDetail?: (it: TItem) => void }) {
  const ui = TRACK_UI[it.type];
  const tAttr = useTAttr();
  const [open, setOpen] = useState(defaultOpen);
  // 작성/수행 주체 — 역할 라벨을 함께(검사=검사자, 영상=판독의, 처방=처방의, 활력=측정 간호사, 수술=집도의)
  const who = it.author ? `${it.author}${it.authorRole ? ` ${it.authorRole}` : ''}` : null;
  const st = TRACK_STATUS[it.type];
  return (
    <div className={`group relative overflow-hidden rounded-xl border border-gray-200/80 bg-white pl-3.5 pr-3 py-2.5 transition-shadow hover:shadow-md hover:border-gray-300`}>
      {/* 트랙 색은 얇은 좌측 띠로만 — 제목까지 색을 칠하면 목록 전체가 알록달록해진다 */}
      <span className={`absolute inset-y-0 left-0 w-[3px] ${ui.dot}`} aria-hidden />

      {/* 헤더 한 줄: 트랙·부가 + 시각·주체 (좌) / 상태 + 동작 (우) */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-xs font-semibold text-gray-900">{ui.label}</span>
          {extra && <span className="text-[11px] text-gray-500">{extra}</span>}
          <span className="text-[11px] tabular-nums text-gray-400">{fmt(it.at)}</span>
          {who && <span className="text-[11px] text-gray-500">· {who}</span>}
          {it.verifier && <span className="text-[11px] text-gray-400">· <T k="확정" /> {it.verifier}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {it.status && <StatusBadge status={it.status} domain={st?.domain} config={st?.config} className="!text-[10px] !px-1.5" />}
          {/* 동작은 평소엔 흐리게, 카드에 올리면 또렷하게 — 목록이 버튼 밭이 되지 않게 */}
          {detail && (
            <button type="button" onClick={() => setOpen((v) => !v)} title={open ? tAttr('상세 접기') : tAttr('상세 펼치기')}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 group-hover:text-gray-500">
              {open ? <T k="접기" /> : <T k="상세" />}
            </button>
          )}
          {onOpenDetail && (
            <button type="button" onClick={() => onOpenDetail(it)} title={tAttr('이 기록만 별도 창으로 열기')}
              className="rounded-md px-1.5 py-0.5 text-[10px] text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 group-hover:text-gray-500">
              <T k="자료" /> ↗
            </button>
          )}
        </div>
      </div>

      {children && <div className="mt-1.5">{children}</div>}
      {detail && open && <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-[11px] text-gray-600">{detail}</div>}
    </div>
  );
}

/** 상세 펼침 공통 — 라벨/값 행 */
function Row({ k, v }: { k: string; v?: string | number | null }) {
  if (v === null || v === undefined || v === '') return null;
  return <div className="flex gap-2"><span className="text-gray-400 w-20 shrink-0"><T k={k} /></span><span className="flex-1 whitespace-pre-wrap break-words">{v}</span></div>;
}

export function Card({ it, defaultOpen = false, onOpenDetail }: { it: TItem; defaultOpen?: boolean; onOpenDetail?: (it: TItem) => void }) {
  const tAttr = useTAttr();
  const s = it.soap ?? {}; const d = it.dar ?? {};
  switch (it.type) {
    case 'ENCOUNTER':
      return (
        <Shell it={it} defaultOpen={defaultOpen} onOpenDetail={onOpenDetail} extra={[it.visitType, it.rxCount ? `처방 ${it.rxCount}` : ''].filter(Boolean).join(' · ')}>
          {it.title && <div className="text-xs text-gray-700 mb-1"><b>C.C.</b> {it.title}</div>}
          {(['S', 'O', 'A', 'P'] as const).map((k) => s[k] ? (
            <div key={k} className="flex gap-1.5 text-xs text-gray-600">
              <span className="w-3.5 shrink-0 font-semibold text-gray-400">{k}</span>
              <span className="flex-1 whitespace-pre-wrap break-words">{s[k]}</span>
            </div>
          ) : null)}
          {it.diagnoses && it.diagnoses.length > 0 && <div className="text-[11px] text-gray-500 mt-1"><T k="진단" />: {it.diagnoses.map((x) => `${x.name ?? ''}${x.code ? `(${x.code})` : ''}`).filter(Boolean).join(', ')}</div>}
        </Shell>
      );
    case 'NURSING':
      return (
        <Shell it={it} defaultOpen={defaultOpen} onOpenDetail={onOpenDetail} extra={[NURSING_CONTEXT_LABEL[it.context ?? ''] ?? it.context ?? null, it.noteType, it.shift, it.priority && it.priority !== 'NORMAL' ? it.priority : null].filter(Boolean).join(' · ')}>
          {it.canonBypass && <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-1">⚠ <T k="입원 간호기록 정본을 우회해 저장된 기록입니다(서명·QA 대상 아님)" /></div>}
          {it.focus && <div className="text-xs text-gray-700 mb-1"><b>Focus</b> {it.focus}</div>}
          {(['D', 'A', 'R', 'E'] as const).map((k) => d[k] ? <div key={k} className="text-xs text-gray-600 whitespace-pre-wrap"><b className="text-gray-400">{k}:</b> {d[k]}</div> : null)}
          {(['S', 'O', 'A', 'P'] as const).map((k) => s[k] ? <div key={k} className="text-xs text-gray-600 whitespace-pre-wrap"><b className="text-gray-400">{k}:</b> {s[k]}</div> : null)}
          {(['S', 'B', 'A', 'R'] as const).map((k) => it.sbar?.[k] ? <div key={`sbar-${k}`} className="text-xs text-gray-600 whitespace-pre-wrap"><b className="text-gray-400">{k}:</b> {it.sbar?.[k]}</div> : null)}
          {it.content && <div className="text-xs text-gray-600 whitespace-pre-wrap">{it.content}</div>}
        </Shell>
      );
    case 'LAB':
      return (
        <Shell it={it} defaultOpen={defaultOpen} onOpenDetail={onOpenDetail} extra={it.abnormalCount ? `이상 ${it.abnormalCount}` : undefined}
          detail={<>
            <div className="grid grid-cols-1 gap-0.5">
              {(it.results ?? []).map((r, i) => (
                <div key={i} className="flex gap-2">
                  <span className="w-28 shrink-0 text-gray-500">{r.name}</span>
                  <span className={`w-24 shrink-0 ${isAbnormalFlag(r.flag) ? 'text-rose-600 font-semibold' : ''}`}>{r.value} {r.unit}</span>
                  <span className="text-gray-400">
                    {r.refLow !== null && r.refLow !== undefined || r.refHigh !== null && r.refHigh !== undefined
                      ? `참고 ${r.refLow ?? ''}~${r.refHigh ?? ''}` : '참고범위 없음'}
                    {isAbnormalFlag(r.flag) ? ` · ${r.flag}` : ''}
                  </span>
                  {/* 🔴 미판정은 정상이 아니다 — 아무 표시도 없으면 보는 사람이 정상으로 읽는다 */}
                  {!isJudgedFlag(r.flag) && (
                    <span className="text-[10px] font-semibold px-1 rounded bg-amber-50 text-amber-700" title={tAttr(LAB_FLAG_UNJUDGED_HINT)}>
                      <T k={LAB_FLAG_UNJUDGED_TEXT} />
                    </span>
                  )}
                </div>
              ))}
            </div>
            <Row k="채취" v={it.collectedAt ? fmt(it.collectedAt) : null} />
            <Row k="완료" v={it.completedAt ? fmt(it.completedAt) : null} />
            <Row k="확정" v={it.verifiedAt ? fmt(it.verifiedAt) : null} />
          </>}
        >
          <div className="text-xs text-gray-700 mb-1">{it.title}</div>
          <div className="flex flex-wrap gap-1.5">
            {(it.results ?? []).map((r, i) => (
              <span key={i}
                title={!isJudgedFlag(r.flag) ? tAttr(LAB_FLAG_UNJUDGED_HINT)
                  : r.refLow !== null && r.refLow !== undefined || r.refHigh !== null && r.refHigh !== undefined
                  ? `참고범위 ${r.refLow ?? ''}~${r.refHigh ?? ''}${isAbnormalFlag(r.flag) ? ` · ${r.flag === 'H' ? '상회' : r.flag === 'L' ? '하회' : r.flag}` : ''}`
                  : '참고범위 미등록'}
                className={`inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${
                  isAbnormalFlag(r.flag) ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                    : !isJudgedFlag(r.flag) ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                    : 'bg-gray-50 text-gray-600'
                }`}>
                <span className={isAbnormalFlag(r.flag) ? 'text-rose-500' : 'text-gray-400'}>{r.name}</span>
                <b className="tabular-nums">{r.value}</b>
                {r.unit ? <span className="text-[0.5em] opacity-70">{r.unit}</span> : null}
                {isAbnormalFlag(r.flag) ? <span className="text-[10px] font-bold">{r.flag}</span>
                  : !isJudgedFlag(r.flag) ? <span className="text-[10px] font-bold" aria-label={tAttr(LAB_FLAG_UNJUDGED_TEXT)}>?</span> : null}
              </span>
            ))}
          </div>
        </Shell>
      );
    case 'IMAGING':
      return (
        <Shell it={it} defaultOpen={defaultOpen} onOpenDetail={onOpenDetail}
          detail={<>
            <Row k="촬영@시각" v={it.acquiredAt ? fmt(it.acquiredAt) : null} />
            <Row k="판독보고" v={it.reportedAt ? fmt(it.reportedAt) : null} />
            <Row k="소견" v={it.finding} />
            <Row k="결론" v={it.impression} />
          </>}
        >
          <div className="text-xs font-medium text-gray-800 mb-1">{it.title}</div>
          {it.finding && <div className="text-xs text-gray-600 whitespace-pre-wrap"><b className="text-gray-400"><T k="소견" />:</b> {it.finding}</div>}
          {it.impression && <div className="text-xs text-gray-700 whitespace-pre-wrap"><b className="text-gray-400"><T k="결론" />:</b> {it.impression}</div>}
        </Shell>
      );
    case 'PRESCRIPTION':
      return (
        <Shell it={it} defaultOpen={defaultOpen} onOpenDetail={onOpenDetail} extra={it.rxType}
          detail={<>
            <Row k="약품코드" v={it.code} />
            <Row k="용량" v={it.dosage} />
            <Row k="용법" v={it.frequency} />
            <Row k="투여경로" v={it.route} />
            <Row k="일수" v={it.duration ? `${it.duration}일` : null} />
            <Row k="지시" v={it.instructions} />
          </>}
        >
          {/* 유형(extra)과 제목이 같은 값이면 한 번만 — 활동·간호지시는 title=rxType 인 경우가 흔하다 */}
          {it.title && it.title !== it.rxType && <div className="text-xs text-gray-800">{it.title}</div>}
          {[it.dosage, it.frequency, it.duration ? `${it.duration}일` : null].filter(Boolean).length > 0 && (
            <div className="text-[11px] text-gray-500">{[it.dosage, it.frequency, it.duration ? `${it.duration}일` : null].filter(Boolean).join(' · ')}</div>
          )}
          {it.instructions && <div className="text-[11px] whitespace-pre-wrap text-gray-600">{it.instructions}</div>}
        </Shell>
      );
    case 'VITALS': {
      const v = it.vitals ?? {};
      // 🔴 (2026-10-07) 표시 부품 정본 — 종전 요약은 미측정 항목을 지워 '안 잰 것'과 '없는 줄'이 같았고 단위·이상 색이 없었다.
      //    bp 문자열·hr·temp·rr·pain 별칭은 부품이 읽는다 · 미측정 '—'
      return (
        <Shell it={it} defaultOpen={defaultOpen} onOpenDetail={onOpenDetail}
          detail={<VitalSignsGrid vitals={v as Record<string, unknown>} columns={3}
            keys={['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'temperature', 'painScore', 'weight', 'bmi']} />}
        >
          <VitalSignsStrip vitals={v as Record<string, unknown>} />
        </Shell>
      );
    }
    case 'SURGERY':
      return (
        <Shell it={it} defaultOpen={defaultOpen} onOpenDetail={onOpenDetail} extra={it.bodySite ?? undefined}
          detail={<>
            <Row k="시작" v={it.startedAt ? fmt(it.startedAt) : null} />
            <Row k="종료" v={it.endedAt ? fmt(it.endedAt) : null} />
            <Row k="술전진단" v={it.preOpDiagnosis} />
            <Row k="술후진단" v={it.postOpDiagnosis} />
            <Row k="수술소견" v={it.findings} />
          </>}
        >
          <div className="text-xs font-medium text-gray-800 mb-1">{it.title}</div>
          {it.preOpDiagnosis && <div className="text-[11px] text-gray-500"><T k="술전" />: {it.preOpDiagnosis}</div>}
          {it.postOpDiagnosis && <div className="text-[11px] text-gray-500"><T k="술후" />: {it.postOpDiagnosis}</div>}
          {it.findings && <div className="text-xs text-gray-600 whitespace-pre-wrap mt-1">{it.findings}</div>}
        </Shell>
      );
    case 'PROGRESS_NOTE':
      return (
        <Shell it={it} defaultOpen={defaultOpen} onOpenDetail={onOpenDetail}
          detail={<Row k="내용" v={it.content} />}>
          <p className="text-xs text-gray-700 whitespace-pre-wrap break-words line-clamp-3">{it.content}</p>
        </Shell>
      );
    case 'MAR':
      return (
        <Shell it={it} defaultOpen={defaultOpen} onOpenDetail={onOpenDetail}
          extra={[it.dosage, it.route].filter(Boolean).join(' · ') || undefined}
          detail={<>
            <Row k="예정" v={it.scheduledAt ? fmt(it.scheduledAt) : null} />
            <Row k="투여@시각" v={it.administeredAt ? fmt(it.administeredAt) : null} />
            <Row k="용량" v={it.dosage} />
            <Row k="경로" v={it.route} />
            <Row k="보류사유" v={it.instructions} />
            <Row k="약품코드" v={it.code} />
          </>}>
          <div className="text-xs text-gray-800">{it.title}</div>
          {/* 보류·누락은 사유가 임상적으로 중요하므로 접기 전에도 보인다 */}
          {it.instructions && <p className="text-[11px] text-amber-700 mt-0.5"><T k="보류" />: {it.instructions}</p>}
        </Shell>
      );
    case 'DISCHARGE_SUMMARY':
      return (
        <Shell it={it} defaultOpen={defaultOpen} onOpenDetail={onOpenDetail}
          detail={<>
            <Row k="입원진단" v={it.admitDiagnosis} />
            <Row k="퇴원진단" v={it.dischargeDiagnosis} />
            <Row k="경과요약" v={it.hospitalCourse} />
            <Row k="추적계획" v={it.followUpPlan} />
          </>}>
          <div className="text-xs text-gray-800">{it.dischargeDiagnosis ?? it.title}</div>
        </Shell>
      );
    /**
     * AI 제안 — 🔴 **초안 본문이 없다.** 서버가 싣지 않는다(본문 정본은 `AiProposal` 하나).
     * 🔴 시각이 어느 시각인지(`atBasis`) 밝히고, 수정량이 `null` 이면 **'미측정'** 이라 말한다
     *    ('0' 으로 그리면 "안 고치고 그대로 수용했다"는 다른 사실이 된다).
     * 🔴 '자료' 버튼(별도 창)을 달지 않는다 — 제안 상세 화면이 아직 없다.
     */
    case 'AI_PROPOSAL': {
      const measured = it.editDistance !== null && it.editDistance !== undefined;
      return (
        <Shell it={it} defaultOpen={defaultOpen}
          extra={[it.source && it.source !== 'AI' ? it.source : null, it.version && it.version > 1 ? `v${it.version}` : null].filter(Boolean).join(' · ') || undefined}
          detail={<>
            <Row k="대상" v={`${it.targetType ?? ''}${it.targetKey ? ` (${it.targetKey})` : it.targetId ? ` (${it.targetId})` : ''}`.trim() || null} />
            <Row k="생성" v={it.createdAt ? fmt(it.createdAt) : null} />
            {/* 🔴 노출 기록이 없으면 '없음'이라 말한다 — 빈칸은 '안 봤다'와 '모른다'를 뒤섞는다 */}
            <Row k="노출" v={it.presentedAt ? fmt(it.presentedAt) : '노출 기록 없음(사람이 본 적 없음)'} />
            <Row k="결정" v={it.decidedAt ? fmt(it.decidedAt) : '미결정'} />
            <Row k="모델" v={it.modelRef ?? '모델 미기록'} />
            <Row k="프롬프트" v={it.promptVersion} />
            <Row k="수정량" v={measured ? `${it.editDistance}자` : '미측정(0 이 아님)'} />
            <Row k="거부사유" v={it.rejectReason} />
            <Row k="사유코드" v={it.reasonCode} />
            <Row k="최근 전이" v={it.lastTransition ? `${it.lastTransition.from ?? '(생성)'} → ${it.lastTransition.to}${it.lastTransition.actor ? ` · ${it.lastTransition.actor}` : ''}${it.lastTransition.reason ? ` · ${it.lastTransition.reason}` : ''}` : null} />
          </>}>
          <div className="text-xs text-gray-800">{it.title}</div>
          <div className="mt-0.5 text-[11px] text-gray-400">
            {AT_BASIS_LABEL[it.atBasis ?? ''] ?? '시각 기준 미상'} 기준
            {/* 초안 본문이 여기 없다는 사실 자체를 말한다(빈 카드로 보이지 않게) */}
            <span className="ml-1"><T k="· 초안 본문은 제안 원장에만 있습니다" /></span>
          </div>
        </Shell>
      );
    }
    /**
     * 대화 기록(스크라이브) — 🔴 **대화 원문이 없다.** 서버가 싣지 않는다(전사 정본은 세션 하나).
     * 🔴 발화 수 `null` = 그 축이 없다(녹음 사후는 발화 단위로 저장하지 않는다) — '0 발화'라 그리면
     *    "말이 없었다"는 다른 사실이 된다. 누락초 `null` = **재지 않았다**(0 과 다르다).
     * 🔴 반영 필드는 **키만** 말한다 — 어느 칸에 들어갔는지는 사실이고 무엇이 들어갔는지는 진료기록이 갖는다.
     */
    case 'CONVERSATION': {
      const utt = it.utterances;
      const dropped = it.droppedSec;
      return (
        <Shell it={it} defaultOpen={defaultOpen}
          extra={[it.legalHold ? '보존명령' : null, it.appliedFields?.length ? `반영 ${it.appliedFields.join('·')}` : null].filter(Boolean).join(' · ') || undefined}
          detail={<>
            <Row k="경로" v={it.scribeSource} />
            <Row k="발화 수" v={utt === null || utt === undefined ? '해당 없음(발화 단위로 저장하지 않는 경로)' : `${utt}건${it.deletedUtterances ? ` (숨김 ${it.deletedUtterances}건 포함)` : ''}`} />
            {/* 🔴 자릿수는 shared NUMERIC_POLICIES 정본이 정한다 — toFixed 직접 호출 금지(구조 가드) */}
            <Row k="전사 누락" v={dropped === null || dropped === undefined ? '미측정(0 이 아님)' : `${formatNum(dropped, 'seconds')}초`} />
            <Row k="반영 필드" v={it.appliedFields === null || it.appliedFields === undefined ? '반영 기록 없음' : it.appliedFields.length ? it.appliedFields.join(' · ') : '반영 기록 없음'} />
            <Row k="반영 시각" v={it.appliedAt ? fmt(it.appliedAt) : null} />
            <Row k="전사 보관" v={it.transcriptPresent ? '남아 있음' : '없음(미전사 또는 파기됨)'} />
            <Row k="원음" v={it.audioPresent ? '남아 있음' : it.audioDeletedAt ? `파기됨 (${fmt(it.audioDeletedAt)})` : '미저장'} />
            <Row k="STT" v={it.sttTier ?? '엔진 미기록'} />
            <Row k="화자 판정" v={it.resolverKind} />
            <Row k="초안 모델" v={it.modelRef ?? 'AI 초안 모델 기록 없음'} />
            <Row k="프롬프트" v={it.promptVersion} />
          </>}>
          <div className="text-xs text-gray-800">{it.title}</div>
          <div className="mt-0.5 text-[11px] text-gray-400">
            <T k="세션 시작 시각 기준 · 대화 원문은 진료 화면의 대화 패널에만 있습니다" />
          </div>
        </Shell>
      );
    }
    case 'ADMISSION':
      return (
        <Shell it={it} defaultOpen={defaultOpen} onOpenDetail={onOpenDetail} extra={it.subType === 'ADMIT' ? '입원' : '퇴원'}
          detail={<><Row k="입원사유" v={it.reason} /><Row k="입원번호" v={it.admissionId} /></>}
        >
          <div className="text-xs text-gray-700">{it.title}{it.reason ? ` — ${it.reason}` : ''}</div>
        </Shell>
      );
    default:
      return null;
  }
}

