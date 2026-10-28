import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 진료 보조 패널 정직성 가드 — 기획서 chart-ai-assistant-agent §7(재주입 실패).
 * 2026-08-19 실측: DDx 실패를 `catch {}` 로 삼켜 "아직 안 눌렀다"처럼 그렸고, 검증 안 된 영어 SOAP 이 그대로 폼에 들어갈 수 있었고,
 * 검사 flag 를 서버에 보내지 않아 방향이 뒤집혔다.
 */
const COMPONENTS = path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'patients', '[id]', 'encounter', 'new', 'components');
const SRC = fs.readFileSync(path.join(COMPONENTS, 'AiAssistantPanel.tsx'), 'utf8');
const MODES_SRC = fs.readFileSync(path.join(COMPONENTS, 'ai-skill-modes.ts'), 'utf8');
const PAGE_SRC = fs.readFileSync(path.join(COMPONENTS, '..', 'page.tsx'), 'utf8');
const CHECKLIST_SRC = fs.readFileSync(path.join(COMPONENTS, 'PreSignQaChecklist.tsx'), 'utf8');

describe('AiAssistantPanel — 실패·출처·검증을 화면이 말한다', () => {
  it('🔴 DDx 실패를 삼키는 `// silent fail` 이 없다 · 타임아웃(20s)이 있다 · 오류 상태를 그린다', () => {
    expect(SRC).not.toMatch(/silent fail/);
    expect(SRC).toMatch(/setTimeout\(\(\) => controller\.abort\(\), 20_000\)/);
    expect(SRC).toMatch(/ddxError/);
  });
  it('스킬 출처 고지(SkillNotice)가 DDx·SOAP·검사·약물·추론 5탭에 붙어 있다', () => {
    const n = (SRC.match(/<SkillNotice env=/g) ?? []).length;
    expect(n, `SkillNotice 사용 ${n}곳`).toBeGreaterThanOrEqual(5);
    expect(SRC).toMatch(/data-skill-source="FALLBACK"/);
    expect(SRC).toMatch(/data-skill-source="UNAVAILABLE"/);
  });
  it('🔴 검증 실패(FALLBACK) 초안은 폼에 넣을 수 없다 — 적용 버튼 disabled 조건', () => {
    expect(SRC).toMatch(/disabled=\{soapDraft\.source != null && soapDraft\.source !== 'AI'\}/);
    expect(SRC).toMatch(/result\.source === 'AI' && \(/); // 추론 A/P 적용
  });
  it('검사해석에 LIS flag 를 보낸다 · DUR 판정은 LLM 문자열이 아니라 durVerdict', () => {
    expect(SRC).toMatch(/flag: \(item\.flag as string \| undefined\)/);
    expect(SRC).not.toMatch(/rec\.cdssCheck\?\.startsWith\('PASS'\)/);
    // 초록은 durVerdict === 'PASS' 에서만 — cdssCheck 문자열이 색을 정하는 코드가 없다
    expect(SRC).not.toMatch(/cdssCheck[^\n]*green/);
    expect(SRC).toMatch(/PASS: \{ label: 'DUR 통과', cls: 'bg-green-100/);
    expect(SRC).toMatch(/durBadgeOf\(rec\.durVerdict\)/);
    // 미검증(null)·미매칭(UNRESOLVED)은 회색으로 그렇게 말한다
    expect(SRC).toMatch(/UNRESOLVED: \{ label: '약가마스터 미매칭', cls: 'bg-gray-100/);
    expect(SRC).toMatch(/\{ label: 'DUR 미검증', cls: 'bg-gray-100/);
  });
  it('브리핑 헤더가 기준 시각·알레르기 3상태·못 센 축을 말한다', () => {
    expect(SRC).toMatch(/\/api\/v1\/ai\/brief\//);
    expect(SRC).toMatch(/기준<\/span>|기준/);
    expect(SRC).toMatch(/알레르기 미문진/);
    expect(SRC).toMatch(/못 센 축/);
  });
});

/**
 * P1 에이전트 루프 — 관계 모드 배지 · 스킬 라우터(감시) · 사전 해석 · DUR 정본 판정 · 서명 전 기록품질(비차단).
 * 정본: chart-ai-assistant-agent §4.2·§4.3·§4.5 · clinical-ux-agent-era §7.2.
 */
describe('AiAssistantPanel P1 — 관계 모드·감시 배지·사전 해석·DUR·서명 전 체크리스트', () => {
  it('관계 모드 정본이 탭 10개를 전부 덮고, 자동실행 모드는 어디에도 없다', async () => {
    const m = await import('../../src/app/(main)/patients/[id]/encounter/new/components/ai-skill-modes');
    const tabs = ['ddx', 'soap', 'lab', 'drug', 'qa', 'edu', 'chat', 'knowledge', 'reasoning', 'autorecord'];
    expect(Object.keys(m.AI_SKILL_MODES).sort()).toEqual([...tabs].sort());
    // §4.2 표 그대로
    expect(m.skillModeText('ddx')).toBe('감시→보조');
    expect(m.skillModeText('soap')).toBe('초안');
    expect(m.skillModeText('lab')).toBe('보조');
    expect(m.skillModeText('drug')).toBe('실행제안');
    expect(m.skillModeText('qa')).toBe('감시');
    expect(m.skillModeText('edu')).toBe('초안');
    expect(m.skillModeText('reasoning')).toBe('보조');
    expect(m.skillModeText('autorecord')).toBe('초안');
    expect(m.skillModeText('chat')).toBe('보조');
    expect(m.skillModeText('knowledge')).toBe('보조');
    // 🔴 자동실행은 기본 금지(§7.2) — 어휘 자체가 모드 정본·패널에 없다(범례 문구의 "자동실행 모드는 없다" 고지는 제외)
    for (const def of Object.values(m.AI_SKILL_MODES)) expect(def.modes).not.toContain('자동실행');
    expect(m.AI_SKILL_MODE_ORDER).not.toContain('자동실행');
    expect(SRC).not.toMatch(/['"]자동실행['"]/);
    // 패널이 배지를 실제로 그린다
    expect(SRC).toMatch(/<SkillModeBadge tab=\{activeTab\} \/>/);
    expect(SRC).toMatch(/관계 모드 범례/);
  });

  it('🔴 스킬 라우터는 순수 함수다 — 네트워크·LLM 호출 수단이 그 파일에 없다(접힌 패널에서 PHI 가 나갈 길이 없다)', () => {
    expect(MODES_SRC).not.toMatch(/apiClient|fetch\(|\/api\/v1\//);
    // 결정론 규칙 4종
    expect(MODES_SRC).toMatch(/abnormalLabCount/);
    expect(MODES_SRC).toMatch(/NOT_ASSESSED/);
    expect(MODES_SRC).toMatch(/DDX_SUGGEST_MIN_CHARS = 20/);
    expect(MODES_SRC).toMatch(/hasDrugResult/);
  });

  it('접힘 바가 "제안 N" 을 결정론 라우터에서만 얻고, 접힌 상태에서 realtime-ddx 를 부르지 않는다', () => {
    const collapsedStart = SRC.indexOf('if (collapsed) {');
    const collapsedEnd = SRC.indexOf('// 탭별 피드백 위젯');
    expect(collapsedStart).toBeGreaterThan(0);
    const collapsedBlock = SRC.slice(collapsedStart, collapsedEnd);
    expect(collapsedBlock).toMatch(/제안 \{suggestions\.length\}/);
    expect(collapsedBlock).not.toMatch(/apiClient|realtime-ddx|fetchDdx\(/);
    // 자동 DDx effect 는 접힘이면 즉시 return (2026-08-20: 품질 임계 HIDE 게이트가 그 사이에 들어왔다 —
    // 줄 붙임이 아니라 **그 effect 안에 두 조건이 있는지**로 본다)
    const autoStart = SRC.indexOf('// 🔴 접힌 패널에서는 자동 호출하지 않는다');
    expect(autoStart).toBeGreaterThan(0);
    const autoDdxEffect = SRC.slice(autoStart, SRC.indexOf('}, [collapsed, soap.subjective'));
    expect(autoDdxEffect).toMatch(/if \(collapsed\) return;/);
    expect(autoDdxEffect).toMatch(/if \(!soap\.subjective \|\| soap\.subjective\.length < 5\) return;/);
    // 운영이 품질 미달로 내린 스킬은 자동으로도 부르지 않는다
    expect(autoDdxEffect).toMatch(/if \(qualityEffectOf\('ddx'\) === 'HIDE'\) return;/);
    // suggestions 는 라우터 결과다
    expect(SRC).toMatch(/const suggestions: SkillSuggestion\[\] = computeSkillSuggestions\(/);
  });

  it('검사해석 탭 — brief.skills.labInterpretation 이 있으면 "사전 해석(야간 배치 · 기준)" 을 먼저 그리고 "지금 다시 해석" 을 둔다 · 캐시 표기', () => {
    expect(SRC).toMatch(/brief\?\.skills\?\.labInterpretation/);
    expect(SRC).toMatch(/사전 해석/);
    // 2026-09-30 — 시각만 적으면 어제 계산이 오늘 것처럼 읽힌다 → 날짜까지
    expect(SRC).toMatch(/야간 배치 · <KDate value=\{pre\.computedAt\} mode="datetime" \/> 기준/);
    expect(SRC).toMatch(/지금 다시 해석/);
    // 사전·실시간이 같은 본문 렌더를 쓴다(정본 하나)
    expect((SRC.match(/<LabInterpretationBody r=/g) ?? []).length).toBe(2);
    // SkillNotice 가 캐시를 말한다
    expect(SRC).toMatch(/env\.cached \?/);
    expect(SRC).toMatch(/캐시\{env\.cachedAt \? <> · <KDate value=\{env\.cachedAt\} mode="time" \/>/);
  });

  it("'처방 추가' 는 BLOCK·UNRESOLVED 에서 비활성(제목이 이유를 말한다) · durWarnings 최대 3건", () => {
    expect(SRC).toMatch(/const blocked = rec\.durVerdict === 'BLOCK' \|\| rec\.durVerdict === 'UNRESOLVED';/);
    expect(SRC).toMatch(/disabled=\{blocked\} title=\{why\}/);
    expect(SRC).toMatch(/rec\.durWarnings\.slice\(0, 3\)/);
  });

  it('🔴 page.tsx 서명 전 기록품질은 비차단 — chart-qa 를 await 하지 않고, 서명 뮤테이션이 그 뒤에 걸려 있지 않다', () => {
    // 서명 핸들러 본문
    const start = PAGE_SRC.indexOf('const handleSignAndBill = async');
    const end = PAGE_SRC.indexOf('// 약속처방 적용(공용)');
    const body = PAGE_SRC.slice(start, end);
    expect(body).toMatch(/runPreSignQa\(eff\)/);
    expect(body).not.toMatch(/await [^\n]*chart-qa/);
    expect(body).not.toMatch(/await runPreSignQa/);
    // 러너는 반환값 없이(void) — 기다릴 수 있는 promise 를 내주지 않는다
    expect(PAGE_SRC).toMatch(/const runPreSignQa = useCallback\(\(eff: typeof soap\): void =>/);
    expect(PAGE_SRC).toMatch(/setTimeout\(\(\) => controller\.abort\(\), 15_000\)/);
    // 서명은 여전히 진행된다
    // 2026-09-30 — 전자서명 값을 같은 요청에 싣는다(인자 모양이 바뀌었다)
    expect(body).toMatch(/await signEncounter\.mutateAsync\(blockchainSignature \? \{ id: encounterId, blockchainSignature \} : encounterId\)/);
    // 체크리스트가 서명 버튼 근처에 있고 44px 버튼이 있다
    expect(PAGE_SRC).toMatch(/<PreSignQaChecklist state=\{preSignQa\} onRun=/);
    expect(PAGE_SRC).toMatch(/서명 전 기록품질 확인/);
    expect(PAGE_SRC).toMatch(/min-h-\[44px\][^\n]*\n[^\n]*\n[^\n]*서명 전 기록품질 확인|서명 전 기록품질 확인/);
    // 체크리스트 부품은 "막지 않습니다"·실패 문구를 말한다
    expect(CHECKLIST_SRC).toMatch(/막지 않습니다/);
    expect(CHECKLIST_SRC).toMatch(/기록품질 확인 실패 — 서명은 계속할 수 있습니다/);
    expect(CHECKLIST_SRC).toMatch(/AI_ORIGIN_TEXT/);
  });
});

/**
 * P2 실행 연결·계측 — 기획서 §4.5.
 * 🔴 2026-08-19 실측(P16): 패널 버튼은 `처방 추가` 성공 토스트를 띄우는데 page.tsx 는 "처방 탭에서 검색하세요" 안내만 했다.
 *    **아무것도 추가되지 않는데 화면이 성공을 말했다**(토스트 두 개가 동시에 떴다).
 * 재주입 역검증(전부 확인함): ① page 핸들러를 toast 만 남기면 실패 ② 패널에 `toast.success(… 처방 추가)` 를 되살리면 실패
 *    ③ 서명에서 draft-outcome 을 await 하면 실패 ④ 초안 미적용 조기 return 을 지우면 실패 ⑤ 환자설명 '발행' 버튼을 넣으면 실패
 *    ⑥ 복사 성공 토스트를 무조건 띄우면 실패.
 */
describe('AiAssistantPanel P2 — 오더/처방 프리필 정합 · 무수정 승인율 · 환자설명 정직화', () => {
  const drugHandler = PAGE_SRC.slice(PAGE_SRC.indexOf('onOrderDrug={('), PAGE_SRC.indexOf('onOrderTest={('));
  const testHandler = PAGE_SRC.slice(PAGE_SRC.indexOf('onOrderTest={('), PAGE_SRC.indexOf('onOrderTest={(') + 600);
  const eduBlock = SRC.slice(SRC.indexOf('{/* Patient Education Tab */}'), SRC.indexOf('{/* Clinical Q&A Tab */}'));

  it('🔴 page.tsx onOrderDrug 는 toast 만 하지 않는다 — 처방 탭 전환 + 검색 프리필을 실제로 한다', () => {
    expect(drugHandler).toMatch(/setActiveTab\('MEDICATION'\)/);
    expect(drugHandler).toMatch(/handleCodeQueryChange\(drugName\)/);
    // 종전 P16 문구(아무것도 안 하고 안내만)가 되살아나면 실패
    expect(drugHandler).not.toMatch(/처방 탭에서 "\$\{drugName\}"/);
    // 프리필 사실만 말한다(성공 오더가 아니다)
    expect(drugHandler).toMatch(/처방 탭에 띄웠습니다/);
    expect(drugHandler).toMatch(/확인 후 확정하세요\(DUR·승인 적용\)/);
    expect(drugHandler).not.toMatch(/toast\.success/);
    // 서버가 준 약가마스터 매칭 정보를 받는다(있을 때만)
    expect(drugHandler).toMatch(/\(drugName, dosage, medicationCodeId\)/);
  });

  it('🔴 page.tsx onOrderTest 도 프리필을 실제로 한다(검사 탭 전환 + 검색어)', () => {
    expect(testHandler).toMatch(/setActiveTab\('LAB'\)/);
    expect(testHandler).toMatch(/handleCodeQueryChange\(testName\)/);
    expect(testHandler).toMatch(/검사 탭에 띄웠습니다/);
    expect(testHandler).not.toMatch(/toast\.success/);
    expect(testHandler).not.toMatch(/처방 탭에서 "\$\{testName\}"/);
  });

  it('🔴 패널은 프리필을 "추가/오더 성공"이라 말하지 않는다 — 라벨은 프리필, 성공 토스트 없음', () => {
    expect(SRC).toMatch(/처방 폼에 채우기/);
    expect(SRC).toMatch(/검사 폼에 채우기/);
    // 거짓 성공 토스트 재주입 차단
    expect(SRC).not.toMatch(/toast\.success\([^)]*처방 추가/);
    expect(SRC).not.toMatch(/toast\.success\([^)]*오더 추가/);
    expect(SRC).not.toMatch(/toast\.success\([^)]*검사 추가/);
    // 프리필 버튼은 임상 쓰기 경로 진입 — 44px
    expect(SRC).toMatch(/min-h-\[44px\][^\n]*처방 폼에 채우기|처방 폼에 채우기/);
    const drugBtn = SRC.slice(SRC.indexOf('onClick={() => onOrderDrug('), SRC.indexOf('처방 폼에 채우기'));
    expect(drugBtn).toMatch(/min-h-\[44px\]/);
    expect(drugBtn).toMatch(/onOrderDrug\(rec\.resolvedName \|\| rec\.name, rec\.dosage, rec\.medicationCodeId\)/);
    const testBtn = SRC.slice(SRC.indexOf('onClick={() => onOrderTest('), SRC.indexOf('검사 폼에 채우기'));
    expect(testBtn).toMatch(/min-h-\[44px\]/);
    // BLOCK·UNRESOLVED 는 프리필도 막힌 채로 유지(P1 계약)
    expect(SRC).toMatch(/const blocked = rec\.durVerdict === 'BLOCK' \|\| rec\.durVerdict === 'UNRESOLVED';/);
  });

  it('성분 대표 판정(resolution=INGREDIENT_GROUP)은 캐비아트 칩으로만 — 필드가 없어도 안전하다', () => {
    expect(SRC).toMatch(/rec\.resolution === 'INGREDIENT_GROUP' && \(/);
    expect(SRC).toMatch(/data-drug-resolution="INGREDIENT_GROUP"/);
    expect(SRC).toMatch(/성분 대표 판정/);
    // 옵셔널 필드 — 없으면 아무것도 그리지 않는다(DUR 배지를 대체하지 않는다)
    expect(SRC).toMatch(/resolution\?:/);
  });

  it('🔴 무수정 승인율 보고는 서명을 막지도 늦추지도 않는다(fire-and-forget) · 초안 미적용이면 아예 부르지 않는다', () => {
    const start = PAGE_SRC.indexOf('const handleSignAndBill = async');
    const end = PAGE_SRC.indexOf('// 약속처방 적용(공용)');
    const body = PAGE_SRC.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(body).toMatch(/reportDraftOutcome\(eff\)/);
    expect(body).not.toMatch(/await reportDraftOutcome/);
    expect(body).not.toMatch(/await [^\n]*draft-outcome/);
    // 서명 뮤테이션이 보고 뒤에 걸려 있지 않다 — 서명이 먼저 끝난다
    // 🔴 종전 문자열이 사라지면 indexOf=-1 이라 '앞에 있다'가 저절로 참이 됐다 — 존재부터 확인한다
    const signAt = body.indexOf('await signEncounter.mutateAsync(');
    expect(signAt).toBeGreaterThan(0);
    expect(signAt).toBeLessThan(body.indexOf('reportDraftOutcome(eff)'));
    // 러너는 반환값 없이(void) — 기다릴 수 있는 promise 를 내주지 않는다
    expect(PAGE_SRC).toMatch(/const reportDraftOutcome = \(eff: typeof soap\): void =>/);
    // 🔴 초안을 적용한 적이 없으면 부르지 않는다(편집거리 0 행을 만들지 않는다)
    expect(PAGE_SRC).toMatch(/\n\s*if \(!applied\) return;/); // 주석 처리(`// if …`)도 실패로 잡는다
    expect(PAGE_SRC).toMatch(/rememberAppliedDraft\('ASSISTANT', assessment, plan\)/);
    // 계약(BE 정본)
    expect(PAGE_SRC).toMatch(/'\/api\/v1\/ai\/draft-outcome'/);
    expect(PAGE_SRC).toMatch(/resourceType: 'ENCOUNTER_SOAP'/);
    expect(PAGE_SRC).toMatch(/draftText: applied\.text/);
    expect(PAGE_SRC).toMatch(/finalText,/);
    // 실패는 조용히 성공처럼 굳지 않는다 — recorded === false 일 때만 한 줄 고지
    expect(PAGE_SRC).toMatch(/\.catch\(\(\) => setDraftOutcomeRecorded\(false\)\)/);
    expect(PAGE_SRC).toMatch(/draftOutcomeRecorded === false && \(/);
    // 비율은 이 화면에서 그리지 않는다(관제의 몫)
    expect(PAGE_SRC).not.toMatch(/무수정 승인율 \d|editDistance/);
  });

  it('🔴 환자설명 탭은 발행 경로가 없다는 사실을 말한다 — 가짜 "발행" 버튼이 없다', () => {
    expect(eduBlock.length).toBeGreaterThan(200);
    expect(eduBlock).toMatch(/data-edu-no-publish/);
    expect(eduBlock).toMatch(/초안입니다 — 환자 발행 경로가 아직 없습니다\(검수 큐 미구축\)/);
    expect(eduBlock).toMatch(/필요하면 내용을 복사해 기존 문서 경로로 발행하세요/);
    expect(eduBlock).toMatch(/\{AI_ORIGIN_TEXT\} 초안입니다/); // 표기 정본(브랜드로 대체 금지)
    // 없는 발행 경로를 있는 척하는 버튼이 없다
    expect(eduBlock).not.toMatch(/<button[^>]*>[^<]*발행/);
    expect(eduBlock).not.toMatch(/발행<\/button>/);
  });

  it('🔴 설명문 복사는 실패를 성공이라 말하지 않는다 — await + 실패 시 본문 선택 폴백', () => {
    expect(SRC).toMatch(/await navigator\.clipboard\.writeText\(text\)/);
    // 기다리지 않고 성공 토스트를 띄우던 종전 코드 재주입 차단
    expect(SRC).not.toMatch(/(?<!await )navigator\.clipboard\.writeText/);
    expect(SRC).toMatch(/if \(!navigator\?\.clipboard\?\.writeText\) throw new Error/);
    expect(SRC).toMatch(/복사하지 못했습니다 — 본문을 선택해 두었습니다/);
    expect(SRC).toMatch(/복사하지 못했습니다 — 본문을 직접 선택해 복사하세요/);
    expect(SRC).toMatch(/selectNodeContents\(el\)/);
  });
});
