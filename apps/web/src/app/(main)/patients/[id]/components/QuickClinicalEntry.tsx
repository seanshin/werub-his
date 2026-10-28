'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { vitalsIngestNotice, ingestOf } from '@/lib/vitals-ingest-notice';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 환자 상세 — 비의사 역할의 빠른 작성 진입점 (2026-08-03 결정: 각자의 권한에 맞는 작성).
 *
 * 서버 실권한 실측 기반 — 화면 버튼은 서버가 실제 허용하는 행위와 일치해야 한다:
 *  - 활력: `POST /vitals`(patientId 만 필수·NURSE 허용) → 여기서 바로 작성
 *  - 외래 간호기록: universal(`POST /nursing-notes`) — contextId(진료) 필수 → 최근 진료에 붙인다.
 *    🔴 재원 환자는 여기서 쓰지 않는다 — 입원 간호기록 정본은 admission 기반 NursingNote
 *    (워크스테이션·타블렛). universal 로 쓰면 보드·서명·QA 를 우회하는 유령 기록이 된다(기봉합 결함).
 *  - 약사 복약지도: dispensingId(조제 단위) 필수 → 환자 상세에선 작성 불가가 맞다(워크스테이션으로)
 */

const F = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm';

/**
 * NEWS2(조기경보) 7요소 중 수치 5개 외 **관측 2개**.
 * 🔴 서버가 종전에 `supplementalO2:false` · `consciousness:'ALERT'` 를 하드코딩해
 *    관측하지 않은 값을 EWS 법정기록에 사실로 남겼다(최대 5점 과소평가). 이제 서버는
 *    이 둘이 없으면 **NEWS2 를 산출하지 않는다** — 화면이 관측값을 받아 넘긴다.
 */
const ACVPU: [string, string][] = [
  ['ALERT', '명료(A)'], ['CONFUSION', '혼돈(C)'], ['VOICE', '음성반응(V)'], ['PAIN', '통증반응(P)'], ['UNRESPONSIVE', '무반응(U)'],
];

export function QuickVitalsModal({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [v, setV] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  const hasAny = Object.values(v).some((x) => x.trim());
  /** '' = 미관측(보내지 않는다). 'true'/'false' = 관측 결과 */
  const [o2, setO2] = useState('');
  const [acvpu, setAcvpu] = useState('');
  const news2Ready = ['sbp', 'hr', 'rr', 'temp', 'spo2'].every((k) => v[k]?.trim()) && o2 !== '' && acvpu !== '';

  const save = useMutation({
    mutationFn: () => apiClient.post('/api/v1/vitals', {
      patientId,
      ...Object.fromEntries(Object.entries({
        systolicBp: v.sbp, diastolicBp: v.dbp, heartRate: v.hr,
        respiratoryRate: v.rr, spo2: v.spo2, painScore: v.pain,
      }).filter(([, x]) => x?.trim()).map(([k, x]) => [k, Number(x)])),
      ...(v.temp?.trim() ? { temperature: Number(v.temp) } : {}),
      ...(v.notes?.trim() ? { notes: v.notes.trim() } : {}),
      // 관측했을 때만 보낸다 — 미관측을 false/ALERT 로 채우지 않는다
      ...(o2 !== '' ? { supplementalO2: o2 === 'true' } : {}),
      ...(acvpu !== '' ? { consciousness: acvpu } : {}),
    }),
    onSuccess: (res) => {
      // 🔴 200 이 곧 "기록됨"이 아니다 — 중복 재수신·저장 보류면 서버는 `data: null` 을 준다.
      //    종전엔 그때도 "기록되었습니다"를 띄우고 창을 닫았다.
      const n = vitalsIngestNotice(ingestOf(res));
      if (n && !n.stored) { toast.error(n.text); return; } // 창을 닫지 않는다 — 다시 입력할 수 있게
      toast.success(n ? n.text : '활력징후가 기록되었습니다.');
      qc.invalidateQueries({ queryKey: ['vitals', patientId] });
      onClose();
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '활력 기록에 실패했습니다.'),
  });

  const fields: [string, string, string][] = [
    ['sbp', '수축기(mmHg)', '120'], ['dbp', '이완기(mmHg)', '80'], ['hr', '맥박(회/분)', '72'],
    ['rr', '호흡(회/분)', '16'], ['temp', '체온(℃)', '36.5'], ['spo2', 'SpO₂(%)', '98'], ['pain', '통증(0-10)', '0'],
  ];

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900"><T k="활력징후 입력" /></h3>
          <button onClick={onClose} aria-label={tAttr("닫기")} className="p-1 text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {fields.map(([k, label, ph]) => (
            <div key={k}>
              <label className="block text-[11px] font-medium text-gray-500 mb-0.5">{label}</label>
              <input inputMode="decimal" value={v[k] ?? ''} onChange={set(k)} placeholder={ph} className={F} />
            </div>
          ))}
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-0.5">보충산소</label>
            <select value={o2} onChange={(e) => setO2(e.target.value)} className={F}>
              <option value="">미관측</option>
              <option value="false">실내공기(미투여)</option>
              <option value="true">산소 투여 중</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-0.5">의식(ACVPU)</label>
            <select value={acvpu} onChange={(e) => setAcvpu(e.target.value)} className={F}>
              <option value="">미관측</option>
              {ACVPU.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] font-medium text-gray-500 mb-0.5"><T k="메모" /></label>
            <input value={v.notes ?? ''} onChange={set('notes')} placeholder={tAttr("특이사항")} className={F} />
          </div>
        </div>
        <p className={`mt-2 text-[11px] ${news2Ready ? 'text-emerald-700' : 'text-gray-500'}`}>
          {news2Ready
            ? 'NEWS2 자동 산출 대상 — 7요소가 모두 관측되었습니다.'
            : 'NEWS2 산출 불가 — 5개 수치 + 보충산소 + 의식(ACVPU)이 모두 관측되어야 산출합니다. 관측하지 않은 값은 기록하지 않습니다.'}
        </p>
        <button onClick={() => save.mutate()} disabled={!hasAny || save.isPending}
          className="mt-3 w-full py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-emerald-700">
          {save.isPending ? '저장 중…' : '기록 저장'}
        </button>
      </div>
    </div>
  );
}

export function QuickNursingNoteModal({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [content, setContent] = useState('');

  // 최근 진료 — 외래 universal 기록의 contextId. 재원(INPATIENT·admission 연결) 여부도 여기서 판정.
  const encQ = useQuery({
    queryKey: ['patient-encounters', patientId],
    queryFn: () => apiClient.get<{ data: { id: string; visitType?: string; admissionId?: string | null; status?: string; createdAt: string }[] }>(`/api/v1/patients/${patientId}/encounters`),
  });
  const encounters = encQ.data?.data ?? [];
  const latest = encounters[0];
  const activeInpatient = encounters.find((e) => e.admissionId && e.visitType === 'INPATIENT' && e.status !== 'SIGNED') ?? (latest?.admissionId ? latest : undefined);

  const save = useMutation({
    mutationFn: () => apiClient.post('/api/v1/nursing-notes', {
      patientId,
      contextType: 'OUTPATIENT',
      contextId: latest!.id,
      // 어휘 정본(shared UNIVERSAL_NURSING_NOTE_TYPES) — 'GENERAL' 은 정본에 없는 값이었다(400)
      noteType: 'OBSERVATION',
      content: content.trim(),
    }),
    onSuccess: () => {
      toast.success('간호기록이 저장되었습니다.');
      qc.invalidateQueries({ queryKey: ['nursing-notes', patientId] });
      onClose();
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '간호기록 저장에 실패했습니다.'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900"><T k="간호기록 작성 (외래)" /></h3>
          <button onClick={onClose} aria-label={tAttr("닫기")} className="p-1 text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {activeInpatient ? (
          /* 입원 기록은 정본(admission 기반)이 따로 — universal 로 쓰면 보드·서명·QA 우회(기봉합 결함 재발 방지) */
          <div className="text-sm text-gray-600">
            <p className="mb-3">재원 중인 환자입니다 — 입원 간호기록은 <b>간호 워크스테이션(정본)</b>에서 작성합니다.</p>
            <Link href="/nurse-station" className="inline-block px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700">
              <T k="간호 워크스테이션으로 →" />
            </Link>
          </div>
        ) : !latest ? (
          <p className="text-sm text-gray-500"><T k="진료 기록이 없어 외래 간호기록을 붙일 수 없습니다(기록은 진료 맥락에 귀속됩니다)." /></p>
        ) : (
          <>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={6}
              placeholder={tAttr("외래 간호 수행·관찰·교육 내용…")} className={`${F} resize-y`} />
            <p className="mt-1.5 text-[11px] text-gray-400">최근 진료({latest.createdAt.slice(0, 10)})에 귀속됩니다.</p>
            <button onClick={() => save.mutate()} disabled={!content.trim() || save.isPending}
              className="mt-2 w-full py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-emerald-700">
              {save.isPending ? '저장 중…' : '저장'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
