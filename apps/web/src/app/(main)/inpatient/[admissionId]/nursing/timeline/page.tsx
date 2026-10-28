'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { VitalTrendChart } from '@/components/nursing/VitalTrendChart';
import { kstToday } from '@/lib/kst-today';
import { T } from '@/components/ui/i18n-text';
import { kdate } from '@/lib/ui-settings';
import { VitalSignsStrip } from '@/components/vitals/VitalSigns';

interface TimelineItem {
  time: string;
  type: 'SOAP' | 'DARE' | 'NOTE' | 'IO' | 'MAR' | 'VITAL' | 'CHECKLIST';
  data: any;
  nurse?: string;
}

interface TimelineSummary {
  totalIntake: number;
  totalOutput: number;
  balance: number;
  noteCount: number;
  marCount: number;
  checklistCount: number;
}

const TYPE_CONFIG: Record<string, { icon: string; label: string; color: string; bg: string; border: string }> = {
  VITAL:     { icon: '🩺', label: '바이탈',     color: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-l-blue-500' },
  SOAP:      { icon: '📝', label: 'SOAP',       color: 'text-indigo-700',  bg: 'bg-indigo-50',  border: 'border-l-indigo-500' },
  DARE:      { icon: '🩹', label: 'DARE',       color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-l-emerald-500' },
  NOTE:      { icon: '📝', label: '간호 노트',  color: 'text-sky-700',     bg: 'bg-sky-50',     border: 'border-l-sky-500' },
  MAR:       { icon: '💊', label: '투약',        color: 'text-purple-700',  bg: 'bg-purple-50',  border: 'border-l-purple-500' },
  IO:        { icon: '💧', label: 'I/O',         color: 'text-teal-700',    bg: 'bg-teal-50',    border: 'border-l-teal-500' },
  CHECKLIST: { icon: '✅', label: '체크리스트', color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-l-amber-500' },
};

const SHIFT_BG: Record<string, string> = { DAY: 'bg-amber-50/30', EVENING: 'bg-blue-50/30', NIGHT: 'bg-slate-100/30' };
const SHIFT_LABELS: Record<string, string> = { DAY: '주간 (07-15)', EVENING: '준야 (15-23)', NIGHT: '야간 (23-07)' };

function formatTime(iso: string) {
  try { return kdate(iso, 'time'); } catch { return '-'; }
}

export default function NursingTimelinePage() {
  const { admissionId } = useParams();
  const [shift, setShift] = useState<string>('');
  const [date] = useState(kstToday());

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['nursing-timeline', admissionId, shift, date],
    queryFn: () => apiClient.get<any>(`/api/v1/admissions/${admissionId}/timeline?date=${date}${shift ? `&shift=${shift}` : ''}`),
    enabled: !!admissionId,
  });

  const raw = data?.data?.data ?? data?.data;
  const timeline: TimelineItem[] = raw?.timeline ?? [];
  const summary: TimelineSummary = raw?.summary ?? { totalIntake: 0, totalOutput: 0, balance: 0, noteCount: 0, marCount: 0, checklistCount: 0 };

  // 바이탈 데이터 추출 (차트용)
  const vitalEntries = timeline.filter(t => t.type === 'VITAL').map(t => t.data);

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <Link href={`/inpatient/${admissionId}`} className="text-sm text-blue-600 hover:underline">← <T k="입원 상세" /></Link>
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 mt-1"><T k="간호 타임라인" /></h1>
        </div>
        <div className="flex gap-1.5 sm:gap-2 overflow-x-auto">
          {['', 'DAY', 'EVENING', 'NIGHT'].map(s => (
            <button key={s} onClick={() => setShift(s)}
              className={`px-2.5 sm:px-3 py-1.5 text-[11px] sm:text-xs font-medium rounded-full transition whitespace-nowrap ${shift === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {/* 🔴 '주간'은 이미 'Week'(주 단위)로 등재돼 있다 — 여기서는 **근무조(day shift)**라
                  문맥 키로 가른다(뜻이 달라지는 자리). */}
              <T k={s ? (SHIFT_LABELS[s]?.split(' ')[0] === '주간' ? '주간@근무조' : SHIFT_LABELS[s]?.split(' ')[0] ?? '') : '전체'} />
            </button>
          ))}
        </div>
      </div>

      {/* 바이탈 트렌드 미니차트 */}
      {vitalEntries.length > 0 && <VitalTrendChart entries={vitalEntries} />}

      {/* 요약 바 */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
        <SummaryCard label="섭취" value={`${summary.totalIntake}mL`} color="blue" />
        <SummaryCard label="배출" value={`${summary.totalOutput}mL`} color="amber" />
        <SummaryCard label="Balance" value={`${summary.balance >= 0 ? '+' : ''}${summary.balance}mL`} color={summary.balance >= 0 ? 'green' : 'red'} />
        <SummaryCard label="간호기록" value={`${summary.noteCount}건`} color="indigo" />
        {/* 🔴 '투약'은 status 정본이 상태(Administered)로 선점한 원문이라 문맥 키를 쓴다 */}
        <SummaryCard label="투약@탭" value={`${summary.marCount}건`} color="purple" />
        <SummaryCard label="체크리스트" value={`${summary.checklistCount}건`} color="amber" />
      </div>

      {/* 타임라인 */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : timeline.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-2">📋</p>
          <p><T k="오늘 기록이 없습니다" /></p>
        </div>
      ) : (
        <div className="relative">
          {/* 타임라인 수직선 */}
          <div className="absolute left-[44px] sm:left-[60px] top-0 bottom-0 w-0.5 bg-gray-200" />

          <div className="space-y-3">
            {timeline.map((item, i) => {
              const cfg = TYPE_CONFIG[item.type] ?? TYPE_CONFIG.NOTE;
              return (
                <div key={i} className="flex gap-2 sm:gap-4">
                  {/* 시간 */}
                  <div className="w-[36px] sm:w-[52px] text-right flex-shrink-0 pt-3">
                    <span className="text-[10px] sm:text-xs font-mono text-gray-500">{formatTime(item.time)}</span>
                  </div>
                  {/* 도트 */}
                  <div className="relative flex-shrink-0 w-3 sm:w-4 pt-3">
                    <div className={`w-2.5 sm:w-3 h-2.5 sm:h-3 rounded-full border-2 border-white ${cfg.bg.replace('50', '500')} shadow-sm`} />
                  </div>
                  {/* 카드 */}
                  <div className={`flex-1 rounded-xl border-l-3 ${cfg.border} ${cfg.bg} p-3 sm:p-4 hover:shadow-sm transition`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm">{cfg.icon}</span>
                      <span className={`text-xs font-bold ${cfg.color}`}><T k={cfg.label === '투약' ? '투약@탭' : cfg.label} /></span>
                      {item.nurse && <span className="text-[10px] text-gray-400 ml-auto">{item.nurse}</span>}
                    </div>
                    <TimelineCardContent type={item.type} data={item.data} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 모바일 하단 고정 빠른 기록 */}
      <div className="fixed bottom-0 left-0 right-0 sm:hidden bg-white border-t border-gray-200 px-4 py-3 flex gap-2 z-30">
        {[
          { href: `/inpatient/${admissionId}/nursing/notes`, label: '📝', sub: '기록' },
          { href: `/inpatient/${admissionId}/nursing/flowsheet`, label: '📊', sub: '바이탈' },
          { href: `/inpatient/${admissionId}/nursing/io`, label: '💧', sub: 'I/O' },
          { href: `/inpatient/${admissionId}/nursing/mar`, label: '💊', sub: 'MAR' },
          { href: `/inpatient/${admissionId}/nursing/checklist`, label: '✅', sub: '체크' },
        ].map(b => (
          <Link key={b.href} href={b.href} className="flex-1 flex flex-col items-center gap-0.5 py-1 rounded-lg hover:bg-gray-50 transition">
            <span className="text-lg">{b.label}</span>
            <span className="text-[9px] text-gray-500"><T k={b.sub} /></span>
          </Link>
        ))}
      </div>
      <div className="h-16 sm:hidden" /> {/* 모바일 하단 여백 */}

      {/* 데스크탑 하단 빠른 링크 */}
      <div className="hidden sm:flex flex-wrap gap-2 pt-4 border-t">
        {[
          { href: `/inpatient/${admissionId}/nursing/notes`, label: '간호 노트', color: 'indigo' },
          { href: `/inpatient/${admissionId}/nursing/assessment`, label: '간호 사정', color: 'blue' },
          { href: `/inpatient/${admissionId}/nursing/io`, label: 'I/O', color: 'teal' },
          { href: `/inpatient/${admissionId}/nursing/mar`, label: 'MAR', color: 'purple' },
        ].map(l => (
          <Link key={l.href} href={l.href} className={`text-xs font-medium text-${l.color}-600 bg-${l.color}-50 border border-${l.color}-200 px-3 py-1.5 rounded-lg hover:bg-${l.color}-100`}>
            <T k={l.label} /> →
          </Link>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={`bg-${color}-50 rounded-lg p-3 text-center`}>
      <p className={`text-[10px] text-${color}-600 font-medium`}><T k={label} /></p>
      <p className={`text-sm font-bold text-${color}-800`}>{value}</p>
    </div>
  );
}

function TimelineCardContent({ type, data }: { type: string; data: any }) {
  if (type === 'VITAL') {
    return (
      // 활력 표시 정본(2026-10-07) — 종전엔 truthy 검사로 측정된 0 을 숨기고 체온을 원값으로 찍었다
      <div>
        <VitalSignsStrip vitals={data} className="text-gray-700" />
        {/* 재원 중 외래 원장 행(간호 스테이션·차트 빠른 입력) — 어디서 왔는지 지우지 않는다(2026-10-10) */}
        {data?.ledger === 'PREVISIT' && (
          <span className="mt-1 inline-block rounded bg-slate-100 px-1 text-[10px] text-slate-600"><T k="스테이션 입력" /></span>
        )}
      </div>
    );
  }
  if (type === 'SOAP') {
    return (
      <div className="space-y-1 text-xs text-gray-700">
        {data.subjective && <p><strong className="text-blue-600">S:</strong> {data.subjective}</p>}
        {data.objective && <p><strong className="text-emerald-600">O:</strong> {data.objective}</p>}
        {data.assessment && <p><strong className="text-amber-600">A:</strong> {data.assessment}</p>}
        {data.plan && <p><strong className="text-purple-600">P:</strong> {data.plan}</p>}
      </div>
    );
  }
  if (type === 'DARE') {
    return (
      <div className="space-y-1 text-xs text-gray-700">
        {data.data && <p><strong className="text-blue-600">D:</strong> {data.data}</p>}
        {data.action && <p><strong className="text-emerald-600">A:</strong> {data.action}</p>}
        {data.response && <p><strong className="text-amber-600">R:</strong> {data.response}</p>}
        {data.education && <p><strong className="text-purple-600">E:</strong> {data.education}</p>}
      </div>
    );
  }
  if (type === 'NOTE') {
    return (
      <div className="text-xs text-gray-700">
        {data.focus && <p className="font-semibold">{data.focus}</p>}
        {data.data && <p>D: {data.data}</p>}
        {data.action && <p>A: {data.action}</p>}
        {data.response && <p>R: {data.response}</p>}
        {data.content && <p>{data.content}</p>}
      </div>
    );
  }
  if (type === 'IO') {
    const isIntake = data.intakeType || data.intakeAmount;
    return (
      <p className="text-xs text-gray-700">
        {isIntake ? `▲ 섭취 ${data.intakeAmount}mL (${data.intakeDetail ?? data.intakeType ?? ''})` : `▼ 배출 ${data.outputAmount}mL (${data.outputDetail ?? data.outputType ?? ''})`}
      </p>
    );
  }
  if (type === 'MAR') {
    return (
      <p className="text-xs text-gray-700">
        {data.medicationName ?? '약물'} — {data.status === 'ADMINISTERED' ? '✅ 투여 완료' : data.status === 'HELD' ? '⏸ 보류' : '⏳ 예정'}
      </p>
    );
  }
  if (type === 'CHECKLIST') {
    return (
      <p className="text-xs text-gray-700">
        {data.templateType} — {data.checkedItems}/{data.totalItems} 완료 {data.completedAt ? '✅' : ''}
      </p>
    );
  }
  return null;
}
