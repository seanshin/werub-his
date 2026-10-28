'use client';

import { useEffect, useCallback, Suspense, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuthStore } from '@/stores/auth-store';
import { T, Tf } from '@/components/ui/i18n-text';
import { useDashboardStore } from '../stores/dashboard-store';
import { useDashboardConfig } from '../hooks/use-dashboard-config';
import { WIDGET_REGISTRY } from './widget-registry';
import { canAccessWidget } from '@/lib/permissions';
import { widgetGridClass } from './widget-size';
import WidgetWrapper from './WidgetWrapper';
import EditToolbar from './EditToolbar';
import WidgetCatalog from './WidgetCatalog';

function SortableWidget({
  id,
  isEditing,
  children,
}: {
  id: string;
  isEditing: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !isEditing });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="h-full">
      <div {...(isEditing ? listeners : {})} className={`h-full ${isEditing ? 'widget-drag-handle' : ''}`}>
        {children}
      </div>
    </div>
  );
}

export default function DashboardShell() {
  const { user } = useAuthStore();
  const { isEditing, layouts, hiddenWidgets, widgetSettings, setLayouts } = useDashboardStore();
  const { save, reset, isLoading, isSaving } = useDashboardConfig();

  // Ctrl+Z 단축키
  const { undo } = useDashboardStore();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && isEditing) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isEditing, undo]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const lgLayouts = layouts.lg ?? [];
  /**
   * 🔴 (2026-10-03) 등록부의 역할·권한(`canAccessWidget`)은 **편집 목록에만** 쓰였다 — 배치에 들어 있으면 권한 밖 위젯도 떠서
   *    서버 403 칸이 됐다(행정 대시보드 '병상 가동률'). 렌더에도 같은 판정을 쓴다 · 걸러진 수는 말한다(빈 줄로 사라지지 않게).
   */
  const allowed = (id: string) => {
    const def = WIDGET_REGISTRY[id];
    return !!def && (!user || canAccessWidget(def.roles, def.requiredPermissions, user.role, user.permissions ?? []));
  };
  const visibleWidgets = lgLayouts.filter(
    (item) => !hiddenWidgets.includes(item.i) && allowed(item.i),
  );
  const blockedCount = lgLayouts.filter((item) => !hiddenWidgets.includes(item.i) && WIDGET_REGISTRY[item.i] && !allowed(item.i)).length;
  const widgetIds = visibleWidgets.map((w) => w.i);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = widgetIds.indexOf(active.id as string);
    const newIndex = widgetIds.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;

    // 순서 변경
    const newLg = [...lgLayouts];
    const items = visibleWidgets.map(v => v.i);
    const [moved] = items.splice(oldIndex, 1);
    items.splice(newIndex, 0, moved);

    // y 위치를 순서대로 재계산
    const reordered = items.map((id, idx) => {
      const orig = newLg.find(l => l.i === id);
      return orig ? { ...orig, y: idx } : null;
    }).filter(Boolean);

    // hidden 위젯은 유지
    const hiddenItems = newLg.filter(l => !items.includes(l.i));
    setLayouts({ ...layouts, lg: [...reordered, ...hiddenItems] as any });
  }, [lgLayouts, visibleWidgets, widgetIds, layouts, setLayouts]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-12 bg-gray-100 rounded-lg animate-pulse" />
        <div className="h-48 bg-gray-100 rounded-xl animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={isEditing ? 'bg-blue-50/20 rounded-2xl p-2 -m-2' : ''}>
      {isEditing && <EditToolbar onSave={save} onReset={reset} isSaving={isSaving} />}

      {/* '대시보드 편집' 버튼은 머리(hero) 오른쪽에 있다 — 격자 위에 한 줄을 따로 쓰지 않는다 */}
      {blockedCount > 0 && (
        <p className="mb-2 text-[11px] text-gray-500" data-dashboard-blocked={blockedCount}>
          <Tf k="이 계정 권한으로 볼 수 없는 위젯 {수}개는 표시하지 않습니다" params={{ 수: blockedCount }} />
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={widgetIds} strategy={rectSortingStrategy}>
          {/*
            🔴 (2026-10-02 실화면) 종전 보기 모드는 카드가 **자기 내용 높이만큼** 행을 차지하고(masonry) dense 배치로
               뒤 카드가 앞선 빈자리를 메웠다. 폭을 단위로 맞춰도 높이가 제각각이라 한 열에 카드 넷이 쌓이고
               옆 열은 비는, "정리가 안 된" 화면이 됐다(카드 순서도 읽는 순서와 달라졌다).
               → **줄 단위로 선다**: 같은 줄의 카드는 같은 높이로 늘어나고(items-stretch · 카드 h-full),
                 다음 줄은 같은 선에서 시작한다. 폭 단위(widget-size)와 기본 배치가 줄을 꽉 채운다.
               (가로 띠 strip 은 줄 전체를 쓰므로 옆 카드가 띠 높이를 늘리는 일은 없다.)
               dense 는 남긴다 — 2단위 카드가 줄 끝에 안 들어가면 뒤의 1단위 카드가 그 자리를 메운다(줄 높이는 줄마다 같다).
          */}
          <div className="grid grid-cols-12 grid-flow-row-dense items-stretch gap-3" data-dashboard-grid>
            {visibleWidgets.map((item) => {
              const def = WIDGET_REGISTRY[item.i];
              if (!def) return null;
              const settings = widgetSettings[item.i] ?? {};
              return (
                <div key={item.i} className={widgetGridClass(item.i)} data-widget-cell={item.i}>
                  <SortableWidget id={item.i} isEditing={isEditing}>
                    <WidgetWrapper id={item.i} definition={def} isEditing={isEditing}>
                      <Suspense fallback={<div className="h-16 bg-gray-50 rounded-lg animate-pulse" />}>
                        <def.component settings={settings} role={user?.role} />
                      </Suspense>
                    </WidgetWrapper>
                  </SortableWidget>
                </div>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {isEditing && <WidgetCatalog />}
    </div>
  );
}
