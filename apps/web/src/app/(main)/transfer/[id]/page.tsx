'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTAttr, Data } from '@/components/ui/i18n-text';
import { Term } from '@/components/ui/term';
import { DrugName } from '@/components/ui/display';

/**
 * 🔴 (2026-09-15 P11) 임상 섹션 읽기 정본 — 서버 `transfer-clinical-view.ts` 의 응답 모양.
 *    저장 JSON(`diagnoses`·`medications`·`allergies`)은 송신 스냅샷(EncounterDiagnosis·Prescription 행)과
 *    수신 FHIR(`{code,system,text}`·`{text,dosage,status}`)이 서로 달라, 화면이 `{code, name}` 을 가정해 읽던 동안
 *    송신 건 진단 칩은 빈 칸·수신 건은 코드만 나왔다. 화면은 원본 JSON 을 읽지 않고 이 모양만 읽는다.
 *    이름 `null` = 원문에 이름이 없다("원문 없음" — 지어내지 않는다) · 섹션 `null` = 미상 · `[]` = 없음.
 */
interface TransferClinicalView {
  diagnoses: Array<{ code: string | null; system: string | null; nameKo: string | null; nameEn: string | null }> | null;
  medications: Array<{
    code: string | null; nameKo: string | null; nameEn: string | null; ingredient: string | null;
    dosage: string | null; frequency: string | null; status: string | null;
  }> | null;
  allergies: Array<{ name: string | null; severity: string | null }> | null;
}

interface TransferDetail {
  id: string;
  patient?: { familyName: string; givenName: string; mrn: string; dateOfBirth: string };
  fromOrg?: { name: string; code: string; grade?: string };
  toOrg?: { name: string; code: string; grade?: string };
  transferType: string;
  status: string;
  urgency: string;
  reason: string;
  clinicalSummary?: string;
  /** 저장 JSON 원본은 모양이 경로마다 달라 화면이 읽지 않는다 — `clinical` 만 읽는다 */
  clinical?: TransferClinicalView;
  fhirBundleId?: string;
  fhirBundle?: Record<string, unknown>;
  requestedBy?: string;
  acceptedBy?: string;
  requestedAt: string;
  acceptedAt?: string;
  transferredAt?: string;
  completedAt?: string;
  responseNote?: string;
  /** 서버가 남기는 스냅샷 실패 표시 — `snapshotFailed: ['allergies', …]` */
  metadata?: { snapshotFailed?: string[] } | null;
}

/** 스냅샷 섹션 라벨 — 서버 `SECTION_LABEL`(transfer.service.ts)과 같은 어휘 */
const SECTION_LABEL: Record<string, string> = {
  diagnoses: '진단',
  medications: '투약',
  allergies: '알레르기',
};

const STATUS_STEPS = [
  { key: 'REQUESTED', label: '요청', icon: '📤' },
  { key: 'ACCEPTED', label: '수락', icon: '✅' },
  { key: 'IN_TRANSIT', label: '이송중', icon: '🚑' },
  { key: 'COMPLETED', label: '완료', icon: '🏥' },
];

export default function TransferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showBundle, setShowBundle] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['transfer', id],
    queryFn: () => apiClient.get<{ data: TransferDetail }>(`/api/v1/transfer/${id}`),
    enabled: !!id,
  });
  const transfer: TransferDetail | null = (data as any)?.data?.data ?? (data as any)?.data ?? null;

  const { data: bundleData } = useQuery({
    queryKey: ['transfer-bundle', id],
    queryFn: () => apiClient.get(`/api/v1/transfer/${id}/bundle`),
    enabled: !!id && showBundle,
  });
  const bundle = (bundleData as any)?.data?.data ?? (bundleData as any)?.data ?? null;

  const complete = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/transfer/${id}/complete`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transfer', id] }); toast.success(tAttr('전원 완료 처리됨')); },
    onError: () => toast.error(tAttr('처리 실패')),
  });

  const sendBundle = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/transfer/${id}/send`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transfer', id] }); toast.success(tAttr('FHIR Bundle 전송 완료')); },
    onError: () => toast.error(tAttr('전송 실패')),
  });

  if (isLoading) return <div className="py-12 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div>;
  if (!transfer) return <div className="py-12 text-center text-gray-400"><T k="전원 기록을 찾을 수 없습니다" /></div>;

  const snapshotFailed: string[] = Array.isArray(transfer.metadata?.snapshotFailed) ? transfer.metadata.snapshotFailed : [];
  /** 미수집 섹션 이름(표시용 — 번역해 문장 자리표시자에 끼운다) */
  const snapshotSections = snapshotFailed.map((s) => tAttr(SECTION_LABEL[s] ?? s)).join(', ');
  const currentStep = STATUS_STEPS.findIndex(s => s.key === transfer.status);
  const isRejected = transfer.status === 'REJECTED';
  const isCancelled = transfer.status === 'CANCELLED';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="전원 상세" /></h1>
          <p className="text-sm text-gray-500 mt-0.5">ID: {id?.slice(0, 8)}...</p>
        </div>
        <Link href="/transfer" className="text-sm text-blue-600 hover:underline">&larr; <T k="대시보드" /></Link>
      </div>

      {/* Status Timeline */}
      <div className="bg-white rounded-2xl border shadow-sm p-6">
        {isRejected || isCancelled ? (
          <div className={`text-center py-4 ${isRejected ? 'text-red-600' : 'text-gray-500'}`}>
            <div className="text-3xl mb-2">{isRejected ? '❌' : '🚫'}</div>
            <div className="font-bold text-lg"><T k={isRejected ? '전원 거절됨' : '전원 취소됨'} /></div>
            {transfer.responseNote && <p className="text-sm mt-2">{transfer.responseNote}</p>}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            {STATUS_STEPS.map((s, i) => {
              const done = i <= currentStep;
              const active = i === currentStep;
              return (
                <div key={s.key} className="flex-1 flex flex-col items-center relative">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                    done ? 'bg-blue-600' : 'bg-gray-100'
                  } ${active ? 'ring-4 ring-blue-200' : ''}`}>
                    {done ? <span>{s.icon}</span> : <span className="text-gray-300">{s.icon}</span>}
                  </div>
                  <div className={`text-xs mt-2 font-medium ${done ? 'text-blue-700' : 'text-gray-400'}`}><T k={s.label} /></div>
                  {i < STATUS_STEPS.length - 1 && (
                    <div className={`absolute top-5 left-[55%] w-[90%] h-0.5 ${i < currentStep ? 'bg-blue-600' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Timestamps */}
        <div className="mt-4 grid grid-cols-4 text-center text-[10px] text-gray-400">
          <div>{transfer.requestedAt?.slice(0, 16).replace('T', ' ')}</div>
          <div>{transfer.acceptedAt?.slice(0, 16).replace('T', ' ') ?? '-'}</div>
          <div>{transfer.transferredAt?.slice(0, 16).replace('T', ' ') ?? '-'}</div>
          <div>{transfer.completedAt?.slice(0, 16).replace('T', ' ') ?? '-'}</div>
        </div>
      </div>

      {/* Patient + Orgs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border p-4">
          <div className="text-[10px] font-semibold text-gray-400 mb-1"><T k="환자" /></div>
          <div className="text-sm font-bold text-gray-900">{transfer.patient ? `${transfer.patient.familyName}${transfer.patient.givenName}` : '-'}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{transfer.patient?.mrn}</div>
        </div>
        <div className="bg-white rounded-2xl border p-4">
          <div className="text-[10px] font-semibold text-gray-400 mb-1"><T k="송신 병원" /></div>
          <div className="text-sm font-bold text-gray-900">{transfer.fromOrg?.name ?? <T k="우리병원" />}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{transfer.fromOrg?.code}</div>
        </div>
        <div className="bg-white rounded-2xl border p-4">
          <div className="text-[10px] font-semibold text-gray-400 mb-1"><T k="수신 병원" /></div>
          <div className="text-sm font-bold text-gray-900">{transfer.toOrg?.name ?? <T k="우리병원" />}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{transfer.toOrg?.code}</div>
        </div>
      </div>

      {/* 🔴 스냅샷 조회 실패를 화면이 밝힌다 — 빈 진단·빈 알레르기가 '없음'인지 '미상'인지 구분한다.
          서버(transfer.service create)가 실패한 섹션을 metadata.snapshotFailed 로 남긴다. */}
      {snapshotFailed.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-amber-800">⚠️ <T k="전원 스냅샷 일부 미수집" /></p>
          <p className="text-xs text-amber-700 mt-1">
            {/* 한 문장 한 키 — 강조(`<b>`)는 노드 자리표시자로 끼운다(쪼개면 어순이 깨진다) */}
            <Tf
              k="{섹션} 조회에 실패해 이 전원 기록·FHIR 번들에 담기지 않았습니다.{강조}입니다 — 수신 기관에 별도로 확인해 주세요."
              params={{ 섹션: snapshotSections, 강조: <b> <T k="없음이 아니라 미상" /></b> }}
            />
          </p>
        </div>
      )}

      {/* Clinical Info */}
      <div className="bg-white rounded-2xl border shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900"><T k="전원 정보" /></h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
            transfer.urgency === 'EMERGENT' ? 'bg-red-600 text-white' :
            transfer.urgency === 'URGENT' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
          }`}>{transfer.urgency}</span>
        </div>
        <div>
          <div className="text-xs font-medium text-gray-500"><T k="전원 사유" /></div>
          <p className="text-sm text-gray-700 mt-1">{transfer.reason}</p>
        </div>
        {transfer.clinicalSummary && (
          <div>
            <div className="text-xs font-medium text-gray-500"><T k="임상 요약" /></div>
            <p className="text-sm text-gray-700 mt-1">{transfer.clinicalSummary}</p>
          </div>
        )}
        {/* 섹션 3상태 — 미상(null)·없음([])·목록. 빈 섹션을 숨기면 '없음'과 '미상'이 같은 화면이 된다 */}
        {transfer.clinical && (
          <>
            <div data-testid="transfer-diagnoses">
              <div className="text-xs font-medium text-gray-500 mb-1"><T k="진단" /></div>
              {transfer.clinical.diagnoses === null ? (
                <p className="text-xs text-amber-700"><T k="없음이 아니라 미상" /></p>
              ) : transfer.clinical.diagnoses.length === 0 ? (
                <p className="text-xs text-gray-400"><T k="없음" /></p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {transfer.clinical.diagnoses.map((d, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">
                      {d.code && <><Data>{d.code}</Data>{' '}</>}
                      {d.nameKo || d.nameEn ? <Term nameKo={d.nameKo} nameEn={d.nameEn} /> : <span className="text-gray-400"><T k="원문 없음" /></span>}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div data-testid="transfer-medications">
              <div className="text-xs font-medium text-gray-500 mb-1"><T k="투약" /></div>
              {transfer.clinical.medications === null ? (
                <p className="text-xs text-amber-700"><T k="없음이 아니라 미상" /></p>
              ) : transfer.clinical.medications.length === 0 ? (
                <p className="text-xs text-gray-400"><T k="없음" /></p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {transfer.clinical.medications.map((m, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full">
                      {m.nameKo || m.nameEn ? <DrugName nameKo={m.nameKo} nameEn={m.nameEn} ingredient={m.ingredient} /> : <span className="text-gray-400"><T k="원문 없음" /></span>}
                      {m.dosage && <> · <Data>{[m.dosage, m.frequency].filter(Boolean).join(' ')}</Data></>}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* 🔴 (2026-09-15) 전원 수신 알레르기는 종전엔 원내 목록 등록이 FK 위반으로 조용히 실패해 어디에도 없었다 — 수신 자료로 보존한 것을 여기서 보인다 */}
            <div data-testid="transfer-allergies">
              <div className="text-xs font-medium text-gray-500 mb-1"><T k="알레르기" /></div>
              {transfer.clinical.allergies === null ? (
                <p className="text-xs text-amber-700"><T k="없음이 아니라 미상" /></p>
              ) : transfer.clinical.allergies.length === 0 ? (
                <p className="text-xs text-gray-400"><T k="없음" /></p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {transfer.clinical.allergies.map((a, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 bg-red-50 text-red-700 rounded-full">
                      {a.name ? <Data>{a.name}</Data> : <span className="text-gray-400"><T k="원문 없음" /></span>}
                      {a.severity ? <> · <Data>{a.severity}</Data></> : null}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* FHIR Bundle Viewer */}
      <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
        <button
          onClick={() => setShowBundle(!showBundle)}
          className="w-full px-5 py-4 text-left flex items-center justify-between hover:bg-gray-50"
        >
          <span className="text-sm font-bold text-gray-900"><T k="FHIR Bundle 뷰어" /></span>
          <span className="text-xs text-gray-400"><T k={showBundle ? '접기 ▲' : '열기 ▼'} /></span>
        </button>
        {showBundle && bundle && (
          <div className="px-5 pb-5">
            <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-xs overflow-x-auto max-h-96 overflow-y-auto">
              {JSON.stringify(bundle, null, 2)}
            </pre>
          </div>
        )}
        {showBundle && !bundle && (
          <div className="px-5 pb-5 text-sm text-gray-400"><T k="Bundle이 아직 생성되지 않았습니다" /></div>
        )}
      </div>

      {/* Actions */}
      {!isRejected && !isCancelled && (
        <div className="flex gap-3">
          {transfer.status === 'ACCEPTED' && (
            <button
              onClick={() => sendBundle.mutate()}
              disabled={sendBundle.isPending}
              className="flex-1 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-medium hover:bg-violet-700 disabled:opacity-40"
            >
              <T k={sendBundle.isPending ? '전송 중...' : 'FHIR Bundle 전송'} />
            </button>
          )}
          {['ACCEPTED', 'IN_TRANSIT'].includes(transfer.status) && (
            <button
              onClick={() => complete.mutate()}
              disabled={complete.isPending}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-40"
            >
              <T k={complete.isPending ? '처리 중...' : '전원 완료'} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
