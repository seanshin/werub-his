'use client';

import React from 'react';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

// 외국인 진료 안내 배지 — 환자 API 가 이미 반환하지만 화면에 없던 정보를 식별 영역에 노출.
// (종전에는 /patients/[id]/international 전용 화면에서만 볼 수 있어, 접수·진료 담당자가
//  통역 필요·예치금 필요 여부를 차트에서 확인할 수 없었다.)
//
// 표시 원칙: 해당 값이 있을 때만 배지를 그린다(내국인 차트에는 아무것도 추가되지 않음).

interface Props {
  patient: Record<string, any>;
}

/**
 * 여권 만료까지 남은 일수 — 만료·임박(60일 이내)만 경고.
 * 🔴 라벨을 **문자열로 조립하지 않는다** — `여권 만료 D-{일수}` 는 어순이 언어마다 달라
 *    조각으로 붙이면 영어에서 문장이 깨진다(`<Tf>` 자리표시자로 넘긴다).
 */
function passportAlert(expiry?: string | null): { node: React.ReactNode; tone: 'crit' | 'warn'; key: string } | null {
  if (!expiry) return null;
  const days = Math.floor((new Date(expiry).getTime() - Date.now()) / 86_400_000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return { node: <T k="여권 만료" />, tone: 'crit', key: '여권 만료' };
  if (days <= 60) return { node: <Tf k="여권 만료 D-{일수}" params={{ 일수: days }} />, tone: 'warn', key: '여권 만료 D-{일수}' };
  return null;
}

const TONE: Record<string, string> = {
  crit: 'bg-red-100 text-red-700 border-red-300',
  warn: 'bg-amber-100 text-amber-800 border-amber-300',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
};

export function ForeignCareBadges({ patient }: Props) {
  const tAttr = useTAttr();
  const passport = passportAlert(patient?.passportExpiry);
  const isForeign = Boolean(
    patient?.passportNumber || patient?.visaType || patient?.alienRegistrationNo || patient?.koreanName,
  );

  const badges: Array<{ key: string; label: React.ReactNode; tone: string; title?: string }> = [];

  if (patient?.interpreterNeeded) {
    badges.push({
      key: 'interpreter',
      // 🔴 선호 언어는 **환자 데이터**(서버 값)다 — 번역하지 않고 자리표시자로 끼운다
      label: patient?.preferredLanguage
        ? <>🗣 <Tf k="통역 필요 ({언어})" params={{ 언어: String(patient.preferredLanguage) }} /></>
        : <>🗣 <T k="통역 필요" /></>,
      tone: 'warn',
      title: tAttr('통역이 필요한 환자입니다. 접수·진료·동의 취득 시 통역을 준비하세요.'),
    });
  }
  if (patient?.depositRequired) {
    badges.push({
      key: 'deposit',
      label: <>💳 <T k="예치금 필요" /></>,
      tone: 'warn',
      title: tAttr('진료 전 예치금 수납이 필요한 환자입니다.'),
    });
  }
  if (passport) {
    badges.push({ key: 'passport', label: <>🛂 {passport.node}</>, tone: passport.tone });
  }
  if (isForeign && patient?.visaType) {
    // 비자 종류(D-2·E-7…)는 코드값이라 번역하지 않는다
    badges.push({ key: 'visa', label: <Tf k="비자 {종류}" params={{ 종류: String(patient.visaType) }} />, tone: 'info' });
  }

  if (!badges.length) return null;

  return (
    <>
      {badges.map((b) => (
        <span
          key={b.key}
          title={b.title}
          className={`text-xs font-bold px-2.5 py-0.5 rounded-full border whitespace-nowrap ${TONE[b.tone]}`}
        >
          {b.label}
        </span>
      ))}
    </>
  );
}
