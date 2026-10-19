/**
 * vendored open-claude-ui 组件的类型声明。
 *
 * 为什么不直接把 vendor 目录放进 tsconfig 的 include：
 * vendor 是上游原样拷贝的演示组件（不修改其源码），其中 ClaudeDesktopHeader 用了
 * Electron 专有的 WebkitAppRegion、ScrollFadeContainer 用了 CSS 自定义属性强转，
 * 这两处在严格 tsc 下必然报错，但 Vite/esbuild 编译时完全不校验类型。
 * 因此类型层用本文件的精确声明，运行时仍由 Vite 的 @cds 别名指向 vendor 真身。
 */

declare module '@cds/CdsButton' {
  import type * as React from 'react';
  export type ButtonVariant =
    | 'primary'
    | 'secondary'
    | 'ghost'
    | 'danger'
    | 'brand'
    | 'onContent'
    | 'outline';
  export type ButtonSize = 'xxs' | 'xs' | 'sm' | 'md' | 'lg' | 'icon';
  export interface CdsButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    icon?: React.ReactNode;
    iconPosition?: 'left' | 'right';
    isLoading?: boolean;
    indicator?: React.ReactNode;
  }
  export const CdsButton: React.ForwardRefExoticComponent<
    CdsButtonProps & React.RefAttributes<HTMLButtonElement>
  >;
}

declare module '@cds/StatusIndicators' {
  import type * as React from 'react';
  export interface StatusDotProps {
    kind?: 'ready' | 'running' | 'error' | 'clay';
    label?: string;
    className?: string;
  }
  export function StatusDot(props: StatusDotProps): React.ReactElement;
  export function ClayBreatheDot(props: { className?: string }): React.ReactElement;
  export function PulseRunningDot(props: { className?: string }): React.ReactElement;
  export function QuietDotsWave(props: { label?: string }): React.ReactElement;
  export function SkeletonSweep(props: { className?: string }): React.ReactElement;
}

declare module '@cds/ClaudeDesktopHeader' {
  import type * as React from 'react';
  export interface ClaudeDesktopHeaderProps {
    title?: string;
    children?: React.ReactNode;
  }
  export const ClaudeDesktopHeader: React.FC<ClaudeDesktopHeaderProps>;
}

declare module '@cds/ConfirmationDialog' {
  import type * as React from 'react';
  export interface ConfirmationDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'default';
    size?: 'sm' | 'md' | 'lg';
    icon?: React.ReactNode;
  }
  export function ConfirmationDialog(props: ConfirmationDialogProps): React.ReactElement;
}

declare module '@cds/SegmentedControl' {
  import type * as React from 'react';
  export interface SegmentedTabItem {
    id: string;
    label: string;
    icon?: React.ReactNode;
    badge?: string | number;
  }
  export interface SegmentedControlProps {
    tabs: (string | SegmentedTabItem)[];
    value?: string | number;
    defaultValue?: string | number;
    onChange?: (value: string | number, index: number) => void;
    size?: 'sm' | 'md';
    className?: string;
    useFramerMotion?: boolean;
  }
  export function SegmentedControl(props: SegmentedControlProps): React.ReactElement;
}

declare module '@cds/MediaLightboxViewer' {
  import type * as React from 'react';
  export interface MediaItem {
    id: string;
    url: string;
    alt?: string;
    width?: number;
    height?: number;
    kind?: 'image' | 'video';
    loading?: boolean;
    originEl?: HTMLElement | null;
  }
  export interface MediaLightboxViewerProps {
    items: MediaItem[];
    initialIndex?: number;
    isOpen: boolean;
    onClose: () => void;
    backdrop?: 'blur' | 'dim';
    renderHeader?: (item: MediaItem, index: number) => React.ReactNode;
    renderAttribution?: (item: MediaItem, index: number) => React.ReactNode;
    className?: string;
  }
  export function MediaLightboxViewer(props: MediaLightboxViewerProps): React.ReactElement | null;
}

declare module '@cds/ThinkingAccordion' {
  import type * as React from 'react';
  export interface ThinkingAccordionProps {
    thoughtText: string;
    isThinkingLive: boolean;
    elapsedMs?: number;
    onCopyQuote?: () => void;
    className?: string;
  }
  export function ThinkingAccordion(props: ThinkingAccordionProps): React.ReactElement | null;
}

declare module '@cds/ScrollFadeContainer' {
  import type * as React from 'react';
  export interface ScrollFadeContainerProps {
    children: React.ReactNode;
    orientation?: 'vertical' | 'horizontal';
    fadeSize?: number;
    className?: string;
    style?: React.CSSProperties;
  }
  export const ScrollFadeContainer: React.FC<ScrollFadeContainerProps>;
}

declare module '@cds/CodeBlock' {
  import type * as React from 'react';
  export interface CodeBlockProps {
    code: string;
    language?: string;
    filename?: string;
    showLineNumbers?: boolean;
    className?: string;
  }
  export function CodeBlock(props: CodeBlockProps): React.ReactElement;
}

declare module '@cds/AttachmentCard' {
  import type * as React from 'react';
  export interface AttachmentCardProps {
    id?: string;
    name: string;
    size: string;
    type?: string;
    category?: string;
    uploading?: boolean;
    uploadProgress?: number;
    onRemove?: () => void;
    onClick?: () => void;
    layout?: 'tile' | 'chip';
    className?: string;
  }
  export function AttachmentCard(props: AttachmentCardProps): React.ReactElement;
}
