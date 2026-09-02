'use client';

import { useEffect } from 'react';
import { redo, undo, useAppStore } from '@/store';

export interface HotkeyActions {
  onRun: () => void;
  onStop: () => void;
  onExport: () => void;
  onImport: () => void;
  onCommandPalette: () => void;
  onAutoLayout: () => void;
  onGroupSelection: () => void;
  onUngroupSelection: () => void;
  onFitSelection: () => void;
  onFitAll: () => void;
}

/** Spec §22.2 ComfyUI 컨벤션 단축키 */
export function useHotkeys(actions: HotkeyActions): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement
        || el instanceof HTMLTextAreaElement
        || (el as HTMLElement | null)?.isContentEditable;

      const mod = e.metaKey || e.ctrlKey;
      const s = useAppStore.getState();

      // 입력 중에도 동작해야 하는 것들
      if (mod && e.key === 'Enter') { e.preventDefault(); actions.onRun(); return; }
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); actions.onCommandPalette(); return; }
      if (typing) return;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (s.selectedNodeIds.length) s.duplicateNodes(s.selectedNodeIds);
        return;
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (s.selectedNodeIds.length) s.toggleBypass(s.selectedNodeIds);
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        s.selectNodes(s.nodes.map((n) => n.id));
        return;
      }
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) actions.onUngroupSelection(); else actions.onGroupSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); actions.onAutoLayout(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); actions.onExport(); return; }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); actions.onImport(); return; }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (s.selectedNodeIds.length) s.removeNodes(s.selectedNodeIds);
        else if (s.selectedEdgeIds.length) s.removeEdges(s.selectedEdgeIds);
        return;
      }
      if (e.key === 'Escape') { actions.onStop(); return; }
      if (e.key === 'f') { actions.onFitSelection(); return; }
      if (e.key === 'F' && e.shiftKey) { actions.onFitAll(); return; }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions]);
}
