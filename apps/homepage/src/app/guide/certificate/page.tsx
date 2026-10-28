import Link from 'next/link';
import { SITE_INFO, portalUrl } from '@/lib/site-info';

export const metadata = {
  title: '제증명 발급 안내 | 위루비병원',
  description: '진단서·진료확인서·진료기록 사본 등 제증명 발급 방법(온라인 포털·방문·무인발급기)과 필요 서류·수수료 안내',
};

const DOCS = [
  { name: '진단서 / 소견서', desc: '질병명·치료내용·향후 소견', online: true },
  { name: '진료확인서', desc: '내원·진료 사실 확인', online: true },
  { name: '입·퇴원 확인서', desc: '입원/퇴원 일자 확인', online: true },
  { name: '진료기록 사본', desc: '진료기록·검사결과 사본 (의료법 §21)', online: true },
  { name: '진료비 영수증 / 납입확인서', desc: '연말정산·실손보험 청구용', online: true },
  { name: '제증명 (기타)', desc: '병명·통원 등 각종 증명', online: false },
];

const METHODS = [
  { icon: '💻', title: '온라인(환자 포털)', desc: '환자 포털 로그인 → 서비스 → 서류발급에서 신청·발급내역 확인. 24시간 신청 가능.', cta: { label: '포털에서 신청', href: portalUrl('?tab=services&segment=documents') } },
  { icon: '🏥', title: '원무과 방문', desc: '1층 원무과 제증명 창구에서 신청. 본인 또는 대리인(위임장·신분증 지참).', cta: null },
  { icon: '🖨️', title: '무인 발급기', desc: '로비 무인 발급기에서 본인 인증 후 즉시 출력(일부 서류 한정).', cta: null },
];

export default function CertificateGuidePage() {
  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-8 py-10 lg:py-14">
      <nav className="text-xs text-gray-400 mb-3"><Link href="/home" className="hover:text-gray-600">홈</Link> · <Link href="/guide" className="hover:text-gray-600">이용안내</Link> · <span className="text-gray-600">제증명 발급</span></nav>
      <h1 className="text-3xl lg:text-4xl font-extrabold text-[#0d4f4f] tracking-tight">제증명 발급 안내</h1>
      <p className="text-gray-500 mt-3 text-[15px] leading-relaxed">진단서·진료확인서·진료기록 사본 등 각종 제증명을 온라인(환자 포털)·방문·무인 발급기로 발급받을 수 있습니다.</p>

      {/* 발급 방법 */}
      <section className="mt-10">
        <h2 className="text-xl font-extrabold text-gray-900 mb-4">발급 방법</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {METHODS.map((m) => (
            <div key={m.title} className="rounded-2xl border border-gray-100 shadow-sm p-5 bg-white flex flex-col">
              <div className="text-3xl">{m.icon}</div>
              <h3 className="font-bold text-gray-900 mt-3">{m.title}</h3>
              <p className="text-sm text-gray-500 mt-1.5 leading-relaxed flex-1">{m.desc}</p>
              {m.cta && (
                <Link href={m.cta.href} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700">{m.cta.label} →</Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 발급 가능 서류 */}
      <section className="mt-10">
        <h2 className="text-xl font-extrabold text-gray-900 mb-4">발급 가능 서류</h2>
        <div className="rounded-2xl border border-gray-100 shadow-sm overflow-hidden bg-white">
          {DOCS.map((d, i) => (
            <div key={d.name} className={`flex items-center gap-3 px-5 py-3.5 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
              <div className="flex-1">
                <p className="font-semibold text-gray-900 text-sm">{d.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{d.desc}</p>
              </div>
              {d.online
                ? <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 px-2 py-1 rounded-full whitespace-nowrap">온라인 가능</span>
                : <span className="text-[11px] font-medium text-gray-400 bg-gray-50 px-2 py-1 rounded-full whitespace-nowrap">방문</span>}
            </div>
          ))}
        </div>
      </section>

      {/* 필요 서류 / 안내 */}
      <section className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-gray-100 shadow-sm p-5 bg-white">
          <h3 className="font-bold text-gray-900 mb-2">준비물</h3>
          <ul className="text-sm text-gray-600 space-y-1.5 list-disc pl-5">
            <li>본인: 신분증</li>
            <li>대리인: 위임장 + 환자·대리인 신분증 + 가족관계 증빙</li>
            <li>진료기록 사본은 의료법 §21에 따라 본인·법정대리인 등만 발급</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-gray-100 shadow-sm p-5 bg-white">
          <h3 className="font-bold text-gray-900 mb-2">수수료 · 처리</h3>
          <ul className="text-sm text-gray-600 space-y-1.5 list-disc pl-5">
            <li>서류별 수수료 상이 (창구·포털 결제)</li>
            <li>온라인 신청 후 발급 상태(접수→발급완료)를 포털에서 확인</li>
            <li>문의: 원무과 1층 / 대표전화 {SITE_INFO.phone}</li>
          </ul>
        </div>
      </section>

      {/* CTA */}
      <div className="mt-10 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 p-6 lg:p-8 text-center text-white">
        <h2 className="text-xl lg:text-2xl font-extrabold">지금 온라인으로 제증명을 신청하세요</h2>
        <p className="text-white/85 text-sm mt-2">환자 포털에서 24시간 신청하고 발급 상태를 확인할 수 있습니다.</p>
        <Link href={portalUrl('?tab=services&segment=documents')} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center mt-5 px-6 py-3 rounded-xl bg-white text-teal-700 text-sm font-bold hover:bg-gray-50">포털에서 제증명 신청 →</Link>
      </div>
    </div>
  );
}
