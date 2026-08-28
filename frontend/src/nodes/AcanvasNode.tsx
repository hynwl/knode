'use client';

import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import { getNodeDef } from './registry';
import { useAppStore, useNodeState } from '@/store';
import type { AcNode } from '@/types/canvas';
import { cn } from '@/lib/cn';

/**
 * 모든 노드 타입은 **레지스트리 기반 단일 컴포넌트**로 렌더링한다.
 * (Spec §5.1-1 "노드 정의는 한 곳에서만 선언한다" 의 컴포넌트 레벨 귀결.
 *  타입별 파일을 두면 정의가 두 곳으로 갈라진다.)
 * 본문 미리보기만 타입별로 분기한다.
 */
export const AcanvasNode = memo(function AcanvasNode({ id, selected }: NodeProps) {
  const node = useAppStore((s) => s.nodes.find((n) => n.id === id));
  if (!node) return null;
  return (
    <BaseNode node={node} selected={Boolean(selected)}>
      <NodeBody node={node} />
    </BaseNode>
  );
});

function NodeBody({ node }: { node: AcNode }) {
  const def = getNodeDef(node.type);
  const runState = useNodeState(node.id);
  const d = node.data as Record<string, unknown>;

  switch (node.type) {
    case 'llm':
      return (
        <>
          <Row1>{String(d.provider ?? '').toUpperCase()} / {String(d.model ?? '')}</Row1>
          <Row2>temperature {String(d.temperature ?? '')}</Row2>
        </>
      );

    case 'agent':
      return (
        <>
          <Row1>{String(d.role || '역할 미지정')}</Row1>
          <Row2>{String(d.goal || '목표를 입력하세요')}</Row2>
          {Boolean(d.allow_delegation) && <span className="ac-chip">위임 허용</span>}
        </>
      );

    case 'task':
      return (
        <>
          <Row2>{String(d.description || '작업 설명을 입력하세요')}</Row2>
          {runState?.output && <OutputPeek text={runState.output} />}
        </>
      );

    case 'tool':
      return <Row1>{String(d.tool_id ?? '')}</Row1>;

    case 'crew':
      return (
        <>
          <Row1>{String(d.process ?? 'sequential')}</Row1>
          <Row2>
            {Boolean(d.memory) && 'memory · '}
            {Boolean(d.cache) && 'cache · '}
            {Boolean(d.planning) && 'planning'}
          </Row2>
        </>
      );

    case 'input':
      return (
        <>
          <Row1>{`{${String(d.var_name ?? '')}}`}</Row1>
          <Row2>{String(d.label ?? '')}{d.required ? ' · 필수' : ''}</Row2>
        </>
      );

    case 'output':
      return (
        <>
          <Row1>{String(d.title ?? '결과')}</Row1>
          {runState?.output
            ? <OutputPeek text={runState.output} lines={6} />
            : <Row2>실행이 끝나면 여기에 결과가 표시됩니다.</Row2>}
        </>
      );

    case 'knowledge':
      return (
        <>
          <Row1>{String(d.source_type ?? 'text')}</Row1>
          <Row2>{String(d.content || d.url || d.file_ref || '지식원을 지정하세요')}</Row2>
        </>
      );

    case 'memory':
      return (
        <Row2>
          {[d.short_term && '단기', d.long_term && '장기', d.entity && '엔티티']
            .filter(Boolean).join(' · ') || '비활성'}
        </Row2>
      );

    case 'human':
      return <Row2>{String(d.prompt ?? '')}</Row2>;

    case 'router':
    case 'guardrail':
      return (
        <>
          <Row2>{String(d.condition ?? d.type ?? '')}</Row2>
          <span className="ac-chip !text-amber">v1.1 예정 · 실행 제외</span>
        </>
      );

    case 'note':
      return (
        <div className="whitespace-pre-wrap text-t11_5 leading-normal text-text-dim">
          {String(d.text ?? '')}
        </div>
      );

    case 'group':
      return <Row2>{String(d.title ?? '그룹')}</Row2>;

    default:
      return <Row2>{def.description}</Row2>;
  }
}

function Row1({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden text-ellipsis whitespace-nowrap text-t12_5 font-bold text-text">
      {children}
    </div>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden text-t11_5 leading-tight text-text-faint"
      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}
    >
      {children}
    </div>
  );
}

/** 실행 결과 미리보기 — 노드 하단 접이식 영역 (Spec §10.3) */
function OutputPeek({ text, lines = 3 }: { text: string; lines?: number }) {
  return (
    <div
      className={cn(
        'mt-1 rounded-lg border border-border-soft bg-surface-2 p-2',
        'font-mono text-t10 leading-relaxed text-log-ok',
      )}
      style={{ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
    >
      {text}
    </div>
  );
}
