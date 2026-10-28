/**
 * 🔴 활력 수집 결과를 화면이 말한다 — 2026-08-20.
 *
 * 실측 배경: `POST /api/v1/vitals` 는 중복 재수신·저장 보류일 때 **200 에 `data: null`** 을
 * 돌려줬고 사유는 서버 로그에만 있었다. 그런데 화면들은 200 이면 무조건
 * "활력징후가 기록되었습니다" · "바이탈 저장 완료" 를 띄웠다 — **저장되지 않았는데 저장됐다고 말했다.**
 * 진료 화면 하나는 아예 `catch {}` 로 실패를 통째로 삼켰다.
 *
 * 재주입: `vitalsIngestNotice` 가 DUPLICATE 에 `stored: true` 를 주게 하거나,
 * 쓰기 화면에서 `vitalsIngestNotice` 호출을 빼면 이 파일이 실패한다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { vitalsIngestNotice, ingestOf, type VitalsIngestMeta } from '../../src/lib/vitals-ingest-notice';
import { VITALS_TIME_FLAG } from '@hospital-run/shared';

const meta = (o: Partial<VitalsIngestMeta>): VitalsIngestMeta => ({
  status: 'STORED', pendingReason: null, duplicateOfId: null, timeFlags: [], dedupeChecked: true, measuredAt: null, ...o,
});

describe('vitalsIngestNotice — 저장되지 않은 것을 저장됐다고 말하지 않는다', () => {
  it('🔴 중복 재수신은 저장이 아니다', () => {
    const n = vitalsIngestNotice(meta({ status: 'DUPLICATE', duplicateOfId: 'pv-old' }));
    expect(n?.stored).toBe(false);
    expect(n?.text).toContain('저장하지 않았습니다');
  });

  it('🔴 보류는 실패로 말하고 사유를 붙인다', () => {
    const n = vitalsIngestNotice(meta({ status: 'PENDING', pendingReason: 'SCHEMA_PENDING' }));
    expect(n?.stored).toBe(false);
    expect(n?.level).toBe('error');
    expect(n?.text).toContain('SCHEMA_PENDING');
  });

  it('사유가 없으면 "사유 미상"이라 말한다 — 지어내지 않는다', () => {
    expect(vitalsIngestNotice(meta({ status: 'PENDING' }))?.text).toContain('사유가 전달되지 않았습니다');
  });

  it('저장됐고 특이사항이 없으면 조용히 통과한다(null)', () => {
    expect(vitalsIngestNotice(meta({}))).toBeNull();
  });

  it('🔴 dedupeChecked=false 를 "중복 없음"으로 말하지 않는다 — 판정 불가라고 말한다', () => {
    const n = vitalsIngestNotice(meta({ dedupeChecked: false }));
    expect(n?.stored).toBe(true);
    expect(n?.text).toContain('중복 여부를 확인하지 못했습니다');
  });

  it('🔴 서버가 실제로 내는 플래그 값을 사람 말로 옮긴다', () => {
    // 🔴 2026-08-20 사고: 이 테스트의 첫 판은 화면이 **지어낸 어휘**(`FUTURE`)를 넣어
    //    통과했다. 서버는 `FUTURE_MEASURED_AT` 를 낸다 — 교집합 0이라 실제로는 전건 폴백이었다.
    //    값 정본(shared)에서 가져와 단언한다.
    expect(vitalsIngestNotice(meta({ timeFlags: [VITALS_TIME_FLAG.FUTURE_MEASURED_AT] }))?.text).toContain('미래');
    expect(vitalsIngestNotice(meta({ timeFlags: [VITALS_TIME_FLAG.MEASURED_AT_UNKNOWN] }))?.text).toContain('알 수 없');
  });

  it('🔴 서버가 내는 플래그 전부에 문구가 있다 — 하나라도 빠지면 그 사실이 조용히 사라진다', () => {
    for (const f of Object.values(VITALS_TIME_FLAG)) {
      const t = vitalsIngestNotice(meta({ timeFlags: [f] }))?.text ?? '';
      expect(t, `${f} 에 문구가 없어 폴백으로 떨어진다`).not.toContain('확인 필요(');
    }
  });

  it('모르는 플래그는 숨기지 않고 코드를 그대로 보여준다', () => {
    expect(vitalsIngestNotice(meta({ timeFlags: ['ZZZ_NEW'] }))?.text).toContain('ZZZ_NEW');
  });

  it('🔴 meta 가 없으면 "저장됨"이라 단정하지 않는다(null 을 돌려 화면 기본 문구에 맡긴다)', () => {
    expect(vitalsIngestNotice(null)).toBeNull();
    expect(ingestOf({ data: { id: 'v1' } })).toBeNull();
    expect(ingestOf({ data: null, meta: { ingest: meta({}) } })?.status).toBe('STORED');
  });
});

describe('구조 — 활력 쓰기 경로가 정본 해석을 쓴다', () => {
  const SRC = path.join(__dirname, '..', '..', 'src');
  const WRITERS = [
    'app/(main)/patients/[id]/components/QuickClinicalEntry.tsx',
    'app/(main)/telehealth/[sessionId]/_components/NurseChart.tsx',
    'app/(main)/patients/[id]/encounter/new/components/InternalMedicineEncounterLayout.tsx',
    'hooks/useNurseStation.ts',
  ];

  it.each(WRITERS)('%s 는 응답을 해석한 뒤에 성공을 말한다', (rel) => {
    const s = fs.readFileSync(path.join(SRC, rel), 'utf8');
    expect(s, '정본 해석을 쓰지 않는다 — 화면마다 어휘가 갈라진다').toContain('vitalsIngestNotice(');
    expect(s).toContain('ingestOf(');
  });

  it('🔴 활력 저장 실패를 빈 catch 로 삼키지 않는다', () => {
    const s = fs.readFileSync(path.join(SRC, 'app/(main)/patients/[id]/encounter/new/components/InternalMedicineEncounterLayout.tsx'), 'utf8');
    expect(/catch\s*\{\s*\/\*[^*]*활력[^*]*\*\/\s*\}/.test(s), '실패를 주석만 남기고 삼킨다').toBe(false);
  });
});
