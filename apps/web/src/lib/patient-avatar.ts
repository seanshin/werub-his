/**
 * 환자 아바타 매핑 — 성별 + 생년월일 기반 적절한 아바타 선택
 */

const AVATARS = {
  'm-20': '/images/avatars/patient-m-20.png',
  'm-40': '/images/avatars/patient-m-40.png',
  'm-60': '/images/avatars/patient-m-60.png',
  'm-70': '/images/avatars/patient-m-70.png',
  'f-20': '/images/avatars/patient-f-20.png',
  'f-30': '/images/avatars/patient-f-30.png',
  'f-50': '/images/avatars/patient-f-50.png',
  'f-60': '/images/avatars/patient-f-60.png',
  'child-m': '/images/avatars/patient-child-m.png',
  'child-f': '/images/avatars/patient-child-f.png',
};

export function getPatientAvatar(gender?: string, dateOfBirth?: string): string {
  if (!gender || !dateOfBirth) return AVATARS['m-40'];

  const birthYear = new Date(dateOfBirth).getFullYear();
  const age = new Date().getFullYear() - birthYear;
  const isMale = gender === 'MALE' || gender === 'M';

  if (age < 10) return isMale ? AVATARS['child-m'] : AVATARS['child-f'];
  if (age < 30) return isMale ? AVATARS['m-20'] : AVATARS['f-20'];
  if (age < 45) return isMale ? AVATARS['m-40'] : AVATARS['f-30'];
  if (age < 60) return isMale ? AVATARS['m-60'] : AVATARS['f-50'];
  if (age < 75) return isMale ? AVATARS['m-60'] : AVATARS['f-60'];
  return isMale ? AVATARS['m-70'] : AVATARS['f-60'];
}
