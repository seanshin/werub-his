import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EncryptionService } from '../../src/modules/patient-auth/services/encryption.service';

describe('EncryptionService', () => {
  let service: EncryptionService;

  beforeEach(() => {
    const mockConfig = { get: vi.fn().mockReturnValue('test-encryption-key-for-unit-test!') };
    service = new EncryptionService(mockConfig as any);
  });

  describe('encrypt / decrypt', () => {
    it('암호화 후 복호화하면 원본과 동일', () => {
      const plainText = '주민등록번호-테스트';
      const encrypted = service.encrypt(plainText);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toBe(plainText);
      expect(encrypted).not.toBe(plainText);
    });

    it('암호화 결과 형식: iv:authTag:data', () => {
      const encrypted = service.encrypt('test');
      const parts = encrypted.split(':');

      expect(parts).toHaveLength(3);
      expect(parts[0]).toHaveLength(32); // iv hex = 16 bytes = 32 chars
    });

    it('같은 평문도 매번 다른 암호문 생성 (랜덤 IV)', () => {
      const e1 = service.encrypt('same-text');
      const e2 = service.encrypt('same-text');

      expect(e1).not.toBe(e2);
      expect(service.decrypt(e1)).toBe(service.decrypt(e2));
    });

    it('빈 문자열 암호화/복호화', () => {
      const encrypted = service.encrypt('');
      expect(service.decrypt(encrypted)).toBe('');
    });

    it('한글 암호화/복호화', () => {
      const korean = '대한민국 서울특별시 강남구';
      const encrypted = service.encrypt(korean);
      expect(service.decrypt(encrypted)).toBe(korean);
    });

    it('변조된 암호문은 복호화 실패', () => {
      const encrypted = service.encrypt('sensitive');
      const parts = encrypted.split(':');
      parts[2] = 'tampered' + parts[2].slice(8);

      expect(() => service.decrypt(parts.join(':'))).toThrow();
    });
  });

  describe('maskNationalId', () => {
    it('정상 마스킹: 720108-1******', () => {
      const encrypted = service.encrypt('7201081234567');
      const masked = service.maskNationalId(encrypted);

      expect(masked).toBe('720108-1******');
    });

    it('짧은 값은 전체 마스킹', () => {
      const encrypted = service.encrypt('123');
      const masked = service.maskNationalId(encrypted);

      expect(masked).toBe('******-*******');
    });

    it('잘못된 암호문은 전체 마스킹', () => {
      const masked = service.maskNationalId('invalid-encrypted-data');

      expect(masked).toBe('******-*******');
    });
  });

  describe('validateNationalId', () => {
    it('유효한 주민등록번호 (체크섬 통과)', () => {
      // 8*2+0*3+0*4+1*5+0*6+1*7+1*8+0*9+0*2+0*3+0*4+0*5 = 16+5+7+8 = 36
      // (11 - 36%11) % 10 = (11 - 3) % 10 = 8
      expect(service.validateNationalId('800101-1000008')).toBe(true);
    });

    it('잘못된 체크섬', () => {
      expect(service.validateNationalId('800101-1000000')).toBe(false);
    });

    it('길이 오류 (13자리 아님)', () => {
      expect(service.validateNationalId('123456')).toBe(false);
      expect(service.validateNationalId('12345678901234')).toBe(false);
    });

    it('하이픈 포함도 처리', () => {
      // 하이픈 제거 후 검증
      const result1 = service.validateNationalId('800101-1000005');
      const result2 = service.validateNationalId('8001011000005');
      expect(result1).toBe(result2);
    });
  });
});
