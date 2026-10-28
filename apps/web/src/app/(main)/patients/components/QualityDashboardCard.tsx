'use client';

/**
 * 데이터 품질 지표(관리자) — 🔴 2026-10-20 환자 목록 P1(R8) 정직화.
 * 종전: 지표마다 분모를 "전체 환자"로 고정 — 중복 의심 **그룹 수**를 환자 수로 나눠 % 를 그렸고, 자비 환자까지 "보험정보 미확인",
 * 등록 1년 미만 환자를 "1년 이상 미내원", 등록 정책이 없는 사진을 "미등록 100%"로 경고했다. `Math.round` 직접.
 * 이제 서버가 지표마다 분자·분모를 주고, 화면은 정의를 쓴다 · 비율은 정본 `<Ratio>`(분모 0 = 산출 불가).
 */
import { useQualityDashboard } from '@/hooks/usePatients';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Ratio, Unit } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import type { QualityDashboard } from '@/types/patient';

type Metric = { count: number; denominator: number };

export function QualityDashboardCard({ show, onToggle, activeQuality, onDrill }: { show: boolean; onToggle: () => void; activeQuality: string; onDrill: (q: string) => void }) {
  const { data, isError, error, refetch } = useQualityDashboard();
  const _raw = data?.data as unknown;
  const dashboard = ((_raw && typeof _raw === 'object' && 'noPhone' in (_raw as object)) ? _raw : (_raw as { data?: unknown } | undefined)?.data) as QualityDashboard | undefined;
  const ok = !!dashboard && typeof dashboard.noPhone === 'object';

  return (
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-xl border border-gray-100 bg-white px-3.5 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>
          <T k="데이터 품질 대시보드" />
        </span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${show ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
      </button>
      {show && isError && <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" className="mt-2" />}
      {show && ok && dashboard && (
        <div className="mt-2 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-quality-cards>
          <QualityCard id="noPhone" label="전화번호 미등록" definition="등록 환자 중 전화번호가 비어 있음" m={dashboard.noPhone} color="amber" active={activeQuality === 'noPhone'} onClick={() => onDrill('noPhone')} />
          <QualityCard id="noInsurance" label="건보 증번호 없음" definition="건강보험·의료급여 환자 중 증번호가 비어 있음(자비·산재·자보 제외)" m={dashboard.noInsurance} color="orange" active={activeQuality === 'noInsurance'} onClick={() => onDrill('noInsurance')} />
          <QualityCard id="noAddress" label="주소 미등록" definition="등록 환자 중 주소가 비어 있음" m={dashboard.noAddress} color="red" active={activeQuality === 'noAddress'} onClick={() => onDrill('noAddress')} />
          <QualityCard id="dormant" label="1년 이상 미내원" definition="등록 1년이 지났고 최근 1년 진료 기록이 없음(휴면 정의는 결정 전)" m={dashboard.dormant} color="violet" active={activeQuality === 'dormant'} onClick={() => onDrill('dormant')} />
          <DuplicateCard d={dashboard.duplicateSuspect} active={activeQuality === 'dupSuspect'} onClick={() => onDrill('dupSuspect')} />
          <QualityCard id="noPhoto" label="사진 미등록" definition="사진 등록 정책이 정해지지 않아 경고하지 않습니다" m={dashboard.noPhoto} color="gray" neutral active={activeQuality === 'noPhoto'} onClick={() => onDrill('noPhoto')} />
        </div>
      )}
    </div>
  );
}

/** 비율은 정본 `<Ratio>`(분자/분모·분모 0 = 산출 불가) — 화면이 `산출 불가` 를 따로 적지 않는다 */
function Share({ count, denominator }: Metric) {
  return (
    <p className="text-[10px] text-gray-400" data-quality-share={denominator ? '' : 'na'}>
      <Ratio numerator={count} denominator={denominator} />
    </p>
  );
}

function QualityCard({ id, label, definition, m, color, neutral, active, onClick }: {
  id: string; label: string; definition: string; m: Metric; color: string; neutral?: boolean; active?: boolean; onClick?: () => void;
}) {
  const tA = useTAttr();
  return (
    <button
      onClick={onClick}
      title={tA(definition)}
      data-quality-card={id}
      className={`bg-white rounded-xl border p-3 text-left transition-colors ${active ? 'border-blue-400 ring-1 ring-blue-200 bg-blue-50/40' : 'border-gray-100 hover:border-blue-200 hover:bg-blue-50/20'}`}
    >
      <p className="text-[11px] text-gray-500 mb-1"><T k={label} /></p>
      <p className={`text-lg font-bold ${neutral ? 'text-gray-700' : `text-${color}-600`}`}>{m.count.toLocaleString()}<Unit>명</Unit></p>
      <Share {...m} />
      <p className="mt-1 text-[10px] leading-snug text-gray-400"><T k={definition} /></p>
    </button>
  );
}

function DuplicateCard({ d, active, onClick }: { d: QualityDashboard['duplicateSuspect']; active?: boolean; onClick?: () => void }) {
  const tA = useTAttr();
  return (
    <button
      onClick={onClick}
      title={tA('같은 성·이름·생년월일 묶음 — 그룹 수와 그 그룹에 든 환자 수')}
      data-quality-card="dupSuspect"
      className={`bg-white rounded-xl border p-3 text-left transition-colors ${active ? 'border-blue-400 ring-1 ring-blue-200 bg-blue-50/40' : 'border-gray-100 hover:border-blue-200 hover:bg-blue-50/20'}`}
    >
      <p className="text-[11px] text-gray-500 mb-1"><T k="중복 의심" /></p>
      <p className="text-lg font-bold text-rose-600" data-quality-dup-groups>
        <Tf k="{그룹}그룹 · {환자}명" params={{ 그룹: d.groups.toLocaleString(), 환자: d.patients.toLocaleString() }} />
      </p>
      <Share count={d.patients} denominator={d.denominator} />
      <p className="mt-1 text-[10px] leading-snug text-gray-400"><T k="같은 성·이름·생년월일 — 같은 사람인지는 사람이 확인" /></p>
    </button>
  );
}
