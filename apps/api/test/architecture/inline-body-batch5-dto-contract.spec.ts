/**
 * 🔴 (2026-09-15 B5) 인라인 @Body 5차 배치 29 핸들러 → class DTO 계약.
 * 검진 13 · 약국 8 · 의사 코드 3 · 사전 오더 2 · 트리아지 2 · 검사 1 (+ 약국 조제완료 시그니처 안 주석 오탐 1).
 * 대량 할당 5곳 — 대체조제 요청(`...body` → status·doctorApproved) · 약국 기기(`data as never` → status·lastHeartbeatAt) ·
 * 처방 세트 수정(`...updates` → doctorId·useCount) · 사전 오더 수정(`...updates`) · 트리아지 별칭 일괄(`data: item`).
 * 지키는 것(main.ts 전역 파이프 옵션 그대로):
 *  ① 잘못된 본문 400(종전 Prisma 500)  ② 대조군 — 화면이 실제로 보내는 모양은 통과·키 보존
 *  ③ DTO 밖 키는 지워진다 + 서비스도 읽는 키만 Prisma 로 보낸다  ④ 핸들러 시그니처가 DTO class 다(소스 대조)
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  CreateAtcJobDto,
  CreatePharmacyDeviceDto,
  IssueDispensingDto,
  RequestSubstitutionDto,
  StartSplitDispensingDto,
  VerifyDispensingDto,
} from '../../src/modules/pharmacy/dto/pharmacy-write.dto';
import { PharmacyService } from '../../src/modules/pharmacy/pharmacy.service';
import { CreatePrescriptionSetDto, ImportDoctorCodeCatalogDto, UpdatePrescriptionSetDto } from '../../src/modules/doctor-code/dto/doctor-code.dto';
import { DoctorCodeService } from '../../src/modules/doctor-code/doctor-code.service';
import { ApprovePreOrderDto, ModifyPreOrderDto } from '../../src/modules/pre-order/dto/pre-order.dto';
import { PreOrderService } from '../../src/modules/pre-order/pre-order.service';
import { BulkCreateAliasesDto, EvaluateTriageDto } from '../../src/modules/triage/dto/triage.dto';
import { TriageService } from '../../src/modules/triage/triage.service';
import { SignLabWorksheetDto } from '../../src/modules/lab/dto/lab-result.dto';
import {
  BulkUploadCheckupDto,
  CheckInCheckupVisitDto,
  CheckupStationCompleteItemDto,
  CheckupWsArriveDto,
  CheckupWsCompleteDto,
  CheckupWsStartDto,
  CreateCheckupContractDto,
  CreateCheckupQuestionnaireDto,
  SignCheckupSummaryDto,
  UpdateCheckupQuestionnaireDto,
} from '../../src/modules/checkup/dto/checkup-ops-write.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
const meta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype, data: undefined });
const bad = (v: unknown, t: ArgumentMetadata['metatype']) => expect(pipe.transform(v, meta(t))).rejects.toBeInstanceOf(BadRequestException);
const ok = (v: unknown, t: ArgumentMetadata['metatype']) => pipe.transform(v, meta(t)) as Promise<Record<string, unknown>>;
const U = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('인라인 @Body 5차 배치 DTO 계약', () => {
  it('③ 약국 대량 할당 — 대체조제의 승인 상태·기기의 온라인 상태가 본문에서 지워지고, 서비스도 등록 필드만 Prisma 로 보낸다', async () => {
    const sub = await ok({ originalPrescriptionId: U, substituteMedicationCodeId: U2, reason: '품절', status: 'APPROVED', doctorApproved: true }, RequestSubstitutionDto);
    expect(sub).toEqual({ originalPrescriptionId: U, substituteMedicationCodeId: U2, reason: '품절' });
    await bad({ originalPrescriptionId: 'RX-1', substituteMedicationCodeId: U2, reason: 'r' }, RequestSubstitutionDto);

    // 화면(pharmacy/admin) 모양 — location '' 포함
    const device = { name: 'ATC-1', type: 'ATC', connectionType: 'TCP', connectionConfig: { host: '10.0.0.1', port: 9100 }, location: '' };
    expect(await ok({ ...device, status: 'ONLINE', lastHeartbeatAt: '2026-09-15T00:00:00Z' }, CreatePharmacyDeviceDto)).toEqual(device);
    await bad({ ...device, connectionConfig: '{"host":"x"}' }, CreatePharmacyDeviceDto); // Json 객체를 문자열로
    await bad({ ...device, connectionType: 'BLUETOOTH-LE' }, CreatePharmacyDeviceDto); // VarChar(10)

    const substitutionCreate = vi.fn().mockResolvedValue({ id: U });
    const deviceCreate = vi.fn().mockResolvedValue({ id: U });
    const prisma = { genericSubstitution: { create: substitutionCreate }, pharmacyDevice: { create: deviceCreate } };
    const svc = new PharmacyService(prisma as never, {} as never, {} as never, {} as never);
    await svc.requestSubstitution({ originalPrescriptionId: U, substituteMedicationCodeId: U2, reason: 'r', pharmacistId: U, status: 'APPROVED', doctorApproved: true } as never);
    const sd = substitutionCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(sd).toMatchObject({ originalPrescriptionId: U, substituteMedicationCodeId: U2, reason: 'r', pharmacistId: U });
    expect(sd).not.toHaveProperty('status');
    expect(sd).not.toHaveProperty('doctorApproved');
    await svc.createDevice({ ...device, status: 'ONLINE', lastHeartbeatAt: new Date() } as never);
    const dd = deviceCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(dd).toMatchObject({ name: 'ATC-1', connectionType: 'TCP' });
    expect(dd).not.toHaveProperty('status');
    expect(dd).not.toHaveProperty('lastHeartbeatAt');
  });

  it('② 약국·검사 — 화면 모양 통과(빈 본문 포함) · ① 형식 위반 400', async () => {
    expect(await ok({ notifyPatient: true }, VerifyDispensingDto)).toEqual({ notifyPatient: true });
    expect(await ok({ issuedTo: '보호자 김OO' }, IssueDispensingDto)).toEqual({ issuedTo: '보호자 김OO' });
    expect(await ok({}, IssueDispensingDto)).toEqual({}); // 화면은 공란이면 issuedTo: undefined
    await bad({ issuedTo: 'x'.repeat(101) }, IssueDispensingDto); // VarChar(100) 수령 기록 — 자르지 않는다
    await bad({ notifyPatient: 'yes' }, VerifyDispensingDto);
    await bad({ blockchainSignature: 'sig' }, VerifyDispensingDto);
    await bad({ orderId: U, totalSplits: 0 }, StartSplitDispensingDto); // 서비스가 나눈다 — 0 은 Infinity 수량
    await bad({ dispensingId: U, medications: { code: 'A' } }, CreateAtcJobDto);
    // 검사 기록지 서명 — 화면(WorksheetTab)은 본문 없이 부른다
    expect(await ok(undefined, SignLabWorksheetDto)).toEqual({});
    await bad({ blockchainSignature: ['a'] }, SignLabWorksheetDto);
  });

  it('③ 처방 세트 — 수정 본문의 doctorId·useCount 가 지워지고 서비스도 읽는 필드만 · ② 화면 모양(codeId:\'\') 통과', async () => {
    // 화면(settings/my-codes SetCreateModal) — 자유 입력 항목은 codeId ''
    const set = { name: '고혈압 기본', description: undefined, category: undefined, items: [{ codeId: '', codeType: 'MEDICATION_CODE', name: '암로디핀', dosage: '5mg', duration: 30 }] };
    const r = await ok(set, CreatePrescriptionSetDto);
    expect(r.name).toBe('고혈압 기본');
    expect(r.items).toEqual([{ codeId: '', codeType: 'MEDICATION_CODE', name: '암로디핀', dosage: '5mg', duration: 30 }]);
    await bad({ ...set, items: [{ ...set.items[0], duration: '30일' }] }, CreatePrescriptionSetDto); // 원소도 검사
    await bad({ ...set, name: 'x'.repeat(201) }, CreatePrescriptionSetDto);
    expect(await ok({ name: 'n', doctorId: U2, useCount: 999, isActive: false }, UpdatePrescriptionSetDto)).toEqual({ name: 'n' });
    expect(await ok({ department: '내과', codeIds: [U] }, ImportDoctorCodeCatalogDto)).toEqual({ department: '내과', codeIds: [U] });
    await bad({ department: '내과', codeIds: ['MED-1'] }, ImportDoctorCodeCatalogDto); // code_id @db.Uuid

    const update = vi.fn().mockResolvedValue({ id: U });
    const prisma = { doctorPrescriptionSet: { findFirst: vi.fn().mockResolvedValue({ id: U }), update } };
    const svc = new DoctorCodeService(prisma as never);
    await svc.updateSet(U, U, { name: 'n', doctorId: U2, useCount: 999, isActive: false } as never);
    const d = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(d.name).toBe('n');
    for (const k of ['doctorId', 'useCount', 'isActive']) expect(d).not.toHaveProperty(k);
  });

  it('③ 사전 오더 — 승인은 encounterId uuid 필수 · 수정 사유가 DTO 로 들어오고 서비스는 수정 가능 필드만 Prisma 로(사유·status 제외)', async () => {
    // 화면(PreOrderBanner) 모양
    expect(await ok({ encounterId: U }, ApprovePreOrderDto)).toEqual({ encounterId: U });
    expect(await ok({ encounterId: U, overrideDur: true, overrideReason: '검토함' }, ApprovePreOrderDto)).toEqual({ encounterId: U, overrideDur: true, overrideReason: '검토함' });
    await bad({ encounterId: 'ENC-1' }, ApprovePreOrderDto); // 종전 @Body('encounterId') 원시값 → Prisma 500
    await bad({}, ApprovePreOrderDto);
    await bad({ encounterId: U, overrideDur: 'true' }, ApprovePreOrderDto);
    expect(await ok({ dosage: '10mg', reason: '용량 조정', status: 'APPROVED' }, ModifyPreOrderDto)).toEqual({ dosage: '10mg', reason: '용량 조정' });
    await bad({ reason: 'x'.repeat(301) }, ModifyPreOrderDto); // PreOrderRevision.reason VarChar(300) — 수정 이력은 자르지 않는다
    await bad({ quantity: 1.5 }, ModifyPreOrderDto); // Int

    const update = vi.fn().mockResolvedValue({ id: U });
    const revisionCreate = vi.fn().mockResolvedValue({ id: U });
    const prisma = {
      preOrder: { findUnique: vi.fn().mockResolvedValue({ id: U, status: 'PENDING', dosage: '5mg', doctorId: U2 }), update },
      preOrderRevision: { create: revisionCreate },
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
    };
    const svc = new PreOrderService(prisma as never, {} as never, {} as never);
    await svc.modify(U, { dosage: '10mg', reason: '용량 조정', status: 'APPROVED', doctorId: U } as never, U2, '용량 조정');
    const d = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(d).toEqual({ dosage: '10mg', status: 'MODIFIED' });
    expect(revisionCreate.mock.calls[0][0].data).toMatchObject({ snapshot: { dosage: '5mg' }, reason: '용량 조정' });
  });

  it('③ 트리아지 — 별칭 일괄 원소는 두 필드만 Prisma 로 · 평가 본문 형 검사', async () => {
    expect(await ok({ items: [{ symptomId: U, alias: '머리 아픔', hitCount: 999 }] }, BulkCreateAliasesDto)).toEqual({ items: [{ symptomId: U, alias: '머리 아픔' }] });
    await bad({ items: [{ symptomId: U, alias: 'x'.repeat(51) }] }, BulkCreateAliasesDto); // VarChar(50) — 종전 '중복'으로 조용히 건너뜀
    await bad([{ symptomId: U, alias: 'a' }], BulkCreateAliasesDto); // 종전 @Body('items') — 배열 직송
    expect(await ok({ text: '두통 3일', patientInfo: { age: 40, sex: 'M' } }, EvaluateTriageDto)).toEqual({ text: '두통 3일', patientInfo: { age: 40, sex: 'M' } });
    await bad({ text: '두통', patientInfo: { age: '마흔' } }, EvaluateTriageDto);
    await bad({ patientInfo: {} }, EvaluateTriageDto);

    const create = vi.fn().mockResolvedValue({ id: U });
    const svc = new TriageService({ triageAlias: { create } } as never, {} as never);
    await svc.createAliasesBulk([{ symptomId: U, alias: 'a', hitCount: 999, isActive: false, id: U2 }] as never);
    expect(create.mock.calls[0][0]).toEqual({ data: { symptomId: U, alias: 'a' } });
  });

  it('② 검진 — 화면 모양(계약 담당자·연락처 \'\'·엑셀 행·스테이션 완료·문진) 통과 · ① 형식 위반 400', async () => {
    const contract = { companyName: '위루비', contactPerson: '', contactPhone: '', programId: U, headcount: 10, discountRate: 10, contractDate: '2026-09-15', expiryDate: '2027-09-14' };
    expect(await ok(contract, CreateCheckupContractDto)).toEqual(contract);
    await bad({ ...contract, expiryDate: '' }, CreateCheckupContractDto); // @db.Date — 종전 Invalid Date → 500
    await bad({ ...contract, headcount: 10.5 }, CreateCheckupContractDto);
    await bad({ ...contract, contactPhone: '0'.repeat(21) }, CreateCheckupContractDto);
    // 엑셀 행은 형만 — 날짜 형식이 틀린 행은 서비스가 행 단위 오류로 돌려준다
    const rows = [{ name: '홍길동', dateOfBirth: '1980.01.01', gender: '남', phone: '', scheduledDate: '2026-09-20' }];
    expect(await ok({ rows }, BulkUploadCheckupDto)).toEqual({ rows });
    await bad({ rows: [{ ...rows[0], name: 7 }] }, BulkUploadCheckupDto);
    // 접수·서명
    expect(await ok({ selectedOptions: ['opt-1'] }, CheckInCheckupVisitDto)).toEqual({ selectedOptions: ['opt-1'] });
    expect(await ok(undefined, SignCheckupSummaryDto)).toEqual({}); // 화면(visit/[id])은 본문 없이 서명
    await bad({ force: 'true' }, SignCheckupSummaryDto);
    // 스테이션 — 레거시(station/page) · 신규(ws/StationPage·tablet)
    const legacy = { visitId: U, testName: '공복혈당', value: '98', unit: '', referenceRange: '', finding: 'NORMAL', note: '' };
    expect(await ok(legacy, CheckupStationCompleteItemDto)).toEqual(legacy);
    await bad({ ...legacy, visitId: 'V-1' }, CheckupStationCompleteItemDto);
    expect(await ok({ stationId: 'ck-blood' }, CheckupWsArriveDto)).toEqual({ stationId: 'ck-blood' });
    const ws = { stationId: 'ck-blood', resultData: { tubes: 3 }, finding: 'NORMAL', testNames: ['CBC'] };
    expect(await ok(ws, CheckupWsCompleteDto)).toEqual(ws);
    expect(await ok({ stationId: 'ck-eye', resultData: {}, finding: 'ABNORMAL', note: '안압 높음' }, CheckupWsCompleteDto)).toEqual({ stationId: 'ck-eye', resultData: {}, finding: 'ABNORMAL', note: '안압 높음' });
    await bad({ ...ws, testNames: 'CBC' }, CheckupWsCompleteDto);
    await bad({ stationId: 'ck-blood', operatorId: 'nurse-1' }, CheckupWsStartDto);
    // 문진 — programId 는 비움 허용 · sections 필수
    expect(await ok({ title: '기본 문진', sections: [{ title: 's', questions: [] }] }, CreateCheckupQuestionnaireDto)).toEqual({ title: '기본 문진', sections: [{ title: 's', questions: [] }] });
    await bad({ title: '기본 문진' }, CreateCheckupQuestionnaireDto);
    await bad({ title: 't', programId: 'PRG', sections: [] }, CreateCheckupQuestionnaireDto);
    expect(await ok({ title: 't', sections: [], id: U }, UpdateCheckupQuestionnaireDto)).toEqual({ title: 't', sections: [] });
  });

  it('④ 핸들러 시그니처가 DTO class 다 — 원시 `@Body(\'key\')`·인라인 객체 타입이 남지 않는다', () => {
    const src = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../src/modules', p), 'utf8');
    const ck = src('checkup/checkup.controller.ts');
    for (const t of ['CheckInCheckupVisitDto', 'SignCheckupSummaryDto', 'CreateCheckupContractDto', 'BulkReserveCheckupDto', 'BulkUploadCheckupDto', 'CheckupStationCompleteItemDto', 'CreateCheckupQuestionnaireDto', 'UpdateCheckupQuestionnaireDto', 'SaveCheckupQuestionnaireResponseDto', 'UpdateCheckupStationDto', 'CheckupWsArriveDto', 'CheckupWsStartDto', 'CheckupWsCompleteDto']) {
      expect(ck).toMatch(new RegExp(`@Body\\(\\) body: ${t}\\b`));
    }
    const ph = src('pharmacy/pharmacy.controller.ts');
    for (const t of ['VerifyDispensingDto', 'IssueDispensingDto', 'StartSplitDispensingDto', 'DispenseSplitNextDto', 'RequestSubstitutionDto', 'CreatePharmacyDeviceDto', 'CreateAtcJobDto', 'GeneratePharmacyLabelDto']) {
      expect(ph).toMatch(new RegExp(`@Body\\(\\) body: ${t}\\b`));
    }
    expect(ph).not.toMatch(/\.\.\.body, pharmacistId/);
    const dc = src('doctor-code/doctor-code.controller.ts');
    expect(dc).not.toMatch(/@Body\(\) body: Record</);
    const po = src('pre-order/pre-order.controller.ts');
    expect(po).not.toMatch(/@Body\(\s*'/);
    expect(po).toMatch(/@Body\(\) body: ApprovePreOrderDto/);
    const tr = src('triage/triage.controller.ts');
    expect(tr).not.toMatch(/@Body\(\s*'/);
    expect(src('lab/lab.controller.ts')).toMatch(/@Body\(\) body: SignLabWorksheetDto/);
  });
});
