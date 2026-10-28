import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '보험·비용 안내 | 국제진료 | 위루비병원',
  description: '해외 환자 비용 안내, 여행자 보험, 결제 방법, 예치금',
};

const COST_GUIDE = [
  { category: '외래 진료', range: '₩50,000 ~ ₩200,000', note: '진료과별 상이' },
  { category: '건강검진 (기본)', range: '₩300,000 ~ ₩500,000', note: '1일 코스' },
  { category: '건강검진 (정밀)', range: '₩800,000 ~ ₩2,000,000', note: '2일 코스, MRI/PET 포함' },
  { category: '입원 (1일)', range: '₩200,000 ~ ₩500,000', note: '병실 등급별' },
  { category: '응급 진료', range: '₩100,000 ~', note: '처치 내용별 상이' },
  { category: '원격 진료', range: '₩80,000 ~ ₩150,000', note: '화상 상담 기준' },
];

const PAYMENT_METHODS = [
  { method: '신용카드', icons: 'Visa, Mastercard, JCB, UnionPay, AMEX', note: '해외 카드 가능' },
  { method: '은행 송금', icons: 'SWIFT / T/T', note: '사전 예치금 송금' },
  { method: '현금', icons: 'KRW, USD, JPY, CNY', note: '원화 환전 가능' },
  { method: '여행자 보험', icons: 'Example A, Example B, Example C', note: '보험 직접 청구 또는 서류 발급' },
  { method: '대사관 보증', icons: 'Embassy Letter of Guarantee', note: '사전 조율 필요' },
];

export default function InsurancePage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-16">
      <div className="mb-4">
        <Link href="/international" className="text-sm text-blue-600 hover:underline">← International Healthcare</Link>
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">보험·비용 안내</h1>
      <p className="text-gray-500 mb-10">Insurance & Cost Information</p>

      {/* 보험 유형 */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-gray-900 mb-4">보험 유형별 안내</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-blue-50 rounded-2xl border border-blue-200 p-5">
            <h3 className="font-bold text-blue-800 mb-2">🇰🇷 국민건강보험 (NHI)</h3>
            <p className="text-sm text-blue-700">한국 거주 외국인(외국인등록증 소지자)은 국민건강보험 적용이 가능합니다.</p>
            <ul className="text-xs text-blue-600 mt-2 space-y-1">
              <li>• 본인부담률: 30% (일반), 0% (의료급여)</li>
              <li>• 건강보험증 또는 외국인등록증 지참</li>
            </ul>
          </div>
          <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5">
            <h3 className="font-bold text-amber-800 mb-2">✈️ 여행자 보험</h3>
            <p className="text-sm text-amber-700">여행자 보험 가입 환자는 보험사에 직접 청구하거나, 병원에서 서류를 발급합니다.</p>
            <ul className="text-xs text-amber-600 mt-2 space-y-1">
              <li>• 보험증권 + 여권 지참</li>
              <li>• 영문 진단서·영수증 발급 가능</li>
              <li>• 우선 자비 결제 → 보험사 환급</li>
            </ul>
          </div>
          <div className="bg-gray-50 rounded-2xl border border-gray-200 p-5">
            <h3 className="font-bold text-gray-800 mb-2">💰 자비 (Self-Pay)</h3>
            <p className="text-sm text-gray-700">보험 미가입 환자는 전액 자비로 진료 가능합니다.</p>
            <ul className="text-xs text-gray-600 mt-2 space-y-1">
              <li>• 입원 시 예치금 필요 (₩500,000~)</li>
              <li>• 퇴원 시 정산</li>
              <li>• 다국어 영수증 발급</li>
            </ul>
          </div>
          <div className="bg-violet-50 rounded-2xl border border-violet-200 p-5">
            <h3 className="font-bold text-violet-800 mb-2">🏛️ 대사관 보증</h3>
            <p className="text-sm text-violet-700">대사관 보증서(Letter of Guarantee)로 진료비를 보증받을 수 있습니다.</p>
            <ul className="text-xs text-violet-600 mt-2 space-y-1">
              <li>• 사전 대사관 조율 필요</li>
              <li>• 보증서 원본 지참</li>
            </ul>
          </div>
        </div>
      </section>

      {/* 비용 안내 */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-gray-900 mb-4">진료비 참고 (비보험 기준)</h2>
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-5 py-3 text-left font-medium text-gray-500">항목</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">비용 범위</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">비고</th>
              </tr>
            </thead>
            <tbody>
              {COST_GUIDE.map(c => (
                <tr key={c.category} className="border-b border-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">{c.category}</td>
                  <td className="px-5 py-3 text-blue-600 font-semibold">{c.range}</td>
                  <td className="px-5 py-3 text-gray-400 text-xs">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-2">* 실제 비용은 진료 내용에 따라 달라질 수 있습니다. 정확한 견적은 국제진료센터로 문의하세요.</p>
      </section>

      {/* 결제 방법 */}
      <section className="mb-12">
        <h2 className="text-xl font-bold text-gray-900 mb-4">결제 방법</h2>
        <div className="space-y-3">
          {PAYMENT_METHODS.map(p => (
            <div key={p.method} className="bg-white rounded-xl border p-4 flex items-center justify-between">
              <div>
                <span className="font-semibold text-gray-900">{p.method}</span>
                <span className="ml-3 text-xs text-gray-400">{p.icons}</span>
              </div>
              <span className="text-xs text-gray-500">{p.note}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 서류 발급 */}
      <section className="bg-emerald-50 rounded-2xl p-8 mb-12">
        <h2 className="text-xl font-bold text-gray-900 mb-4">영문 서류 발급</h2>
        <div className="grid grid-cols-3 gap-4">
          {['영문 진단서', '영문 영수증', '영문 검사결과지', '여행자보험 청구서', '진료확인서 (영문)', '처방전 (영문)'].map(doc => (
            <div key={doc} className="bg-white rounded-xl p-3 text-center text-sm font-medium text-gray-700 border">{doc}</div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">* 원무과 또는 국제진료센터에서 발급 가능. 발급 수수료 별도.</p>
      </section>

      {/* Contact */}
      <div className="text-center">
        <p className="text-sm text-gray-500">비용 견적 및 보험 관련 문의</p>
        <p className="font-bold text-lg mt-1">+82-2-000-0000 | international@hospital.example.org</p>
      </div>
    </div>
  );
}
