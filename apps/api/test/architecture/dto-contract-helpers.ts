/**
 * 요청 본문 DTO 계약 스펙 공용 도구(B6·B7) — 화면 소스에서 **실제로 보내는 키**를 뽑아 DTO 선언 키와 대조한다.
 * 전역 `whitelist:true` 는 DTO 에 없는 키를 조용히 지운다(성공 응답+데이터 소실) — 기계 대조만이 잡는다.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { getMetadataStorage } from 'class-validator';

export const REPO = path.join(__dirname, '..', '..', '..', '..');
export const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

/** main.ts 전역 파이프 옵션 그대로 */
export const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true });
export const bodyMeta = (metatype: ArgumentMetadata['metatype']): ArgumentMetadata => ({ type: 'body', metatype, data: undefined });

/** DTO 가 선언한 속성 이름(class-validator 메타데이터) */
export function dtoKeys(t: new () => object): Set<string> {
  return new Set(getMetadataStorage().getTargetValidationMetadatas(t, '', true, false).map((m) => m.propertyName));
}

/** `anchor` 의 모든 출현 위치(0개면 throw — 앵커가 사라지면 대조는 증거가 아니다) */
export function anchorPositions(src: string, anchor: string): number[] {
  const out: number[] = [];
  for (let at = src.indexOf(anchor); at >= 0; at = src.indexOf(anchor, at + anchor.length)) out.push(at);
  if (out.length === 0) throw new Error(`앵커 없음: ${anchor}`);
  return out;
}

/**
 * 소스의 `from` 위치 이후 첫 `{ … }` 객체 리터럴의 **최상위 키**(`key:` · 단축 `key,`)를 뽑는다.
 * 문자열·중첩 괄호 안은 건너뛴다(값 쪽 객체·배열의 속은 본문 키가 아니다). 전개(`...x`)는 키로 세지 않는다.
 */
export function literalKeysFrom(src: string, from: number): string[] {
  const open = src.indexOf('{', from);
  const keys: string[] = [];
  let depth = 0;
  let expectKey = true;
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      for (i++; i < src.length && src[i] !== q; i++) if (src[i] === '\\') i++;
      expectKey = false;
      continue;
    }
    if ('({['.includes(c)) { depth++; continue; }
    if (')]}'.includes(c)) {
      if (depth === 0) break; // 객체 끝
      depth--;
      continue;
    }
    if (depth > 0) continue;
    if (c === ',') { expectKey = true; continue; }
    if (expectKey && /[A-Za-z_.]/.test(c)) {
      const m = /^(\.\.\.)?([A-Za-z_]\w*)\s*([:,}\n])?/.exec(src.slice(i));
      if (m && !m[1] && (m[3] === ':' || m[3] === ',' || m[3] === '}' || m[3] === '\n')) keys.push(m[2]);
      expectKey = false;
      i += (m?.[0].length ?? 1) - 1;
      if (m?.[3] === ',') expectKey = true;
      if (m?.[3] === '}') break;
    }
  }
  return keys;
}

/** `anchor` 첫 출현 뒤 객체 리터럴의 최상위 키 */
export function literalKeys(src: string, anchor: string): string[] {
  const [at] = anchorPositions(src, anchor);
  return literalKeysFrom(src, at + anchor.length);
}
