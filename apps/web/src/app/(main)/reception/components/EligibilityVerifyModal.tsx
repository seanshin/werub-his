'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

export interface VerifyTarget { patientId: string; queueId: string; name: string; visitType?: string }

const COPAY_LABEL: Record<string, string> = {
  NHI: '건강보험', MA_TYPE1: '의료급여 1종', MA_TYPE2: '의료급여 2종', NEAR_POOR: '차상위',
  SPECIAL_EXEMPTION: '산정특례', INDUSTRIAL: '산재', AUTO: '자동차', SELF_PAY: '자비',
};

/** 접수 직후 자격조회 자동 실행 + 본인확인(2024.5 의무화) 기록 모달. WalkIn/Appointment 공용. */
export function EligibilityVerifyModal({ target, onClose }: { target: VerifyTarget; onClose: () => void }) {
  const tAttr = useTAttr();
  const [elig, setElig] = useState<{ status?: string; copayCategory?: string; specialExemption?: string; message?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState<'PASS' | 'FAIL' | null>(null);
  /**
   * 🔴 실제로 대조한 항목만 서버로 보낸다(2026-08-18).
   *    종전엔 FE 가 `verifiedItems` 를 아예 보내지 않았고 서버가 `{name:true, dob:true}` 를
   *    무조건 박아 넣었다 — **아무도 확인하지 않은 두 항목이 확인된 것으로 법정기록에 남았다.**
   *    이제 서버는 항목 없는 기록을 400 으로 거절한다.
   */
  const [items, setItems] = useState<Record<string, boolean>>({ name: false, dob: false });
  const [showFail, setShowFail] = useState(false);
  const [failReason, setFailReason] = useState('');

  useEffect(() => {
    apiClient.post<{ data: typeof elig }>('/api/v1/eligibility/check', {
      patientId: target.patientId, visitType: 'OUTPATIENT', queueId: target.queueId || undefined,
    }).then((r) => setElig(r.data)).catch(() => setElig({ status: 'ERROR' })).finally(() => setLoading(false));
  }, [target.patientId, target.queueId]);

  const checkedCount = Object.values(items).filter(Boolean).length;
  /**
   * 🔴 (2026-09-15) 체크하지 않은 항목을 `false` 로 보냈다 — 서버 정본에서 `false` 는 "대조했는데 불일치"라,
   *    성명만 체크하고 '신분증 확인'을 누르면 **FAIL 로 판정돼 사유 없음 400**("본인확인 기록 실패")이었다.
   *    화면 문구("체크한 항목만 기록됩니다")대로 **체크한 항목만** 보낸다 — 미대조는 키가 없는 것이다.
   */
  const comparedItems = () => Object.fromEntries(Object.entries(items).filter(([, v]) => v === true));

  const verify = (method: string, exceptionReason?: string) => {
    if (checkedCount === 0) { toast.error(tAttr('대조한 항목을 먼저 체크하세요(확인하지 않은 항목은 기록되지 않습니다).')); return; }
    apiClient.post('/api/v1/eligibility/verify-identity', {
      patientId: target.patientId, method, queueId: target.queueId || undefined, exceptionReason,
      verifiedItems: comparedItems(),
    }).then(() => { setVerified('PASS'); toast.success(tAttr('본인확인 기록 완료')); }).catch((e) => toast.error((e as { message?: string })?.message || tAttr('본인확인 기록 실패')));
  };

  /** 🔴 종전엔 **불일치를 기록할 방법 자체가 없었다** — 서버가 무엇을 받든 PASS 였다. */
  const recordFail = () => {
    const reason = failReason.trim();
    if (!reason) { toast.error(tAttr('불일치 내용을 입력하세요.')); return; }
    apiClient.post('/api/v1/eligibility/verify-identity', {
      patientId: target.patientId, method: 'TWO_IDENTIFIER', queueId: target.queueId || undefined,
      result: 'FAIL', failureReason: reason, verifiedItems: comparedItems(),
    }).then(() => { setVerified('FAIL'); toast.success(tAttr('본인확인 불일치가 기록되었습니다.')); })
      .catch((e) => toast.error((e as { message?: string })?.message || tAttr('본인확인 기록 실패')));
  };

  const expired = elig?.status === 'EXPIRED' || elig?.status === 'NOT_FOUND';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-1"><T k="자격조회 · 본인확인" /></h2>
        <p className="text-sm text-gray-500 mb-4"><Tf k="{이름} 환자" params={{ 이름: target.name }} /></p>

        <div className="rounded-xl border p-3 mb-4 text-sm">
          {loading ? <span className="text-gray-400"><T k="자격조회 중..." /></span> : (
            <div className="space-y-1">
              <div className="flex justify-between"><span className="text-gray-500"><T k="자격" /></span>
                <span className={expired ? 'text-red-600 font-bold' : 'text-emerald-700 font-medium'}>
                  <T k={elig?.status === 'VERIFIED' ? '자격확인' : elig?.status === 'EXPIRED' ? '자격상실' : elig?.status === 'NOT_FOUND' ? '미발견' : '오류'} />
                </span></div>
              <div className="flex justify-between"><span className="text-gray-500"><T k="본인부담 구분" /></span>
                <span><T k={COPAY_LABEL[elig?.copayCategory ?? 'NHI'] ?? elig?.copayCategory ?? ''} />{elig?.specialExemption ? ` (${elig.specialExemption})` : ''}</span></div>
              {expired && <p className="text-xs text-red-600 mt-1">⚠️ <T k="전액 본인부담 대상 — 환자 안내 필요" /></p>}
              <p className="text-[11px] text-gray-400">{elig?.message}</p>
            </div>
          )}
        </div>

        <p className="text-sm font-medium text-gray-700 mb-2"><T k="본인확인 (2024.5 의무화)" /></p>
        {verified === 'PASS' ? (
          <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-2 mb-3">✓ <T k="본인확인 기록 완료" /></p>
        ) : verified === 'FAIL' ? (
          <p className="text-sm text-red-700 bg-red-50 rounded-lg p-2 mb-3">✗ <T k="본인확인 불일치로 기록됨 — 진료 전 신원 재확인 필요" /></p>
        ) : (
          <>
            <div className="rounded-lg bg-gray-50 border p-2.5 mb-2">
              <p className="text-[11px] text-gray-500 mb-1.5"><T k="대조한 항목만 체크하세요 (체크한 항목만 기록됩니다)" /></p>
              <div className="flex gap-3">
                {([['name', '성명'], ['dob', '생년월일']] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5 text-sm text-gray-700">
                    <input type="checkbox" checked={!!items[k]} onChange={(e) => setItems((p) => ({ ...p, [k]: e.target.checked }))} />
                    <T k={label} />
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={() => verify('ID_CARD')} className="py-2 rounded-lg border text-sm hover:bg-gray-50"><T k="신분증 확인" /></button>
              <button onClick={() => verify('MOBILE_INSURANCE')} className="py-2 rounded-lg border text-sm hover:bg-gray-50"><T k="모바일 건보증" /></button>
              <button onClick={() => verify('VERBAL_EXCEPTION', '재진·응급 등 예외')} className="py-2 rounded-lg border text-sm hover:bg-gray-50 col-span-2"><T k="구두확인(예외)" /></button>
            </div>
            {showFail ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 mb-3">
                <p className="text-xs text-red-700 mb-1.5"><T k="불일치 내용(무엇이 달랐는지)" /></p>
                <input
                  value={failReason}
                  onChange={(e) => setFailReason(e.target.value)}
                  placeholder={tAttr('예: 제시 신분증의 생년월일이 등록정보와 다름')}
                  className="w-full px-2 py-1.5 rounded border border-red-200 text-sm mb-2"
                />
                <div className="flex gap-2">
                  <button onClick={recordFail} className="flex-1 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold"><T k="불일치 기록" /></button>
                  <button onClick={() => setShowFail(false)} className="px-3 py-1.5 rounded-lg border text-sm"><T k="취소" /></button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowFail(true)} className="w-full py-2 mb-3 rounded-lg border border-red-200 text-red-700 text-sm hover:bg-red-50">
                <T k="신원 불일치 기록(확인 실패)" />
              </button>
            )}
          </>
        )}
        <button onClick={onClose} className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><T k="완료@버튼" /></button>
      </div>
    </div>
  );
}
