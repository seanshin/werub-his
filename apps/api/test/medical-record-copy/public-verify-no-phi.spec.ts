import { describe, it, expect } from 'vitest';
import { PATH_METADATA } from '@nestjs/common/constants';
import { MedicalRecordCopyModule } from '../../src/modules/medical-record-copy/medical-record-copy.module';
import { MedicalRecordCopyService } from '../../src/modules/medical-record-copy/medical-record-copy.service';
import { DocumentController } from '../../src/modules/document/document.controller';

/**
 * 공개 사본 확인 EP 제거(2026-10-13 결함 발굴 B8).
 *
 * 연혁: 2026-09-16 F1 — 무인증 `GET /api/v1/verify/record-copy/:copyId` 가 환자 실명을 내줘 마스킹했다.
 * 🔴 그런데 그 EP 는 토큰을 받지도 대조하지도 않고 번호만 있으면 `valid:true` 였고, 대상 원장은 **문서를 만들지 않는
 *    이력 기록**이었다(B6) — 없는 문서를 진짜라고 보증하는 공개 표면. QR 토큰 생성기는 부르는 곳이 0.
 * 이제: 그 컨트롤러·생성기가 없다 · 대조군: 문서 진위확인 정본(`documents/verify/:issueNo`)은 있다.
 */
describe('🔴 공개 사본 확인 — 없는 문서를 보증하는 표면이 없다', () => {
  it('모듈 컨트롤러에 api/v1/verify 가 없다 · 서비스에 verifyCopy·토큰 생성기가 없다', () => {
    const controllers = (Reflect.getMetadata('controllers', MedicalRecordCopyModule) ?? []) as Array<object>;
    expect(controllers.length).toBeGreaterThan(0); // 판정기가 돈다
    expect(controllers.map((c) => Reflect.getMetadata(PATH_METADATA, c))).not.toContain('api/v1/verify');
    expect('verifyCopy' in MedicalRecordCopyService.prototype).toBe(false);
    expect('generateVerificationToken' in MedicalRecordCopyService.prototype).toBe(false);
  });
  it('대조군 — 문서 진위확인 정본 EP 는 있다', () => {
    expect(Reflect.getMetadata(PATH_METADATA, DocumentController.prototype.verify)).toBe('verify/:issueNo');
  });
});
