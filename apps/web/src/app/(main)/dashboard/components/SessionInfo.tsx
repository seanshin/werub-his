'use client';

import { InfoRow } from './shared';
import { useAuthStore } from '@/stores/auth-store';
import { USER_ROLE_LABEL, HIS_VERSION } from '@hospital-run/shared';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface SessionUser {
  familyName?: string;
  givenName?: string;
  email?: string;
  role?: string;
}

interface HrProfile {
  department?: string;
  position?: string;
  employeeNumber?: string;
  licenseNumber?: string;
  specialty?: string;
}

interface ScheduleItem {
  clinicRoom?: { name?: string };
  roomName?: string;
}

interface SessionInfoProps {
  user?: SessionUser | null;
  hrProfile?: HrProfile | null;
  mySchedules?: ScheduleItem[];
}

// 🔴 위젯 레지스트리는 settings/role 만 넘긴다 — 필수 props 를 요구하면 모든 역할에서
//    이름·이메일 공백, 직책 '-' 의 빈 카드가 된다(2026-08-13 W3). 스토어에서 자립 취득.
export default function SessionInfo({ user: userProp, hrProfile = null, mySchedules = [] }: SessionInfoProps) {
  const tt = useTAttr();
  const storeUser = useAuthStore((st) => st.user);
  const user: SessionUser | null = userProp ?? (storeUser as SessionUser | null);
  return (
    <div>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <span className="text-sm font-bold text-blue-700">{user?.familyName?.charAt(0)}</span>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{user?.familyName}{user?.givenName}</p>
            <p className="text-xs text-gray-500">{user?.email}</p>
          </div>
        </div>
        <div className="space-y-2 pt-3 border-t border-gray-100">
          {/* 라벨 정본 = shared USER_ROLE_LABEL(15종) — 로컬 5종 재정의는 신설 역할에서 드리프트(P12) */}
          <InfoRow label="직책" value={tt(USER_ROLE_LABEL[user?.role ?? ''] ?? user?.role ?? '-')} />
          {hrProfile?.department && <InfoRow label="부서" value={hrProfile.department} />}
          {hrProfile?.position && <InfoRow label="직위" value={hrProfile.position} />}
          {hrProfile?.employeeNumber && <InfoRow label="사번" value={hrProfile.employeeNumber} />}
          {hrProfile?.licenseNumber && user?.role === 'DOCTOR' && (
            <InfoRow label="면허번호" value={hrProfile.licenseNumber} />
          )}
          {hrProfile?.specialty && user?.role === 'DOCTOR' && (
            <InfoRow label="전문분야" value={hrProfile.specialty} />
          )}
        </div>
        {user?.role === 'DOCTOR' && mySchedules.length > 0 && (
          <div className="pt-3 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-700 mb-1"><T k="오늘 진료실" /></p>
            <p className="text-sm font-semibold text-blue-700">
              {mySchedules[0]?.clinicRoom?.name ?? mySchedules[0]?.roomName ?? '-'}
            </p>
          </div>
        )}
        <div className="space-y-2 pt-3 border-t border-gray-100">
          {/* 🔴 (2026-10-02) 기관명을 상수로 박지 않는다 — 기관 정체성 정본은 설정(hospital.*)이다. 여기서는 버전만 */}
          <InfoRow label="시스템" value={`HIS ${HIS_VERSION}`} />
          <InfoRow label="표준" value="FHIR R4 · KCD-8" />
        </div>
        {/* 🔴 종전 "시스템 정상 운영 중"(초록 점멸)은 아무것도 확인하지 않는 상수였다(P17 — 근거 없는 안심).
            실제 상태는 '시스템 상태' 위젯(system-health)이 API·DB·Redis 를 재서 말한다. */}
      </div>
    </div>
  );
}
