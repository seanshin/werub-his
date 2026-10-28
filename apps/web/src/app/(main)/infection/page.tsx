'use client';

import { useState } from 'react';
import { Ratio, Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import InfectionRegistry from './InfectionRegistry';
import { ContactCandidatesButton, ContactCandidatesPanel } from './ContactCandidatesPanel';
import { kdate } from '@/lib/ui-settings';
import { T, Tf, useTAttr, Data } from '@/components/ui/i18n-text';
import {
  HH_MOMENTS,
  complianceBarTone,
  complianceDisplay,
  infectionTypeLabel,
  isolationLabel,
  isolationTone,
} from './infection-labels';

interface InfectionRecord {
  id: string;
  infectionType: string;
  organism?: string;
  isolationType?: string;
  detectedAt?: string;
  resolvedAt?: string | null;
  isResolved?: boolean;
  /** 🔴 질병관리청 '신고 표시'는 원내 플래그일 뿐 전송 근거가 아니다(서버가 판정해 내려준다) */
  kcdc?: { flagged: boolean; transmitted: boolean; label: string; note?: string | null };
  patient?: { id: string; familyName: string; givenName: string; mrn?: string | null };
}

interface InfectionStats {
  active: number;
  isolated: number;
  newToday: number;
  resolved: number;
  /** 격리 환자 병합 정의의 출처별 내역(환자 단위) */
  isolatedBy?: { order: number; surveillance: number; mdro: number; icu: number };
  isolatedBasis?: string;
}

interface InfectionListResponse {
  data: InfectionRecord[];
}

export default function InfectionPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['infections'],
    queryFn: () => apiClient.get<{ data: InfectionRecord[] }>('/api/v1/infection-control'),
  });
  const _infRaw = data?.data;
  const infectionList = Array.isArray(_infRaw) ? _infRaw : (_infRaw as InfectionListResponse | undefined)?.data ?? [];
  const { data: stats } = useQuery({
    queryKey: ['infection-stats'],
    queryFn: () => apiClient.get<{ data: InfectionStats }>('/api/v1/infection-control/stats'),
  });

  // 위치 겹침 접촉자 후보(P5) — 버튼·조회의 관리자 검사는 패널 파일 안에 있다
  const [contactFor, setContactFor] = useState<InfectionRecord['patient'] | null>(null);

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="감염관리" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="의료관련감염 감시 및 격리 현황" /></p>
        </div>
        {stats?.data && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 rounded-xl border border-red-100">
            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            </svg>
            {/* 🔴 아래 HAI 레지스트리의 'ACTIVE'(hai_cases)와 세는 대상이 다르다 — 무엇을 세는지 밝힌다 */}
            <Tf className="text-sm font-semibold text-red-700" k="감염감시 활성 {건수}" params={{ 건수: <>{stats.data.active}<Unit>건</Unit></> }} />
          </div>
        )}
      </div>

      {stats?.data && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: '활성 감염감시', value: stats.data.active ?? 0, color: 'text-red-600', sub: <T k="미해소 감염감시 건수" /> },
            {
              label: '격리 환자',
              value: stats.data.isolated ?? 0,
              color: 'text-orange-600',
              // 🔴 종전엔 감염감시 격리유형만 세어 '격리 환자 1' 이라 했고, 같은 화면 MDRO 탭엔
              //    접촉격리 4명이 보였다. 이제 환자 단위 병합 수를 말하고 출처를 함께 적는다.
              // 🔴 숫자 4개가 든 문장은 조각으로 쪼개지 않는다 — 한 보간 키(어순은 번역문이 정한다)
              sub: stats.data.isolatedBy
                ? <Tf k="환자 기준 · 오더 {오더} · 감염감시 {감염감시} · MDRO {MDRO} · 중환자실 {중환자실}" params={{
                    오더: stats.data.isolatedBy.order, 감염감시: stats.data.isolatedBy.surveillance,
                    MDRO: stats.data.isolatedBy.mdro, 중환자실: stats.data.isolatedBy.icu,
                  }} />
                : <T k="환자 기준(중복제거)" />,
            },
            { label: '오늘 신규', value: stats.data.newToday ?? 0, color: 'text-amber-600', sub: <T k="오늘 등록된 감염감시" /> },
            { label: '해소 완료', value: stats.data.resolved ?? 0, color: 'text-emerald-600', sub: <T k="감염감시 해소 건수" /> },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <p className="text-xs font-medium text-gray-500 mb-1"><T k={s.label} /></p>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-gray-400 mt-1 leading-tight">{s.sub}</p>
            </div>
          ))}
        </div>
      )}
      {stats?.data?.isolatedBasis && (
        <Tf className="text-[11px] text-gray-400 -mt-3 mb-6" k="격리 환자 집계 기준: {기준}" params={{ 기준: stats.data.isolatedBasis }} />
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="감염유형" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="원인균" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="격리" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="질병관리청 신고 표시" /></th>
              <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="발생일" /></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-gray-50">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-4 w-20 bg-gray-100 rounded-lg animate-pulse" /></td>
                  ))}
                </tr>
              ))
            ) : !infectionList.length ? (
              <tr>
                <td colSpan={7} className="py-16 text-center">
                  <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-1.573 4.818A2.25 2.25 0 0115.282 21H8.718a2.25 2.25 0 01-2.145-1.682L5 14.5m14 0H5" />
                  </svg>
                  <p className="text-sm text-gray-400"><T k="감염 감시 대상이 없습니다" /></p>
                </td>
              </tr>
            ) : (
              infectionList.map((i: InfectionRecord) => {
                // 🔴 해소 여부를 화면이 말하지 않아, 해소된 건도 격리 배지를 단 채 '현재 감염'처럼 보였다.
                const resolved = i.isResolved ?? i.resolvedAt != null;
                return (
                <tr key={i.id} className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${resolved ? 'bg-gray-50/60' : ''}`}>
                  <td className={`px-5 py-4 font-medium ${resolved ? 'text-gray-500' : 'text-gray-900'}`}>
                    {i.patient?.familyName}{i.patient?.givenName}
                    {i.patient?.id && <ContactCandidatesButton onClick={() => setContactFor(i.patient!)} />}
                  </td>
                  {/* 감염유형 라벨은 HAI 탭과 같은 정본(infection-labels)을 쓴다 — 종전엔 여기만 영문 raw */}
                  <td className="px-5 py-4 text-gray-700" title={i.infectionType}><T k={infectionTypeLabel(i.infectionType)} /></td>
                  <td className="px-5 py-4 text-gray-600 text-xs">{i.organism || '-'}</td>
                  <td className="px-5 py-4">
                    {i.isolationType ? (
                      <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${resolved ? 'bg-gray-100 text-gray-500' : isolationTone(i.isolationType)}`}>
                        <T k={isolationLabel(i.isolationType)} />{resolved ? <>{' '}<T k="(해소)" /></> : ''}
                      </span>
                    ) : <span className="text-xs text-gray-400">-</span>}
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${resolved ? 'bg-gray-100 text-gray-500' : 'bg-rose-50 text-rose-600'}`}>
                      <T k={resolved ? '해소' : '활성'} />
                    </span>
                    {resolved && i.resolvedAt && <span className="ml-1.5 text-[10px] text-gray-400">{kdate(i.resolvedAt)}</span>}
                  </td>
                  {/* 🔴 flag=true 라도 '신고완료'가 아니다 — 질병관리청 전송 채널은 구현된 적이 없다(서버 판정) */}
                  <td className="px-5 py-4 text-xs">
                    {i.kcdc?.flagged ? (
                      <span
                        className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${i.kcdc.transmitted ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                        title={i.kcdc.note ?? undefined}
                      >
                        {i.kcdc.label}
                      </span>
                    ) : <span className="text-gray-400"><T k="표시 없음" /></span>}
                  </td>
                  <td className="px-5 py-4 text-gray-500 text-xs">{i.detectedAt ? kdate(i.detectedAt) : '-'}</td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {contactFor && <ContactCandidatesPanel patient={contactFor} onClose={() => setContactFor(null)} />}

      <InfectionRegistry />

      <HandHygieneSection />
    </div>
  );
}

/* ── 손위생 모니터링 (JCI IPSG.5 / WHO 5 Moments) ── */
/* 🔴 WHO Moment 문구가 입력 드롭다운/통계에서 달랐다 → infection-labels(=BE 정본과 동일 문구)로 수렴.
      화면은 서버가 준 label 을 우선 쓰고, 없을 때만 로컬 상수로 폴백한다. */
const HH_ROLES = [{ k: 'DOCTOR', l: '의사' }, { k: 'NURSE', l: '간호사' }, { k: 'OTHER', l: '기타' }];
const HH_METHODS = [{ k: 'SANITIZER', l: '손소독제' }, { k: 'SOAP', l: '물비누' }];

interface HHCompliance {
  /** complianceRate=null → 관측 0건(산출 불가). 0 과 구분한다. */
  overall: { total: number; performed: number; missed: number; complianceRate: number | null; target: number; sampleAvailable?: boolean; note?: string | null };
  byRole: { key: string; performed: number; total: number; rate: number | null }[];
  byMoment: { moment: number; label: string; performed: number; total: number; rate: number | null }[];
}

function HandHygieneSection() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [form, setForm] = useState({ observedRole: 'NURSE', moment: 1, method: 'SANITIZER' });

  const { data } = useQuery({
    queryKey: ['hand-hygiene-compliance'],
    queryFn: () => apiClient.get<{ data: HHCompliance }>('/api/v1/infection-control/hand-hygiene/compliance'),
  });
  const c = ((data?.data as { data?: HHCompliance })?.data ?? data?.data) as HHCompliance | undefined;

  const recordMut = useMutation({
    mutationFn: (action: 'PERFORMED' | 'MISSED') =>
      apiClient.post('/api/v1/infection-control/hand-hygiene', { ...form, action }),
    onSuccess: (_r, action) => {
      qc.invalidateQueries({ queryKey: ['hand-hygiene-compliance'] });
      toast.success(tAttr(action === 'PERFORMED' ? '손위생 수행 기록됨' : '손위생 누락 기록됨'));
    },
    onError: () => toast.error(tAttr('기록 실패')),
  });

  // 🔴 종전: `c?.overall.complianceRate ?? 0` → 관측 0건인데 "0%"를 빨간 큰 글씨로 단정했다
  //    (= "직원이 손을 전혀 안 씻는다"로 읽힌다). 표본 부재의 정답은 0 이 아니라 '산출 불가'.
  const total = c?.overall.total ?? 0;
  const disp = complianceDisplay(c?.overall.complianceRate, total);
  const moments = c?.byMoment?.length
    ? c.byMoment.map((m) => ({ value: m.moment, label: m.label }))
    : HH_MOMENTS.map((l, i) => ({ value: i + 1, label: l }));

  return (
    <div className="mt-8 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900">🧼 <T k="손위생 모니터링" /></h3>
          <p className="text-xs text-gray-500 mt-0.5"><T k="WHO 5 Moments · JCI IPSG.5 (최근 30일)" /></p>
        </div>
        <div className="text-right">
          {/* 🔴 비율은 분모와 함께(§3.3) — 정본 `<Ratio>` 가 관측 0건이면 '산출 불가'를 그린다.
              화면이 자체 삼항으로 문구를 만들면 규칙이 갈라진다(정본이 둘이 되지 않게). */}
          <p className={`text-3xl font-bold ${disp.tone}`} data-testid="hh-overall-compliance">
            <Ratio
              numerator={c?.overall.performed}
              denominator={c?.overall.total}
              unavailableHint={c?.overall.note ? <Data>{c.overall.note}</Data> : '관측 0건'}
            />
          </p>
          <p className="text-[10px] text-gray-400">
            {disp.available
              ? <Tf k="준수율 (목표 {목표})" params={{ 목표: <>{c?.overall.target ?? 90}<Unit>%</Unit></> }} />
              : (c?.overall.note ?? <T k="관측 0건 — 준수율을 산출할 수 없습니다" />)}
          </p>
        </div>
      </div>

      {/* 빠른 관찰 입력 */}
      <div className="bg-gray-50 rounded-xl p-3 mb-4 space-y-2.5">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] font-semibold text-gray-500 block mb-1"><T k="피관찰 직군" /></label>
            <div className="flex gap-1">
              {HH_ROLES.map((r) => (
                <button key={r.k} onClick={() => setForm({ ...form, observedRole: r.k })}
                  className={`flex-1 py-1.5 text-[11px] rounded-lg border ${form.observedRole === r.k ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}><T k={r.l} /></button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-gray-500 block mb-1"><T k="방법" /></label>
            <div className="flex gap-1">
              {HH_METHODS.map((m) => (
                <button key={m.k} onClick={() => setForm({ ...form, method: m.k })}
                  className={`flex-1 py-1.5 text-[11px] rounded-lg border ${form.method === m.k ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}><T k={m.l} /></button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-gray-500 block mb-1">WHO Moment</label>
            <select value={form.moment} onChange={(e) => setForm({ ...form, moment: Number(e.target.value) })}
              className="w-full py-1.5 px-2 text-[11px] rounded-lg border border-gray-200 bg-white">
              {moments.map((m) => <option key={m.value} value={m.value}>{m.value}. {m.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => recordMut.mutate('PERFORMED')} disabled={recordMut.isPending}
            className="flex-1 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50">✓ <T k="수행" /></button>
          <button onClick={() => recordMut.mutate('MISSED')} disabled={recordMut.isPending}
            className="flex-1 py-2 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-600 disabled:opacity-50">✕ <T k="누락@손위생" /></button>
        </div>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-semibold text-gray-500 mb-1.5"><T k="직군별 준수율" /></p>
          <div className="space-y-1">
            {(c?.byRole ?? []).map((r) => {
              const d = complianceDisplay(r.rate, r.total);
              return (
              <div key={r.key} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-14"><T k={HH_ROLES.find((x) => x.k === r.key)?.l ?? r.key} /></span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${complianceBarTone(r.rate, r.total)}`} style={{ width: `${d.barPct}%` }} /></div>
                {/* 🔴 관찰 0건인 직군은 '0%'도 '-'도 아니다 — 정본 `<Ratio>` 가 n/N 과 함께 말한다 */}
                <span className="text-[11px] text-gray-700 w-28 text-right"><Ratio numerator={r.performed} denominator={r.total} unavailableHint="관찰 0건" /></span>
              </div>
              );
            })}
            {!c?.byRole.length && <p className="text-[11px] text-gray-400"><T k="관찰 기록 없음" /></p>}
          </div>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-gray-500 mb-1.5"><T k="WHO Moment별 준수율" /></p>
          <div className="space-y-1">
            {(c?.byMoment ?? []).filter((m) => m.total > 0).map((m) => {
              const d = complianceDisplay(m.rate, m.total);
              return (
              <div key={m.moment} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 w-28 truncate">{m.moment}. {m.label}</span>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${complianceBarTone(m.rate, m.total)}`} style={{ width: `${d.barPct}%` }} /></div>
                {/* 🔴 종전 '-' 는 미측정처럼 읽혔다 — Moment 별 준수율도 분모(관찰 수)와 함께 낸다 */}
                <span className="text-[11px] text-gray-700 w-24 text-right"><Ratio numerator={m.performed} denominator={m.total} unavailableHint="관찰 0건" /></span>
              </div>
              );
            })}
            {!c?.byMoment.some((m) => m.total > 0) && <p className="text-[11px] text-gray-400"><T k="관찰 기록 없음" /></p>}
          </div>
        </div>
      </div>
    </div>
  );
}
