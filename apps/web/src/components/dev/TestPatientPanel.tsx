'use client';

import { TEST_PATIENTS } from '@/lib/test-patients';

/**
 * 시드 환자 자동입력 패널 — **개발/스테이징 전용**.
 *
 * 🔴 부르는 쪽은 반드시 `dev-test-accounts` 의 `TestPatientPanel`(상수 분기 안의 dynamic import)을
 *    쓴다. 화면에서 직접 `@/lib/test-patients` 를 import 하면 운영 번들에 값이 남는다.
 *
 * 직원 계정 패널(`TestAccountPanel`)과 같은 규약이되, 자격의 종류가 다르다
 * (직원 = 이메일+공용 비밀번호 / 환자 = MRN+생년월일).
 */
export default function TestPatientPanel({
  onPick,
  className = '',
}: {
  onPick: (mrn: string, dob: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2 text-center">
        테스트 계정
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {TEST_PATIENTS.map((t) => (
          <button
            key={t.mrn}
            type="button"
            aria-label={`${t.name} 시드 환자로 입력`}
            onClick={() => onPick(t.mrn, t.dob)}
            className="text-left px-2.5 py-2 bg-white border border-gray-100 rounded-lg hover:bg-blue-50 hover:border-blue-200 transition-colors"
          >
            <p className="text-xs font-medium text-gray-700">{t.name}</p>
            <p className="text-[10px] text-gray-400 font-mono">{t.mrn}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
