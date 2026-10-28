'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ratioOf, RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { kstToday } from '@/lib/kst-today';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Duration, Ratio } from '@/components/ui/display';
import { T, Tf, Data, useTAttr } from '@/components/ui/i18n-text';

/**
 * 수술실 질 지표(2026-10-05).
 *  · 수술 안전(IPSG.4 체크리스트 이행·좌우 확인·계수 불일치)은 정본 `qi/surgery-safety/summary` 를 그대로 부른다(다시 세지 않는다)
 *  · 운영·기록 지표는 `surgery/quality` — 분자/분모 · 표본 0 = 산출 불가 · 기준은 원내 설정(미설정이면 판정하지 않는다)
 *  · 기록 기반 지표는 "기록된 것만 센다"를 그 자리에서 말한다(합병증 0 이 '없었다'가 아니다)
 *  · 예방적 항생제·VTE 예방은 구조화 수술 기록에 '적혀 있는가'만(투여 시각·적정성 판정 아님)
 */
type Frac = { numerator: number; denominator: number };
type Dist = { n: number; median: number | null; p90: number | null };
type Quality = {
  period: { from: string; to: string };
  volume: { scheduled: number; performed: number; completed: number; cancelled: Frac };
  firstCaseStart: Dist & { onTime: Frac | null; toleranceMin: number | null; roomDays: number; noStartRecord: number; cancelledFirst: number };
  turnover: Dist & { excluded: number };
  durationVsEstimate: Dist & { over: number; under: number };
  documentation: Record<'opNote' | 'incisionClosure' | 'ebl' | 'prophylacticAbx' | 'vteProphylaxis' | 'anesthesiaRecord' | 'intraopVitals' | 'preAnesthesiaCompleted', Frac>;
  complications: { surgeryRecorded: Frac; pacuRecorded: Frac; gradeCounts?: Record<string, number> };
  pacu: Dist & { prolonged: Frac | null; prolongedMin: number | null; prolongedSource: string; overrideDischarge: Frac; stillIn: number };
};
type Safety = {
  available: boolean; reason: string | null;
  checklist: { denominator: number; complete: number; byPhase: { phase: string; label: string; missing: number }[] };
  siteVerification: { lateralityRequired: number; gaps: number; lateralityUndetermined: number };
  count: { denominator: number; mismatchUnresolved: number };
};

const DOC_KEYS: { key: keyof Quality['documentation']; label: string }[] = [
  { key: 'opNote', label: '수술 기록' },
  { key: 'incisionClosure', label: '절개·봉합 시각' },
  { key: 'ebl', label: '추정 실혈량' },
  { key: 'prophylacticAbx', label: '예방적 항생제 기록' },
  { key: 'vteProphylaxis', label: 'VTE 예방 기록' },
  { key: 'anesthesiaRecord', label: '마취 기록' },
  { key: 'intraopVitals', label: '수술 중 활력' },
  { key: 'preAnesthesiaCompleted', label: '마취 전 평가 완료' },
];

/** 가로 막대 — 백분율은 정본 ratioOf · 산출 불가면 막대 없이 정본 Ratio 가 이유를 말한다 */
function Bar({ label, f }: { label: string; f: Frac }) {
  const r = ratioOf(f.numerator, f.denominator);
  return (
    <div className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-2 text-xs">
      <span className="text-gray-600"><T k={label} /></span>
      <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">{r.pct != null && <div className="h-full bg-indigo-500" style={{ width: `${r.pct}%` }} />}</div>
      <span className="tabular-nums text-gray-800"><Ratio numerator={f.numerator} denominator={f.denominator} /></span>
    </div>
  );
}

function Card({ title, children, note }: { title: React.ReactNode; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-bold text-gray-900">{title}</h3>
      {children}
      {note && <p className="mt-2 text-[10px] leading-relaxed text-gray-400">{note}</p>}
    </section>
  );
}

function DistLine({ d, signed }: { d: Dist; signed?: boolean }) {
  if (d.n === 0) return <p className="text-sm text-gray-400"><T k={RATIO_UNAVAILABLE} /> — <T k="표본 없음" /></p>;
  const fmt = (v: number | null) => (v == null ? '—' : <>{signed && v > 0 ? '+' : ''}{v < 0 ? '−' : ''}<Duration minutes={Math.abs(v)} dense /></>);
  return (
    <p className="text-sm text-gray-800">
      <T k="중앙값" /> <b className="text-lg tabular-nums">{fmt(d.median)}</b> · <T k="90분위" /> <span className="tabular-nums">{fmt(d.p90)}</span>
      <span className="ml-1 text-[11px] text-gray-400">(n={d.n})</span>
    </p>
  );
}

export default function SurgeryQualityPanel() {
  const tAttr = useTAttr();
  const today = kstToday();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const qs = `from=${from}&to=${to}`;
  const q = useQuery({ queryKey: ['surgery-quality', from, to], queryFn: () => apiClient.get<{ data: Quality }>(`/api/v1/surgery/quality?${qs}`) });
  const sq = useQuery({ queryKey: ['surgery-safety-summary', from, to], queryFn: () => apiClient.get<{ data: Safety }>(`/api/v1/qi/surgery-safety/summary?${qs}`) });
  const d = q.data?.data;
  const sf = sq.data?.data;

  return (
    <div className="space-y-4" aria-label={tAttr('수술실 질 지표')}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-gray-700"><T k="기간" /></span>
        <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1" aria-label={tAttr('시작일')} />
        <span>~</span>
        <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1" aria-label={tAttr('종료일')} />
        <span className="text-[11px] text-gray-400"><T k="예약일 기준 · 측정값만(추정 없음)" /></span>
      </div>

      {/* 수술 안전 — 정본 QI */}
      {sq.isError ? <QueryErrorFallback error={sq.error} onRetry={() => sq.refetch()} size="compact" /> : sf && (
        <Card title={<T k="수술 안전(IPSG.4)" />} note={<T k="수술 안전 정본(질 관리 화면과 같은 값) — 수술방을 거친 수술이 분모입니다." />}>
          {!sf.available ? <p className="text-sm text-gray-500">{sf.reason}</p> : (
            <div className="space-y-1.5">
              <Bar label="체크리스트 3단계 완료" f={{ numerator: sf.checklist.complete, denominator: sf.checklist.denominator }} />
              <p className="text-[11px] text-gray-500">{sf.checklist.byPhase.map((p) => <span key={p.phase} className="mr-2">{p.label} <Tf k="누락 {수}" params={{ 수: p.missing }} /></span>)}</p>
              <Bar label="좌우 지정(필요 술식)" f={{ numerator: sf.siteVerification.lateralityRequired - sf.siteVerification.gaps, denominator: sf.siteVerification.lateralityRequired }} />
              <p className={`text-xs ${sf.count.mismatchUnresolved > 0 ? 'font-semibold text-rose-600' : 'text-gray-500'}`}>
                <Tf k="계수 불일치 미해소 {수}건 / {분모}건" params={{ 수: sf.count.mismatchUnresolved, 분모: sf.count.denominator }} />
              </p>
            </div>
          )}
        </Card>
      )}

      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} /> : !d ? <div className="h-40 animate-pulse rounded-2xl bg-gray-100" /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title={<T k="수술 건수" />} note={<T k="취소 시점이 기록되지 않아 당일 취소인지는 구분할 수 없습니다 — 분모는 이미 지난 예약입니다." />}>
            <p className="text-sm text-gray-700">
              <Tf k="예정 {예정} · 시행 {시행} · 완료 {완료}" params={{ 예정: d.volume.scheduled, 시행: d.volume.performed, 완료: d.volume.completed }} />
            </p>
            <div className="mt-2"><Bar label="취소" f={d.volume.cancelled} /></div>
          </Card>

          <Card title={<T k="첫 수술 시작 지연" />}
            note={<Tf k="방·날짜마다 예약상 첫 수술 {방일}개 · 시작 기록 없음 {없음} · 취소 {취소}는 분모 밖" params={{ 방일: d.firstCaseStart.roomDays, 없음: d.firstCaseStart.noStartRecord, 취소: d.firstCaseStart.cancelledFirst }} />}>
            <DistLine d={d.firstCaseStart} signed />
            {d.firstCaseStart.onTime && d.firstCaseStart.toleranceMin != null
              ? <div className="mt-2"><Bar label={tAttr('정시 시작(허용 지연 내)')} f={d.firstCaseStart.onTime} /><p className="mt-1 text-[10px] text-gray-400"><Tf k="허용 지연 {분}분(원내 설정)" params={{ 분: d.firstCaseStart.toleranceMin }} /></p></div>
              : <p className="mt-1 text-[11px] text-amber-700"><T k="정시 허용 지연이 원내 설정에 없어 정시율은 내지 않습니다(지연 분포만)." /></p>}
          </Card>

          <Card title={<T k="수술방 회전 시간" />} note={<Tf k="같은 방·같은 날 앞 수술 종료 → 다음 수술 시작 · 기록 이상(음수·24시간 이상) {수}건 제외" params={{ 수: d.turnover.excluded }} />}>
            <DistLine d={d.turnover} />
          </Card>

          <Card title={<T k="예상 대비 실제 소요" />} note={<T k="수술방 배정의 예상 소요와 실제(시작~종료)가 모두 있는 완료 수술 · 양수 = 예상보다 길었음" />}>
            <DistLine d={d.durationVsEstimate} signed />
            {d.durationVsEstimate.n > 0 && <p className="mt-1 text-xs text-gray-600"><Tf k="예상보다 길었음 {길게} · 짧았음 {짧게}" params={{ 길게: d.durationVsEstimate.over, 짧게: d.durationVsEstimate.under }} /></p>}
          </Card>

          <Card title={<T k="기록 완결(완료 수술)" />}>
            <div className="space-y-1.5">{DOC_KEYS.map((k) => <Bar key={k.key} label={k.label} f={d.documentation[k.key]} />)}</div>
          </Card>

          <Card title={<T k="회복실(PACU)" />}
            note={d.pacu.prolongedMin != null
              ? <Tf k="지연 기준 {분}분 · 출처 {출처}(회복실 설정 정본)" params={{ 분: d.pacu.prolongedMin, 출처: d.pacu.prolongedSource }} />
              : <T k="회복실 지연 기준을 확인할 수 없어 지연 수를 내지 않습니다." />}>
            <DistLine d={d.pacu} />
            <div className="mt-2 space-y-1.5">
              {d.pacu.prolonged && <Bar label="체류 지연" f={d.pacu.prolonged} />}
              <Bar label="기준 미달 강제 퇴실" f={d.pacu.overrideDischarge} />
            </div>
            {d.pacu.stillIn > 0 && <p className="mt-1 text-[11px] text-gray-500"><Tf k="아직 퇴실 기록 없음 {수}건(체류 계산 밖)" params={{ 수: d.pacu.stillIn }} /></p>}
          </Card>

          <Card title={<T k="합병증 기록" />} note={<T k="기록된 합병증만 셉니다 — 0 은 '없었다'가 아니라 '기록이 없다'입니다." />}>
            <div className="space-y-1.5">
              <Bar label="수술 기록의 합병증" f={d.complications.surgeryRecorded} />
              <Bar label="회복실 합병증 사건" f={d.complications.pacuRecorded} />
            </div>
            {d.complications.gradeCounts && Object.keys(d.complications.gradeCounts).length > 0 && (
              <p className="mt-2 text-xs text-gray-600" data-clavien>
                <T k="Clavien-Dindo 등급" />: {Object.entries(d.complications.gradeCounts).sort(([a], [b]) => a.localeCompare(b)).map(([g, n]) => <span key={g} className="mr-2 tabular-nums"><Data>{g}</Data> {n}</span>)}
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
