'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { useIdentifyPatient } from '@/hooks/usePatients';
import { toast } from '@/stores/toast-store';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useAuthStore } from '@/stores/auth-store';
import { ArrivalNoteBody, useArrivalNotes } from './ArrivalNotesPanel';

/**
 * 🔴 미확인(응급) 환자 신원 확인 — 임시ID → 실명 전환 (환자관리 A3 · 2026-08-31).
 *
 * 종전엔 응급 등록 화면이 "상세에서 '신원 확인' 버튼으로 갱신하세요"라 안내했으나 그 버튼·흐름이
 * **어디에도 없었다**(백엔드 EP `PATCH .../identify` 는 있는데 부르는 화면이 없던 미배선).
 * 신원 전환은 법적 식별정보를 쓰는 고위험 변이라 **사유 필수**(감사 원장에 남는다).
 * 이미 등록된 동일인이 의심되면 **병합**이 맞으므로, 그 경로(환자 목록 병합)를 함께 안내한다.
 */
const schema = z.object({
  familyName: z.string().min(1, '성을 입력하세요'),
  givenName: z.string().min(1, '이름을 입력하세요'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식'),
  // 🔴 초기값 '남'으로 시작하던 것을 미선택으로(쓰기 폼은 정상값으로 시작하지 않는다) — 고르지 않으면 제출되지 않는다
  gender: z.enum(['MALE', 'FEMALE'], { errorMap: () => ({ message: '성별을 선택하세요' }) }),
  phone: z.string().optional(),
  nationalId: z.string().optional(),
  reason: z.string().min(1, '신원 확인 사유를 입력하세요'),
});
type Form = z.infer<typeof schema>;

interface Props {
  patientId: string;
  currentName?: string;
  onClose: () => void;
}

export function IdentifyPatientModal({ patientId, currentName, onClose }: Props) {
  const tAttr = useTAttr();
  const mut = useIdentifyPatient();
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
  });
  // 신원 단서 — 도착 상황 기록(소지품·신체 특징·동행인·경찰) · 조회 권한이 있는 역할만
  const role = useAuthStore((s) => s.user?.role);
  const notesQ = useArrivalNotes(patientId, role === 'NURSE' || role === 'DOCTOR' || role === 'ADMIN');
  const clues = (notesQ.data?.data.notes ?? []).filter((n) => n.identifyingFeatures || n.belongings?.length || n.companionName || n.policeCaseNo || n.foundLocation);

  const onSubmit = (data: Form) => {
    mut.mutate(
      { patientId, data: { ...data, patientSource: 'DOMESTIC' } },
      {
        onSuccess: () => { toast.success('신원 확인 완료 — 정식 환자로 전환됨'); onClose(); },
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : '신원 확인 실패'),
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900"><T k="신원 확인 (임시 → 정식)" /></h2>
        <p className="mt-1 text-sm text-gray-500">
          응급 미확인으로 등록된 <span className="font-medium">{currentName ?? '이 환자'}</span> 의 실명을 확정합니다.
        </p>

        {/* 🔴 이미 등록된 동일인이면 병합이 맞다 — 지어내지 않고 사람이 판단하도록 안내 */}
        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
          이미 등록된 환자와 동일인이라면 <b>새로 실명을 입력하지 말고</b>{' '}
          <Link href="/patients" className="underline font-medium">환자 목록에서 병합</Link>하세요(중복 생성 방지).
        </div>

        {clues.length > 0 && (
          <details className="mt-3 rounded-lg border border-rose-200 bg-rose-50/40 p-3 text-xs" open>
            <summary className="cursor-pointer font-semibold text-rose-800"><T k="신원 단서 — 도착 상황 기록에서" /></summary>
            <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
              {clues.map((n) => <ArrivalNoteBody key={n.id} n={n} />)}
            </div>
          </details>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600"><T k="성 *" /></label>
              <input {...register('familyName')} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              {errors.familyName && <p className="text-xs text-red-600 mt-0.5">{errors.familyName.message}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600"><T k="이름 *" /></label>
              <input {...register('givenName')} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              {errors.givenName && <p className="text-xs text-red-600 mt-0.5">{errors.givenName.message}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600"><T k="생년월일 *" /></label>
              <input type="date" {...register('dateOfBirth')} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              {errors.dateOfBirth && <p className="text-xs text-red-600 mt-0.5">{errors.dateOfBirth.message}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600"><T k="성별 *" /></label>
              <select {...register('gender')} defaultValue="" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                <option value="" disabled>{tAttr('선택')}</option>
                <option value="MALE"><T k="남" /></option>
                <option value="FEMALE"><T k="여" /></option>
              </select>
              {errors.gender && <p className="text-xs text-red-600 mt-0.5">{errors.gender.message}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600"><T k="전화" /></label>
              <input {...register('phone')} placeholder="010-1234-5678" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600"><T k="주민등록번호" /></label>
              <input {...register('nationalId')} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600"><T k="신원 확인 사유 *" /> <span className="text-gray-400"><T k="(감사 기록)" /></span></label>
            <input {...register('reason')} placeholder={tAttr("예: 보호자 도착·신분증 확인")} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            {errors.reason && <p className="text-xs text-red-600 mt-0.5">{errors.reason.message}</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"><T k="취소" /></button>
            <button type="submit" disabled={mut.isPending} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {mut.isPending ? '전환 중…' : '신원 확정'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
