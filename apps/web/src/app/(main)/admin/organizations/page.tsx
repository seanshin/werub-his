'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

/**
 * 🔴 서버 정본 키는 `orgType` 이다 — `Organization.orgType`(schema.prisma) · `organization.service.ts` `findAll()` 은
 *    `findMany` 결과를 가공 없이 돌려주므로 **응답 키 = 모델 키**다. 이 화면이 `type` 으로 읽어
 *    `TYPE_LABEL[undefined] ?? undefined` 가 `<T k={undefined}>` 로 들어갔고, `tOf()` 의 `key.lastIndexOf('@')` 가
 *    터져 **화면 전체가 오류로 죽었다**(2026-09-13 외부 실측 S18 · `reading 'lastIndexOf'`).
 *    쓰기 경로는 DTO 별칭(`type`)으로 이미 봉합돼 있었으나 **읽기 경로는 그대로였다** — 정본 키로 읽고 쓴다.
 *    가드: `test/ui/organization-field-contract.spec.tsx`(이 인터페이스의 필드가 전부 서버 모델에 있는지 기계 대조).
 */
interface Organization {
  id: string;
  code: string;
  name: string;
  orgType: string;
  grade?: string;
  phone?: string;
  fhirEndpoint?: string;
  isActive: boolean;
  isSelf: boolean;
}

const TYPE_LABEL: Record<string, string> = { HOSPITAL: '병원', CLINIC: '의원', PHARMACY: '약국', PUBLIC_HEALTH: '보건소', INSURANCE: '보험사' };

export default function OrganizationsPage() {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', orgType: 'HOSPITAL', grade: '', phone: '', fhirEndpoint: '' });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['organizations'],
    queryFn: () => apiClient.get<{ data: Organization[] }>('/api/v1/organizations'),
  });
  const orgs: Organization[] = (() => { const d = data?.data; return Array.isArray(d) ? d : (d as any)?.data ?? []; })();

  const create = useMutation({
    mutationFn: () => apiClient.post('/api/v1/organizations', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['organizations'] }); toast.success('기관 등록 완료'); setShowForm(false); setForm({ code: '', name: '', orgType: 'HOSPITAL', grade: '', phone: '', fhirEndpoint: '' }); },
    onError: () => toast.error('등록 실패'),
  });

  const testConnection = async (id: string) => {
    try {
      await apiClient.get(`/api/v1/organizations/${id}/test`);
      toast.success('연결 테스트 성공');
    } catch {
      toast.error('연결 테스트 실패');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="연동 기관 관리" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="파트너 병원/보험사 FHIR 연동 기관" /></p>
        </div>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700"><T k="+ 기관 등록" /></button>
      </div>

      {isError ? <QueryErrorFallback error={error} onRetry={() => refetch()} /> :
      isLoading ? <div className="py-12 text-center text-gray-400 animate-pulse"><T k="로딩 중..." /></div> :
      orgs.length === 0 ? <EmptyState icon="📋" title="등록된 기관이 없습니다" /> : (
        <div className="grid grid-cols-2 gap-3">
          {orgs.map(org => (
            <div key={org.id} className={`bg-white rounded-2xl border shadow-sm p-4 ${org.isSelf ? 'border-blue-300 bg-blue-50/30' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-bold text-gray-900">{org.name}</span>
                  {org.isSelf && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-semibold"><T k="우리병원" /></span>}
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${org.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                  <T k={org.isActive ? '활성' : '비활성'} />
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs text-gray-500">
                <div><T k="코드" />: <span className="font-mono text-gray-700">{org.code}</span></div>
                <div><T k="유형" />: <T k={TYPE_LABEL[org.orgType] ?? org.orgType ?? ''} /></div>
                {org.grade && <div><T k="등급" />: {org.grade}</div>}
                {org.phone && <div><T k="전화" />: {org.phone}</div>}
              </div>
              {org.fhirEndpoint && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-gray-400 font-mono truncate max-w-[200px]">{org.fhirEndpoint}</span>
                  <button onClick={() => testConnection(org.id)} className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded font-medium hover:bg-blue-100"><T k="연결 테스트" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4"><T k="기관 등록" /></h3>
            <div className="space-y-3">
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder={tAttr('기관명 *')} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <input value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder={tAttr('기관코드 (HIRA) *')} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <select value={form.orgType} onChange={e => setForm({...form, orgType: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                <option value="HOSPITAL">{tAttr('병원')}</option><option value="CLINIC">{tAttr('의원')}</option><option value="INSURANCE">{tAttr('보험사')}</option><option value="PUBLIC_HEALTH">{tAttr('보건소')}</option>
              </select>
              <input value={form.fhirEndpoint} onChange={e => setForm({...form, fhirEndpoint: e.target.value})} placeholder={tAttr('FHIR Base URL')} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder={tAttr('전화번호')} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <div className="flex gap-2 pt-2">
                <button onClick={() => setShowForm(false)} className="flex-1 py-2 bg-gray-100 rounded-xl text-sm"><T k="취소" /></button>
                <button onClick={() => create.mutate()} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium"><T k="등록" /></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
