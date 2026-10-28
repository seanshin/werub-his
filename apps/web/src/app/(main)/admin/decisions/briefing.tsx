'use client';

import { DECISION_DOMAINS, decisionSubdomainOf, decisionSubdomainMeta } from '@hospital-run/shared';
import { KDate } from '@/components/ui/display';
import { T } from '@/components/ui/i18n-text';
import type { DecisionItem } from './types';
import { LAYER_TITLE, PATH_LABEL, GO_LIVE_LABEL } from './types';
import { DecisionTimeline, MechanismExplain, SettingDetailTable } from './engine-parts';
import { Rich } from './rich';

/**
 * 결정 설명자료 본문 — **설명자료 페이지와 의사결정 창이 같은 부품을 쓴다**(2026-10-11 사용자 "허가결정과 설명자료를 같이 볼 수 있도록").
 * 🔴 두 벌로 두면 한쪽만 고쳐져 창에서 본 설명과 문서가 갈라진다 — 본문은 여기 하나.
 * 이 화면이 지키는 것(종전 그대로): 읽는 사람은 개발자가 아니다 · 지금 상태를 먼저 · 선택의 결과를 고르기 전에 ·
 * 기록 후에도 남는 일을 숨기지 않는다 · 믿으라고 하지 않는다(확인 방법) · 시스템은 권고하지 않는다.
 */
export function DecisionBriefingBody({ item, items, measuredAt, caveat }: { item: DecisionItem; items: DecisionItem[]; measuredAt: string; caveat: string }) {
  const isLegal = item.layer === 'LICENSE_HOLDER';
  const docTitle = isLegal ? '법적 검토 요청서' : item.layer === 'INTERNAL_COMMITTEE' ? '위원회 안건 자료' : '업무 판단 안내';
  /** 영역 › 세부 분류(2026-10-12) — 영역을 모르면 적지 않는다 */
  const domainLabel = item.domain ? DECISION_DOMAINS.find((d) => d.key === item.domain)?.label ?? null : null;
  const sub = item.domain ? decisionSubdomainMeta(decisionSubdomainOf(item.key, item.track, item.layer, item.domain) ?? '') : null;
  return (
    <>
      {/* 🔴 넓은 화면 2열(2026-10-12 사용자 "세부적인 부분에서도 충분하게 화면 여백을 사용할것") — 왼쪽 설명 본문 · 오른쪽 의사결정 내역·설정·경과 */}
      <div className="grid gap-x-10 gap-y-7 xl:grid-cols-[minmax(0,1fr)_28rem] 2xl:grid-cols-[minmax(0,1fr)_34rem] print:block" data-doc-layout>
      <div className="min-w-0 space-y-7" data-doc-main>
      {/* 표제 */}
      <header className="border-b border-gray-200 pb-5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold tracking-widest text-gray-400 uppercase">
          <T k={docTitle} />
          {domainLabel && (
            <span className="normal-case tracking-normal font-medium text-gray-500" data-doc-category>
              · <T k={domainLabel} />{sub && <> › <T k={sub.label} /></>}
            </span>
          )}
        </p>
        <h1 className="text-2xl font-extrabold text-gray-900 mt-1.5 leading-snug"><Rich text={item.title} /></h1>
        <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-1.5 text-[13px] sm:grid-cols-2 2xl:grid-cols-3">
          <Row label="결정 층"><T k={LAYER_TITLE[item.layer]} /></Row>
          <Row label="허가권">{item.authority}</Row>
          <Row label="처리 경로"><T k={PATH_LABEL[item.approvalPath].label} /></Row>
          <Row label="실서비스 개시"><T k={GO_LIVE_LABEL[item.goLive]} /></Row>
          <Row label="결정 상태">
            {item.decided
              ? <span className="text-emerald-700 font-semibold"><T k="결정됨" /> · <KDate value={item.record!.decidedAt} /></span>
              : <span className="text-amber-700 font-semibold"><T k="미결" /></span>}
          </Row>
          <Row label="자료 기준 시각"><KDate value={measuredAt} mode="datetime" /></Row>
        </dl>
      </header>

      {/* 1. 현재 상황(의사결정 이전) — 가장 먼저 */}
      <Section n={1} title="현재 상황(의사결정 이전)">
        <p className="text-[15px] text-gray-800"><Rich text={item.statusQuo} /></p>
        <p className="mt-2 text-[12px] text-gray-500">
          🔴 <T k="결정하지 않는 것도 결정입니다 — 위 상태가 계속됩니다." />
        </p>
      </Section>

      {/* 2. 왜 결정이 필요한가 */}
      <Section n={2} title="왜 결정이 필요한가">
        <p className="text-[15px] text-gray-800"><Rich text={item.why} /></p>
      </Section>

      {/* 3. 법적 검토 항목 — 허가권자 문서의 핵심 */}
      {item.legalReview.length > 0 && (
        <Section n={3} title={isLegal ? '검토를 요청하는 법적 항목' : '관련 법적 항목'}>
          <ul className="space-y-2">
            {item.legalReview.map((l, i) => (
              <li key={i} className="flex gap-2.5 text-[14px] text-gray-800">
                <span className="shrink-0 mt-[3px] w-5 h-5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                <span><Rich text={l} /></span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-gray-500">
            🔴 <T k="이 목록은 검토해야 할 축을 적은 것이며" /> <b><T k="법적 판단을 대신하지 않습니다" /></b>.
          </p>
        </Section>
      )}

      {/* 4. 선택지와 결과 */}
      <Section n={item.legalReview.length > 0 ? 4 : 3} title="선택지와 그 결과">
        <div className="grid gap-2.5 lg:grid-cols-2">
          {item.options.map((o) => {
            const chosen = item.record?.choice === o.value;
            return (
              <div key={o.value}
                className={`rounded-xl border px-4 py-3 ${chosen ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200'}`}>
                <p className="text-[14px] font-bold text-gray-900">
                  {o.label}
                  {chosen && <span className="ml-2 text-[10px] font-bold bg-emerald-600 text-white px-1.5 py-0.5 rounded-full align-middle"><T k="선택됨" /></span>}
                </p>
                <p className="text-[13px] text-gray-700 mt-1"><Rich text={o.effect} /></p>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] text-gray-500">
          🔴 <T k="시스템은" /> <b><T k="어느 선택이 옳다고 권고하지 않습니다" /></b> — <T k="결과를 적을 뿐입니다." />
        </p>
      </Section>

      {/* 5. 결정하면 무엇이 열리는가 */}
      {(item.opens?.length || item.unlocks.length > 0 || item.blocks) && (
        <Section n={item.legalReview.length > 0 ? 5 : 4} title="이 결정이 나면 무엇이 열리는가">
          {item.blocks && (
            <p className="text-[13px] text-gray-700 mb-2">
              <T k="지금 이 결정이 막고 있는 것" />: <b>{item.blocks}</b>
            </p>
          )}
          {item.opens && item.opens.length > 0 && (
            <ul className="list-disc list-inside space-y-1 text-[14px] text-gray-800">
              {item.opens.map((o, i) => <li key={i}><Rich text={o} /></li>)}
            </ul>
          )}
          {item.unlocks.length > 0 && (
            <div className="mt-3 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
              <p className="text-[12px] font-bold text-gray-600 mb-1.5"><T k="이 결정이 직접 풀어주는 후속 결정" /> {item.unlocks.length}<T k="건" /></p>
              <ul className="space-y-1">
                {item.unlocks.map((u) => (
                  <li key={u.key} className="text-[13px] text-gray-800">
                    · {u.title} <span className="text-[11px] text-gray-400">(<T k={LAYER_TITLE[u.layer]} />)</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* 6. 선행 조건 */}
      {item.blockedBy.length > 0 && (
        <Section n={item.legalReview.length > 0 ? 6 : 5} title="먼저 정해져야 하는 것">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-[13px] font-semibold text-amber-900">
              🔴 <T k="아래가 정해지기 전에는 이 결정을 의사결정해도" /> <b><T k="적용되지 않습니다" /></b>. <T k="하위 층은 상위 층을 앞지르지 못합니다." />
            </p>
            <ul className="mt-2 space-y-1">
              {item.blockedBy.map((b) => (
                <li key={b.key} className="text-[13px] text-amber-900">· <b>{b.title}</b> — {b.reason}</li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {/* 7. 기록 후에도 남는 일 */}
      {item.afterDecision && (
        <Section n={item.legalReview.length > 0 ? 7 : 6} title="결정을 기록한 뒤에도 남는 일">
          <p className="text-[14px] text-gray-800"><Rich text={item.afterDecision} /></p>
          <p className="mt-2 text-[12px] text-gray-500">
            🔴 <T k="이 화면의 의사결정은" /> <b><T k="결정의 증빙" /></b><T k="이지 실행이 아닙니다." /> <T k={PATH_LABEL[item.approvalPath].note} />
          </p>
        </Section>
      )}

      {/* 8. 직접 확인하는 방법 */}
      {item.verifyHow && item.verifyHow.length > 0 && (
        <Section n={item.legalReview.length > 0 ? 8 : 7} title="이 자료의 주장을 직접 확인하는 방법">
          <ul className="space-y-1.5">
            {item.verifyHow.map((v, i) => (
              <li key={i} className="text-[13px] text-gray-700">· <Rich text={v} /></li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-gray-500">🔴 <T k="믿으라고 하지 않습니다 — 위 경로로 직접 보실 수 있습니다." /></p>
        </Section>
      )}

      </div>

      <aside className="min-w-0 space-y-7 xl:border-l xl:border-gray-100 xl:pl-10" data-doc-aside>
      {!item.record && (
        <Section n={99} title="의사결정 내역" plain>
          <p className="rounded-xl border border-dashed border-gray-200 px-4 py-3 text-[13px] text-gray-500"><T k="미결" /></p>
        </Section>
      )}
      {/* 기록 내역 */}
      {item.record && (
        <Section n={99} title="의사결정 내역" plain>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-[13px]">
            <dt className="text-gray-500"><T k="선택" /></dt><dd className="text-gray-900 font-semibold">{item.options.find((o) => o.value === item.record!.choice)?.label ?? item.record.choice}</dd>
            <dt className="text-gray-500"><T k="법적 검토 근거" /></dt><dd className="text-gray-900">{item.record.legalReviewRef}</dd>
            <dt className="text-gray-500"><T k="권한 근거" /></dt><dd className="text-gray-900">{item.record.authorityClaim}</dd>
            {item.record.note && (<><dt className="text-gray-500"><T k="비고" /></dt><dd className="text-gray-900">{item.record.note}</dd></>)}
            <dt className="text-gray-500"><T k="결정 시각" /></dt><dd className="text-gray-900"><KDate value={item.record.decidedAt} mode="datetime" /></dd>
            <dt className="text-gray-500"><T k="설정 적용" /></dt>
            <dd className={item.record.applied ? 'text-emerald-700 font-semibold' : 'text-gray-700'}>
              {item.record.applied ? <><T k="적용됨" /> — {item.record.appliedDetail ?? ''}</> : <T k="적용 안 됨(의사결정만)" />}
            </dd>
            {(item.record.attachments?.length ?? 0) > 0 && (
              <>
                <dt className="text-gray-500"><T k="근거 문서" /></dt>
                <dd className="text-gray-900">{item.record.attachments!.map((a) => a.fileName).join(' · ')}</dd>
              </>
            )}
          </dl>
        </Section>
      )}

      {/* 결정 방식 · 설정 상세 · 재검토 — 서버가 등록부와 현재 설정에서 파생 */}
      <Section n={99} title="결정 방식과 설정" plain>
        <div className="space-y-2" data-doc-mechanism>
          <MechanismExplain mechanism={item.mechanism} />
          {!!item.needsReview?.length && (
            <p className="text-[13px] text-amber-900" data-doc-review>
              🔴 <T k="재검토 필요 — 이 결정 뒤에 선행 결정이 바뀌었습니다" />: {item.needsReview.map((k) => items.find((x) => x.key === k)?.title ?? k).join(' · ')}
            </p>
          )}
          <div data-doc-config><SettingDetailTable settings={item.settings} recordChoice={item.record?.choice ?? null} /></div>
        </div>
      </Section>

      {/* 결정 경과 — 이력 원장(덧붙이기만) · 오래된 것부터 */}
      <div id="decision-log">
        <Section n={99} title="결정 경과(이력)" plain>
          <DecisionTimeline decisionKey={item.key} items={items} />
          <p className="mt-2 text-[11px] text-gray-500"><T k="이력은 덧붙이기만 합니다 — 고치거나 지우지 않습니다. 원장 시작(2026-10-11) 전 기록은 그때 남아 있던 한 줄씩만 옮겼습니다." /></p>
        </Section>
      </div>
      </aside>
      </div>

      {/* 한계 고지 — 인쇄물에도 반드시 남는다 */}
      <footer className="border-t border-gray-200 pt-4">
        <p className="text-[11px] text-gray-500 leading-relaxed"><Rich text={caveat} /></p>
        <p className="text-[11px] text-gray-400 mt-2">
          <T k="항목 키" /> <code className="font-mono">{item.key}</code> · <T k="자료 생성 시각" />{' '}
          <KDate value={measuredAt} mode="datetime" /> · <T k="출처" /> `decision.registry.ts`
        </p>
      </footer>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 w-20 text-gray-400"><T k={label} /></dt>
      <dd className="text-gray-800">{children}</dd>
    </div>
  );
}

function Section({ n, title, children, plain }: { n: number; title: string; children: React.ReactNode; plain?: boolean }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="text-[13px] font-extrabold text-gray-900 mb-2.5 flex items-center gap-2">
        {!plain && <span className="w-5 h-5 rounded-md bg-gray-900 text-white text-[10px] flex items-center justify-center">{n}</span>}
        <T k={title} />
      </h2>
      {children}
    </section>
  );
}



