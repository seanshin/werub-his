'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { toast } from '@/stores/toast-store';
import { PatientConsentSignDialog } from '@/components/consent/PatientConsentSignDialog';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import StatusBadge from '@/components/ui/StatusBadge';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { kdate } from '@/lib/ui-settings';

const TYPE_LABEL: Record<string, string> = {
  SURGERY: '수술동의서', ANESTHESIA: '마취동의서', TREATMENT: '시술동의서',
  TRANSFUSION: '수혈동의서', RESEARCH: '연구참여동의서', GENERAL: '일반동의서',
  DNR: 'DNR', PROCEDURE: '시술동의서',
};

interface ConsentPatient {
  id?: string;
  familyName?: string;
  givenName?: string;
  mrn?: string;
  dateOfBirth?: string;
}

interface ConsentListItem {
  id: string;
  type?: string;
  consentType?: string;
  status: string;
  createdAt?: string;
  signedAt?: string;
  patient?: ConsentPatient;
}

interface ConsentDetail {
  id: string;
  type?: string;
  consentType?: string;
  status: string;
  createdAt?: string;
  signedAt?: string;
  revokedAt?: string;
  revokedReason?: string;
  risks?: string;
  alternatives?: string;
  content?: string | Record<string, unknown>;
  templateName?: string;
  patient?: ConsentPatient;
  doctor?: { familyName?: string; givenName?: string };
  template?: { name?: string };
}

export default function ConsentPage() {
  /** 🔴 동의 철회는 설명·동의의 주체가 판단할 일이라 서버가 `@Roles(DOCTOR, ADMIN)` 이다 */
  const canRevoke = useHasRole('DOCTOR');
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['consents', statusFilter, typeFilter],
    queryFn: () => apiClient.get<{ data: ConsentListItem[] }>('/api/v1/consent', {
      status: statusFilter || undefined,
      type: typeFilter || undefined,
    }),
  });

  const { data: detailData } = useQuery({
    queryKey: ['consent-detail', selectedId],
    queryFn: () => apiClient.get<{ data: ConsentDetail }>(`/api/v1/consent/${selectedId}`),
    enabled: !!selectedId,
  });

  // 🔴 (A1 2026-10-13) 환자 서명은 증거(서명패드 이미지·종이 스캔본)와 함께 — 이름 prompt 하나로 "서명 완료"가 되던 경로 제거
  const [signOpen, setSignOpen] = useState(false);

  // sign EXTERNAL 배선 — 외부 서명 모드면 sign 으로 서명요청(portalUrl) 생성.
  const { data: modeData } = useQuery({
    queryKey: ['sign-mode'],
    queryFn: () => apiClient.get<{ data: { mode: string } }>('/api/v1/sign-integration/mode'),
  });
  const isExternal = modeData?.data?.mode === 'EXTERNAL';
  const [portalUrl, setPortalUrl] = useState<string | null>(null);

  const externalSignMutation = useMutation({
    mutationFn: (d: { id: string; patientId?: string; consentType?: string; title?: string }) =>
      apiClient.post<{ data: { portalUrl?: string; issueNo?: string } }>('/api/v1/sign-integration/request-sign', {
        consentFormId: d.id, documentType: 'CONSENT', sourceId: d.id,
        snapshot: { title: d.title, consentType: d.consentType, consentFormId: d.id },
        channel: 'PORTAL', patientId: d.patientId, consentType: d.consentType,
      }),
    onSuccess: (res) => {
      const url = (res as { data?: { portalUrl?: string } })?.data?.portalUrl;
      if (url) { setPortalUrl(url); toast.success('sign 서명 요청 생성 — 환자에게 링크를 전달하세요.'); }
      else toast.error('portalUrl 을 받지 못했습니다.');
      qc.invalidateQueries({ queryKey: ['consent-detail', selectedId] });
    },
    onError: (err: unknown) => toast.error((err as { message?: string })?.message || '외부 서명 요청에 실패했습니다.'),
  });

  const revokeMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.patch(`/api/v1/consent/${id}/revoke`, { reason }),
    onSuccess: () => {
      toast.success('동의서가 철회되었습니다.');
      qc.invalidateQueries({ queryKey: ['consents'] });
      qc.invalidateQueries({ queryKey: ['consent-detail', selectedId] });
    },
    onError: () => toast.error('철회 처리에 실패했습니다.'),
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;

  const consentList = data?.data ?? [];
  const detail = detailData?.data;

  return (
    <div className="max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="동의서 관리" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="환자 동의서 생성, 서명 및 이력 관리" /></p>
        </div>
        <Link href="/consent/templates"
          className="px-4 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-xl hover:bg-indigo-100 transition-colors">
          <T k="템플릿 관리" />
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-xl text-sm">
          <option value="">{tAttr('전체 상태')}</option>
          <option value="PENDING">{tAttr('서명대기')}</option>
          <option value="SIGNED">{tAttr('서명완료')}</option>
          <option value="REVOKED">{tAttr('철회')}</option>
          <option value="EXPIRED">{tAttr('만료')}</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-xl text-sm">
          <option value="">{tAttr('전체 유형')}</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex items-center gap-2 ml-auto text-xs text-gray-400">
          총 {consentList.length}건
        </div>
      </div>

      <div className="flex gap-4">
        {/* Left: List */}
        <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${selectedId ? 'w-1/2' : 'w-full'} transition-all`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="동의서 유형" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="생성일" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="서명일" /></th>
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-4 w-20 bg-gray-100 rounded-lg animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : !consentList.length ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center">
                    <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    <p className="text-sm text-gray-400"><T k="동의서 내역이 없습니다" /></p>
                    <p className="text-xs text-gray-300 mt-1"><T k="환자 상세 화면에서 동의서를 생성할 수 있습니다" /></p>
                  </td>
                </tr>
              ) : (
                consentList.map((c: ConsentListItem) => (
                  <tr key={c.id} onClick={() => setSelectedId(c.id)}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${selectedId === c.id ? 'bg-blue-50' : 'hover:bg-gray-50/50'}`}>
                    <td className="px-5 py-4">
                      <span className="font-medium text-gray-900">{c.patient?.familyName}{c.patient?.givenName}</span>
                      <span className="text-xs text-gray-400 ml-1">{c.patient?.mrn}</span>
                    </td>
                    <td className="px-5 py-4 text-gray-700">{(c.consentType ? TYPE_LABEL[c.consentType] : undefined) ?? (c.type ? TYPE_LABEL[c.type] : undefined) ?? c.type}</td>
                    <td className="px-5 py-4 text-gray-500 text-xs tabular-nums">{c.createdAt ? kdate(c.createdAt) : '-'}</td>
                    <td className="px-5 py-4 text-gray-500 text-xs tabular-nums">{c.signedAt ? kdate(c.signedAt) : '-'}</td>
                    <td className="px-5 py-4">
                      <StatusBadge domain="consent" status={c.status} className="text-[11px]" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Right: Detail Panel */}
        {selectedId && detail && (
          <div className="w-1/2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900"><T k="동의서 상세" /></h3>
              <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Patient Info */}
            <div className="bg-blue-50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-sm font-bold text-white">{detail.patient?.familyName}</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-blue-900">{detail.patient?.familyName}{detail.patient?.givenName}</p>
                  <p className="text-xs text-blue-600">{detail.patient?.mrn} · {detail.patient?.dateOfBirth ? kdate(detail.patient.dateOfBirth) : ''}</p>
                </div>
              </div>
            </div>

            {/* Consent Info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-[10px] text-gray-400"><T k="유형" /></span>
                <p className="font-medium text-gray-900">{(detail.consentType ? TYPE_LABEL[detail.consentType] : undefined) ?? (detail.type ? TYPE_LABEL[detail.type] : undefined) ?? detail.type}</p>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-[10px] text-gray-400"><T k="상태" /></span>
                <p><StatusBadge domain="consent" status={detail.status} className="text-xs" /></p>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-[10px] text-gray-400"><T k="생성일" /></span>
                <p className="font-medium text-gray-900 text-xs">{detail.createdAt ? kdate(detail.createdAt, 'datetimeSec') : '-'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-[10px] text-gray-400"><T k="서명일" /></span>
                <p className="font-medium text-gray-900 text-xs">{detail.signedAt ? kdate(detail.signedAt, 'datetimeSec') : '-'}</p>
              </div>
              {detail.doctor && (
                <div className="bg-gray-50 rounded-lg px-3 py-2">
                  <span className="text-[10px] text-gray-400"><T k="담당의" /></span>
                  <p className="font-medium text-gray-900">{detail.doctor.familyName}{detail.doctor.givenName}</p>
                </div>
              )}
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-[10px] text-gray-400"><T k="템플릿" /></span>
                <p className="font-medium text-gray-900">{detail.templateName ?? detail.template?.name ?? '-'}</p>
              </div>
            </div>

            {/* Risks / Alternatives */}
            {(detail.risks || detail.alternatives) && (
              <div className="space-y-2">
                {detail.risks && (
                  <div className="bg-red-50 rounded-xl p-3">
                    <p className="text-[10px] font-semibold text-red-500 uppercase mb-1"><T k="위험사항" /></p>
                    <p className="text-xs text-red-700">{detail.risks}</p>
                  </div>
                )}
                {detail.alternatives && (
                  <div className="bg-amber-50 rounded-xl p-3">
                    <p className="text-[10px] font-semibold text-amber-500 uppercase mb-1"><T k="대안" /></p>
                    <p className="text-xs text-amber-700">{detail.alternatives}</p>
                  </div>
                )}
              </div>
            )}

            {/* Content Preview */}
            {detail.content && (
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1"><T k="동의서 내용" /></p>
                <div className="text-xs text-gray-700 max-h-60 overflow-y-auto space-y-1.5">
                  <ConsentContentRenderer content={detail.content} />
                </div>
              </div>
            )}

            {/* Revocation Info */}
            {detail.status === 'REVOKED' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <p className="text-[10px] font-semibold text-red-500 uppercase mb-1"><T k="철회 정보" /></p>
                <p className="text-xs text-red-700"><T k="철회일" />: {detail.revokedAt ? kdate(detail.revokedAt, 'datetimeSec') : '-'}</p>
                {detail.revokedReason && <p className="text-xs text-red-600 mt-1"><T k="사유" />: {detail.revokedReason}</p>}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t border-gray-100">
              {detail.status === 'PENDING' && isExternal && (
                <button
                  onClick={() => externalSignMutation.mutate({ id: detail.id, patientId: detail.patient?.id, consentType: detail.consentType, title: detail.templateName ?? detail.template?.name ?? '동의서' })}
                  disabled={externalSignMutation.isPending}
                  className="flex-1 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50"
                >
                  {externalSignMutation.isPending ? <T k="요청 중…" /> : <T k="sign 서명 요청" />}
                </button>
              )}
              {detail.status === 'PENDING' && !isExternal && (
<>
                  <button
                    type="button"
                    data-patient-sign-open
                    onClick={() => setSignOpen(true)}
                    className="flex-1 py-2 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700"
                  >
                    <T k="환자 서명 받기" />
                  </button>
                  {signOpen && (
                    <PatientConsentSignDialog
                      consentId={detail.id}
                      title={detail.templateName ?? detail.template?.name ?? undefined}
                      onClose={() => setSignOpen(false)}
                      onSigned={() => {
                        setSignOpen(false);
                        toast.success(tAttr('서명 기록'));
                        qc.invalidateQueries({ queryKey: ['consents'] });
                        qc.invalidateQueries({ queryKey: ['consent-detail', selectedId] });
                      }}
                    />
                  )}
                </>
              )}
              {canRevoke && (detail.status === 'PENDING' || detail.status === 'SIGNED') && (
                <button
                  onClick={() => {
                    const reason = prompt('철회 사유를 입력하세요:');
                    if (reason) revokeMutation.mutate({ id: detail.id, reason });
                  }}
                  disabled={revokeMutation.isPending}
                  className="flex-1 py-2 bg-red-50 text-red-700 text-sm font-medium rounded-xl hover:bg-red-100 disabled:opacity-50"
                >
                  <T k="철회@버튼" />
                </button>
              )}
              <Link href={`/print/consent/${detail.id}`} target="_blank"
                className="flex-1 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 text-center flex items-center justify-center gap-1.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18.75 12h.008v.008h-.008V12zm-3 0h.008v.008H16.5V12z" /></svg>
                <T k="인쇄" />
              </Link>
            </div>
          </div>
        )}
      </div>

      {portalUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setPortalUrl(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-2"><T k="sign 전자서명 요청 생성됨" /></h3>
            <p className="text-sm text-gray-500 mb-4"><T k="아래 링크를 환자에게 전달하면 sign 포털에서 서명합니다. (48시간·일회용) 서명 완료 시 자동으로 반영됩니다." /></p>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 break-all text-xs font-mono text-gray-700">{portalUrl}</div>
            <div className="flex gap-2">
              <button onClick={() => { navigator.clipboard?.writeText(portalUrl); toast.success('링크 복사됨'); }} className="flex-1 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700"><T k="링크 복사" /></button>
              <a href={portalUrl} target="_blank" rel="noopener noreferrer" className="flex-1 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 text-center"><T k="열기" /></a>
              <button onClick={() => setPortalUrl(null)} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded-xl hover:bg-gray-200"><T k="닫기" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 동의서 내용을 사람이 읽을 수 있는 형태로 렌더링 */
function ConsentContentRenderer({ content }: { content: unknown }) {
  if (!content) return null;
  if (typeof content === 'string') return <p>{content}</p>;

  const obj = content as Record<string, unknown>;

  // title이 있으면 상세 동의서
  if (obj.title) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-bold text-gray-900 border-b pb-1">{String(obj.title)}</p>
        {Object.entries(obj).filter(([k]) => k !== 'title').map(([key, value]) => {
          const label = key.replace(/_/g, ' ');
          if (typeof value === 'boolean') {
            return <div key={key} className="flex items-center gap-1.5"><span className={`text-xs ${value ? 'text-emerald-600' : 'text-red-500'}`}>{value ? '✓' : '✗'}</span><span className="text-xs text-gray-600">{label}</span></div>;
          }
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            return (
              <div key={key} className="bg-white rounded-lg p-2 border border-gray-100">
                <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">{label}</p>
                {Object.entries(value as Record<string, unknown>).map(([sk, sv]) => (
                  <div key={sk} className="flex items-center gap-1.5 ml-2">
                    {typeof sv === 'boolean' ? <span className={`text-xs ${sv ? 'text-emerald-600' : 'text-red-500'}`}>{sv ? '✓' : '✗'}</span> : null}
                    <span className="text-[11px] text-gray-600">{sk.replace(/_/g, ' ')}{typeof sv !== 'boolean' ? `: ${String(sv)}` : ''}</span>
                  </div>
                ))}
              </div>
            );
          }
          if (Array.isArray(value)) {
            return <div key={key}><span className="text-[10px] font-bold text-gray-500">{label}:</span> <span className="text-xs text-gray-700">{value.join(', ')}</span></div>;
          }
          return <div key={key}><span className="text-[10px] font-bold text-gray-500">{label}:</span> <span className="text-xs text-gray-700">{String(value)}</span></div>;
        })}
      </div>
    );
  }

  // 이전 형식 폴백
  return <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(content, null, 2)}</pre>;
}
