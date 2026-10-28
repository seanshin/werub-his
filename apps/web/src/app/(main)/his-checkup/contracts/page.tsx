'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';

import { EmptyState, Unit } from '@/components/ui/display';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';

const contractSchema = z.object({
  companyName: z.string().min(1, '기업명을 입력하세요'),
  contactPerson: z.string().optional(),
  contactPhone: z.string().optional(),
  programId: z.string().min(1, '프로그램을 선택하세요'),
  headcount: z.coerce.number().min(1, '1명 이상'),
  discountRate: z.coerce.number().min(0).max(100),
  contractDate: z.string().min(1, '계약일을 입력하세요'),
  expiryDate: z.string().min(1, '만료일을 입력하세요'),
});
type ContractForm = z.infer<typeof contractSchema>;

export default function CheckupContractsPage() {
  const queryClient = useQueryClient();
  const tAttr = useTAttr();
  const [showCreate, setShowCreate] = useState(false);
  const { register, handleSubmit, formState: { errors }, reset } = useForm<ContractForm>({
    resolver: zodResolver(contractSchema),
    defaultValues: { companyName: '', contactPerson: '', contactPhone: '', programId: '', headcount: 10, discountRate: 10, contractDate: kstToday(), expiryDate: '' },
  });

  const { data: contractsRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['checkup-contracts'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/contracts'),
  });
  const contracts = contractsRes?.data ?? [];

  const { data: programsRes } = useQuery({
    queryKey: ['checkup-programs-active'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/programs', { isActive: 'true' }),
  });
  const programs = programsRes?.data ?? [];

  const createContract = useMutation({
    mutationFn: (data: ContractForm) => apiClient.post('/api/v1/checkup/contracts', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkup-contracts'] });
      setShowCreate(false);
      reset();
      toast.success('단체 계약 등록 완료');
    },
    onError: () => toast.error('등록 실패'),
  });

  const [uploadTarget, setUploadTarget] = useState<string | null>(null);
  const [uploadData, setUploadData] = useState('');

  const bulkUpload = useMutation({
    mutationFn: ({ contractId, rows }: { contractId: string; rows: any[] }) =>
      apiClient.post(`/api/v1/checkup/contracts/${contractId}/bulk-upload`, { rows }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['checkup-contracts'] });
      setUploadTarget(null);
      setUploadData('');
      toast.success(`${res?.data?.success ?? 0}명 등록, ${res?.data?.failed ?? 0}명 실패`);
    },
    onError: () => toast.error('업로드 실패'),
  });

  const parseExcelText = (text: string) => {
    return text.trim().split('\n').filter(l => l.trim()).map(line => {
      const cols = line.split('\t').length > 1 ? line.split('\t') : line.split(',');
      return {
        name: cols[0]?.trim() ?? '',
        dateOfBirth: cols[1]?.trim() ?? '',
        gender: cols[2]?.trim() ?? '',
        phone: cols[3]?.trim() ?? '',
        scheduledDate: cols[4]?.trim() ?? kstToday(),
      };
    }).filter(r => r.name && r.dateOfBirth);
  };

  const formatPrice = (n: number) => new Intl.NumberFormat('ko-KR').format(n) + '원';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold"><T k="단체 검진 계약" /></h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          <T k="+ 계약 등록" />
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleSubmit((d) => createContract.mutate(d))} className="bg-white border rounded-lg p-5 space-y-4">
          <h3 className="font-semibold"><T k="새 단체 계약" /></h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1"><T k="기업명" /> *</label>
              <input {...register('companyName')} className="w-full border rounded-lg px-3 py-2 text-sm" />
              {errors.companyName?.message && <p className="text-xs text-red-500 mt-0.5"><T k={errors.companyName.message} /></p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1"><T k="담당자" /></label>
              <input {...register('contactPerson')} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1"><T k="연락처" /></label>
              <input {...register('contactPhone')} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1"><T k="검진 프로그램" /> *</label>
              <select {...register('programId')} className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">{tAttr('선택')}</option>
                {programs.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} ({formatPrice(p.price)})</option>
                ))}
              </select>
              {errors.programId?.message && <p className="text-xs text-red-500 mt-0.5"><T k={errors.programId.message} /></p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1"><T k="인원" /></label>
              <input type="number" {...register('headcount')} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1"><T k="할인율 (%)" /></label>
              <input type="number" {...register('discountRate')} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1"><T k="계약일" /></label>
              <input type="date" {...register('contractDate')} className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1"><T k="만료일" /></label>
              <input type="date" {...register('expiryDate')} className="w-full border rounded-lg px-3 py-2 text-sm" />
              {errors.expiryDate?.message && <p className="text-xs text-red-500 mt-0.5"><T k={errors.expiryDate.message} /></p>}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={createContract.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
              <T k="등록@버튼" />
            </button>
            <button type="button" onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm">
              <T k="취소" />
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-gray-400"><T k="로딩 중..." /></div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : (
        <div className="space-y-3">
          {contracts.map((c: any) => {
            const visitCount = c._count?.visits ?? 0;
            const pct = c.headcount > 0 ? Math.round((visitCount / c.headcount) * 100) : 0;
            return (
              <div key={c.id} className="bg-white border rounded-lg p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">{c.companyName}</h3>
                    <div className="text-sm text-gray-500">
                      {c.program?.name} | {c.headcount}명 | 할인 {c.discountRate}%
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      계약: {c.contractDate?.slice(0, 10)} ~ {c.expiryDate?.slice(0, 10)}
                      {c.contactPerson && ` | ${c.contactPerson}`}
                      {c.contactPhone && ` ${c.contactPhone}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${
                      c.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>{c.status}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm text-gray-600 whitespace-nowrap">{visitCount}/{c.headcount}<Unit>명</Unit> ({pct}<Unit>%</Unit>)</span>
                  {c.status === 'ACTIVE' && (
                    <button onClick={() => setUploadTarget(c.id)}
                      className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-medium hover:bg-emerald-100 whitespace-nowrap">
                      <T k="엑셀 등록" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {contracts.length === 0 && (
            <EmptyState icon="📋" title="등록된 계약이 없습니다" />
          )}
        </div>
      )}

      {/* 엑셀 업로드 모달 */}
      {uploadTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setUploadTarget(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-bold text-gray-900"><T k="수검자 일괄 등록" /></h3>
              <button onClick={() => setUploadTarget(null)} className="text-gray-400 hover:text-gray-600 text-lg">x</button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500">
                <p className="font-medium text-gray-700 mb-1"><T k="엑셀에서 복사하여 붙여넣기" /></p>
                <p><T k="형식: 이름 [탭] 생년월일 [탭] 성별 [탭] 전화번호 [탭] 예약일" /></p>
                <p className="mt-1">예: 홍길동{'\t'}1985-03-15{'\t'}남{'\t'}010-0000-0000{'\t'}2026-06-15</p>
              </div>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono h-40"
                placeholder={tAttr('엑셀에서 복사한 데이터를 붙여넣으세요...')}
                value={uploadData}
                onChange={(e) => setUploadData(e.target.value)}
              />
              {uploadData && (
                <p className="text-xs text-gray-500">{parseExcelText(uploadData).length}<Unit>명</Unit> <T k="인식됨" /></p>
              )}
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2">
              <button onClick={() => setUploadTarget(null)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm"><T k="취소" /></button>
              <button
                onClick={() => bulkUpload.mutate({ contractId: uploadTarget, rows: parseExcelText(uploadData) })}
                disabled={!uploadData || bulkUpload.isPending}
                className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50">
                <T k={bulkUpload.isPending ? '등록 중...' : '일괄 등록'} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
