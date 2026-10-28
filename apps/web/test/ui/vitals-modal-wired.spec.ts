import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 간호 스테이션 "VS 일괄 기록" 배선 가드 (2026-08-25 · 9단계 미검증 후보 재실측에서 확정)
 *
 * 🔴 버튼·단축키(alt+a)까지 배선된 모달이 **열리지만 저장은 항상 실패**했다 —
 *    `toast.info('기능 준비 중')` + `throw new Error('placeholder')`.
 *    안내 문구도 사실이 아니었다: 활력 쓰기 정본 EP(POST /api/v1/vitals)는 있었다.
 *    폼 키가 DTO 와 달라(bodyTemperature/spO2/note ↔ temperature/spo2/notes) 매핑이 필요하다.
 */
const SRC = path.join(__dirname, '..', '..', 'src', 'app', '(main)', 'nurse-station', 'page.tsx');
// 2026-10-10 — 폼 → 본문 매핑은 lib/vs-batch-form.ts 로 옮겼다(의식·산소·측정 시각 추가 · 테스트 가능). 둘을 함께 본다
const LIB = path.join(__dirname, '..', '..', 'src', 'lib', 'vs-batch-form.ts');
const src = fs.readFileSync(SRC, 'utf8') + '\n' + fs.readFileSync(LIB, 'utf8');

describe('VS 일괄 기록이 실제로 저장한다', () => {
  it("🔴 placeholder throw 가 없다 — 되돌리면 실패", () => {
    expect(src).not.toContain("throw new Error('placeholder')");
    expect(src).not.toContain('기능 준비 중');
  });

  it('🔴 정본 EP 를 부른다', () => {
    expect(src).toMatch(/apiClient\.post[^\n]*'\/api\/v1\/vitals'/);
  });

  it('🔴 폼 키를 DTO 키로 매핑한다 — 그대로 보내면 whitelist 가 지운다', () => {
    expect(src).toMatch(/\['bodyTemperature', 'temperature'\]/);
    expect(src).toMatch(/\['spO2', 'spo2'\]/);
    expect(src).toMatch(/body\.notes = form\.note\.trim\(\)/);
  });

  it('🔴 서버가 거부하면(meta.ingest.accepted=false) 성공이라 말하지 않는다', () => {
    expect(src).toMatch(/ingest\.accepted === false/);
    expect(src).toMatch(/저장되지 않았습니다/);
  });

  it('대조군 — 입력하지 않은 항목은 보내지 않는다(빈 값은 "쟀는데 0"과 다르다)', () => {
    expect(src).toMatch(/if \(v !== undefined\) body\[dto(Key)?\] = v;/);
    expect(src).toMatch(/기록할 항목을 하나 이상 입력하세요/);
  });
});
