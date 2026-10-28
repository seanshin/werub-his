'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { uploadMultipart } from '@/lib/upload';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import SignedDocumentFooter from '@/components/signature/SignedDocumentFooter';
import { kdate } from '@/lib/ui-settings';
import { localeDateTimeText } from '@hospital-run/shared';

interface ConsentPatient {
  familyName?: string;
  givenName?: string;
  mrn?: string;
  dateOfBirth?: string;
  gender?: string;
}

interface ConsentTemplateComponent {
  type: string;
  text?: string;
  label?: string;
  level?: string;
  placeholder?: string;
  required?: boolean;
  role?: string;
  options?: string[];
}

interface ConsentTemplate {
  name?: string;
  version?: string;
  variables?: Record<string, string>;
  components?: ConsentTemplateComponent[];
}

interface ConsentData {
  consentType?: string;
  type?: string;
  status?: string;
  content?: Record<string, unknown> | string;
  risks?: string;
  alternatives?: string;
  patientSignedBy?: string;
  signedBy?: string;
  signedAt?: string;
  patientSignature?: string;
  doctorSignedAt?: string;
  revokedAt?: string;
  revokedReason?: string;
  patient?: ConsentPatient;
  doctor?: { familyName: string; givenName: string };
  template?: ConsentTemplate;
  attachments?: { url: string; fileName: string; mimeType: string; size?: number }[];
}

const TYPE_LABEL: Record<string, string> = {
  SURGERY: '수술 동의서', ANESTHESIA: '마취 동의서', TREATMENT: '치료 동의서',
  TRANSFUSION: '수혈 동의서', RESEARCH: '연구참여 동의서', GENERAL: '일반 동의서',
  DNR: '심폐소생술 거부(DNR) 동의서', PROCEDURE: '시술 동의서',
};

export default function ConsentPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [uploading, setUploading] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['consent-print', id],
    queryFn: () => apiClient.get<{ data: ConsentData }>(`/api/v1/consent/${id}`),
  });

  // 첨부 업로드 — multipart(fetch+FormData·쿠키인증) — apiClient는 JSON 전용
  const uploadAttachment = async (file: File) => {
    setUploading(true);
    try {
      await uploadMultipart(`/api/v1/consent/${id}/attachments`, file);
      await refetch();
    } catch (e) {
      alert((e as Error)?.message ?? '첨부 업로드에 실패했습니다 (jpeg/png/webp/pdf·10MB)');
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (index: number) => {
    try {
      await apiClient.del(`/api/v1/consent/${id}/attachments/${index}`);
      await refetch();
    } catch {
      alert('첨부 삭제에 실패했습니다');
    }
  };

  if (isLoading) return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-500">동의서를 불러오는 중...</p></div>;
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (!data?.data) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <p className="text-red-500">동의서를 불러올 수 없습니다.</p>
      <Link href="/consent" className="text-blue-600 hover:underline text-sm">돌아가기</Link>
    </div>
  );

  const consent = data.data;
  const patient = consent.patient;
  const template = consent.template;
  const consentTitle = (consent.consentType ? TYPE_LABEL[consent.consentType] : undefined) ?? (consent.type ? TYPE_LABEL[consent.type] : undefined) ?? template?.name ?? '동의서';
  const docNumber = template?.variables?.docNumber;
  const components = template?.components ?? [];

  return (
    <div className="max-w-[800px] mx-auto bg-white">
      {/* Print Toolbar */}
      <div className="flex justify-end gap-2 p-4 print:hidden sticky top-0 bg-white border-b z-10">
        <label className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 cursor-pointer">
          {uploading ? '업로드 중...' : '📎 파일 첨부'}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={uploading}
            onChange={e => { const file = e.target.files?.[0]; if (file) uploadAttachment(file); e.target.value = ''; }} />
        </label>
        <Link href="/consent" className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">목록으로</Link>
        <button onClick={() => window.print()} className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 flex items-center gap-1.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
          인쇄 / PDF 저장
        </button>
      </div>

      {/* Document */}
      <div className="p-10 print:p-8">
        {/* Document Header */}
        <div className="flex items-center justify-between mb-2 text-[10px] text-gray-400">
          <span>{docNumber && <span className="font-mono font-semibold text-gray-600 mr-2">{docNumber}</span>}v{template?.version ?? '1.0'}</span>
          <span>위루비병원</span>
        </div>

        {/* Title */}
        <div className="text-center mb-8 border-b-2 border-gray-900 pb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{consentTitle}</h1>
          <p className="text-sm text-gray-500">위루비병원 의료정보시스템</p>
        </div>

        {/* Patient Info */}
        <div className="border border-gray-300 rounded-lg mb-6">
          <div className="grid grid-cols-4 text-sm">
            <div className="border-r border-b border-gray-300 bg-gray-50 px-3 py-2 font-medium text-gray-700">환자명</div>
            <div className="border-b border-gray-300 px-3 py-2 font-bold">{patient?.familyName}{patient?.givenName}</div>
            <div className="border-r border-b border-gray-300 bg-gray-50 px-3 py-2 font-medium text-gray-700">등록번호</div>
            <div className="border-b border-gray-300 px-3 py-2 font-mono">{patient?.mrn}</div>
            <div className="border-r border-gray-300 bg-gray-50 px-3 py-2 font-medium text-gray-700">생년월일</div>
            <div className="px-3 py-2">{patient?.dateOfBirth ? kdate(patient.dateOfBirth) : '-'}</div>
            <div className="border-r border-gray-300 bg-gray-50 px-3 py-2 font-medium text-gray-700">성별</div>
            <div className="px-3 py-2">{patient?.gender === 'MALE' ? '남' : patient?.gender === 'FEMALE' ? '여' : '-'}</div>
          </div>
        </div>

        {/* Template Components 렌더링 */}
        {components.length > 0 ? (
          <div className="space-y-3 mb-8">
            {components.map((c: ConsentTemplateComponent, i: number) => (
              <ComponentPrintRenderer key={i} comp={c} consent={consent} />
            ))}
          </div>
        ) : (
          /* Fallback: raw content */
          <>
            <div className="mb-6">
              <h2 className="text-sm font-bold text-gray-900 mb-3 bg-gray-50 px-3 py-2 rounded">동의 내용</h2>
              <div className="px-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap min-h-[120px]">
                {consent.content && typeof consent.content === 'object'
                  ? Object.entries(consent.content).map(([key, value]) => (
                      <div key={key} className="mb-2"><span className="font-medium text-gray-600">{key}: </span><span>{String(value)}</span></div>
                    ))
                  : consent.content ?? '(내용 없음)'}
              </div>
            </div>
            {consent.risks && (
              <div className="mb-6">
                <h2 className="text-sm font-bold text-gray-900 mb-3 bg-red-50 px-3 py-2 rounded text-red-800">위험사항 및 부작용</h2>
                <div className="px-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{consent.risks}</div>
              </div>
            )}
            {consent.alternatives && (
              <div className="mb-6">
                <h2 className="text-sm font-bold text-gray-900 mb-3 bg-amber-50 px-3 py-2 rounded text-amber-800">대안적 치료 방법</h2>
                <div className="px-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{consent.alternatives}</div>
              </div>
            )}
          </>
        )}

        {/* Agreement (components에 없을 때 fallback) */}
        {components.length === 0 && (
          <div className="border border-gray-300 rounded-lg p-4 mb-8 bg-gray-50 text-sm text-gray-700 leading-relaxed">
            <p>본인은 위 내용에 대하여 담당 의사로부터 충분한 설명을 듣고 이해하였으며, 시행에 따른 예상 결과, 발생 가능한 위험 및 합병증, 대안적 치료 방법에 대해 충분히 이해하였음을 확인합니다.</p>
            <p className="mt-2">이에 본인(또는 법정대리인)의 자유의사에 의하여 동의합니다.</p>
          </div>
        )}

        {/* Signature (components에 서명란이 없을 때만 표시) */}
        {!components.some((c: ConsentTemplateComponent) => c.type === 'signature') && (
          <div className="grid grid-cols-2 gap-8 mb-8">
            <SignatureBlock label="환자(법정대리인)" name={consent.patientSignedBy ?? consent.signedBy} date={consent.signedAt} signed={!!consent.patientSignature} />
            <SignatureBlock label="담당의사" name={consent.doctor ? `${consent.doctor.familyName}${consent.doctor.givenName}` : undefined} date={consent.doctorSignedAt} />
          </div>
        )}

        {/* Revocation */}
        {consent.status === 'REVOKED' && (
          <div className="border-2 border-red-400 rounded-lg p-4 bg-red-50 mb-6">
            <p className="text-sm font-bold text-red-700 mb-1">이 동의서는 철회되었습니다</p>
            <p className="text-xs text-red-600">철회일: {consent.revokedAt ? localeDateTimeText(new Date(consent.revokedAt), 'ko-KR') : '-'}</p>
            {consent.revokedReason && <p className="text-xs text-red-600 mt-1">사유: {consent.revokedReason}</p>}
          </div>
        )}

        {/* 첨부 — 이미지는 본문에 포함 인쇄·기타 파일은 별첨 목록 */}
        {(consent.attachments?.length ?? 0) > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-bold border-b border-gray-300 pb-1 mb-3">별첨 ({consent.attachments!.length})</h3>
            <ol className="text-xs text-gray-600 space-y-1 mb-4 list-decimal list-inside">
              {consent.attachments!.map((a, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="flex-1">{a.fileName} {a.mimeType === 'application/pdf' && <span className="text-gray-400">(PDF — 별도 출력)</span>}</span>
                  <a href={a.url} target="_blank" rel="noreferrer" className="text-blue-600 underline print:hidden">열기</a>
                  <button onClick={() => removeAttachment(i)} className="text-red-400 hover:text-red-600 print:hidden">삭제</button>
                </li>
              ))}
            </ol>
            {consent.attachments!.filter(a => a.mimeType.startsWith('image/')).map((a, i) => (
              <div key={i} className="mb-4 break-inside-avoid">
                <p className="text-[10px] text-gray-400 mb-1">첨부 {i + 1}. {a.fileName}</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt={a.fileName} className="max-w-full border border-gray-200 rounded" />
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 border-t border-gray-200 pt-4 mt-8">
          <div className="flex justify-between">
            <span>본 동의서는 원본 1부, 사본 1부를 작성하여 환자에게 사본을 교부합니다.</span>
            <span>{docNumber}</span>
          </div>
          <p className="mt-2">위루비병원 · {kdate(new Date())} 출력</p>
        </div>

        <SignedDocumentFooter documentType="CONSENT" documentId={id} />
      </div>
    </div>
  );
}

// ── 컴포넌트 인쇄 렌더러 ──
function ComponentPrintRenderer({ comp, consent }: { comp: ConsentTemplateComponent; consent: ConsentData }) {
  const patient = consent.patient;

  // 변수 치환
  const replaceVars = (text: string) => {
    if (!text) return text;
    return text
      .replace('{{patient.name}}', patient ? `${patient.familyName}${patient.givenName}` : '____')
      .replace('{{patient.mrn}}', patient?.mrn ?? '____')
      .replace('{{patient.birthDate}}', patient?.dateOfBirth ? kdate(patient.dateOfBirth) : '____')
      .replace('{{doctor.name}}', consent.doctor ? `${consent.doctor.familyName}${consent.doctor.givenName}` : '____')
      .replace('{{today}}', kdate(new Date()))
      .replace('{{hospital.name}}', '위루비병원');
  };

  switch (comp.type) {
    case 'heading':
      return comp.level === 'h3'
        ? <h3 className="text-base font-semibold border-b pb-1 mt-4">{comp.text}</h3>
        : <h2 className="text-lg font-bold border-b-2 pb-2 mt-2">{comp.text}</h2>;
    case 'paragraph':
      return <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{comp.text}</p>;
    case 'divider':
      return <hr className="border-gray-300 my-2" />;
    case 'page_break':
      return <div className="break-before-page" />;
    case 'text_input':
      return (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium min-w-[120px]">{comp.label}{comp.required && <span className="text-red-500">*</span>}</label>
          <div className="flex-1 border-b border-gray-400 pb-1 text-sm min-h-[20px]">
            {comp.placeholder && replaceVars(comp.placeholder) !== comp.placeholder ? replaceVars(comp.placeholder) : ''}
          </div>
        </div>
      );
    case 'textarea':
      return (
        <div>
          <label className="text-sm font-medium">{comp.label}{comp.required && <span className="text-red-500">*</span>}</label>
          <div className="mt-1 border border-gray-300 rounded h-16 min-h-[40px]" />
        </div>
      );
    case 'date_input':
      return (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium min-w-[120px]">{comp.label}{comp.required && <span className="text-red-500">*</span>}</label>
          <div className="border-b border-gray-400 pb-1 text-sm w-40">
            {consent.signedAt ? kdate(consent.signedAt) : '____년 __월 __일'}
          </div>
        </div>
      );
    case 'checkbox':
      return (
        <label className="flex items-start gap-2 text-sm">
          <span className="w-4 h-4 border border-gray-400 rounded-sm flex-shrink-0 mt-0.5 flex items-center justify-center text-[10px]">
            {consent.status === 'SIGNED' ? '✓' : ''}
          </span>
          <span>{comp.label}{comp.required && <span className="text-red-500">*</span>}</span>
        </label>
      );
    case 'checkbox_group':
      return (
        <div className="space-y-1">
          <p className="text-sm font-medium">{comp.label}</p>
          {(comp.options ?? []).map((opt: string, oi: number) => (
            <label key={oi} className="flex items-center gap-2 text-sm ml-4">
              <span className="w-4 h-4 border border-gray-400 rounded-sm flex-shrink-0" />
              {opt}
            </label>
          ))}
        </div>
      );
    case 'signature':
      return (
        <div className="flex flex-col items-center mt-6">
          <div className="w-48 border-b-2 border-gray-400 pb-8 flex items-end justify-center">
            {consent.status === 'SIGNED' && comp.role === 'patient' && (
              <span className="text-lg font-bold text-gray-700 mb-1">(전자서명)</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {comp.label} ({comp.role === 'patient' ? '환자' : comp.role === 'guardian' ? '보호자' : comp.role === 'doctor' ? '설명 의사' : '증인'})
          </p>
        </div>
      );
    default:
      return null;
  }
}

function SignatureBlock({ label, name, date, signed }: { label: string; name?: string; date?: string; signed?: boolean }) {
  return (
    <div className="border border-gray-300 rounded-lg p-4">
      <p className="text-xs font-medium text-gray-500 mb-4">{label}</p>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-gray-400 mb-1">서명자:</p>
          <p className="text-sm font-bold text-gray-900">{name ?? '(미서명)'}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-400 mb-1">서명일:</p>
          <p className="text-sm text-gray-700">{date ? localeDateTimeText(new Date(date), 'ko-KR') : '____년 __월 __일'}</p>
        </div>
      </div>
      <div className="mt-4 h-16 border-b-2 border-gray-400 flex items-end justify-center">
        {signed ? <span className="text-lg font-bold text-gray-800 mb-1">(전자서명)</span> : <span className="text-sm text-gray-300 mb-1">서명란</span>}
      </div>
    </div>
  );
}
