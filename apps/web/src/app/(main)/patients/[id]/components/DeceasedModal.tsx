'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMarkDeceased } from '@/hooks/usePatients';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';

const deceasedSchema = z.object({
  deathDate: z.string().min(1, '사망일시를 입력해주세요'),
  deathLocation: z.enum(['HOSPITAL', 'ER', 'OR', 'ICU', 'OTHER']),
  deathType: z.enum(['NATURAL', 'EXTERNAL', 'OTHER']),
  causeA: z.string().min(1, '직접 사인을 입력해주세요'),
  causeB: z.string().optional(),
  causeC: z.string().optional(),
  causeD: z.string().optional(),
  stopPrescriptions: z.boolean(),
  cancelAppointments: z.boolean(),
  dischargeIfAdmitted: z.boolean(),
  guardianNotified: z.boolean(),
});
type DeceasedForm = z.infer<typeof deceasedSchema>;

interface DeceasedModalProps {
  patientId: string;
  patientName: string;
  onClose: () => void;
}

export function DeceasedModal({ patientId, patientName, onClose }: DeceasedModalProps) {
  const tAttr = useTAttr();
  const markDeceasedMut = useMarkDeceased();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<DeceasedForm>({
    resolver: zodResolver(deceasedSchema),
    defaultValues: {
      deathDate: new Date().toISOString().slice(0, 16),
      deathLocation: 'HOSPITAL',
      deathType: 'NATURAL',
      causeA: '',
      causeB: '',
      causeC: '',
      causeD: '',
      stopPrescriptions: true,
      cancelAppointments: true,
      dischargeIfAdmitted: true,
      guardianNotified: false,
    },
  });

  const onSubmit = async (data: DeceasedForm) => {
    if (!confirm(`${patientName} 환자를 사망 처리하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.\n진행 중인 처방/예약이 자동으로 중단됩니다.`)) return;

    try {
      await markDeceasedMut.mutateAsync({
        patientId,
        data: {
          deathDate: new Date(data.deathDate).toISOString(),
          deathCause: data.causeA,
          deathLocation: data.deathLocation,
          deathType: data.deathType,
          causeChain: { a: data.causeA, b: data.causeB || undefined, c: data.causeC || undefined, d: data.causeD || undefined },
          stopPrescriptions: data.stopPrescriptions,
          cancelAppointments: data.cancelAppointments,
          dischargeIfAdmitted: data.dischargeIfAdmitted,
        },
      });
      toast.success('사망 처리가 완료되었습니다.');
      onClose();
    } catch {
      toast.error('사망 처리에 실패했습니다.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900"><T k="사망 처리" /></h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
            {patientName} 환자의 사망을 기록합니다.
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Step 1: 사망 정보 */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-gray-500 uppercase"><T k="Step 1. 사망 정보" /></h4>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="사망일시 *" /></label>
                <input type="datetime-local" {...register('deathDate')}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-200 focus:border-red-300" />
                {errors.deathDate && <p className="text-xs text-red-500 mt-1">{errors.deathDate.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1"><T k="사망 장소" /></label>
                  <select {...register('deathLocation')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                    <option value="HOSPITAL"><T k="병실" /></option>
                    <option value="ER"><T k="응급실" /></option>
                    <option value="OR"><T k="수술실" /></option>
                    <option value="ICU"><T k="중환자실" /></option>
                    <option value="OTHER"><T k="기타" /></option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1"><T k="사망 종류" /></label>
                  <select {...register('deathType')} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
                    <option value="NATURAL"><T k="병사" /></option>
                    <option value="EXTERNAL"><T k="외인사" /></option>
                    <option value="OTHER"><T k="기타" /></option>
                  </select>
                </div>
              </div>
            </div>

            {/* Step 2: 사인 체인 */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-gray-500 uppercase"><T k="Step 2. 사인 (사망진단서)" /></h4>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="(가) 직접 사인 *" /></label>
                <input type="text" {...register('causeA')} placeholder={tAttr("예: 급성 심근경색증")}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
                {errors.causeA && <p className="text-xs text-red-500 mt-1">{errors.causeA.message}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="(나) (가)의 원인" /></label>
                <input type="text" {...register('causeB')} placeholder={tAttr("예: 관상동맥 폐쇄")}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="(다) (나)의 원인" /></label>
                <input type="text" {...register('causeC')} placeholder={tAttr("예: 동맥경화증")}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1"><T k="(라) (다)의 원인" /></label>
                <input type="text" {...register('causeD')} placeholder={tAttr("예: 고혈압, 당뇨")}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              </div>
            </div>

            {/* Step 3: 체크리스트 */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-gray-500 uppercase"><T k="Step 3. 후속 처리" /></h4>
              <div className="space-y-1.5 bg-gray-50 rounded-lg p-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" {...register('stopPrescriptions')} className="rounded text-red-600" />
                  <span><T k="진행 중 처방 전체 중단" /></span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" {...register('cancelAppointments')} className="rounded text-red-600" />
                  <span><T k="예약 일괄 취소" /></span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" {...register('dischargeIfAdmitted')} className="rounded text-red-600" />
                  <span><T k="입원 중이면 퇴원 처리" /></span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" {...register('guardianNotified')} className="rounded text-red-600" />
                  <span><T k="보호자 통보 확인" /></span>
                </label>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-[11px] text-red-600">
              <T k="사망 처리 후 의무기록이 봉인됩니다. 이 작업은 되돌릴 수 없습니다." />
            </div>

            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={markDeceasedMut.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:opacity-50">
                {markDeceasedMut.isPending ? '처리 중...' : '사망 처리 확정'}
              </button>
              <button type="button" onClick={onClose}
                className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-700 hover:bg-gray-50">
                <T k="취소" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
