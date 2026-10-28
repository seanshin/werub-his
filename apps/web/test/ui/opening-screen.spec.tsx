import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 개원·운영 단계 화면(3167) 가드 — 2026-08-28.
 *
 * 🔴 이 화면의 위험은 **덜 안전한 쪽이 아니라 더 안심시키는 쪽**이다.
 *    기록이 없는 항목을 "미완료"라 부르거나, 완료를 단정하거나,
 *    목록이 전수인 것처럼 그리면 사람이 안 한 일을 했다고 믿는다.
 */
const RAW = readFileSync(
  join(process.cwd(), 'src/app/(main)/admin/opening/page.tsx'), 'utf-8',
);
/**
 * 🔴 **주석을 걷어내고 검사한다.** 주석에 적어둔 규칙 문장이 검사에 걸려
 *    가드가 엉뚱한 이유로 실패·통과한 적이 있다(이 저장소 반복 유형).
 */
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('🔴 모르는 것을 안 한 것으로 말하지 않는다', () => {
  it('연결도 기록도 없으면 "기록 없음" 이다', () => {
    expect(CODE).toContain('기록 없음');
    // "미완료"·"미이행"은 판정이다 — 시스템에 안 적혔을 뿐일 수 있다
    expect(CODE, '기록 부재를 미완료로 단정하지 않는다').not.toContain('미완료');
    expect(CODE).not.toContain('미이행');
  });

  it('🔴 완료를 단정하지 않는다 — 롤업 줄이 "완료로 읽힘 N / M" 이다', () => {
    // 🔴 문구가 파일 어딘가에 있는 것으로는 부족하다(배지 라벨이 대신 통과시켰다).
    //    **집계를 내는 그 줄**을 겨눈다 — 분모와 어휘를 한 번에 본다.
    expect(CODE).toMatch(/완료로 읽힘 \{p\.knownDone\} \/ \{p\.total\}/);
  });

  it('🔴 항목이 0건인 단계를 "완료"로 그리지 않는다', () => {
    expect(CODE).toContain('기본 항목 없음');
  });
});

describe('🔴 P1 — 사람 기록', () => {
  it('파생 항목에는 기록 버튼을 주지 않는다 — 정본이 둘이 된다', () => {
    expect(CODE).toMatch(/\{!t\.derived && \(/);
  });

  it('🔴 해당 없음을 완료와 다른 색으로 그린다 — 섞이면 "다 됐다"로 읽힌다', () => {
    expect(CODE).toContain('해당 없음');
    expect(CODE).toMatch(/notApplicable > 0/);
  });

  it('🔴 해당 없음은 사유 없이 저장할 수 없다', () => {
    expect(CODE).toMatch(/canSave = state === 'RECORDED' \|\| !!note\.trim\(\)/);
  });

  it('🔴 증빙이 없으면 없다고 말한다 — 강제하지는 않는다', () => {
    expect(CODE).toContain('증빙 미기재');
    expect(CODE).toContain('(선택)');
  });

  it('🔴 이 기록이 시스템 확인이 아니라는 사실을 말한다', () => {
    expect(CODE).toContain('담당자가 남긴 것');
  });
});

describe('🔴 국가 축', () => {
  it('나라를 고를 수 있고, 지금 어느 나라인지 보인다', () => {
    expect(CODE).toContain('data.countries.map');
    expect(CODE).toMatch(/c\.code === data\.country/);
  });

  it('🔴 설정에서 온 값인지 기본값으로 떨어진 것인지 말한다', () => {
    // 조용히 기본값을 쓰면 다른 나라 기관이 자기 항목을 못 보고도 모른다
    expect(CODE).toMatch(/!data\.countryFromConfig/);
    expect(CODE).toContain('hospital.country');
  });

  it('나라별 관할 설명을 화면이 그린다 — 화면이 다시 쓰지 않는다', () => {
    expect(CODE).toMatch(/\{data\.countryNote\}/);
  });

  it('나라를 바꾸면 다시 불러온다 — 캐시 키에 들어 있다', () => {
    expect(CODE).toMatch(/queryKey: \['opening', 'overview', country\]/);
  });
});

describe('🔴 막지 않는다 · 전수라 말하지 않는다', () => {
  it('선행은 순서를 보여줄 뿐 잠그지 않는다', () => {
    expect(CODE).toContain('막지 않는다');
    // disabled 로 뒤 항목을 잠그면 사람이 우회한다
    expect(CODE, '선행 미완료로 UI 를 잠그지 않는다').not.toMatch(/disabled=\{.*waitingOn/);
  });

  it('전수가 아니라는 캐비아트를 상시 노출한다', () => {
    expect(CODE).toContain('data.caveat');
  });
});

describe('🔴 정본에 없는 위원회를 드러낸다', () => {
  it('위원 명부가 어디 있는지 말한다 — 정리가 삭제가 아니라 이관이다', () => {
    expect(CODE).toContain('codelessCommittees');
    expect(CODE).toContain('이관');
    // 🔴 "삭제하세요"라고 말하면 위원 명부 30명이 사라진다
    expect(CODE, '삭제를 권하지 않는다').not.toContain('삭제하세요');
  });

  it('🔴 건수만이 아니라 위원 수를 함께 낸다', () => {
    expect(CODE).toMatch(/reduce\(\(a, c\) => a \+ c\.members, 0\)/);
  });
});

describe('🔴 P2 — 위원회 주기는 "기록"을 센다', () => {
  it('🔴 "미개최"라 쓰지 않는다 — 시스템에 안 남았을 뿐일 수 있다', () => {
    expect(CODE).toContain('기록 없음');
    expect(CODE, '개최 여부를 단정하지 않는다').not.toContain('미개최');
    expect(CODE).not.toContain('미준수');
  });

  it('🔴 판정 대상 아님(수시)을 "없음"과 섞지 않는다', () => {
    expect(CODE).toMatch(/r\.heldThisPeriod === null \?/);
    expect(CODE).toContain('판정 대상 아님');
  });

  it('🔴 분모를 함께 내고, 판정 못 하는 것은 분모 밖이다', () => {
    expect(CODE).toMatch(/summary\.withRecord\} \/ \{cycle\.summary\.judged/);
  });

  it('🔴 개최 기록이 없으면 날짜를 지어내지 않는다', () => {
    expect(CODE).toContain('개최 기록 없음');
  });

  it('🔴 조회 실패를 "0건"으로 그리지 않는다', () => {
    expect(CODE).toMatch(/cycleQ\.isError/);
    expect(CODE).toMatch(/cycleQ\.isLoading/);
  });
});

describe('🔴 증빙 첨부와 AI 판독', () => {
  it('첨부는 정본 클라이언트를 통과한다 — raw fetch 는 토큰 갱신을 못 탄다', () => {
    expect(CODE).toContain('apiClient.postForm');
    expect(CODE, '화면이 직접 fetch 하지 않는다').not.toMatch(/await fetch\(/);
  });

  it('🔴 기록 전에는 붙일 수 없다는 사실을 그 자리에서 말한다', () => {
    expect(CODE).toContain('기록을 먼저 저장해야 증빙을 붙일 수 있습니다');
  });

  it('🔴 첨부 0건을 감추지 않는다', () => {
    expect(CODE).toContain('첨부 없음');
    expect(CODE).toMatch(/첨부 \$\{t\.record\.attachments\?\.length \?\? 0\}건/);
  });

  it('🔴 판독은 초안이다 — 자동으로 칸을 덮지 않는다(사람이 담는다)', () => {
    expect(CODE).toContain('입력칸에 담기');
    expect(CODE).toMatch(/const applyDraft = \(\) =>/);
    // 🔴 판독 직후 자동 적용하면 사람이 고쳐둔 값을 지운다.
    //    `applyDraft` 는 **버튼에서만** 참조돼야 한다(`onClick={applyDraft}`) —
    //    코드가 직접 호출(`applyDraft();`)하면 사람이 누르지 않았는데 담긴다.
    expect(CODE, '판독 결과를 코드가 직접 담지 않는다').not.toContain('applyDraft();');
    expect(CODE).toContain('onClick={applyDraft}');
  });

  it('🔴 판독 3상태를 뭉개지 않는다 — 못 읽음과 "읽었는데 없음"은 다른 사실', () => {
    expect(CODE).toMatch(/draft\.source === 'UNAVAILABLE'/);
    expect(CODE).toMatch(/extractedCount\(draft\.fields\) === 0/);
    expect(CODE).toContain('찾지 못했습니다');
  });

  it('🔴 문서가 어디로 가는지 말하고, AI 임을 병기한다', () => {
    // 🔴 import 만으로는 부족하다 — **화면에 그려야** 사람이 읽는다(import 가 대신 통과했다)
    expect(CODE).toMatch(/\{EVIDENCE_EGRESS_NOTICE\}/);
    expect(CODE).toContain('AI_ORIGIN_TEXT');
    // "자동분석" 같은 말로 AI 임을 가리지 않는다
    expect(CODE).not.toContain('자동분석');
  });

  it('필드 라벨을 화면이 다시 만들지 않는다', () => {
    expect(CODE).toContain('EVIDENCE_FIELD_LABEL');
  });
});

describe('상태 어휘를 화면이 다시 만들지 않는다', () => {
  it('🔴 파생 상태는 서버가 준 것을 그대로 옮긴다', () => {
    // 화면이 자기 판정 로직(점수·퍼센트 계산)을 두면 정본이 둘이 된다
    expect(CODE).not.toMatch(/Math\.round\(.*100\)/);
    expect(CODE).toContain('t.derived.detail');
  });

  it('🔴 조회 실패를 "0건"으로 그리지 않는다', () => {
    expect(CODE).toMatch(/q\.isError/);
    expect(CODE).toMatch(/q\.isLoading/);
    expect(CODE).toContain('QueryErrorFallback');
  });
});
