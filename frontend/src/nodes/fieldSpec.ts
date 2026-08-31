/** 노드 본문에 렌더링될 폼 필드 선언 (Spec §5.1 NodeDefinition.fields) */

export type FieldKind =
  | 'text' | 'textarea' | 'select' | 'combobox' | 'number'
  | 'slider' | 'toggle' | 'code' | 'tags' | 'file';

export interface FieldOption {
  value: string;
  label: string;
  hint?: string;
}

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  /** true 면 인스펙터의 "고급" 섹션에만 노출된다 */
  advanced?: boolean;
  /** 노드 본문(캔버스)에도 미리보기로 노출할지 */
  showOnNode?: boolean;
  rows?: number;
  min?: number;
  max?: number;
  step?: number;
  options?: FieldOption[];
  /** 이 필드를 보이게 할 조건 (같은 노드의 다른 필드 값) */
  visibleWhen?: { key: string; equals: unknown };
  /**
   * `{var_name}` 보간을 지원하는 필드. `true` 면 인스펙터가 실시간 하이라이팅을
   * 적용한다 — 정의된 Input 변수는 강조, 정의되지 않은 변수는 `AC-W301` 과 같은
   * 밑줄로 표시한다 (Spec §5.8 동작 흐름 1~2).
   */
  interpolatesVars?: boolean;
}
