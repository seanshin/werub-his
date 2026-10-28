import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 구조 가드 — **쓰기 핸들러의 인라인 `@Body` 기준선 동결**(2026-08-18)
 *
 * 전역 ValidationPipe(`whitelist: true`)는 **런타임 metatype 이 클래스일 때만** 돈다.
 * `@Body() body: Record<string, unknown>` · `@Body() body: { a: string }` · `@Body('key') v: string`
 * 처럼 인라인 타입/인터페이스/원시타입이면 metatype 이 `Object`(또는 `String`)라 검증이
 * **통째로 스킵**된다 — 음수 용량·범위 밖 점수·오타 상태값이 그대로 원장에 저장되고,
 * 오타 키는 400 도 아니고 조용한 폐기도 아닌 **정의되지 않은 상태**가 된다.
 *
 * 기존 가드 `external-body-dto.spec.ts` 는 **무가드(외부 수신) 컨트롤러만** 본다.
 * 이 가드는 **직원 JWT 뒤에 있는 내부 쓰기 경로 전체**를 기준선으로 동결한다 —
 * 전면 금지가 아니라 **늘면 실패**다(2026-08-18 실측 잔여 = 아래 BASELINE).
 *
 * 실패하면 둘 중 하나다:
 *   1. 새 쓰기 핸들러가 인라인 @Body 를 썼다 → `class-validator` DTO 로 승격한다.
 *      🔴 승격할 때 **화면이 실제로 보내는 키를 먼저 확인**한다. DTO 에 없는 키는
 *         whitelist 가 조용히 지우므로, 빠뜨리면 그 자리에서 새 유실을 만든다.
 *   2. DTO 로 승격해 줄었다 → 기준선을 **낮춰서** 갱신한다.
 *
 * 판정 규약: CLAUDE.md "입력 검증(DTO)" · docs/03-analysis/input-validation-audit-2026-07.md
 */

const MODULES = path.join(__dirname, '..', '..', 'src', 'modules');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

/** `(`…`)` 균형 — 문자열 리터럴은 건너뛴다 */
function balance(src: string, i: number): number {
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return i;
}

function skipTrivia(src: string, i: number): number {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src.startsWith('/*', i)) {
      i = src.indexOf('*/', i) + 2;
      continue;
    }
    break;
  }
  return i;
}

/** 최상위 콤마로 파라미터 분리 */
function splitParams(sig: string): string[] {
  const inner = sig.slice(1, -1);
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      cur += c;
      i++;
      while (i < inner.length && inner[i] !== q) {
        cur += inner[i];
        if (inner[i] === '\\') cur += inner[++i];
        i++;
      }
      cur += inner[i] ?? '';
      continue;
    }
    if ('([{<'.includes(c)) depth++;
    if (')]}>'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/**
 * 🔴 (2026-09-15 U2) 종전 판정은 **이름 끝 `Dto`** 였다 — class-validator 클래스인 `CreateDiagnosisInput` 류를 인라인으로
 *    오탐하고, 반대로 `interface XxxDto` 는 통과시킬 수 있었다(메모리 규칙: 가드는 이름이 아니라 **선언 종류**를 본다).
 *    이제 타입 이름을 컨트롤러의 import·재export 를 따라가(깊이 4) 실제 선언을 찾는다:
 *      - `class X` + 클래스 본문에 검증 데코레이터(@Is*·@Validate*·@Min/@Max·@Length·@Matches·@Type·@Array*) → 검증됨
 *      - `class X extends PartialType|PickType|OmitType|IntersectionType(` → 검증됨(매핑 타입은 원 클래스 검증을 물려받는다)
 *      - `interface X` · `type X =` · 데코레이터 없는 class · `import type` 으로 들여온 이름 · 못 찾음 → 검증 안 됨
 */
const VALIDATOR_DECORATOR = /@(Is[A-Z]\w*|Validate\w*|Min|Max|Length|MinLength|MaxLength|Matches|Type|Array\w*|Allow|Equals|NotEquals|Contains)\s*\(/;

function resolveModule(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [`${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(c)) return c;
  return null;
}

function classBody(src: string, at: number): string {
  const open = src.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}

export function isValidatedType(typeName: string, fromFile: string, depth = 0): boolean {
  if (depth > 4 || !fromFile || !fs.existsSync(fromFile)) return false;
  const src = fs.readFileSync(fromFile, 'utf8');
  const esc = typeName.replace(/[$]/g, '\\$');
  const cls = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:abstract\\s+)?class\\s+${esc}\\b([^{]*)`).exec(src);
  if (cls) {
    if (/extends\s+(PartialType|PickType|OmitType|IntersectionType)\s*\(/.test(cls[1])) return true;
    if (VALIDATOR_DECORATOR.test(classBody(src, cls.index))) return true;
    // `class RenameErBedDto extends CreateErBedDto {}` — 검증 데코레이터는 부모 클래스에서 물려받는다
    const base = /extends\s+([A-Za-z_$][\w$]*)/.exec(cls[1]);
    return base ? isValidatedType(base[1], fromFile, depth + 1) : false;
  }
  if (new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:interface\\s+${esc}\\b|type\\s+${esc}\\s*[=<])`).test(src)) return false;
  // import { A, B as C } from '...' / export { A } from '...' — `import type` 은 런타임에 사라지므로 따라가지 않는다
  const re = /(import|export)\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[2] && m[1] === 'import') continue;
    // import 목록 안의 주석(`// v2.48.0`)이 이름 앞에 붙어 매칭을 깨뜨렸다 — 주석을 걷고 나눈다
    const names = m[3].replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    for (const part of names.split(',').map((x) => x.trim()).filter(Boolean)) {
      const inlineType = /^type\s+/.test(part);
      const [orig, alias] = part.replace(/^type\s+/, '').split(/\s+as\s+/).map((x) => x.trim());
      if ((alias ?? orig) !== typeName) continue;
      if (inlineType && m[1] === 'import') return false;
      const next = resolveModule(fromFile, m[4]);
      if (next && isValidatedType(orig, next, depth + 1)) return true;
    }
  }
  return false;
}

/** 검증되지 않는 @Body 를 가진 쓰기 핸들러 수 — `file` 이 있으면 타입 이름을 실제 선언까지 따라간다 */
export function countInlineBodyHandlers(src: string, file?: string): number {
  let n = 0;
  const re = /@(Post|Put|Patch|Delete)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let j = balance(src, m.index + m[0].length - 1);
    // 뒤따르는 데코레이터를 모두 건너뛴다(여러 줄 데코레이터 포함)
    for (;;) {
      j = skipTrivia(src, j);
      if (src[j] === '@') {
        let k = j + 1;
        while (k < src.length && /[A-Za-z0-9_.]/.test(src[k])) k++;
        k = skipTrivia(src, k);
        if (src[k] === '(') k = balance(src, k);
        j = k;
        continue;
      }
      break;
    }
    const rest = src.slice(j, j + 300);
    const nm = rest.match(/^(?:async\s+)?([A-Za-z0-9_$]+)\s*(?:<[^>]*>)?\s*\(/);
    if (!nm) continue;
    const pStart = j + rest.indexOf('(', rest.indexOf(nm[1]) + nm[1].length);
    const sig = src.slice(pStart, balance(src, pStart));

    const bodies = splitParams(sig).filter((p) => /@Body\s*\(/.test(p));
    if (!bodies.length) continue;

    const unvalidated = bodies.some((p) => {
      // `@Body('key')` = 원시값 추출 → 파이프 스킵
      if (/@Body\(\s*['"]/.test(p)) return true;
      const noDec = p.replace(/@\w+\([^)]*\)|@\w+/g, '').trim();
      const ci = noDec.indexOf(':');
      if (ci < 0) return true;
      const ty = noDec
        .slice(ci + 1)
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/=.*$/, '')
        .trim();
      if (!ty) return true;
      if (/^\{|^Record<|\bany\b|^unknown|^Partial<|^Pick<|^Omit</.test(ty)) return true;
      if (/^(string|number|boolean|Date)(\[\])?$/.test(ty)) return true;
      if (/^Array</.test(ty)) return true;
      const name = ty.replace(/\[\]$/, '');
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) return true; // 제네릭·합성 타입 = metatype Object
      if (file) return !isValidatedType(name, file);
      return !/Dto$/.test(name); // 파일 없이 부른 경우(픽스처)만 이름 규칙

    });
    if (unvalidated) n++;
  }
  return n;
}

/**
 * 2026-08-18 실측 잔여 — `src/modules` 기준 상대경로 → 인라인 @Body 쓰기 핸들러 수.
 * 총계는 아래 TOTAL_BASELINE 로 함께 동결한다(파일 이동으로 빠져나가지 못하게).
 */
const BASELINE: Record<string, number> = {
  'access-control/access-control.controller.ts': 1, // 2026-09-15 T2 위험 쓰기 DTO 승격
  'admission/admission.controller.ts': 0, // transfer-care 를 TransferCareDto 로 승격(2026-09-01·유효-바디 프로브)
  'agent-session/agent-session.controller.ts': 1,
  'auth/lifecycle/lifecycle.controller.ts': 0, // 2026-09-15 E2 대량 할당·임상 쓰기 DTO 승격
  'auth/step-up/push-approval.controller.ts': 1, // 2026-09-15 E2 대량 할당·임상 쓰기 DTO 승격
  'blockchain-cert/blockchain-cert.controller.ts': 1, // 2026-09-15 B6 발급·정책·반려·갱신·폐기·PIN 2 = 7 DTO · 잔여 1 = `PUT policies`(본문 자체가 역할→boolean 맵 · 호출 화면 없음)
  'cancer-registry/cancer-registry.controller.ts': 0, // 2026-09-15 B9 9차 배치 5 DTO(날짜·길이 500·추적관찰 recurrence "false")
  'checkup/checkup-protocol.controller.ts': 4,
  'checkup/checkup.controller.ts': 0, // 2026-09-15 B5 접수·서명·단체계약 3·레거시 스테이션·문진 3·스테이션 4 = 13 DTO · B4 예약 취소·변경·스킵·결과·패널·판독·추적·의뢰 8 DTO
  'clinical-pathway/clinical-pathway.controller.ts': 0, // 2026-09-15 B9 9차 배치 6 DTO(🔴 결과 시행자 performedBy 본문 지정→로그인 사용자 · isRequired "false")
  'cms-config/cms-config.controller.ts': 2,
  'code-master/code-master.controller.ts': 5, // 2026-09-15 B10 매핑 확정·거부·임상 승인/반려·부서 배정 5 DTO(🔴 확정 selectedCode 누락·후보 밖 → 첫 후보로 조용히 확정 · 거부가 CONFIRMED 를 REJECTED 로 뒤집음) · U2 — *Input class-validator 6건은 이름 판정 오탐이었다(선언 종류 판정으로 제외) · E2 DTO 승격
  'concierge/concierge.controller.ts': 5, // 6→5 H1 공개 본인 인증 verify 를 ConciergePatientAuthDto 로(개별 @Body(key) 가 ValidationPipe 를 건너뛰어 Prisma 연산자 주입 → 본인 인증 우회 · 2026-09-16)
  'consent-template/consent-template.controller.ts': 2,
  'consent/consent-devices.controller.ts': 1, // 2026-09-15 T2 위험 쓰기 DTO 승격
  'consent/consent.controller.ts': 2, // 2026-09-15 T2 위험 쓰기 DTO 승격
  // 🔴 2026-08-26: 협진 의뢰(`POST /consultations`)를 `CreateConsultationDto` 로 승격 — 2 → 1.
  //    **기준선은 낮추기만 한다**(올리면 결함을 못 박는 것이다).
  'consultation/consultation.controller.ts': 0, // 2026-09-15 B10 회신 ReplyConsultationDto(내용 없는 REPLIED)
  'cost-analysis/cost-analysis.controller.ts': 0, // 2026-09-15 B6 중심점·동인 생성/수정·수동 배부(금액·출처 대량 할당 + 화면 계약 불일치로 저장 0)·기간 3 = 8 DTO
  'crm/crm.controller.ts': 6, // 2026-09-15 B4 캠페인·세그먼트·템플릿·동의·해외환자·소통·배너 11 DTO(수정 4종 대량 할당)
  'cssd/cssd-inventory.controller.ts': 0, // 2026-09-15 N4-B8 공급업체·품목 등록/수정·공급 4 DTO(품목 수정 본문 전체 update — stock 직접 수정으로 입출고 원장 우회·qty 문자열 결합)
  'cssd/cssd-package.controller.ts': 2, // 2026-09-15 N4-B8 사용·리콜·로드 회수 3 DTO · 2026-09-14 R5 — repackage 를 RepackageDto 로 승격(6→5)
  'dashboard/dashboard-config.controller.ts': 1,
  'data-quality/data-quality.controller.ts': 0, // 2026-09-15 B10 안내 초안(유형 오타 → 조용히 recall)·전화 정규화 적용(101번째부터 말없이 버림·중간 500 부분 적용) 2 DTO
  'discharge-summary/discharge-summary.controller.ts': 1, // 2026-09-15 B10 수정 `Partial<>`(metatype Object → 검증 스킵) → PartialType DTO · 빈 수정이 서명본을 AMENDED 로 뒤집음 · 잔여 1 = 서명(블록체인 서명 헬퍼 경로 — 서명 갈래 몫)
  'doctor-code/doctor-code.controller.ts': 0, // 2026-09-15 B5 처방 세트 생성·수정(수정은 `...updates` 대량 할당)·카탈로그 가져오기 DTO
  'doctors/doctors.controller.ts': 0, // 2026-09-15 B10 빠른 회진 QuickRoundDto
  'eligibility/eligibility.controller.ts': 0, // 2026-09-15 B9 9차 배치 2 DTO(자격조회 visitType 어휘·본인확인 uuid·방법 길이)
  'encounter/encounter.controller.ts': 1, // 2026-09-15 B10 빈 초안 정리 cutoffHours 0·음수(방금 연 초안까지 삭제 대상)·NaN 500 · 잔여 1 = 서명(서명 갈래 몫)
  'fhir-lab/fhir-lab.controller.ts': 2,
  'fhir/fhir.controller.ts': 4,
  'foreign-patient/foreign-patient.controller.ts': 1,
  'formulary/formulary.controller.ts': 1, // 2026-09-15 B10 실적 등재 months·AI 초안·체크리스트 저장(🔴 aiGenerated "false"=AI 생성 표기) 3 DTO · 잔여 1 = `PATCH policy`(본문 자체가 영역→모드 맵 · 서비스가 영역·모드 400 검사 — DTO 로 옮기면 미지 영역이 whitelist 로 조용히 사라진다)
  'hie/hie.controller.ts': 2,
  'hira-edi/hira-edi.controller.ts': 1,
  'homepage-popup/homepage-popup.controller.ts': 2,
  'hospice/hospice.controller.ts': 0, // 2026-09-15 B10 상태 변경 `@Body('status')` → DTO · 2026-09-15 E2 대량 할당·임상 쓰기 DTO 승격
  'hospital-info/hospital-info.controller.ts': 8, // 2026-09-15 B7 콘텐츠 상태 변경 DTO
  'hr/hr.controller.ts': 0, // 2026-09-15 B4 보고라인·재직상태 DTO
  'integration-gate/integration-gate.controller.ts': 1,
  'integration/integration-admin.controller.ts': 0, // 2026-09-15 B10 웹훅 등록·수정 2 DTO(이벤트 오타 조용히 걸러 일부만 구독·format 소문자 → RAW·isActive "false" 500)
  'internal-medicine/internal-medicine.controller.ts': 1,
  'lab/lab.controller.ts': 0, // 2026-09-15 B5 기록지 서명 DTO
  'mdt/mdt.controller.ts': 0, // 2026-09-15 B9 9차 배치 6 DTO(참석 attended "false"·일시·uuid 500)
  'medical-ai/medical-ai.controller.ts': 10,
  'medical-record-issuance/staff-document.controller.ts': 2, // 2026-09-15 U4 반려·교부·대리인 검증 DTO(조용한 slice 절단 → 400)
  'nurse-station/nurse-station.controller.ts': 0, // 2026-09-15 B10 담당환자 배정 AssignNursePatientDto(근무조 enum·isPrimary 불리언)
  'nursing/nursing.controller.ts': 2, // 2026-09-15 B7 체크리스트·중재 상태·결과 평가·템플릿 5 DTO · E2 대량 할당·임상 쓰기 DTO 승격
  'nutrition/nutrition-advanced.controller.ts': 0, // 2026-09-15 B10 특수영양 생성·수정(Record 본문 · 음수 주입속도·상태 임의 · 🔴 시작일 new Date() KST 전날)·식사 섭취(🔴 trayCollected "false"=회수·섭취율 150%) 3 DTO
  'nutrition/nutrition.controller.ts': 0, // 2026-09-15 B4 생산·검식·HACCP·배식확인·직원 식단/식수 9 DTO
  // 🔴 2026-08-26 F3 — 마지막 1건(`newborns/:id/verify-match`)이 `VerifyNewbornMatchDto` 로 회수돼 0 이 됐다.
  //    기준선은 내리기만 한다(올리면 신규 위반을 흡수한다).
  'obgyn/obgyn.controller.ts': 0,
  'omop-cdm/omop-cdm.controller.ts': 1,
  'onboarding/onboarding-welcome.controller.ts': 1,
  'order-set/order-set.controller.ts': 1,
  'organization/organization.controller.ts': 0, // 2026-09-15 E2 대량 할당·임상 쓰기 DTO 승격
  'pathology/pathology.controller.ts': 0, // 2026-09-15 N4-B8 슬라이드(본문을 clinicalInfo JSON 에 펼쳐 저장)·이미지 2 DTO
  'patient-auth/patient-auth.controller.ts': 0, // 2026-09-15 N4-B8 FCM 토큰 갱신·푸시 토큰 등록 2 DTO
  'patient-flag/patient-flag.controller.ts': 0, // 2026-09-15 U4 마킹 CreatePatientFlagDto(사유 1000자 조용한 절단 → 400)
  'patient-flow/patient-flow.controller.ts': 0, // 2026-09-15 B10 스테이션 활성 `@Body('isActive')`(빈 본문 = 무변경 성공) → DTO
  'patient-safety/patient-safety.controller.ts': 0, // 2026-09-15 E2 대량 할당·임상 쓰기 DTO 승격 // RCA 2건 DTO 승격(2026-08-18 보고자 보호 축) — 잔여 2 = identification-check·morse-fall-scale
  // 2026-08-26 약사 임상활동 축 — 쓰기 7개 전부 DTO 승격(CreateInterventionDto 등) → 0
  'pharmacist-activity/pharmacist-activity.controller.ts': 0,
  // 2026-08-26 복약지도 등록·Naranjo 계산 DTO 승격(고아 EP 회수와 한 벌) → 12 → 10
  'pharmacy/pharmacy.controller.ts': 0, // 2026-09-15 B5 검수·불출·분할 2·대체조제(대량 할당)·기기(대량 할당)·ATC·라벨 8 DTO + 조제완료 시그니처 안 주석 오탐 1 · T2 위험 쓰기 DTO 승격
  'phase0-cutover/phase0-cutover.controller.ts': 0, // 2026-09-15 B10 컷오버 승인 DTO(체크리스트 본문 객체를 통째로 승인 원장에 저장 → 정본 6키만)
  'portal/portal.controller.ts': 0, // 2026-09-15 B6 자가측정·셀프 체크인·동의 서명(ipAddress 대량 할당)·철회·검진 문진·원격 메시지/평가/예약·AI 질문·문진표 제출 10 DTO · checkup-reserve 를 CheckupReserveDto 로 승격(2026-09-01·환자 500→400)
  'pre-order/pre-order.controller.ts': 0, // 2026-09-15 B5 승인·수정 `@Body('key')` 원시 추출 → DTO(수정 `...updates` 명시 필드)
  'qi/qi.controller.ts': 2,
  'record-timeline/record-timeline.controller.ts': 1,
  'referral-letter/referral-letter.controller.ts': 0, // 2026-09-15 B10 초안 생성(`body as any`)·수정(빈 본문 → editedByDoctor 만 true)·거절·폐기 4 DTO
  'registration-consent/registration-consent.controller.ts': 0, // 2026-09-15 N4-B8 창구 일괄·개별 동의 2 DTO(서명 방식 본문 지정·개별 수정 기본값 PORTAL → 서버가 HIS)
  'rehab/rehab.controller.ts': 0, // 2026-09-15 B9 9차 배치 2 DTO(🔴 세션 시작 overrideGate "false"=안전게이트 BLOCK 우회 · 세션 생성 weeks)
  'remote-consultation/remote-consultation.controller.ts': 0, // 2026-09-15 N4-B8 진료과 설정(본문 전체 정책 저장)·답변·종료·처방(수량·일수 무검증)·안내·화상 제안 6 DTO
  'risk-reassessment/risk-reassessment.controller.ts': 1,
  'satisfaction/satisfaction.controller.ts': 4,
  'schedule/schedule.controller.ts': 0, // 2026-09-15 B10 직원 대기자 등록 RegisterWaitlistDto(희망일 Invalid Date 500)
  'sign-integration/sign-integration.controller.ts': 2, // 2026-09-15 N4-B8 일괄 등록·제출·요청 3 DTO(inPerson "false"=대면 → 고위험 동의 본인확인 수준 하향) · 잔여 ERP 공개 발의·웹훅(외부 계약)
  'smart-auth/smart-auth.controller.ts': 1,
  'staff-call/staff-call.controller.ts': 0, // 2026-09-15 B10 호출 취소 CancelStaffCallDto(🔴 falseAlarm "false"=허위 CODE 플래그)
  'telehealth/telehealth.controller.ts': 2, // 2026-09-15 N4-B8 세션 생성·종료·평가 3 DTO · 2026-09-14 비동기 진료 환자 메시지·의사 답변 → DTO 승격(기획서 전체 검토)
  'transfer/transfer.controller.ts': 1, // 2026-09-15 T2 위험 쓰기 DTO 승격
  'transplant/transplant.controller.ts': 0, // 2026-09-15 B6 교차시험 2(판정 없는 기록이 NEGATIVE 로 게이트 통과)·거부 결과·KONOS·HLA·TDM·추적 7 DTO · E2 대량 할당·임상 쓰기 DTO 승격
  'treatment-template/treatment-template.controller.ts': 2, // 2026-09-15 B9 9차 배치 4 DTO(🔴 일정 항목 cancel "false"=항목+미결 사전처방 취소·shiftFollowing "false"=일괄 이동 · 전개 anchorDate)
  'triage/triage.controller.ts': 0, // 2026-09-15 B5 평가·별칭 일괄(`data: item`) DTO
  'twin/fhir-writeback.controller.ts': 2,
  'voc/voc-admin.controller.ts': 2,
  'voucher/distributor.controller.ts': 0, // 2026-09-15 B10 딜러 발송(🔴 공급단가 음수·소수가 해시 체인 원장에 박힘)·수령확인(문자열 → 글자 단위 조회) 2 DTO
  'waiting-queue/waiting-queue.controller.ts': 0, // 2026-09-15 B10 접수 QueueCheckInDto(🔴 과 누락 → 중복 검사가 전 과 대상) · 2026-09-15 N4-B8 접수 정정 1 DTO
  'workstation/workstation.controller.ts': 0, // 2026-09-15 B9 6 DTO(🔴 촬영 overrideSafety "false"=영상 안전게이트 강제 시행·선량 문자열·반복 오더 isRecurring "false") · completeLabResult 를 CompleteLabResultDto 로 승격(2026-09-01)
};
const TOTAL_BASELINE = 96; // 97→96 H1 공개 환자 본인 인증 verify DTO 승격(연산자 주입 차단 · 2026-09-16) · 129→97 B10 10차 배치 32 핸들러 DTO(코드매핑 검토 5·의뢰서 4·특수영양/섭취 3·처방집 3·자료품질 2·웹훅 2·검진권 2·퇴원요약/초안정리 2·호출/배정/스테이션/호스피스/회진/협진/접수/대기자/컷오버 9 · 🔴 매핑 확정이 후보 밖 선택을 첫 후보로 조용히 확정·거부가 확정본을 뒤집음·트레이 회수 "false"·허위 CODE "false"·AI 생성 표기 "false"·공급단가 음수가 해시 원장에·특수영양 시작일 KST 전날·빈 수정이 서명본 AMENDED · 2026-09-15) · 160→129 B9 9차 배치 31 핸들러 DTO(임상경로 6·MDT 6·워크스테이션 6·암등록 5·치료일정 템플릿 4·재활 2·자격조회 2 · 문자열 "false"=참 3곳이 안전게이트/취소를 켰다(재활 overrideGate·영상 overrideSafety·일정 cancel/shiftFollowing)·임상경로 결과 시행자 본문 지정 · 2026-09-15) · 186→160 N4-B8 8차 배치 26 핸들러 DTO(비대면 6·CSSD 7·외부서명 3·원격진료 3·창구 동의 2·병리 2·환자 푸시 2·접수 정정 1 · 품목 수정 stock 직접 수정(입출고 원장 우회)·비대면 진료과 설정 본문 전체 정책 저장·병리 슬라이드 본문 JSON 펼침·외부서명 inPerson "false"=대면·창구 동의 서명 방식 본문 지정 · 2026-09-15) · 220→186 B7 7차 배치 34 핸들러 DTO(당직 9·ICU 7·응급 6·간호 5·문서 서명 3·자격 3·병원정보 1 · 당직 승인 문자열 "false"=승인·교대/휴가/선호 대리 신청·문서 서명 서명자/증빙 본문 지정+타인 인증서·체크리스트 "false"=체크·SBT PASS/RASS 0/준수율 100 기본값 · 2026-09-15) · 252→220 B6 6차 배치 32 핸들러 DTO(포털 10·원가 8·전자인증서 7·이식 7 · 원가 수동 배부 금액·출처 대량 할당+화면 계약 불일치·동의 서명 ipAddress·교차시험 무판정 NEGATIVE · 2026-09-15) · 282→252 B5 5차 배치 29 핸들러 DTO + 주석 오탐 1(검진 13·약국 8+1·의사코드 3·사전오더 2·트리아지 2·검사 1 · 대체조제·약국 기기·처방 세트 수정·사전오더 수정·별칭 일괄 대량 할당 · 2026-09-15) · 312→282 B4 4차 배치 30 핸들러 DTO(CRM 11·검진 8·급양 9·인사 2 · CRM 수정 4종 대량 할당 · 2026-09-15) · 316→312 U4 조용한 저장 절단 4 핸들러 DTO(환자 마킹·발급 반려·교부·대리인 검증 · 2026-09-15) · 353→316 U2 3차 배치 24 핸들러 DTO + 여유 13 제거(파일별 합 340 인데 총계가 353 이었다 — 여유는 신규 위반을 흡수한다)(수련 4·KONIS·손위생·격리해제·GLD 위원회·회의·정책 7·임상연구·IRB 10 · 2026-09-15) · 359→353 U2 판정 교정 — 이름 끝 Dto 가 아니라 선언 종류(code-master *Input 6 오탐 제거 · 2026-09-15) · 383→359 E2 대량 할당·임상 쓰기 24 핸들러 DTO(기관·이식·호스피스·환자식별·Morse·표준매핑·인증정책·폰승인·NIC/NOC·내성감시·격리 · 2026-09-15) · 384→383 본인 비밀번호 변경 ChangePasswordDto(2026-09-15 T1) · 409→384 T2 위험 쓰기 25 핸들러 DTO(처방·마약류·청구·수납·동의·입원·전원·ADR·사용자·메뉴 권한 · 2026-09-15) · 410→409 CSSD 재포장 RepackageDto(2026-09-14 R5) · 413→410 CRM 예약 대행 3 DTO(2026-09-14) · 417→413 코드블루·RRT 4 DTO(2026-09-14) · 419→417 원격진료 비동기 메시지·답변 DTO(2026-09-14) · 424→423 마약류 · 423→422 검진예약 · 422→420 전과+검사결과 DTO(2026-09-01 유효-바디) · 420→419 파트너 공개신청 DTO(2026-09-02 — 폼 배선 후 빈 바디 500 실측)

describe('쓰기 핸들러 인라인 @Body 기준선 (ValidationPipe 커버리지)', () => {
  const files = walk(MODULES);
  const found: Record<string, number> = {};
  for (const f of files) {
    const n = countInlineBodyHandlers(fs.readFileSync(f, 'utf8'), f);
    if (n > 0) found[path.relative(MODULES, f).split(path.sep).join('/')] = n;
  }

  it('컨트롤러를 실제로 수집한다(스캔이 비면 가드가 아니다)', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('🔴 새 컨트롤러가 인라인 @Body 로 쓰기를 받지 않는다', () => {
    const newFiles = Object.keys(found)
      .filter((f) => !(f in BASELINE))
      .sort();
    expect(newFiles, `DTO 없이 본문을 받는 신규 컨트롤러:\n  ${newFiles.join('\n  ')}`).toEqual([]);
  });

  it('🔴 기존 컨트롤러에서 인라인 @Body 가 늘지 않는다', () => {
    const grown = Object.entries(found)
      .filter(([f, n]) => f in BASELINE && n > BASELINE[f])
      .map(([f, n]) => `${f}: ${BASELINE[f]} → ${n}`)
      .sort();
    expect(grown, `기준선 초과:\n  ${grown.join('\n  ')}`).toEqual([]);
  });

  it('DTO 승격으로 줄었으면 기준선을 낮춘다', () => {
    const stale = Object.entries(BASELINE)
      .filter(([f, n]) => (found[f] ?? 0) < n)
      .map(([f, n]) => `${f}: 기준선 ${n} → 실제 ${found[f] ?? 0}`)
      .sort();
    expect(stale, `기준선 갱신 필요(낮추기):\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('총계가 기준선을 넘지 않는다(파일 이동 회피 차단)', () => {
    const total = Object.values(found).reduce((a, b) => a + b, 0);
    expect(total, `인라인 @Body 총계 ${total} > 기준선 ${TOTAL_BASELINE}`).toBeLessThanOrEqual(TOTAL_BASELINE);
  });

  it('🔴 총계 기준선에 여유가 없다(파일별 합과 같다 — 2026-09-15 U2 에서 여유 13 발견)', () => {
    const sum = Object.values(BASELINE).reduce((a, b) => a + b, 0);
    expect(TOTAL_BASELINE, `총계 기준선 ${TOTAL_BASELINE} ≠ 파일별 합 ${sum}`).toBe(sum);
  });
});

describe('판정은 이름이 아니라 선언 종류다(2026-09-15 U2)', () => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'inline-body-'));
  fs.mkdirSync(path.join(tmp, 'dto'));
  fs.writeFileSync(path.join(tmp, 'dto', 'a.dto.ts'), [
    "import { IsString, IsOptional } from 'class-validator';",
    'export class GoodInput { @IsString() name!: string; }',
    'export class ChildInput extends GoodInput {}',
    'export class BareDto { name!: string; }',
    'export interface IfaceDto { name: string }',
    'export type AliasDto = { name: string };',
  ].join('\n'));
  fs.writeFileSync(path.join(tmp, 'svc.ts'), "export { GoodInput } from './dto/a.dto';\n");
  const ctl = path.join(tmp, 'x.controller.ts');
  fs.writeFileSync(ctl, [
    "import { GoodInput } from './svc';",
    "import {\n  // 주석이 이름 앞에 붙어도\n  ChildInput, BareDto, IfaceDto, AliasDto,\n} from './dto/a.dto';",
    "import type { GoodInput as TypeOnlyInput } from './dto/a.dto';",
  ].join('\n'));
  const handler = (ty: string) => `@Post('x')\n  async h(@Body() body: ${ty}) {}\n`;
  const count = (ty: string) => countInlineBodyHandlers(handler(ty), ctl);

  it('class-validator 클래스는 이름이 Dto 로 끝나지 않아도 검증된다(재export·상속·import 주석 경유)', () => {
    expect(count('GoodInput')).toBe(0);
    expect(count('ChildInput')).toBe(0);
  });
  it('🔴 대조군 — interface·type alias·데코레이터 없는 class·Record·import type 은 이름이 Dto 여도 인라인이다', () => {
    expect(count('IfaceDto')).toBe(1);
    expect(count('AliasDto')).toBe(1);
    expect(count('BareDto')).toBe(1);
    expect(count('Record<string, unknown>')).toBe(1);
    expect(count('TypeOnlyInput')).toBe(1);
    expect(count('NowhereDto')).toBe(1);
  });
});
