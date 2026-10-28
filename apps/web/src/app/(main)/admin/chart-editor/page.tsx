'use client';

import { useState } from 'react';
import { ChartTemplate } from './components/shared';
import { TemplateListView } from './components/TemplateListView';
import { EditorView } from './components/EditorView';

export default function ChartEditorPage() {
  const [editing, setEditing] = useState<ChartTemplate | null>(null);

  if (editing) {
    return <EditorView initial={editing} onBack={() => setEditing(null)} />;
  }

  return <TemplateListView onEdit={setEditing} onNew={setEditing} />;
}
