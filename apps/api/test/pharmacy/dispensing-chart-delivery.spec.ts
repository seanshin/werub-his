import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * 약국 조제 → 차트 전달 봉합 가드 (F1 · 2026-08-26).
 *
 * 🔴 이 가드들은 **결함을 재주입하면 반드시 실패해야** 한다. 재주입 검증 결과는
 *    커밋 메시지가 아니라 이 파일의 단언 형태로 남긴다 —
 *    "그 문자열이 있다"가 아니라 **"그 문자열이 없으면 실패한다"** 로 조준한다.
 *
 * 소스 텍스트 대조를 쓰는 이유: 여기서 깨지는 것들은 **배선(누가 무엇을 include/전송하는가)**
 * 이라 순수 함수 테스트로는 잡히지 않는다. 실제로 이 저장소에서 목(mock)이 코드가 가정한
 * 모양을 되돌려주는 바람에 가드가 결함을 못 박은 사례가 여러 번 있었다.
 */

const API = join(__dirname, '../../src');
const WEB = join(__dirname, '../../../web/src');
const read = (p: string) => readFileSync(p, 'utf-8');

const prescriptionService = read(join(API, 'modules/prescription/prescription.service.ts'));
const prescriptionController = read(join(API, 'modules/prescription/prescription.controller.ts'));
const pharmacyService = read(join(API, 'modules/pharmacy/pharmacy.service.ts'));
const pharmacyController = read(join(API, 'modules/pharmacy/pharmacy.controller.ts'));
const workstationService = read(join(API, 'modules/workstation/workstation.service.ts'));

const medicationTab = read(join(WEB, 'app/(main)/patients/[id]/components/MedicationTab.tsx'));
const orderTrackingTab = read(join(WEB, 'app/(main)/patients/[id]/components/OrderTrackingTab.tsx'));
const pharmacyPage = read(join(WEB, 'app/(main)/pharmacy/page.tsx'));
const wsPharmacyPage = read(join(WEB, 'app/(main)/workstation/pharmacy/page.tsx'));

/** 주석을 코드로 세지 않는다 — 줄 주석·블록 주석을 걷어낸 뒤 판정한다. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('A. 차트가 조제·불출을 안다', () => {
  it('🔴 findByPatient 가 orders 안에 dispensing 을 include 한다', () => {
    // 재주입: `dispensing: { select: ...}` 블록을 지우면 실패한다.
    const body = prescriptionService.slice(
      prescriptionService.indexOf('async findByPatient('),
      prescriptionService.indexOf('async findActiveByPatient('),
    );
    expect(body).toContain('dispensing:');
    // 차트가 실제로 필요한 사실들 — 하나라도 빠지면 그 사실은 화면에 못 간다
    for (const f of ['dispensedAt', 'verifiedAt', 'issuedAt', 'issuedTo', 'secondCheckAt']) {
      expect(body, `findByPatient 의 dispensing select 에 ${f} 가 없다`).toContain(f);
    }
  });

  it('🔴 투약 이력 탭이 orders/dispensing 을 실제로 읽는다', () => {
    // 종전엔 이 파일에 `orders` 가 **0건**이었다(처방 상태만 그렸다).
    const code = stripComments(medicationTab);
    // 🔴 **정의가 있는 것과 렌더되는 것은 다른 일이다.** 처음 이 단언은 `toContain('DispensingChain')`
    //    이었는데, 재주입으로 렌더 호출만 지웠을 때 **함수 정의가 남아 통과**했다
    //    (= 컴포넌트를 만들어 두고 아무도 부르지 않던 상태를 그대로 허용). 호출 지점을 조준한다.
    expect(code).toMatch(/<DispensingChain\s+orders=\{rx\.orders\}\s*\/>/);
    expect(code).toMatch(/orders\?:\s*OrderInfo\[\]/);
    expect(code).toContain('dispensingStage');
    // 수령자가 차트에 실제로 렌더된다
    expect(code).toContain('issuedTo');
  });

  it('🔴 오더 추적 탭이 수령자·검수 시각을 렌더한다', () => {
    const code = stripComments(orderTrackingTab);
    expect(code).toContain('DispensingFacts');
    expect(code).toContain('issuedTo');
    expect(code).toContain('verifiedAt');
  });
});

describe('B. 조제 완료 ≠ 불출 완료 (상태 전이는 그대로 두고 화면이 사실을 말한다)', () => {
  it('🔴 상태 전이 규약을 바꾸지 않았다 — 조제 완료 시 order 는 여전히 COMPLETED', () => {
    // 이 단언이 깨졌다면 누군가 전이를 바꾼 것이다(다른 소비처가 함께 깨진다).
    const body = pharmacyService.slice(pharmacyService.indexOf('async completeDispensing('));
    expect(body).toMatch(/status:\s*'COMPLETED'/);
  });

  it('🔴 오더 추적 탭이 order.status 만으로 완료를 판정하지 않는다', () => {
    const code = stripComments(orderTrackingTab);
    // 약은 dispensing 으로 판정해야 한다
    expect(code).toContain('dispensingStage({ orderStatus: order.status, dispensingStatus: order.dispensing?.status })');
    // 재주입: 아래 5단계 라벨을 4단계로 되돌리면 실패한다
    // 🔴 문맥 키(`접수@상태`)를 허용한다 — i18n 라운드가 동음이의를 문맥으로 갈랐고,
    //    그때 이 가드가 대상을 잃었다(2026-09-08). 단계 **수와 순서**는 그대로 검사한다.
    expect(code).toMatch(
      /MEDICATION:\s*\['처방(@[^']*)?',\s*'접수(@[^']*)?',\s*'조제(@[^']*)?',\s*'검수(@[^']*)?',\s*'불출(@[^']*)?'\]/,
    );
  });

  it('🔴 완료 목록 판정이 약에 대해서는 ISSUED 를 요구한다', () => {
    const code = stripComments(orderTrackingTab);
    expect(code).toContain("=== 'ISSUED'");
  });
});

describe('C. 없는 상태를 화면이 지어내지 않는다', () => {
  // 2026-09-30: 중단(DISCONTINUED) 추가 — 여전히 COMPLETED·SUSPENDED 같은 지어낸 상태는 없다
  it('🔴 PrescriptionStatus 는 스키마가 정본(ACTIVE·CANCELLED·DISCONTINUED)', () => {
    const schema = read(join(__dirname, '../../prisma/schema.prisma'));
    const m = schema.match(/enum PrescriptionStatus \{([\s\S]*?)\}/);
    expect(m).toBeTruthy();
    const values = m![1].split('\n').map((l) => l.trim()).filter(Boolean);
    expect(values.filter((v) => !v.startsWith('///')).sort()).toEqual(['ACTIVE', 'CANCELLED', 'DISCONTINUED']);
  });

  it('🔴 투약 이력 탭이 존재하지 않는 상태를 선언·표시하지 않는다', () => {
    const code = stripComments(medicationTab);
    // 재주입: 'COMPLETED'/'SUSPENDED' 를 상태 유니온이나 라벨로 되살리면 실패한다.
    expect(code).not.toMatch(/rx\.status === 'COMPLETED'/);
    expect(code).not.toContain("'SUSPENDED'");
    expect(code).not.toMatch(/status:\s*'ACTIVE'\s*\|\s*'COMPLETED'/);
    // '완료' 필터 탭이 없어야 한다(구조적으로 영원히 0건이던 탭)
    expect(code).not.toMatch(/key:\s*'completed'/);
  });
});

describe('D. 투여기간 종료를 "복용 중"이라 말하지 않는다', () => {
  it('🔴 서버가 투여기간을 함께 돌려준다', () => {
    const code = stripComments(prescriptionService);
    // 🔴 처음엔 `toContain('private withDosing')` 이었는데, 재주입으로 `withDosingRENAMED` 로
    //    바꿔도 **접두사 일치라 통과**했다. 이름의 존재가 아니라 **정의와 호출이 맞물리는지**를 묻는다.
    expect(code).toMatch(/private withDosing<[^>]*>\(row: T\)/);
    expect(code).toContain('dosingWindow({ createdAt: row.createdAt, duration: row.duration, discontinuedAt: row.discontinuedAt ?? null })');
    // 두 EP 모두 실제로 호출한다 — 활성 목록(간호 사이드레일·무균조제)도 같은 사실을 받아야 한다
    const calls = code.match(/this\.withDosing\(r\)/g) ?? [];
    expect(calls.length, 'findByPatient·findActiveByPatient 둘 다 withDosing 을 통과해야 한다').toBe(2);
  });

  it('🔴 상호작용 점검 입력이 status 가 아니라 투여기간으로 걸러진다', () => {
    const code = stripComments(medicationTab);
    expect(code).toContain('isScreenedForInteraction');
    // 재주입: activeDrugNames 를 activePrescriptions(=status ACTIVE 전량)로 되돌리면 실패한다
    expect(code).toMatch(/screened\.flatMap/);
    // 분모를 밝힌다
    expect(code).toContain('상호작용 점검 대상');
  });

  it('🔴 FE 가 자기 규칙으로 기간을 계산하지 않는다(정본 함수만 쓴다)', () => {
    const code = stripComments(medicationTab);
    expect(code).toContain('dosingWindow(');
    // 손으로 일수를 곱해 기간을 만드는 코드가 없어야 한다
    expect(code).not.toMatch(/86400000|864e5|24 \* 60 \* 60 \* 1000/);
  });
});

describe('E. 고위험약 2인확인 — 게이트를 약화하지 않고 고를 사람을 준다', () => {
  it('🔴 게이트 자체는 그대로다(BLOCK 시 유효 확인자 없으면 차단)', () => {
    const body = pharmacyService.slice(pharmacyService.indexOf('async completeDispensing('));
    expect(body).toContain("gateMode(await this.configRuntime.get('pharmacy.highAlertDoubleCheck'))");
    // 재주입: fallback 을 'OFF'/'WARN' 로 완화하면 실패한다(gateMode 2번째 인자 금지)
    expect(body).not.toMatch(/highAlertDoubleCheck'\)\s*,\s*'(OFF|WARN)'/);
    expect(body).toContain("gate === 'BLOCK'");
    expect(body).toContain('ConflictException');
  });

  it('🔴 2차 확인자 후보 EP 가 존재하고 약국 스코프에 있다', () => {
    expect(pharmacyService).toContain('async listSecondCheckers(');
    expect(pharmacyController).toContain("@Get('second-checkers')");
    // 클래스 가드가 약사를 포함해야 부를 수 있다(그렇지 않으면 목록이 영원히 비어 게이트가 안 풀린다)
    expect(pharmacyController).toContain('@Roles(UserRole.PHARMACIST, UserRole.ADMIN)');
  });

  it('🔴 후보 목록과 게이트 판정이 **같은 상수**를 본다', () => {
    // 갈라지면 화면에 뜬 사람을 서버가 거부하거나, 목록에 없는 사람이 통과한다.
    expect(pharmacyService).toContain('SECOND_CHECKER_ROLES');
    const list = pharmacyService.slice(pharmacyService.indexOf('async listSecondCheckers('));
    expect(list.slice(0, 600)).toContain('PharmacyService.SECOND_CHECKER_ROLES');
    const complete = pharmacyService.slice(pharmacyService.indexOf('async completeDispensing('));
    expect(complete).toContain('PharmacyService.SECOND_CHECKER_ROLES.includes(checker.role)');
    // 재주입: 역할 문자열을 다시 하드코딩하면 실패한다
    expect(complete).not.toMatch(/checker\.role === 'PHARMACIST'/);
  });

  it('🔴 두 조제 화면이 secondCheckBy 를 실제로 전송한다', () => {
    // 종전엔 web 전역 `secondCheckBy` grep 이 **0건**이었다.
    for (const [name, src] of [['/pharmacy', pharmacyPage], ['/workstation/pharmacy', wsPharmacyPage]] as const) {
      const code = stripComments(src);
      expect(code, `${name} 이 secondCheckBy 를 보내지 않는다`).toContain('{ secondCheckBy: sc }');
      expect(code, `${name} 에 2차 확인자 UI 가 없다`).toContain('SecondCheckPicker');
    }
  });

  it('🔴 /pharmacy 가 조제 완료 실패 사유를 버리지 않는다', () => {
    const code = stripComments(pharmacyPage);
    // 재주입: `onError: () => toast.error('조제 완료 실패')` 로 되돌리면 실패한다.
    expect(code).not.toMatch(/onError:\s*\(\)\s*=>\s*toast\.error\('조제 완료 실패'\)/);
    expect(code).toMatch(/onError:\s*\(e\)\s*=>\s*toast\.error\(\(e as \{ message\?: string \}\)\?\.message \|\| '조제 완료 실패'\)/);
  });

  it('🔴 secondCheckBy 가 인라인 @Body 가 아니라 DTO 로 검증된다', () => {
    expect(pharmacyController).toContain('@Body() body: CompleteDispensingDto');
    // 🔴 주석을 코드로 세지 않는다 — 이 단언은 처음에 **내가 쓴 주석**("종전은 인라인 …")에
    //    걸려 실패했다. 무엇이 실행되는지를 물어야지, 파일에 그 글자가 있는지를 물으면 안 된다.
    expect(stripComments(pharmacyController)).not.toContain('@Body() body?: { secondCheckBy?: string }');
    const dto = read(join(API, 'modules/pharmacy/dto/start-dispensing.dto.ts'));
    expect(dto).toContain('export class CompleteDispensingDto');
    expect(dto).toMatch(/@IsUUID\('4'[\s\S]{0,120}secondCheckBy/);
  });
});

describe('F. 원외 처방이 원내 조제되지 않는다', () => {
  it('🔴 서버가 EXTERNAL 조제 시작을 거부한다', () => {
    const body = pharmacyService.slice(
      pharmacyService.indexOf('async startDispensing('),
      pharmacyService.indexOf('async listSecondCheckers('),
    );
    // 재주입: 이 검사를 지우면 실패한다.
    expect(body).toContain("order.pharmacyType === 'EXTERNAL'");
    expect(body).toContain('ConflictException');
    // 막기만 하지 않고 무엇을 해야 하는지 말한다("막으면 방치된다")
    expect(body).toContain('처방전');
  });

  it('🔴 워크스테이션 큐가 pharmacyType 을 응답에 싣는다', () => {
    const body = workstationService.slice(workstationService.indexOf('private async getPharmacyWorklist('));
    expect(body).toContain('pharmacyType: o.pharmacyType');
  });

  it('🔴 두 화면이 원외 건에 조제 버튼을 주지 않는다', () => {
    const ws = stripComments(wsPharmacyPage);
    expect(ws).toContain('isExternal(o)');
    expect(ws).toContain('!selectedExternal');
    const ph = stripComments(pharmacyPage);
    // 상세 패널의 '조제 시작' 이 원외로 막힌다(종전엔 모드로 막히지 않았다)
    expect(ph).toContain("detail.status === 'ORDERED' && !isExternalDetail");
    expect(ph).toContain('isExternalDetail');
  });
});

describe('G. 처방 취소가 조제 중인 건을 조용히 지우지 않는다', () => {
  it('🔴 두 큐가 최상위에서 prescription.status=ACTIVE 로 거르지 않는다', () => {
    for (const [name, src, marker] of [
      ['pharmacy.getQueue', pharmacyService, 'async getQueue('],
      ['workstation.getPharmacyWorklist', workstationService, 'private async getPharmacyWorklist('],
    ] as const) {
      const start = src.indexOf(marker);
      const body = stripComments(src.slice(start, start + 2500));
      // 재주입: `prescription: { status: 'ACTIVE', type: 'MEDICATION' }` 로 되돌리면 실패한다.
      expect(body, `${name} 이 여전히 최상위에서 ACTIVE 를 강제한다`).not.toMatch(
        /prescription:\s*\{\s*status:\s*'ACTIVE',\s*type:\s*'MEDICATION'\s*\}/,
      );
      // 비약물 배제는 유지된다(간호 지시가 조제 큐에 서던 결함 — 되살리지 않는다)
      expect(body, `${name} 이 MEDICATION 필터를 잃었다`).toMatch(/type:\s*'MEDICATION'/);
      // 조제가 시작된 건은 처방 상태와 무관하게 남는다
      expect(body).toMatch(/'PENDING',\s*'DISPENSED',\s*'VERIFIED'/);
    }
  });

  it('🔴 화면이 취소 사실을 말한다(남겨두기만 하면 왜 남았는지 모른다)', () => {
    expect(workstationService).toContain('prescriptionStatus: rx.status');
    expect(stripComments(wsPharmacyPage)).toContain("prescriptionStatus === 'CANCELLED'");
    expect(stripComments(pharmacyPage)).toContain('detailRxCancelled');
  });
});

describe('H. 서버가 흉내내던 필터를 실제로 적용한다', () => {
  it('🔴 status/limit 을 받고 실제로 적용한다', () => {
    expect(prescriptionController).toContain("@Query('status')");
    expect(prescriptionController).toContain("@Query('limit')");
    const body = prescriptionService.slice(
      prescriptionService.indexOf('async findByPatient('),
      prescriptionService.indexOf('async findActiveByPatient('),
    );
    expect(body).toContain('status ? { status }');
    expect(body).toContain('take: opts.limit');
  });

  it('🔴 알 수 없는 status 는 조용히 무시하지 않는다(무시하면 화면이 걸러진 줄 안다)', () => {
    expect(prescriptionService).toContain('normalizePrescriptionStatus');
    const fn = prescriptionService.slice(prescriptionService.indexOf('private normalizePrescriptionStatus('));
    expect(fn.slice(0, 500)).toContain('BadRequestException');
  });
});
