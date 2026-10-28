import Link from 'next/link';
import { SITE_INFO, PORTAL_URL } from '@/lib/site-info';
import { getClinicHours } from '@/lib/clinic-hours';
import { ClinicHoursNotice } from './ClinicHoursNotice';

// 의료기관 법정 고지 정보 — ※ 데모용 가상 데이터. 실제 운영 시 법무/원무 확인 값으로 교체(권장: /admin/hospital-info CMS 연동).
const LEGAL_INFO: { label: string; value: string }[] = [
  { label: '의료기관명', value: '위루비병원' },
  { label: '의료기관 종별', value: '종합병원' },
  { label: '개설자(대표자)', value: '김수경' },
  { label: '사업자등록번호', value: '616-85-30024' },
  { label: '요양기관기호', value: '39140382' },
  { label: '개인정보보호책임자', value: '신현묵 (CISO)' },
];

const FOOTER_LINKS = [
  { title: '병원 안내', links: [
    { label: '병원 소개', href: '/about/hospital-overview' },
    { label: '시설 안내', href: '/about/facility' },
    { label: '오시는 길', href: '/about/directions' },
    { label: '채용 안내', href: '/news/recruit' },
  ]},
  { title: '진료 안내', links: [
    { label: '진료과 소개', href: '/care/departments' },
    { label: '의료진 소개', href: '/care/doctors' },
    { label: '진료시간', href: '/care/schedule' },
    { label: '비급여 안내', href: '/care/non-covered' },
    { label: '응급의료 안내', href: '/guide/emergency' },
  ]},
  { title: '환자 서비스', links: [
    { label: '온라인 예약', href: '/booking' },
    { label: '환자 포털', href: PORTAL_URL },
    { label: '건강검진', href: '/checkup' },
    { label: 'FAQ', href: '/support/faq' },
  ]},
];

export async function Footer() {
  // 🔴 W9: 진료시간을 CMS 정본에서 읽는다(코드에 박아 두면 관리 화면에서 바꿔도 반영되지 않는다)
  const hours = await getClinicHours();

  return (
    <footer className="bg-gray-900 text-gray-400 mt-10" role="contentinfo">
      {/*
        병원 소식 안내 배너
        🔴 W9(P16 — 하지 않고 했다고 말하는 것): 여기에 이메일 입력창 + '구독하기' 버튼이 있었는데
           입력값을 읽는 state 도, 제출 핸들러도, 구독 API 도 없었다. 버튼은 /support/voc 로 가는 <Link>라
           방문자가 이메일을 적고 눌러도 값은 그대로 버려졌다("이메일로 전해드립니다"는 지켜지지 않는 약속).
           구독 백엔드가 생기기 전까지 전송을 흉내내지 않는다 — 실제로 동작하는 경로만 남긴다.
      */}
      <div className="bg-gradient-to-r from-teal-700 to-emerald-700">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-white font-bold text-lg">병원 소식을 확인하세요</h3>
            <p className="text-teal-200 text-sm mt-1">공지사항·건강정보·검진 안내를 홈페이지에서 바로 보실 수 있습니다</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Link href="/news" className="flex-1 sm:flex-none px-5 py-2.5 bg-white text-teal-700 text-sm font-bold rounded-xl hover:bg-teal-50 transition whitespace-nowrap text-center">병원 소식 보기</Link>
            <Link href="/support/voc" className="flex-1 sm:flex-none px-5 py-2.5 bg-white/15 border border-white/30 text-white text-sm font-semibold rounded-xl hover:bg-white/25 transition whitespace-nowrap text-center">문의하기</Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* 병원 정보 */}
          <div>
            <div className="flex items-center gap-2.5 mb-5">
              <img src="/images/werubyhosp/logo.svg" alt="Weruby Hospital" className="h-8 w-auto" style={{ filter: 'brightness(0) invert(1)' }} />
            </div>
            <div className="space-y-2.5 text-sm">
              <p className="text-gray-500">{SITE_INFO.address}</p>
              <p className="text-gray-600 text-xs">서울사무소: {SITE_INFO.seoulOffice}</p>
              <p>
                <span className="text-blue-400 font-semibold">대표전화</span>{' '}
                <a href={`tel:${SITE_INFO.phone}`} className="text-white hover:text-blue-300 transition ml-1">{SITE_INFO.phone}</a>
              </p>
              {/* 🔴 W9: SITE_INFO 가 있는데도 여기에 09:00~18:00 을 직접 박아 둬, /care/schedule(CMS 정본)의
                  09:00~17:30 과 같은 페이지 안에서 어긋났다. 이제 CMS 정본에서 읽는다. */}
              {/* 🔴 T6: CMS 를 못 읽으면 코드 상수를 그리지 않고 사실(불러오지 못함·미등록)을 말한다 · 본문에 없는 칸은 생략 */}
              {hours.source === 'cms' ? (
                <div className="pt-3 text-xs text-gray-600 leading-relaxed">
                  평일 {hours.weekday}{hours.saturday && <> | 토 {hours.saturday}</>}<br />
                  {[hours.lunch && `점심 ${hours.lunch}`, hours.closed].filter(Boolean).join(' | ')}
                </div>
              ) : (
                <ClinicHoursNotice hours={hours} phone={SITE_INFO.phone} className="pt-3 text-xs text-gray-500 leading-relaxed" />
              )}
            </div>
          </div>

          {/* 링크 그룹 */}
          {FOOTER_LINKS.map(group => (
            <div key={group.title}>
              <h4 className="text-white font-bold text-sm mb-4">{group.title}</h4>
              <ul className="space-y-2.5">
                {group.links.map(link => (
                  <li key={link.href}>
                    <Link href={link.href} target={link.href.startsWith('http') ? '_blank' : undefined} rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined} className="text-sm text-gray-500 hover:text-white transition">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 의료기관 법정 고지 정보 */}
        <div className="mt-12 pt-8 border-t border-gray-800/80">
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-gray-500">
            {LEGAL_INFO.map((it) => (
              <span key={it.label}><span className="text-gray-600">{it.label}</span> {it.value}</span>
            ))}
            <span><span className="text-gray-600">소재지</span> {SITE_INFO.address}</span>
            <span><span className="text-gray-600">대표전화</span> {SITE_INFO.phone}</span>
          </div>
        </div>

        {/* 하단 */}
        <div className="mt-6 pt-6 border-t border-gray-800/50 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-gray-600 space-y-1">
            <p>&copy; {new Date().getFullYear()} Weruby Hospital. All rights reserved.</p>
            {/*
              🔴 W9(P16 — 하지 않은 일을 했다고 말함): 여기에
                 "의료광고 사전심의를 받았습니다. (심의번호: 제2026-가상-0042호)" 가 하드코딩돼 있었다.
              심의번호의 근거(심의필증)가 저장소·DB 어디에도 없다. 받지 않은 심의를 받았다고 적는 것은
              의료법 제56조 거짓·과장 광고에 해당할 수 있어 문구를 내렸다.
              → 실제 심의를 받으면 법무/홍보 확인 번호로 이 자리에 복원할 것(사람 판단 게이트).
            */}
          </div>
          <div className="flex gap-5 text-xs text-gray-600">
            <Link href="/privacy" className="hover:text-gray-400 transition font-medium">개인정보처리방침</Link>
            <Link href="/terms" className="hover:text-gray-400 transition">이용약관</Link>
            <Link href="/support/voc" className="hover:text-gray-400 transition">고객의 소리</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
