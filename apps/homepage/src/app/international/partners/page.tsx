import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '해외 파트너 | 국제진료 | 위루비병원',
  description: '협력 병원, 해외 보험사, 의료 관광 에이전시 네트워크',
};

const PARTNER_HOSPITALS = [
  { name: 'Example University Hospital A', country: '🇰🇷', city: 'Seoul', type: '상급 전원', specialties: ['종합진료', '암센터', '심장센터'] },
  { name: 'Example University Hospital B', country: '🇰🇷', city: 'Seoul', type: '상급 전원', specialties: ['종합진료', '로봇수술', '이식'] },
  { name: 'Example Medical University (JP)', country: '🇯🇵', city: 'Tokyo', type: '교류 협력', specialties: ['내과', '외과'] },
  { name: 'Example Medical College (CN)', country: '🇨🇳', city: 'Beijing', type: '교류 협력', specialties: ['내과', '검진'] },
  { name: 'Example Clinic (US)', country: '🇺🇸', city: 'Rochester, MN', type: '2차 소견', specialties: ['종합진료', '희귀질환'] },
  { name: 'Example Hospital (US)', country: '🇺🇸', city: 'New York', type: '2차 소견', specialties: ['심장', '신경'] },
];

const INSURANCE_PARTNERS = [
  { name: 'Example Travel Insurance', country: '🌍', type: '여행자보험', coverage: '입원/외래/응급' },
  { name: 'Example Global Assistance', country: '🌍', type: '여행자보험', coverage: '입원/외래/송환' },
  { name: 'Example Marine Insurance', country: '🇯🇵', type: '해외의료보험', coverage: '입원/외래' },
  { name: 'Example Health Insurance (CN)', country: '🇨🇳', type: '해외의료보험', coverage: '입원/외래/검진' },
  { name: 'NHIS (건강보험공단)', country: '🇰🇷', type: '국민건강보험', coverage: '외국인거주자' },
];

const AGENCIES = [
  { name: 'Example Medical Tourism', region: '글로벌', services: '예약 대행, 통역, 숙소, 공항 픽업' },
  { name: 'Example Medical Tour', region: '가상', services: '검진 패키지, 관광 연계, 차량 서비스' },
  { name: 'Example Asia Medical Travel', region: '아시아', services: '중국/일본 환자 전문, 비자 지원' },
];

export default function PartnersPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-16">
      <div className="mb-4">
        <Link href="/international" className="text-sm text-blue-600 hover:underline">← International Healthcare</Link>
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">해외 파트너 네트워크</h1>
      <p className="text-gray-500 mb-10">Global Partner Network</p>

      {/* Partner Hospitals */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-gray-900 mb-4">🏥 협력 병원</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {PARTNER_HOSPITALS.map(h => (
            <div key={h.name} className="bg-white rounded-2xl border shadow-sm p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{h.country}</span>
                <span className="text-xs text-gray-400">{h.city}</span>
              </div>
              <h3 className="font-semibold text-gray-900 text-sm mb-1">{h.name}</h3>
              <span className="inline-block text-[10px] px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-semibold mb-2">{h.type}</span>
              <div className="flex flex-wrap gap-1">
                {h.specialties.map(s => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{s}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Insurance Partners */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-gray-900 mb-4">💳 보험사 파트너</h2>
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-5 py-3 text-left font-medium text-gray-500">보험사</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">국가</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">유형</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">보장 범위</th>
              </tr>
            </thead>
            <tbody>
              {INSURANCE_PARTNERS.map(p => (
                <tr key={p.name} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-5 py-3 font-medium text-gray-900">{p.name}</td>
                  <td className="px-5 py-3">{p.country}</td>
                  <td className="px-5 py-3"><span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-semibold">{p.type}</span></td>
                  <td className="px-5 py-3 text-gray-500">{p.coverage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Agencies */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-gray-900 mb-4">🌐 의료 관광 에이전시</h2>
        <div className="grid grid-cols-3 gap-4">
          {AGENCIES.map(a => (
            <div key={a.name} className="bg-white rounded-2xl border shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 text-sm mb-1">{a.name}</h3>
              <span className="text-[10px] text-gray-400">{a.region}</span>
              <p className="text-xs text-gray-500 mt-2">{a.services}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <div className="bg-blue-50 rounded-2xl p-8 text-center">
        <h3 className="text-lg font-bold text-gray-900 mb-2">파트너십 문의</h3>
        <p className="text-sm text-gray-500 mb-4">병원, 보험사, 에이전시 파트너십에 관심이 있으시면 연락 주세요.</p>
        <div className="text-sm"><strong>Email:</strong> partnership@hospital.example.org | <strong>Tel:</strong> +82-2-000-0000</div>
      </div>
    </div>
  );
}
