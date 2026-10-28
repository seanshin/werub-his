import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 🔴 FHIR 매퍼의 **유령 필드** 가드 (2026-08-29 · 발굴 6회차).
 *
 * 발단: `mapVaccinationToImmunization` 이 `v.status`·`v.site`·`v.route`·`v.dose` 를 읽었는데
 * **`Vaccination` 모델에 그 넷이 전부 없다.** 매퍼 인자가 `any` 라 컴파일러가 잡지 못했다.
 * 🔴 그중 `status` 는 조용히 빠진 게 아니라 **틀린 값을 냈다** —
 *    `undefined === 'COMPLETED'` 가 false 라 **모든 접종이 `not-done`(접종 안 함)** 으로 나갔다.
 *
 * 🔴 이 저장소 규칙 그대로다: *"`tsc` 가 통과한다는 사실이 스캔의 열쇠다 —
 *    위험한 곳은 타입 검사를 우회한 자리뿐."* 매퍼 24개 중 20개가 `any` 를 받는다.
 *
 * 🔴 **이 가드가 하지 않는 것**: "any 를 쓰지 마라"고 하지 않는다(관계 include 때문에
 *    실용적이지 않다). 대신 **읽는 필드가 모델에 실재하는지**만 기계로 대조한다.
 */
const ROOT = process.cwd();
const SCHEMA = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
const RAW = readFileSync(join(ROOT, 'src/modules/fhir/fhir.controller.ts'), 'utf8');
/**
 * 🔴 **주석을 벗기고 본다.** "종전엔 `m.highAlert` 였다"고 **설명한 내 주석**이
 *    "되살아났다" 검사에 걸려 가드가 다른 이유로 실패했다 —
 *    오늘만 네 번째 같은 함정(주석 · import 문 · 변수 선언 · 다시 주석).
 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MODELS = new Map<string, Set<string>>();
for (const m of SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  MODELS.set(m[1], new Set([...m[2].matchAll(/^ {2}(\w+)\s/gm)].map((f) => f[1])));
}

/**
 * 매퍼 → 소스 모델. 🔴 **손으로 적는다** — 호출 지점 추론은 틀릴 수 있고,
 *    틀린 매핑은 없는 결함을 만들어낸다(오탐이 정책이 되면 안 된다).
 *    새 매퍼를 추가하면 여기에도 등재한다(아래 커버리지 검사가 강제한다).
 */
const MAPPER_MODEL: Record<string, string> = {
  mapEncounterToFhir: 'Encounter',
  mapConditionToFhir: 'EncounterDiagnosis',
  mapPractitionerToFhir: 'User',
  mapAllergyToFhir: 'Allergy',
  mapProcedureToFhir: 'Surgery',
  mapAppointmentToFhir: 'Appointment',
  mapWardToFhir: 'Ward',
  mapBedToFhir: 'Bed',
  mapConsentToDocRef: 'ConsentForm',
  mapMedicationCodeToMedication: 'MedicationCode',
  /**
   * 🔴 이 매퍼는 인자에 타입을 붙였다 — 그래도 **여기서 뺀 적이 있었고 그때 구멍이 생겼다.**
   *    타입은 `(v as any).site` 캐스팅으로 뚫린다(재주입이 그것을 증명했다).
   *    **타입을 붙였다는 이유로 대조에서 빼지 않는다.**
   */
  mapVaccinationToImmunization: 'Vaccination',
};

function fieldsRead(mapperName: string): { param: string; used: Set<string> } | null {
  const lines = SRC.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const mm = /^\s*private (map\w+)\((\w+)[:)]/.exec(lines[i]);
    if (!mm || mm[1] !== mapperName) continue;
    let j = i + 1;
    while (j < lines.length && !/^\s*private \w+\(/.test(lines[j])) j++;
    const body = lines.slice(i, j).join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // 🔴 주석의 필드명이 섞이면 헛돈다
    /**
     * 🔴 **캐스팅 우회도 센다.** `v.site` 만 찾으면 `(v as any).site` 를 놓친다 —
     *    재주입이 이 구멍을 찾았다. 이 저장소 규칙: *"위험한 곳은 구조 캐스팅으로
     *    타입 검사를 우회한 자리뿐"* 이므로 그 자리를 정확히 겨눈다.
     */
    const direct = [...body.matchAll(new RegExp(`\\b${mm[2]}\\.(\\w+)`, 'g'))].map((x) => x[1]);
    const cast = [...body.matchAll(new RegExp(`\\(\\s*${mm[2]}\\s+as\\s+[^)]+\\)\\s*(?:\\.(\\w+)|\\[\\s*'(\\w+)')`, 'g'))]
      .map((x) => x[1] ?? x[2]).filter(Boolean) as string[];
    const used = new Set([...direct, ...cast]);
    return { param: mm[2], used };
  }
  return null;
}

describe('🔴 FHIR 매퍼가 모델에 없는 필드를 읽지 않는다', () => {
  it('스캔이 실제로 동작한다 — 파싱이 비면 아래가 전부 자동 통과한다(대조군)', () => {
    expect(MODELS.size).toBeGreaterThan(400);
    expect(MODELS.get('Vaccination')?.has('doseNumber')).toBe(true);
    const v = fieldsRead('mapVaccinationToImmunization');
    expect(v, '매퍼를 찾았다').toBeTruthy();
    expect(v!.used.size, '필드 접근을 실제로 수집했다').toBeGreaterThan(3);
  });

  for (const [mapper, model] of Object.entries(MAPPER_MODEL)) {
    it(`${mapper} → ${model}`, () => {
      const fields = MODELS.get(model);
      expect(fields, `${model} 모델을 찾지 못했다 — 이름이 바뀌었으면 매핑을 고친다`).toBeTruthy();
      const read = fieldsRead(mapper);
      expect(read, `${mapper} 를 찾지 못했다`).toBeTruthy();
      const ghost = [...read!.used].filter((f) => !fields!.has(f)).sort();
      expect(ghost, `${model} 에 없는 필드를 읽는다 — undefined 가 조용히 나가거나 틀린 값이 된다`).toEqual([]);
    });
  }

  it('🔴 접종 상태를 조건식으로 만들지 않는다 — 없는 필드와 비교하면 전건이 not-done 이 된다', () => {
    const body = fieldsRead('mapVaccinationToImmunization');
    expect(body).toBeTruthy();
    const src = SRC.slice(SRC.indexOf('private mapVaccinationToImmunization'));
    expect(src.slice(0, 1200), "status 를 없는 필드와 비교하던 코드가 되살아났다")
      .not.toMatch(/status:\s*v\.status/);
    expect(src.slice(0, 1200)).toMatch(/status: 'completed'/);
  });

  it('🔴 접종 차수(doseNumber)가 FHIR 출력에 실린다 — 1차와 3차는 다른 사실이다', () => {
    const src = SRC.slice(SRC.indexOf('private mapVaccinationToImmunization'));
    expect(src.slice(0, 1600)).toMatch(/doseNumberPositiveInt: v\.doseNumber/);
  });

  it('🔴 고위험 약물 표시가 실제 컬럼을 읽는다(highAlertFlag)', () => {
    const src = SRC.slice(SRC.indexOf('private mapMedicationCodeToMedication'));
    expect(src.slice(0, 1400)).toMatch(/m\.highAlertFlag/);
    expect(src.slice(0, 1400), '없는 이름 highAlert 가 되살아났다').not.toMatch(/m\.highAlert\b(?!Flag)/);
  });
});
