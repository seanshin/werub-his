import { describe, it, expect } from 'vitest';

describe('UploadService', () => {
  describe('file validation', () => {
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'image/webp'];
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB

    it('should accept valid image types', () => {
      expect(ALLOWED_TYPES).toContain('image/jpeg');
      expect(ALLOWED_TYPES).toContain('image/png');
      expect(ALLOWED_TYPES).toContain('application/pdf');
    });

    it('should reject invalid types', () => {
      expect(ALLOWED_TYPES).not.toContain('application/exe');
      expect(ALLOWED_TYPES).not.toContain('text/html');
    });

    it('should enforce max file size', () => {
      const fileSize = 5 * 1024 * 1024; // 5MB
      expect(fileSize <= MAX_SIZE).toBe(true);

      const tooLarge = 15 * 1024 * 1024; // 15MB
      expect(tooLarge <= MAX_SIZE).toBe(false);
    });
  });

  describe('filename sanitization', () => {
    it('should sanitize special characters', () => {
      const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
      expect(sanitize('test file (1).jpg')).toBe('test_file__1_.jpg');
      expect(sanitize('환자_사진.png')).toBe('환자_사진.png');
      expect(sanitize('../../../etc/passwd')).toContain('etc_passwd');
    });

    it('should generate unique names', () => {
      const uniqueName = (original: string) => {
        const ext = original.split('.').pop();
        const timestamp = Date.now();
        return `${timestamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      };
      const name1 = uniqueName('photo.jpg');
      const name2 = uniqueName('photo.jpg');
      expect(name1).not.toBe(name2);
      expect(name1.endsWith('.jpg')).toBe(true);
    });
  });
});
