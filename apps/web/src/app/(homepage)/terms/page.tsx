import type { Metadata } from 'next';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

export const metadata: Metadata = { title: '이용약관' };

export default function TermsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-8 py-12 space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">이용약관</h1>

      <div className="prose prose-sm prose-gray max-w-none space-y-6 text-sm leading-relaxed text-gray-700">
        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제1조 (목적)</h2>
          <p>
            이 약관은 위루비병원(이하 &quot;병원&quot;)이 운영하는 홈페이지에서 제공하는
            온라인 서비스(이하 &quot;서비스&quot;)의 이용 조건 및 절차, 병원과 이용자의 권리·의무
            및 책임 사항을 규정함을 목적으로 합니다.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제2조 (정의)</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>&quot;서비스&quot;란 병원 홈페이지를 통해 제공되는 진료 예약, 건강검진 예약, 건강정보 열람, 온라인 상담 등 일체의 서비스를 말합니다.</li>
            <li>&quot;이용자&quot;란 이 약관에 동의하고 서비스를 이용하는 자를 말합니다.</li>
            <li>&quot;회원&quot;이란 병원에 개인정보를 제공하여 회원 등록을 한 이용자를 말합니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제3조 (약관의 효력 및 변경)</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>이 약관은 서비스 화면에 게시하거나 기타의 방법으로 이용자에게 공지함으로써 효력을 발생합니다.</li>
            <li>병원은 합리적인 사유가 발생할 경우 관련 법령에 위배되지 않는 범위에서 약관을 변경할 수 있습니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제4조 (서비스의 제공 및 변경)</h2>
          <p>병원은 다음과 같은 서비스를 제공합니다.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>온라인 진료 예약 및 예약 조회</li>
            <li>건강검진 프로그램 안내 및 예약</li>
            <li>건강정보 및 병원 소식 제공</li>
            <li>온라인 상담 및 고객의 소리</li>
            <li>{AI_ORIGIN_TEXT} 상담 서비스</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제5조 (이용자의 의무)</h2>
          <p>이용자는 다음 행위를 하여서는 안 됩니다.</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>타인의 개인정보를 도용하는 행위</li>
            <li>서비스에서 얻은 정보를 병원의 사전 승낙 없이 복제, 배포하는 행위</li>
            <li>병원 또는 제3자의 저작권 등 지적재산권을 침해하는 행위</li>
            <li>서비스의 안정적 운영을 방해하는 행위</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제6조 (면책 조항)</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>병원은 천재지변 등 불가항력적 사유로 서비스를 제공할 수 없는 경우 책임이 면제됩니다.</li>
            <li>홈페이지를 통해 제공되는 건강정보는 참고용이며, 정확한 진단 및 치료는 반드시 전문 의료진과 상담하시기 바랍니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-bold text-gray-900 mt-8 mb-3">제7조 (분쟁 해결)</h2>
          <p>
            서비스 이용과 관련하여 병원과 이용자 사이에 분쟁이 발생한 경우, 쌍방은 원만한 해결을 위해
            성실히 협의하며, 협의가 이루어지지 않을 경우 관할 법원에 소를 제기할 수 있습니다.
          </p>
        </section>

        <p className="text-xs text-gray-400 mt-8">
          이 약관은 2026년 1월 1일부터 시행합니다.
        </p>
      </div>
    </div>
  );
}
