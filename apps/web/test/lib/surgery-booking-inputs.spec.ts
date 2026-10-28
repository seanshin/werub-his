import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 수술 예약 화면의 "저장되지 않는 입력" 가드 — 2026-08-18.
 *
 * 종전 동작: 예약 폼이 **예상 소요시간(분)** 과 **보조 의사(자유 텍스트 이름)** 를 받아 놓고
 * 아무 데도 보내지 않았고, 화면은 "이 단계에서 저장되지 않습니다"라고 적어 두기만 했다.
 * 입력할 수 있는데 저장되지 않는 칸은 결국 **입력한 사람이 저장됐다고 믿는 칸**이다.
 *
 * 실측으로 정한 자리:
 *  - 예상 소요시간 → 정본은 `OrSchedule.estimatedDuration`(수술실 배정). 배정 전에는 행 자체가 없다
 *    (roomId 필수) → 예약 폼에서 **입력을 없애고** 배정 화면에서 받는다.
 *  - 보조 의사 → 컬럼 `Surgery.assistantId`(uuid)가 이미 있고, 수술 프로토콜 단계 알림이 그 값을 읽는다
 *    → 이름 문자열이 아니라 **의사 계정 선택**으로 저장 경로를 만든다.
 */
const BOOKING = join(process.cwd(), 'src', 'app', '(main)', 'patients', '[id]', 'encounter', 'new', 'components', 'SurgeryEncounterLayout.tsx');
const SURGERY = join(process.cwd(), 'src', 'app', '(main)', 'surgery', 'page.tsx');

/**
 * "없어야 한다" 단언은 **코드**에만 건다 — 주석이 옛 코드를 인용하는 것까지 결함으로 세면
 * 왜 고쳤는지 적을 수 없게 된다(그리고 주석을 지우려고 가드를 약하게 만들게 된다).
 */
const codeOf = (src: string) => src
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')   // JSX 주석
  .replace(/\/\*[\s\S]*?\*\//g, '')                 // 블록 주석
  .replace(/(^|[^:])\/\/.*$/gm, '$1');                // 행 주석(URL 보호)

describe('수술 예약 폼은 보조 의사를 고르게 한다', () => {
  const src = readFileSync(BOOKING, 'utf8');

  it('🔴 보조 의사를 자유 텍스트 이름으로 받지 않는다(uuid 컬럼에 이름을 넣을 수 없다)', () => {
    expect(src).not.toContain('보조 의사 이름');
    expect(src).not.toMatch(/setAssistant\(e\.target\.value\)/);
    // 이름 문자열 상태가 되살아나면 실패한다
    expect(src).not.toMatch(/const \[assistant, setAssistant\]/);
  });

  it('병원 정본 의사 목록에서 고른다(임의 배정·추측 금지)', () => {
    expect(src).toContain('/api/v1/users/doctors');
    expect(src).toMatch(/value=\{assistantId\}/);
  });

  it('🔴 고른 계정 id 를 실제로 보낸다 — 보내지 않으면 저장 경로가 없던 때로 돌아간다', () => {
    expect(src).toMatch(/assistantId: assistantId \|\| undefined/);
  });

  it('집도의 본인은 보조의 후보에서 빠진다(한 사람이 자기 수술의 보조의일 수 없다)', () => {
    expect(src).toMatch(/d\.id !== user\?\.id/);
  });

  it('의사 목록을 못 불러오면 "없다"가 아니라 못 불러왔다고 말한다', () => {
    expect(src).toContain('의사 목록을 불러오지 못했습니다');
  });

  it('저장된 보조의를 목록에서 되읽어 준다 — 지정 안 한 것과 구분해서', () => {
    expect(src).toMatch(/s\.assistant \?/);
    expect(src).toContain('지정 안 함');
  });

  it('🔴 예약 실패 사유를 뭉개지 않는다(보조의 검증 400 을 화면이 말해야 고칠 수 있다)', () => {
    expect(src).toMatch(/onError: \(e\) =>[\s\S]{0,120}message/);
  });

  it('수술 상세(기록 화면)도 보조의를 보여 준다 — 저장만 하고 안 보여 주면 확인할 방법이 없다', () => {
    const detail = readFileSync(join(process.cwd(), 'src', 'app', '(main)', 'surgery', '[id]', 'page.tsx'), 'utf8');
    expect(detail).toMatch(/label="보조의"/);
    expect(detail).toMatch(/surgery\.assistant \?/);
    expect(detail).toContain('지정 안 함');
  });
});

describe('예상 소요시간은 저장할 수 있는 화면에서만 받는다', () => {
  const booking = readFileSync(BOOKING, 'utf8');
  const surgery = readFileSync(SURGERY, 'utf8');

  it('🔴 예약 폼에는 소요시간 입력이 없다 — 저장할 곳 없는 칸을 두지 않는다', () => {
    expect(codeOf(booking)).not.toContain('예상 시간 (분)');
    expect(codeOf(booking)).not.toMatch(/setEstimatedDuration/);
    // "입력은 받되 저장되지 않는다"는 안내로 때우던 상태로 돌아가면 실패한다
    expect(codeOf(booking)).not.toContain('저장되지 않습니다');
  });

  it('어디서 입력하는지 알려 준다(빈자리를 방치하지 않는다)', () => {
    expect(booking).toContain('예상 소요시간은');
    expect(booking).toContain('배정');
  });

  it('🔴 목록의 소요시간은 배정(orRoom)에서 온다 — 서버가 보낸 적 없는 키를 찍지 않는다', () => {
    expect(codeOf(booking)).not.toMatch(/s\.estimatedDuration/);
    expect(booking).toMatch(/s\.orRoom\.estimatedDuration/);
    expect(booking).toContain('수술방 미배정');
  });

  it('🔴 배정 화면이 소요시간을 드러내 입력받는다', () => {
    expect(surgery).toContain('예상 소요(분)');
    expect(surgery).toMatch(/onChange=\{\(e\) => setDuration\(Number\(e\.target\.value\)\)\}/);
  });

  it('🔴 뒤집힌 시간을 30분으로 조용히 바꿔 저장하지 않는다', () => {
    expect(codeOf(surgery)).not.toMatch(/Math\.max\(30,/);
    expect(surgery).toContain('소요시간을 산출할 수 없습니다');
    // 산출 불가면 배정 버튼이 잠긴다
    expect(surgery).toMatch(/disabled=\{!roomId \|\| !durValid/);
  });
});
