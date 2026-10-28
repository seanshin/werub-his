'use client';

import { Term } from '@/components/ui/term';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { safeFormat as format } from '@/lib/safe-date';
import type { ProblemItem } from './types';

import { EmptyState } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { useHasRole } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { extractErrorMessage } from '@/lib/error-utils';
import { usePatientBrief } from './PatientBriefCard';

const PROBLEM_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  ACTIVE: { label: '활성', bg: 'bg-red-50', text: 'text-red-700' },
  CHRONIC: { label: '만성', bg: 'bg-purple-50', text: 'text-purple-700' },
  RESOLVED: { label: '해결', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  INACTIVE: { label: '비활성', bg: 'bg-gray-100', text: 'text-gray-500' },
};

const SEVERITY_CONFIG: Record<string, { label: string; color: string }> = {
  MILD: { label: '경증', color: 'text-green-600' },
  MODERATE: { label: '중등', color: 'text-amber-600' },
  SEVERE: { label: '중증', color: 'text-red-600' },
};

export function ProblemListTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const [filter, setFilter] = useState('ACTIVE,CHRONIC');
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-problems', patientId, filter],
    queryFn: () => apiClient.get<{ data: ProblemItem[] }>(`/api/v1/patients/${patientId}/problems`, { status: filter || undefined }),
    enabled: !!patientId,
  });

  const _problemsRaw = data?.data;
  const problems: ProblemItem[] = Array.isArray(_problemsRaw) ? _problemsRaw : (_problemsRaw as Record<string, unknown> | undefined)?.data as ProblemItem[] ?? [];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900"><T k="문제목록 (Problem List)" /></h3>
        <div className="flex gap-2">
          {[
            { key: 'ACTIVE,CHRONIC', label: '활성/만성' },
            { key: 'RESOLVED', label: '해결됨' },
            { key: '', label: '전체' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                filter === f.key ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <DiagnosisGapPanel patientId={patientId} />

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        /* 🔴 조회 실패를 "없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02) */
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : problems.length === 0 ? (
        <EmptyState icon="📋" title="등록된 문제가 없습니다" />
      ) : (
        <div className="space-y-3">
          {problems.map((p: ProblemItem) => {
            const statusCfg = PROBLEM_STATUS_CONFIG[p.status] ?? PROBLEM_STATUS_CONFIG.ACTIVE;
            const sevCfg = SEVERITY_CONFIG[p.severity] ?? SEVERITY_CONFIG.MODERATE;
            return (
              <div key={p.id} className="border border-gray-100 rounded-xl p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${statusCfg.bg} ${statusCfg.text}`}>
                        {statusCfg.label}
                      </span>
                      <span className={`text-[11px] font-medium ${sevCfg.color}`}>{sevCfg.label}</span>
                      <span className="text-[11px] text-gray-400">{p.diagnosisCode?.code}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-900">{p.description}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      <Term nameKo={p.diagnosisCode?.nameKo} nameEn={p.diagnosisCode?.nameEn} />
                      {p.onsetDate && ` | 발병일: ${format(new Date(p.onsetDate), 'yyyy-MM-dd')}`}
                      {p.resolvedDate && ` | 해결일: ${format(new Date(p.resolvedDate), 'yyyy-MM-dd')}`}
                    </p>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    {p.addedByUser && `${p.addedByUser.familyName}${p.addedByUser.givenName}`}
                  </p>
                </div>
                {p.notes && <p className="text-xs text-gray-500 mt-2 pl-2 border-l-2 border-gray-200">{p.notes}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type GapDx = { code: string; name: string; lastAt: string; encounters: number; diagnosisCodeId?: string };

/**
 * 진료 기록 진단 중 문제 목록에 없는 것(2026-10-03).
 * 🔴 문제 추가 EP(`POST patients/:id/problems`)는 있었는데 **부르는 화면이 없었다** — 문제 목록 탭은 읽기 전용이라 정리할 길이 없었다.
 * 자동 등록은 하지 않는다(설정 `clinical.diagnosisToProblem` · 사람 결정) — 사람이 진단마다 상태·중증도를 **골라야** 올린다
 * (비워 보내면 서버 기본값 MODERATE 가 조용히 박힌다 — 쓰기 폼 초기값은 미선택).
 */
function DiagnosisGapPanel({ patientId }: { patientId: string }) {
  const { allowed, brief, isError } = usePatientBrief(patientId);
  const canAdd = useHasRole('DOCTOR'); // 서버 POST @Roles(DOCTOR, ADMIN) — useHasRole 은 ADMIN 을 통과시킨다
  const [open, setOpen] = useState<string | null>(null);
  if (!allowed || isError || !brief?.recordDiagnoses) return null;
  const gaps = brief.recordDiagnoses.filter((d) => d.onProblemList === false) as GapDx[];
  if (gaps.length === 0) return null;
  return (
    <section className="mb-5 rounded-xl border border-amber-200 bg-amber-50/60 p-4" data-problem-gaps={gaps.length}>
      <h4 className="text-sm font-semibold text-amber-900"><Tf k="진료 기록 진단 중 문제 목록에 없는 것 {수}개" params={{ 수: gaps.length }} /></h4>
      <p className="mt-0.5 text-[11px] text-amber-800">
        <T k="서명된 진료 기록의 진단입니다 — 자동으로 올리지 않습니다. 계속 관리할 문제면 상태·중증도를 골라 올리세요." />
        {!canAdd && <> <T k="(문제 목록 추가는 의사·관리자)" /></>}
      </p>
      <ul className="mt-2 space-y-1.5">
        {gaps.map((g) => (
          <li key={g.code} className="rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-amber-100" data-problem-gap={g.code}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] text-gray-500">{g.code}</span>
              <span className="font-medium text-gray-800">{g.name}</span>
              <span className="text-[10px] text-gray-400"><Tf k="진료 {수}회" params={{ 수: g.encounters }} /></span>
              {canAdd && g.diagnosisCodeId && open !== g.code && (
                <button type="button" onClick={() => setOpen(g.code)} data-problem-gap-open={g.code}
                  className="ml-auto min-h-[32px] rounded-lg border border-amber-300 px-2.5 text-amber-800 hover:bg-amber-100"><T k="문제 목록에 추가" /></button>
              )}
            </div>
            {open === g.code && g.diagnosisCodeId && <AddFromDiagnosis patientId={patientId} dx={g} onDone={() => setOpen(null)} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddFromDiagnosis({ patientId, dx, onDone }: { patientId: string; dx: GapDx; onDone: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const add = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/patients/${patientId}/problems`, { diagnosisCodeId: dx.diagnosisCodeId, description: dx.name, status, severity }),
    onSuccess: async () => {
      toast.success(tAttr('문제 목록에 올렸습니다'));
      // 진료 전 요약은 서버 캐시라 다시 계산을 요청한다 — 그래야 "문제 목록에 없음"이 사라진다
      //    실패를 삼키지 않는다 — 요약에 낡은 "없음"이 남는다는 사실을 말한다(문제 목록 저장은 이미 끝났다)
      try { await apiClient.get(`/api/v1/ai/brief/${patientId}?refresh=1`); }
      catch { toast.error(tAttr('문제 목록에는 올렸지만 진료 전 요약을 다시 계산하지 못했습니다 — 요약의 "다시 계산"을 누르세요')); }
      qc.invalidateQueries({ queryKey: ['patient-brief', patientId] });
      qc.invalidateQueries({ queryKey: ['patient-problems', patientId] });
      onDone();
    },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('문제 목록에 올리지 못했습니다')),
  });
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2" data-problem-gap-form={dx.code}>
      <label className="text-[11px] text-gray-500"><T k="상태" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} data-problem-gap-status className="ml-1 rounded border border-gray-200 px-1.5 py-1 text-xs">
          <option value="">{tAttr('— 선택 —')}</option>
          <option value="ACTIVE">{tAttr(PROBLEM_STATUS_CONFIG.ACTIVE.label)}</option>
          <option value="CHRONIC">{tAttr(PROBLEM_STATUS_CONFIG.CHRONIC.label)}</option>
        </select>
      </label>
      <label className="text-[11px] text-gray-500"><T k="중증도" />
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} data-problem-gap-severity className="ml-1 rounded border border-gray-200 px-1.5 py-1 text-xs">
          <option value="">{tAttr('— 선택 —')}</option>
          {Object.entries(SEVERITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{tAttr(v.label)}</option>)}
        </select>
      </label>
      <button type="button" onClick={onDone} className="min-h-[36px] rounded-lg border border-gray-300 px-3 text-xs text-gray-700"><T k="취소" /></button>
      <button type="button" onClick={() => add.mutate()} disabled={!status || !severity || add.isPending} data-problem-gap-save
        className="min-h-[44px] rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white disabled:opacity-50"><T k="올리기" /></button>
    </div>
  );
}
