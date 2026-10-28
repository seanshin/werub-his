import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '전자문서 보안 · 위변조 방지',
  description: '전자동의서·전자서명의 위변조 방지·부인방지 — 인증서와 블록체인(해시체인+시점앵커)의 4중 보안 계층',
};

function Icon({ d, className = 'w-6 h-6' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ICON = {
  shield: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  badge: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  lock: 'M16.5 10.5V6.75a4.5 4.5 0 00-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
  link: 'M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244',
  clock: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  doc: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  check: 'M4.5 12.75l6 6 9-13.5',
};

const LAYERS = [
  { icon: ICON.badge, title: '① 인증서 (누가)', desc: '서명자의 신원과 서명 키를 신뢰된 기관(HSM 기반 인증기관)이 보증합니다. 누가 서명했는지 위조할 수 없습니다.' },
  { icon: ICON.lock, title: '② 전자서명 (문서 그 자체)', desc: '서명은 문서의 지문(해시)에 묶입니다. 동의서 내용이 1바이트라도 바뀌면 서명 검증이 즉시 실패합니다.' },
  { icon: ICON.link, title: '③ 해시체인 (기록·순서)', desc: '서명 사건이 끊기지 않는 사슬처럼 연결되어 기록됩니다. 한 칸이라도 변조·삭제하면 이후 전체가 깨져 탐지됩니다.' },
  { icon: ICON.clock, title: '④ 시점 앵커 (시점·전체 봉인)', desc: '기록 전체를 공인 시각(TSA)으로 봉인합니다. 내부자가 전체를 다시 계산해도 봉인 시점과 어긋나 드러납니다.' },
];

const SCENARIOS = [
  ['동의서 내용을 몰래 수정', '서명 검증 실패 — 즉시 탐지'],
  ['위조 서명 주입', '키·체인 불일치 — 탐지'],
  ['폐기된 키로 서명', '폐기 시점 확인(OCSP) — 무효'],
  ['감사기록 1건 변조·삭제', '해시체인 끊김 — 탐지'],
  ['기록 전체 재계산', '시점 봉인 불일치 — 탐지'],
  ['만료 후 과거 서명 부인', '시점·장기검증으로 효력 유지'],
];

export default function DocumentSecurityPage() {
  return (
    <div className="bg-white">
      {/* Hero */}
      <section className="bg-gradient-to-br from-indigo-600 to-blue-700 text-white">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <nav className="text-xs text-indigo-200 mb-4">
            <Link href="/guide" className="hover:text-white">이용안내</Link> <span className="mx-1">/</span> 전자문서 보안
          </nav>
          <div className="flex items-start gap-4">
            <Icon d={ICON.shield} className="w-12 h-12 flex-shrink-0 text-indigo-100" />
            <div>
              <h1 className="text-3xl font-bold mb-3">전자문서 보안 · 위변조 방지</h1>
              <p className="text-indigo-100 leading-relaxed max-w-2xl">
                전자동의서와 전자서명은 <b className="text-white">위변조 방지·부인방지</b>를 위해
                인증서와 블록체인(해시체인 + 시점 앵커)을 결합한 <b className="text-white">4중 보안 계층</b>으로 보호됩니다.
                각 계층이 서로 다른 위협을 막고, 언제든 진위를 통합 검증할 수 있습니다.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4중 계층 */}
      <section className="max-w-5xl mx-auto px-6 py-14">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">4중 보안 계층의 조화</h2>
        <p className="text-sm text-gray-500 mb-8">한 가지 수단이 아니라, 서로 다른 공격면을 담당하는 네 계층이 함께 위변조를 막습니다.</p>
        <div className="grid sm:grid-cols-2 gap-5">
          {LAYERS.map((l) => (
            <div key={l.title} className="border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-4">
                <Icon d={l.icon} />
              </div>
              <h3 className="text-base font-bold text-gray-900 mb-2">{l.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{l.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 시나리오 탐지 */}
      <section className="bg-gray-50 border-y border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-14">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">위변조 시도는 이렇게 탐지됩니다</h2>
          <p className="text-sm text-gray-500 mb-8">대표적인 공격 시나리오와 자동 탐지 결과입니다.</p>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
            {SCENARIOS.map(([attack, result]) => (
              <div key={attack} className="flex items-center gap-4 px-6 py-4">
                <span className="text-sm text-gray-700 flex-1">{attack}</span>
                <span className="text-indigo-400">→</span>
                <span className="text-sm font-medium text-emerald-700 flex-1 flex items-center gap-1.5">
                  <Icon d={ICON.check} className="w-4 h-4" /> {result}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 검증 + 법적효력 */}
      <section className="max-w-5xl mx-auto px-6 py-14 grid md:grid-cols-2 gap-8">
        <div>
          <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4"><Icon d={ICON.badge} /></div>
          <h2 className="text-xl font-bold text-gray-900 mb-3">언제든 진위 검증</h2>
          <p className="text-sm text-gray-600 leading-relaxed mb-3">
            서명된 문서는 <b>통합 검증</b>으로 문서 무결성·인증서 유효성·폐기 여부·시점·장기검증·기록 무결성을
            한 번에 확인합니다. 하나라도 어긋나면 <b>무효</b>로 판정됩니다.
          </p>
          <p className="text-sm text-gray-600 leading-relaxed">
            법적 증빙이 필요할 때는 <b>감사추적 인증서(PDF)</b>로 서명·시점·무결성을 입증할 수 있습니다.
          </p>
        </div>
        <div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4"><Icon d={ICON.doc} /></div>
          <h2 className="text-xl font-bold text-gray-900 mb-3">법적효력 · 인증 대응</h2>
          <ul className="space-y-2.5">
            {[
              ['무결성(위변조 방지)', '문서·기록·시점 3중 봉인'],
              ['부인방지', '인증서 + 시점(TSA) + 감사체인'],
              ['신원확인', '본인확인(PASS/대면) 강결합'],
              ['장기검증(LTV)', '만료·폐기 후에도 과거 서명 검증'],
              ['감사추적', '감사추적 인증서 + 해시체인 조회'],
            ].map(([k, v]) => (
              <li key={k} className="flex items-start gap-2.5 text-sm">
                <Icon d={ICON.check} className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span><b className="text-gray-800">{k}</b> <span className="text-gray-500">— {v}</span></span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 안내 */}
      <section className="max-w-5xl mx-auto px-6 pb-16">
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6">
          <p className="text-sm text-indigo-900 leading-relaxed">
            본 보안 체계는 <b>내부 검증 가능한 해시체인과 공인 시각 앵커(tamper-evident ledger)</b>를 기반으로 하며,
            위변조 탐지·부인방지에 충분합니다. 필요 시 공인 타임스탬프·외부 공개 앵커로 법적효력을 확장할 수 있습니다.
          </p>
        </div>
      </section>
    </div>
  );
}
