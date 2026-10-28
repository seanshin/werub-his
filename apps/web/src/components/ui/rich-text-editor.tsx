'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { useCallback, useRef } from 'react';
import { apiClient } from '@/lib/api-client';
import { useTAttr } from '@/components/ui/i18n-text';

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  /**
   * 본문 삽입 이미지 업로더(선택). 지정하면 이 함수가 반환한 URL 을 그대로 쓴다.
   *
   * 🔴 W9: 기본 경로 `/api/v1/upload/image` 는 `/uploads/*` 를 돌려주는데, `/uploads` 는 PHI 보호용
   *    HMAC 서명(TTL 1시간) 게이트다. **공개 홈페이지 본문**에 그 URL 이 박히면
   *    (1) ISR 캐시(300~3600초)에 만료된 서명이 굳어 이미지가 401 로 깨지고
   *    (2) hospital.example.org 에는 `/uploads` 프록시가 없어 항상 404 다.
   *    공개 콘텐츠를 쓰는 화면(CMS)은 `uploadCmsImage`(→ `/media/*`)를 주입한다.
   *    원내 전용 화면(결재 안건 등)은 기본값 그대로가 맞다.
   */
  uploader?: (file: File) => Promise<string>;
}

export function RichTextEditor({ content, onChange, placeholder, className, uploader }: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 툴바 힌트(title 속성 — 티를 그릴 수 없는 자리)만 로케일을 따른다. 본문·placeholder 는 불변 */
  const tAttr = useTAttr();

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Image.configure({ inline: false, allowBase64: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: placeholder ?? '내용을 입력하세요...' }),
    ],
    content,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[300px] px-4 py-3',
      },
    },
  });

  const handleImageUpload = useCallback(async (file: File) => {
    if (!editor) return;
    try {
      let url: string | undefined;
      if (uploader) {
        url = await uploader(file);
      } else {
        const formData = new FormData();
        formData.append('file', file);
        const res = await apiClient.fetch<{ data: { url: string } }>('/api/v1/upload/image', {
          method: 'POST',
          body: formData,
        });
        url = res.data?.url;
      }
      if (!url) throw new Error('업로드 응답에 URL이 없습니다');
      editor.chain().focus().setImage({ src: url }).run();
    } catch (e) {
      alert((e as { message?: string })?.message || '이미지 업로드에 실패했습니다');
    }
  }, [editor, uploader]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleImageUpload(file);
    e.target.value = '';
  }, [handleImageUpload]);

  if (!editor) return null;

  return (
    <div className={`border border-gray-200 rounded-xl overflow-hidden bg-white ${className ?? ''}`}>
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-gray-100 bg-gray-50">
        <ToolbarGroup>
          <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title={tAttr('굵게')}>
            <span className="font-bold">B</span>
          </ToolBtn>
          <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title={tAttr('기울임')}>
            <span className="italic">I</span>
          </ToolBtn>
          <ToolBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title={tAttr('밑줄')}>
            <span className="underline">U</span>
          </ToolBtn>
          <ToolBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title={tAttr('취소선')}>
            <span className="line-through">S</span>
          </ToolBtn>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <ToolBtn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title={tAttr('제목2')}>
            H2
          </ToolBtn>
          <ToolBtn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title={tAttr('제목3')}>
            H3
          </ToolBtn>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title={tAttr('글머리 기호')}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </ToolBtn>
          <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={tAttr('번호 목록')}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" /></svg>
          </ToolBtn>
          <ToolBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title={tAttr('인용')}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          </ToolBtn>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <ToolBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title={tAttr('구분선')}>
            ―
          </ToolBtn>
          <ToolBtn
            onClick={() => {
              const url = window.prompt('링크 URL을 입력하세요:');
              if (url) editor.chain().focus().setLink({ href: url }).run();
            }}
            active={editor.isActive('link')}
            title={tAttr('링크')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
          </ToolBtn>
          <ToolBtn onClick={() => fileInputRef.current?.click()} title={tAttr('이미지 업로드')}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </ToolBtn>
        </ToolbarGroup>

        <ToolbarDivider />

        <ToolbarGroup>
          <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title={tAttr('되돌리기')}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
          </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title={tAttr('다시 실행')}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6" /></svg>
          </ToolBtn>
        </ToolbarGroup>
      </div>

      {/* 에디터 영역 */}
      <EditorContent editor={editor} />

      {/* 숨겨진 파일 입력 */}
      <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileSelect} className="hidden" />
    </div>
  );
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function ToolbarDivider() {
  return <div className="w-px h-5 bg-gray-200 mx-1" />;
}

function ToolBtn({ children, active, disabled, onClick, title }: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded text-xs transition ${
        active
          ? 'bg-blue-100 text-blue-700'
          : disabled
            ? 'text-gray-300 cursor-not-allowed'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      {children}
    </button>
  );
}
