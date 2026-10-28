import { clinicHoursNotice, type ClinicHours } from '@/lib/clinic-hours';

/**
 * 진료시간을 CMS 에서 읽지 못했을 때의 한 줄 — "불러오지 못했습니다" / "등록된 진료시간 없음" + 대표전화.
 * 🔴 (2026-09-15 T6) 종전엔 이 자리에 코드 상수 진료시간이 병원 사실처럼 그려졌다.
 * CMS 에서 읽었으면 아무것도 그리지 않는다(값은 부르는 쪽이 그린다). 연락처는 부르는 쪽 정본에서 받는다.
 * 🔴 `apps/homepage/src/components/homepage/ClinicHoursNotice.tsx` 와 글자 단위로 같아야 한다(가드).
 */
export function ClinicHoursNotice({ hours, phone, className }: { hours: ClinicHours; phone: string; className?: string }) {
  const msg = clinicHoursNotice(hours.source);
  if (!msg) return null;
  return (
    <p className={className} data-clinic-hours-source={hours.source}>
      {msg} · 대표전화{' '}
      <a href={`tel:${phone.replace(/[^0-9+]/g, '')}`} className="underline">{phone}</a>
    </p>
  );
}
