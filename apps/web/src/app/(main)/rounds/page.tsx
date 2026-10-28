'use client';

import { useState } from 'react';
import { Ratio, genderText } from '@/components/ui/display';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { AllRoundsBoard } from './all-rounds-board';
import { VitalSignsStrip } from '@/components/vitals/VitalSigns';
import type { VitalSignKey } from '@hospital-run/shared';

/** 회진 응답(latestVitals)이 싣는 항목 */
const ROUND_VITAL_KEYS: readonly VitalSignKey[] = ['spo2', 'systolicBp', 'heartRate', 'temperature'];
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface RoundPatient {
  admissionId: string;
  patient: { id: string; familyName: string; givenName: string; mrn: string; gender: string; dateOfBirth: string };
  ward: string;
  room: string;
  bed: string;
  admitReason?: string;
  rounded: boolean;
  lastRound: { roundedAt: string; roundType: string; notes?: string } | null;
  latestVitals: { systolicBp?: number; diastolicBp?: number; heartRate?: number; temperature?: number; spo2?: number; recordedAt?: string } | null;
  nursingAlerts: string[];
}

interface RoundsToday {
  total: number;
  rounded: number;
  patients: RoundPatient[];
}

export default function RoundsPage() {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-rounds-today'],
    queryFn: () => apiClient.get<{ data: RoundsToday }>('/api/v1/doctors/rounds/today'),
    refetchInterval: pollMs('normal'),
  });

  const rounds: RoundsToday = (data?.data as any)?.data ?? data?.data ?? { total: 0, rounded: 0, patients: [] };
  /* 🔴 분모 0 은 0% 가 아니라 '산출 불가'다 — 미완료(0%)와 대상 없음을 뒤바꿔 말하지 않는다(2026-09-02) */
  const pct = rounds.total > 0 ? Math.round((rounds.rounded / rounds.total) * 100) : null;

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">← <T k="대시보드" /></Link>
          <h1 className="text-xl font-bold text-gray-900 mt-1"><T k="오늘 회진" /></h1>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-600"><Tf k="{완료}/{전체}명 완료" params={{ 완료: rounds.rounded, 전체: rounds.total }} /></p>
          <p className="text-xs text-gray-400">{kdate(new Date(), 'monthDayWeekday')}</p>
        </div>
      </div>

      {/* 🔴 전체 의료진 회진 현황 — 종전엔 본인 것만 보였다(사람 신고 2026-08-26) */}
      <AllRoundsBoard />

      {/* 진행률 바 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-gray-700"><T k="회진 진행률" /></span>
          <span className={`text-sm font-bold ${pct === 100 ? 'text-green-600' : pct == null ? 'text-gray-400' : 'text-blue-600'}`}>
            <Ratio numerator={rounds.rounded} denominator={rounds.total} pctOnly unavailableHint="오늘 회진 대상 없음" />
          </span>
        </div>
        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
            style={{ width: `${pct ?? 0}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5 text-[10px] text-gray-400">
          <span><Tf k="미회진 {인원}명" params={{ 인원: rounds.total - rounds.rounded }} /></span>
          <span><Tf k="완료 {인원}명" params={{ 인원: rounds.rounded }} /></span>
        </div>
      </div>

      {/* 환자 리스트 */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : rounds.patients.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-2">✓</p>
          <p><T k="담당 입원환자가 없습니다" /></p>
        </div>
      ) : (
        <div className="space-y-3">
          {rounds.patients.map(p => (
            <RoundCard
              key={p.admissionId}
              patient={p}
              expanded={expandedId === p.admissionId}
              onToggle={() => setExpandedId(expandedId === p.admissionId ? null : p.admissionId)}
              onRoundComplete={() => qc.invalidateQueries({ queryKey: ['my-rounds-today'] })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RoundCard({ patient: p, expanded, onToggle, onRoundComplete }: {
  patient: RoundPatient; expanded: boolean; onToggle: () => void; onRoundComplete: () => void;
}) {
  const tAttr = useTAttr();
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');

  const quickRound = useMutation({
    mutationFn: () => apiClient.post('/api/v1/doctors/rounds/quick', {
      admissionId: p.admissionId,
      assessment,
      plan,
      roundType: 'MORNING',
    }),
    onSuccess: () => {
      toast.success(tAttr('회진 기록 완료'));
      setAssessment('');
      setPlan('');
      onRoundComplete();
    },
    onError: () => toast.error(tAttr('회진 기록 실패')),
  });

  const vitalAge = p.latestVitals?.recordedAt
    ? Math.round((Date.now() - new Date(p.latestVitals.recordedAt).getTime()) / (1000 * 60))
    : null;

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition ${p.rounded ? 'border-green-200 opacity-80' : 'border-gray-200'}`}>
      {/* 카드 헤더 */}
      <button onClick={onToggle} className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition">
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full ${p.rounded ? 'bg-green-400' : 'bg-gray-300'}`} />
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900">{p.patient.familyName}{p.patient.givenName}</span>
              <span className="text-[11px] text-gray-400">({genderText(p.patient.gender)})</span>
              <span className="text-[11px] text-gray-400">{p.ward} {p.room}-{p.bed}</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{p.admitReason || '-'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {p.nursingAlerts.length > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700"><Tf k="알림 {건수}" params={{ 건수: p.nursingAlerts.length }} /></span>
          )}
          {p.rounded && p.lastRound && (
            <span className="text-[10px] text-green-600 font-medium">
              <Tf k="{시각} 완료" params={{ 시각: kdate(p.lastRound.roundedAt, 'time') }} />
            </span>
          )}
          <svg className={`w-4 h-4 text-gray-400 transition ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* 확장 영역 */}
      {expanded && (
        <div className="px-5 pb-4 border-t border-gray-100 pt-3 space-y-3">
          {/* 바이탈 */}
          {p.latestVitals && (
            <div className="bg-blue-50 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-blue-600"><T k="최근 바이탈" /></span>
                <span className="text-[10px] text-gray-400">
                  {vitalAge != null ? (vitalAge < 60 ? <Tf k="{분}분 전" params={{ 분: vitalAge }} /> : <Tf k="{시간}시간 전" params={{ 시간: Math.round(vitalAge / 60) }} />) : ''}
                </span>
              </div>
              {/* 미측정 '—'(측정된 0 을 숨기던 truthy 검사·이완기 없을 때 "120/undefined" 회수) · 회진 응답이 싣는 항목만 */}
              <VitalSignsStrip vitals={p.latestVitals as Record<string, unknown>} keys={ROUND_VITAL_KEYS} className="text-gray-700" />
            </div>
          )}

          {/* 간호 알림 */}
          {p.nursingAlerts.length > 0 && (
            <div className="bg-red-50 rounded-xl p-3">
              <span className="text-[10px] font-bold text-red-600 block mb-1"><T k="간호 보고" /></span>
              {p.nursingAlerts.map((a, i) => (
                <p key={i} className="text-xs text-red-700">{a}</p>
              ))}
            </div>
          )}

          {/* 빠른 회진 기록 폼 */}
          {!p.rounded && (
            <div className="bg-gray-50 rounded-xl p-3 space-y-2">
              <span className="text-[10px] font-bold text-gray-600 block"><T k="빠른 회진 기록" /></span>
              <textarea
                value={assessment}
                onChange={e => setAssessment(e.target.value)}
                placeholder={tAttr('평가 (Assessment)')}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                rows={2}
              />
              <textarea
                value={plan}
                onChange={e => setPlan(e.target.value)}
                placeholder={tAttr('계획 (Plan)')}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                rows={2}
              />
              <button
                onClick={() => quickRound.mutate()}
                disabled={!assessment.trim() || quickRound.isPending}
                className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <T k={quickRound.isPending ? '저장 중...' : '회진 완료 ✓'} />
              </button>
            </div>
          )}

          {/* 이미 회진 완료 시 */}
          {p.rounded && p.lastRound && (
            <div className="bg-green-50 rounded-xl p-3">
              <span className="text-[10px] font-bold text-green-600 block mb-1"><T k="오늘 회진 기록" /></span>
              {p.lastRound.notes && <p className="text-xs text-gray-700">{p.lastRound.notes}</p>}
            </div>
          )}

          {/* 상세 이동 */}
          <div className="flex gap-2">
            <Link href={`/inpatient/${p.admissionId}`} className="text-xs text-blue-600 hover:underline"><T k="입원 상세" /> →</Link>
            <Link href={`/patients/${p.patient.id}`} className="text-xs text-blue-600 hover:underline"><T k="환자 차트" /> →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
