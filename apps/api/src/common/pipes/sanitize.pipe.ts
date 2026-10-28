import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';

/**
 * XSS 방지를 위한 입력 산정화 파이프.
 *
 * 🔴 **현재 전역 등록되어 있지 않다**(`main.ts` 참조). 실수가 아니라 판단이다 —
 *    입력 문자열을 통째로 치환하면 Date·JSON 과 의료 서술(부등호·단위 표기)이 변형된다.
 *    XSS 는 **출력 단**에서 막는다: 서버 `escapeHtml` · 브라우저 `sanitizeHtml`(DOMPurify) ·
 *    업로드 fileFilter.
 *
 * 🔴 이 파일을 쓰려거든 **특정 라우트에 한정**해서 붙이고, 위 세 층과 중복·충돌하지 않는지
 *    먼저 확인할 것. 전역으로 되살리면 조용한 데이터 변형이 생긴다.
 */
@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== 'body' && metadata.type !== 'query') return value;
    return this.sanitize(value);
  }

  private sanitize(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.sanitizeString(value);
    }
    if (Array.isArray(value)) {
      return value.map(item => this.sanitize(item));
    }
    if (value && typeof value === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        sanitized[key] = this.sanitize(val);
      }
      return sanitized;
    }
    return value;
  }

  private sanitizeString(str: string): string {
    return str
      // script 태그 제거
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // event handler 속성 제거 (onclick, onerror 등)
      .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
      // javascript: 프로토콜 제거
      .replace(/javascript\s*:/gi, '')
      // data: 프로토콜 (이미지 제외) 제거
      .replace(/data\s*:[^image][^;]*;/gi, '')
      // iframe/object/embed 제거
      .replace(/<(iframe|object|embed|form|input)\b[^>]*>/gi, '')
      .replace(/<\/(iframe|object|embed|form|input)>/gi, '');
  }
}
