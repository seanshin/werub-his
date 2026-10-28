'use client';

import { useState } from 'react';
import { Unit, DrugName } from '@/components/ui/display';
import Link from 'next/link';
import { format } from 'date-fns';
import { useAuthStore } from '@/stores/auth-store';
import type { EncounterListItem } from './types';
import { EncounterRecordModal } from '@/components/document/EncounterRecordModal';
import { PrescriptionModal } from '@/components/document/PrescriptionModal';
import { CertificateModal } from '@/components/document/CertificateModal';

function safeDateTime(d?: string | null): string {
  if (!d) return '-';
  try { return format(new Date(d), 'yyyy-MM-dd HH:mm'); } catch { return d.slice(0, 16); }
}
import { STATUS_CONFIG } from './types';
import { T } from '@/components/ui/i18n-text';
import { VisitComparisonPanel } from './VisitComparisonPanel';

interface EncounterHistoryTabProps {
  patientId: string;
  encounters: EncounterListItem[];
  encountersLoading: boolean;
}

export function EncounterHistoryTab({ patientId, encounters, encountersLoading }: EncounterHistoryTabProps) {
  const user = useAuthStore(s => s.user);
  const isDoctor = user?.role === 'DOCTOR' || user?.role === 'ADMIN';
  const [expandedEncounters, setExpandedEncounters] = useState<Set<string>>(new Set());
  const [docEncounterId, setDocEncounterId] = useState<string | null>(null);
  const [rxEncounterId, setRxEncounterId] = useState<string | null>(null);
  const [certEncounterId, setCertEncounterId] = useState<string | null>(null);
  // 직전 방문 대비(C7) — 펼친 방문에서 사람이 눌렀을 때만 조회한다(펼치기만으로 비교 조회를 쏘지 않는다)
  const [compareEncounterId, setCompareEncounterId] = useState<string | null>(null);

  const toggleEncounter = (encId: string) => {
    setExpandedEncounters(prev => {
      const next = new Set(prev);
      if (next.has(encId)) next.delete(encId);
      else next.add(encId);
      return next;
    });
  };

  // 표시 가능한(의미있는) 진료기록 — 내용 없는 임시저장(DRAFT)은 제외. 카운트/렌더/빈상태가 같은 기준을 쓰도록 한 번만 계산.
  // (종전엔 빈상태 가드만 필터 전 length 를 봐서, 빈 DRAFT 1건일 때 행도 빈상태도 없이 백지로 렌더되던 버그.)
  const visibleEncounters = encounters.filter((e) => e.status !== 'DRAFT' || e.subjective || e.objective || e.assessment || e.plan);
  const hiddenDraftCount = encounters.length - visibleEncounters.length;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900"><T k="진료 이력" /></h3>
        {/* 작성 가능성 표기는 탭 상단 CapabilityBadge 정본으로 일원화 */}
      </div>
      {encountersLoading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : visibleEncounters.length === 0 ? (
        <div className="text-center py-10">
          <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12H9.75m3 0h3m-10.125 0A2.625 2.625 0 018.25 18V6.375c0-1.036.84-1.875 1.875-1.875h3.375" />
          </svg>
          {hiddenDraftCount > 0 ? (
            <p className="text-sm text-gray-400 mb-3">
              작성 중인 임시 진료기록 {hiddenDraftCount}건이 있습니다.<br />
              <span className="text-xs text-gray-400"><T k="내용 입력·서명 전이라 이력에 표시되지 않습니다." /></span>
            </p>
          ) : (
            <p className="text-sm text-gray-400 mb-3"><T k="진료 기록이 없습니다." /></p>
          )}
          {isDoctor && (
            <Link
              href={`/patients/${patientId}/encounter/new`}
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {hiddenDraftCount > 0 ? '진료 작성 이어가기' : '첫 진료 시작하기'}
            </Link>
          )}
        </div>
      ) : (
        <div className="relative">
          {/* Timeline vertical line */}
          <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-gray-200" />

          <div className="space-y-6">
            {visibleEncounters.map((enc: EncounterListItem) => {
              const status = STATUS_CONFIG[enc.status] ?? { label: enc.status, bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-400' };
              const isExpanded = expandedEncounters.has(enc.id);

              return (
                <div key={enc.id} className="relative pl-10">
                  {/* Timeline dot */}
                  <div className={`absolute left-[9px] top-1.5 w-3 h-3 rounded-full border-2 border-white ${status.dot}`} />

                  <button
                    onClick={() => toggleEncounter(enc.id)}
                    className="w-full text-left rounded-xl border border-gray-100 p-4 hover:border-blue-200 hover:bg-blue-50/30 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${status.bg} ${status.text}`}>
                          {status.label}
                        </span>
                        {enc.status === 'DRAFT' && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap">
                            <T k="임시저장" />
                          </span>
                        )}
                        {/* 상태 배지(status.label)가 이미 '서명완료' — 중복 배지 제거(2026-08-03) */}
                        {/* AI 스크라이브로 작성된 기록 — 응답에 있으나 화면에 없던 값.
                            수정거리(aiEditDistance)는 의료진이 초안을 얼마나 고쳤는지를 나타낸다. */}
                        {(enc as { aiScribed?: boolean }).aiScribed && (
                          <span
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 whitespace-nowrap"
                            title={
                              (enc as { aiEditDistance?: number | null }).aiEditDistance != null
                                ? `AI 초안 기반 기록 · 의료진 수정량 ${(enc as { aiEditDistance?: number | null }).aiEditDistance}자`
                                : 'AI 초안 기반으로 작성된 기록입니다'
                            }
                          >
                            AI 초안
                            {(enc as { aiEditDistance?: number | null }).aiEditDistance != null
                              ? ` · 수정 ${(enc as { aiEditDistance?: number | null }).aiEditDistance}자`
                              : ''}
                          </span>
                        )}
                        {enc.status === 'AMENDED' && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap" title={`수정된 차트입니다`}>
                            <T k="수정됨" />
                          </span>
                        )}
                        <span className="text-sm text-gray-500">
                          {safeDateTime(enc.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">
                          {enc.doctor?.familyName}{enc.doctor?.givenName}
                        </span>
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </div>
                    </div>

                    {/* Diagnoses */}
                    {(enc.diagnoses?.length ?? 0) > 0 && (
                      <div className="flex gap-1.5 flex-wrap mb-1.5">
                        {enc.diagnoses!.map((d) => (
                          <span key={d.id} className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md">
                            {d.diagnosisCode?.code} {d.diagnosisCode?.nameKo}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Preview (collapsed) */}
                    {!isExpanded && enc.subjective && (
                      <p className="text-sm text-gray-600 line-clamp-1">
                        <span className="font-medium text-gray-400">S:</span> {enc.subjective}
                      </p>
                    )}

                    {/* Expanded SOAP details */}
                    {isExpanded && (
                      <div className="mt-3 space-y-2 text-sm">
                        {enc.subjective && (
                          <div>
                            <span className="font-medium text-blue-600"><T k="S (주관적):" /></span>
                            <p className="text-gray-700 mt-0.5 whitespace-pre-wrap">{enc.subjective}</p>
                          </div>
                        )}
                        {enc.objective && (
                          <div>
                            <span className="font-medium text-emerald-600"><T k="O (객관적):" /></span>
                            <p className="text-gray-700 mt-0.5 whitespace-pre-wrap">{enc.objective}</p>
                          </div>
                        )}
                        {enc.assessment && (
                          <div>
                            <span className="font-medium text-amber-600"><T k="A (평가):" /></span>
                            <p className="text-gray-700 mt-0.5 whitespace-pre-wrap">{enc.assessment}</p>
                          </div>
                        )}
                        {enc.plan && (
                          <div>
                            <span className="font-medium text-purple-600"><T k="P (계획):" /></span>
                            <p className="text-gray-700 mt-0.5 whitespace-pre-wrap">{enc.plan}</p>
                          </div>
                        )}

                        {/* Prescriptions list */}
                        {(enc.prescriptions?.length ?? 0) > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <p className="text-xs font-medium text-gray-500 mb-2"><T k="처방 목록" /></p>
                            <div className="space-y-1.5">
                              {enc.prescriptions!.map((rx) => (
                                <div key={rx.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                                  <div>
                                    <span className="font-medium text-gray-700">
                                      <DrugName nameKo={rx.medicationCode?.nameKo ?? rx.medication?.nameKo} nameEn={rx.medicationCode?.nameEn} ingredient={rx.medicationCode?.ingredient} code={rx.medicationId} />
                                    </span>
                                    {rx.dosage && (
                                      <span className="text-gray-400 ml-2">{rx.dosage}</span>
                                    )}
                                  </div>
                                  {rx.quantity && (
                                    <span className="text-gray-400">{rx.quantity}정</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Prescription count (collapsed) */}
                    {!isExpanded && (enc.prescriptions?.length ?? 0) > 0 && (
                      <div className="flex items-center gap-1 mt-1.5">
                        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a3.187 3.187 0 01-2.283.866 3.187 3.187 0 01-2.283-.866L5 14.5" />
                        </svg>
                        <span className="text-xs text-gray-400">처방 {enc.prescriptions?.length ?? 0}<Unit>건</Unit></span>
                      </div>
                    )}
                  </button>
                  {isExpanded && (
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => setCompareEncounterId(compareEncounterId === enc.id ? null : enc.id)}
                        aria-expanded={compareEncounterId === enc.id}
                        className="text-[11px] px-2.5 py-1 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50"
                      >
                        <T k="↔ 직전 방문과 비교" />
                      </button>
                      <button onClick={() => setDocEncounterId(enc.id)} className="text-[11px] px-2.5 py-1 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50"><T k="📄 진료기록지" /></button>
                      {(enc.prescriptions?.length ?? 0) > 0 && (
                        <button onClick={() => setRxEncounterId(enc.id)} className="text-[11px] px-2.5 py-1 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50"><T k="📄 처방전" /></button>
                      )}
                      {(enc.diagnoses?.length ?? 0) > 0 && (
                        <button onClick={() => setCertEncounterId(enc.id)} className="text-[11px] px-2.5 py-1 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50"><T k="📄 진단서" /></button>
                      )}
                    </div>
                  )}
                  {isExpanded && compareEncounterId === enc.id && (
                    <div className="mt-2">
                      <VisitComparisonPanel patientId={patientId} encounterId={enc.id} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {docEncounterId && (
        <EncounterRecordModal patientId={patientId} encounterId={docEncounterId} onClose={() => setDocEncounterId(null)} />
      )}
      {rxEncounterId && (
        <PrescriptionModal patientId={patientId} encounterId={rxEncounterId} onClose={() => setRxEncounterId(null)} />
      )}
      {certEncounterId && (
        <CertificateModal patientId={patientId} encounterId={certEncounterId} onClose={() => setCertEncounterId(null)} />
      )}
    </div>
  );
}
