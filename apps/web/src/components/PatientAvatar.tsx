'use client';

import { getPatientAvatar } from '@/lib/patient-avatar';

interface Props {
  gender?: string;
  dateOfBirth?: string;
  photoUrl?: string | null;
  familyName?: string;
  givenName?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = {
  sm: 'w-8 h-8',
  md: 'w-12 h-12',
  lg: 'w-16 h-16',
};

export function PatientAvatar({ gender, dateOfBirth, photoUrl, familyName, givenName, size = 'md', className = '' }: Props) {
  const sizeClass = SIZE_MAP[size];
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
  const src = photoUrl ? `${apiUrl}${photoUrl}` : getPatientAvatar(gender, dateOfBirth);

  return (
    <img
      src={src}
      alt={`${familyName ?? ''}${givenName ?? ''}`}
      className={`${sizeClass} rounded-full object-cover bg-blue-50 flex-shrink-0 ${className}`}
      onError={(e) => {
        // 이미지 로드 실패 시 기본 아바타로 대체
        (e.target as HTMLImageElement).src = getPatientAvatar(gender, dateOfBirth);
      }}
    />
  );
}
