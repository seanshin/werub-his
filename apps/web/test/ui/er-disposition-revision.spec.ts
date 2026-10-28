/**
 * 응급 처분 변경 화면 도달성 가드 — 2026-08-18.
 *
 * 🔴 서버가 처분 재결정을 받아들이게 고쳐도, **화면에 누를 곳이 없으면 절반이다.**
 *    종전 `/emergency` 상세는 `isActive = !visit.disposition` 하나로 액션 영역 전체를 감췄다 —
 *    처분이 한 번 찍히면 관찰→입원, 전원 결정 후 취소를 화면에서 **표현할 방법이 없었다.**
 *    (같은 화면의 워크스테이션 목록은 `OBSERVATION` 을 '처분 완료'로 세지 않아 관찰 환자에게
 *     퇴원·전원 버튼을 계속 노출한다 — 그 버튼이 정확히 500 을 만들던 경로다.)
 *
 * 소스 텍스트 단언은 약한 가드다. 그래서 여기서는 **문구가 아니라 구조적 사실**만 본다:
 *   ① 변경 경로가 `disposition` 유무가 아니라 **퇴실(COMPLETED)** 로 갈린다
 *   ② 변경 시 사유를 실어 보낸다(서버 감사 스냅샷의 유일한 사유 출처)
 *   ③ 성공 토스트가 서버 `outcome` 을 읽는다(안 바뀐 재전송에 "변경 완료"라고 말하지 않는다)
 *   ④ 목록 쿼리키를 실제로 무효화한다
 *   ⑤ 화면에 보이지 않는 값을 저장하지 않는다(프리필 출처가 현행 처분 기록이다)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PAGE = resolve(__dirname, '../../src/app/(main)/emergency/page.tsx');
const WORKSTATION = resolve(__dirname, '../../src/app/(main)/workstation/emergency/page.tsx');

function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const src = stripComments(readFileSync(PAGE, 'utf8'));
const wsSrc = stripComments(readFileSync(WORKSTATION, 'utf8'));

describe('/emergency — 처분은 결정 뒤에도 바꿀 수 있어야 한다', () => {
  it('🔴 변경 가능 여부가 퇴실(COMPLETED)로 갈린다 — 처분 유무로 잠그면 되돌릴 길이 없다', () => {
    expect(src, 'isClosed(퇴실 확정) 판정이 없다').toMatch(/const\s+isClosed\s*=\s*visit\.status\s*===\s*'COMPLETED'/);
    expect(src, 'canRevise(변경 가능) 판정이 없다').toMatch(/const\s+canRevise\s*=\s*isRevision\s*&&\s*!isClosed/);
  });

  it('🔴 처분이 찍힌 뒤에도 패널을 여는 경로가 남아 있다', () => {
    // 액션 패널(isActive) 밖에 canRevise 로 열리는 진입점이 있어야 한다.
    expect(src.match(/canRevise\s*&&/g)?.length ?? 0, '변경 진입점이 없다').toBeGreaterThan(0);
    expect(src, '패널 열기 핸들러가 없다').toMatch(/const\s+openDispositionPanel\s*=/);
    expect(src.match(/onClick=\{openDispositionPanel\}/g)?.length ?? 0, '최초 결정·변경 두 진입점이 같은 핸들러를 써야 한다').toBeGreaterThanOrEqual(2);
  });

  it('🔴 변경 사유를 실어 보내고, 없으면 확정 버튼이 눌리지 않는다', () => {
    expect(src, 'revisionReason 을 보내지 않는다 — 서버 감사에 사유가 남을 길이 없다').toMatch(/revisionReason:\s*isRevision\s*\?\s*dispRevisionReason/);
    // 🔴 계약 = "공백만으로는 변경이 확정되지 않는다". `.trim()` 철자를 못박지 않는다
    //    (2026-08-24 사유 입력 공통 부품으로 옮기며 `reasonFilled()` 로 바뀌었다 — 게이트는 그대로다)
    expect(src, '사유 없이 변경이 확정된다').toMatch(
      /isRevision\s*&&\s*(?:!dispRevisionReason\.trim\(\)|!reasonFilled\(dispRevisionReason\))/,
    );
  });

  it('🔴 결과 문구는 서버 outcome 에서 나온다 — 안 바뀐 재전송을 "변경 완료"라 하지 않는다', () => {
    expect(src).toMatch(/res\?\.meta\?\.outcome/);
    expect(src).toMatch(/'UNCHANGED'/);
    expect(src).toMatch(/'REVISED'/);
  });

  it('🔴 저장 후 실제 목록 쿼리키를 무효화한다 — 종전엔 존재하지 않는 키를 지웠다', () => {
    const listKey = src.match(/queryKey:\s*\['emergency'\]/g)?.length ?? 0;
    expect(listKey, "목록 쿼리키 ['emergency'] 를 쓰지 않는다").toBeGreaterThanOrEqual(2); // 선언 + 무효화
    // 처분 mutation 의 onSuccess 안에서 무효화하는지 확인
    const onSuccess = src.slice(src.indexOf('const dispositionMut'), src.indexOf('const reassessMut'));
    expect(onSuccess, "처분 저장이 ['emergency'] 를 무효화하지 않는다").toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['emergency'\]\s*\}\)/);
    expect(onSuccess, "존재하지 않는 ['emergency-queue'] 를 지우고 있다").not.toMatch(/'emergency-queue'/);
  });

  it('🔴 프리필 출처는 현행 처분 기록이다 — 빈 칸에서 다시 쓰면 안 보이는 값이 지워진다', () => {
    expect(src, 'dispositionRecord 를 읽지 않는다').toMatch(/visit\.dispositionRecord/);
    const opener = src.slice(src.indexOf('const openDispositionPanel'), src.indexOf('const openDispositionPanel') + 800);
    for (const f of ['dischargeInstructions', 'followUpDate', 'transferTo', 'transferReason']) {
      expect(opener, `${f} 를 프리필하지 않는다`).toContain(f);
    }
  });

  it('🔴 화면에 보이지 않는 값은 저장하지 않는다 — 퇴원 지침이 입원 기록에 실리면 안 된다', () => {
    const body = src.slice(src.indexOf('const dispositionMut'), src.indexOf('const reassessMut'));
    expect(body).toMatch(/dischargeInstructions:\s*\(dispType\s*===\s*'DISCHARGE'\s*\|\|\s*dispType\s*===\s*'LEAVE_AMA'\)/);
    expect(body).toMatch(/transferTo:\s*dispType\s*===\s*'TRANSFER'/);
  });

  it('처분 라벨 맵이 화면이 보내는 처분 전부를 덮는다 — 빠지면 "undefined" 가 찍힌다', () => {
    const labelBlock = src.slice(src.indexOf('const DISPOSITION_LABEL'), src.indexOf('const DISPOSITION_LABEL') + 400);
    for (const k of ['DISCHARGE', 'ADMISSION', 'TRANSFER', 'OBSERVATION', 'SURGERY', 'LEAVE_AMA', 'DEATH']) {
      expect(labelBlock, `${k} 라벨이 없다`).toContain(`${k}:`);
    }
  });
});

describe('응급 워크스테이션 — 실패 이유를 삼키지 않는다', () => {
  it('🔴 처분 즉시 버튼의 실패가 "실패" 한 줄로 뭉개지지 않는다', () => {
    // 종전: `catch { toast.error('퇴원 처리 실패'); }` — 500 의 이유가 화면에 닿지 않았다.
    // 처분 POST 를 감싼 try/catch 만 본다(같은 화면의 코드 알림 버튼은 별개 결함 — 보고만 함).
    const posts = [...wsSrc.matchAll(/\/disposition`[\s\S]{0,400}?catch\s*(\{|\()/g)].map((m) => m[0]);
    expect(posts.length, '처분 즉시 버튼(퇴원·전원)을 못 찾았다 — 가드가 헛돌고 있다').toBe(2);
    for (const p of posts) {
      expect(p, '이유를 버리는 catch 가 남아 있다').toMatch(/catch\s*\(/);
    }
    expect(wsSrc.match(/toast\.error\(\(err as \{ message\?: string \}\)\?\.message/g)?.length ?? 0).toBe(2);
  });
});
