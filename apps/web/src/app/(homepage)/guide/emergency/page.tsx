import Link from 'next/link';

export const metadata = {
  title: '응급의료 안내 | 위루비병원',
  description: '24시간 응급실 운영, 응급의료 연락처, 중증응급질환 안내, 응급의료비 대지급 제도 안내 (응급의료에 관한 법률)',
};

const CONTACTS = [
  { label: '응급의료정보센터', value: '1339', tel: '1339' },
  { label: '응급실 직통', value: '02-000-0119', tel: '02-000-0119' },
  { label: '대표전화', value: '02-000-0000', tel: '02-000-0000' },
];

const SEVERE = ['급성 심근경색(가슴통증)', '뇌졸중(편마비·언어장애)', '중증 외상·다발성 손상', '호흡곤란·의식저하', '대량 출혈', '아나필락시스(중증 알레르기)'];

export default function EmergencyGuidePage() {
  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-8 py-10 lg:py-14">
      <nav className="text-xs text-gray-400 mb-3"><Link href="/home" className="hover:text-gray-600">홈</Link> · <Link href="/guide" className="hover:text-gray-600">이용안내</Link> · <span className="text-gray-600">응급의료 안내</span></nav>
      <h1 className="text-3xl lg:text-4xl font-extrabold text-[#0d4f4f] tracking-tight">응급의료 안내</h1>
      <p className="text-gray-500 mt-3 text-[15px] leading-relaxed">본원 응급실은 <b className="text-gray-700">연중무휴 24시간</b> 운영되며, 응급의료에 관한 법률에 따라 응급환자에게 신속한 진료를 제공합니다.</p>

      {/* 긴급 연락처 */}
      <section className="mt-8 rounded-2xl bg-red-50 border border-red-100 p-5 lg:p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">🚑</span>
          <h2 className="text-lg font-extrabold text-red-700">응급 연락처</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {CONTACTS.map((c) => (
            <a key={c.label} href={`tel:${c.tel}`} className="rounded-xl bg-white border border-red-100 p-4 text-center hover:shadow-sm">
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className="text-xl font-extrabold text-red-600 mt-1">{c.value}</p>
            </a>
          ))}
        </div>
        <p className="text-xs text-red-500/80 mt-3">생명이 위급한 경우 즉시 <b>119</b> 신고 또는 가까운 응급실로 내원하세요.</p>
      </section>

      {/* 운영 안내 */}
      <section className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-gray-100 shadow-sm p-5 bg-white">
          <h3 className="font-bold text-gray-900 mb-2">운영 안내</h3>
          <ul className="text-sm text-gray-600 space-y-1.5 list-disc pl-5">
            <li>응급실 24시간 365일 운영</li>
            <li>응급의학 전문의·간호 인력 상주</li>
            <li>중증도 분류(KTAS)에 따라 진료 순서 결정 — 도착 순서와 다를 수 있음</li>
            <li>응급 검사·영상·수술 즉시 연계</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-gray-100 shadow-sm p-5 bg-white">
          <h3 className="font-bold text-gray-900 mb-2">내원 방법</h3>
          <ul className="text-sm text-gray-600 space-y-1.5 list-disc pl-5">
            <li>119 구급차 이송 또는 직접 내원</li>
            <li>응급실 전용 출입구·주차 이용</li>
            <li>복용 약물·기저질환 정보 지참 시 진료에 도움</li>
            <li>비응급 환자는 정규 외래 진료 권장 (<Link href="/care/schedule" className="text-teal-600 underline">진료시간</Link>)</li>
          </ul>
        </div>
      </section>

      {/* 중증응급질환 */}
      <section className="mt-8">
        <h2 className="text-lg font-extrabold text-gray-900 mb-3">즉시 내원이 필요한 중증 응급 증상</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {SEVERE.map((s) => (
            <div key={s} className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-sm text-gray-700">⚠️ {s}</div>
          ))}
        </div>
      </section>

      {/* 응급의료비 대지급 */}
      <section className="mt-8 rounded-2xl border border-gray-100 shadow-sm p-5 bg-white">
        <h3 className="font-bold text-gray-900 mb-2">응급의료비 대지급(대불) 제도</h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          응급의료에 관한 법률에 따라, 응급환자가 진료비를 즉시 지불하기 어려운 경우 <b>응급의료비 대지급 제도</b>를 이용할 수 있습니다.
          본인 부담 응급의료비를 국가가 대신 지급하고 추후 상환합니다. 신청·문의: 건강보험심사평가원 <a href="tel:1644-2367" className="text-teal-600 underline">1644-2367</a>, 원무과.
        </p>
      </section>

      <p className="text-[11px] text-gray-400 mt-8">※ 본 안내는 응급의료에 관한 법률 및 관계 법령에 따른 공지입니다.</p>
    </div>
  );
}
