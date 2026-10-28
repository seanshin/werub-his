import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 🔴 **화면이 지어낸 전화번호·주소를 그리지 않는다** — 2026-09-12.
 *
 * 실측: `(main)/facility-info` 가 대표전화 `02-1234-5678` · 응급실 `02-1234-5679` ·
 * 장례식장 `02-1234-5670` 과 주소 `서울시 강남구 · 강남역 3번 출구 도보 5분` 을 찍고 있었다.
 * 🔴 **앱 안에 정본이 이미 있었다** — `lib/hospital-contact.ts`(대표 `02-000-0000` ·
 * 응급 `02-000-0119`)와 `components/homepage/hospital-facts.ts`(주소 `가상특별자치도 가상시 가상로 126`).
 * 그 정본은 2026-08-19 에 환자 포털이 **틀린 응급실 번호**를 찍던 것을 고치려고 만든 파일인데,
 * 이 화면만 그 길을 지나지 않았다 — **정본을 만든 것과 모든 소비처가 그것을 쓰는 것은 다른 일이다.**
 *
 * 🔴 `가상구 가상로 1` 은 `HOSPITAL.seoulOffice`(사무소)다. 병원 소재지가 아니다 —
 *    그것이 병원 위치로 둔갑해 있었다. 사무소 주소를 쓰는 화면(오시는 길 등)은 정본 필드를 지나므로
 *    이 가드는 **상수 리터럴로 박힌 것만** 잡는다.
 */

const WEB = path.resolve(__dirname, '../../src');
/** 데모·플레이스홀더로 굳은 번호대 — 실제 기관 번호가 아니다(하이픈 유무 모두) */
const FAKE_PHONE = /0?2-?1234-?56\d{2}/;
/** 기관 소재지가 아닌 곳을 병원 위치로 쓰는 자리 */
const WRONG_PLACE = /강남역\s*\d*번\s*출구/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}
/** 🔴 주석을 먼저 걷는다 — 이 저장소는 주석이 문자열 검사에 걸려 가드가 헛돈 적이 있다 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/^\s*\*.*$/gm, '');

describe('🔴 기관 연락처·소재지 — 화면이 지어내지 않는다', () => {
  it('대조군 — 앱 정본이 실제로 그 값을 갖고 있다(정본이 비면 이 가드는 아무것도 보증하지 않는다)', () => {
    const contact = fs.readFileSync(path.join(WEB, 'lib/hospital-contact.ts'), 'utf-8');
    expect(contact).toContain("main: '02-000-0000'");
    expect(contact).toContain("emergency: '02-000-0119'");
    const facts = fs.readFileSync(path.join(WEB, 'components/homepage/hospital-facts.ts'), 'utf-8');
    expect(facts).toContain('가상특별자치도 가상시 가상로 126');
    expect(facts, '서울 사무소 주소는 정본에 **사무소로** 남아 있어야 한다(지운 것이 아니다)').toMatch(/seoulOffice/);
    expect(walk(WEB).length, '스캔 대상이 사라졌다').toBeGreaterThan(500);
  });

  /**
   * 🔴 **입력 형식 예시(placeholder)는 사실을 주장하지 않는다** — 거래처 전화 입력칸의
   *    `placeholder="02-1234-5678"` 은 "이렇게 입력하라"는 형식 안내다. 사유를 적고 허용한다.
   *    허용은 **줄 단위로 이름을 대고** 한다(파일 통째로 열면 그 파일의 새 위반을 흡수한다).
   */
  const ALLOW: Record<string, string> = {
    "app/(main)/equipment/components/EquipmentRegisterForm.tsx:supplierPhone": '거래처 전화 입력 형식 예시(placeholder) — 기관 사실이 아니다',
    "app/(main)/equipment/components/EquipmentRegisterForm.tsx:asContactPhone": 'A/S 연락처 입력 형식 예시(placeholder) — 기관 사실이 아니다',
  };

  it('🔴 데모 전화번호(02-1234-56xx)가 화면 코드에 없다(0 동결)', () => {
    const hits: string[] = [];
    for (const f of walk(WEB)) {
      const rel = path.relative(WEB, f);
      stripComments(fs.readFileSync(f, 'utf-8')).split('\n').forEach((line, i) => {
        if (!FAKE_PHONE.test(line)) return;
        // placeholder 허용은 그 줄이 어떤 필드인지까지 확인한다(줄 번호는 편집으로 밀린다)
        if (Object.entries(ALLOW).some(([k]) => k.startsWith(`${rel}:`) && line.includes(k.split(':').pop()!) && /placeholder=/.test(line))) return;
        hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
      });
    }
    expect(hits, `지어낸 전화번호 ${hits.length}건 — 정본(\`lib/hospital-contact.ts\`)을 쓰거나 "정본 미등재"라고 말하세요:\n${hits.join('\n')}`).toEqual([]);
  });

  it('대조군 — 허용 목록이 가리키는 자리가 실제로 존재한다(없는 것을 가리키는 예외는 죽은 예외다)', () => {
    for (const [k, why] of Object.entries(ALLOW)) {
      const [rel, field] = [k.slice(0, k.lastIndexOf(':')), k.slice(k.lastIndexOf(':') + 1)];
      const src = fs.readFileSync(path.join(WEB, rel), 'utf-8');
      expect(src, `${k}: 허용 대상이 사라졌다 — 예외를 지운다`).toContain(field);
      expect(why.length, `${k}: 사유가 비었다`).toBeGreaterThan(10);
    }
  });

  it('🔴 사무소 위치를 병원 위치로 그리지 않는다(0 동결)', () => {
    const hits: string[] = [];
    for (const f of walk(WEB)) {
      stripComments(fs.readFileSync(f, 'utf-8')).split('\n').forEach((line, i) => {
        if (WRONG_PLACE.test(line)) hits.push(`${path.relative(WEB, f)}:${i + 1}  ${line.trim().slice(0, 110)}`);
      });
    }
    expect(hits, `기관 소재지가 아닌 길 안내 ${hits.length}건:\n${hits.join('\n')}`).toEqual([]);
  });

  it('🔴 facility-info 는 정본을 경유하고, 등재되지 않은 정보임을 스스로 말한다', () => {
    const src = fs.readFileSync(path.join(WEB, 'app/(main)/facility-info/page.tsx'), 'utf-8');
    expect(src, '연락처 정본을 import 하지 않는다').toMatch(/from '@\/lib\/hospital-contact'/);
    expect(src, '기관 사실 정본을 import 하지 않는다').toMatch(/from '@\/components\/homepage\/hospital-facts'/);
    expect(src, '대표전화가 정본을 지나지 않는다').toMatch(/HOSPITAL_CONTACT\.main/);
    expect(src, '응급실 번호가 정본을 지나지 않는다').toMatch(/HOSPITAL_CONTACT\.emergency/);
    expect(src, '주소가 정본을 지나지 않는다').toMatch(/HOSPITAL\.address/);
    expect(src, '정본이 없는 연락처를 "정본 미등재"로 말하지 않는다').toMatch(/정본 미등재/);
    expect(src, '아래 시설 정보가 등재된 것이 아님을 화면이 말하지 않는다').toMatch(/시스템에 등재된 정보가 아니라 예시이며/);
  });
});
