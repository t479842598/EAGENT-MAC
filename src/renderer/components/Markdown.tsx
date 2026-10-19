import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from '@cds/CodeBlock';

interface MarkdownProps {
  text: string;
}

/**
 * 哨兵行识别：模型回显工具调用时会把 # tool_shell_... 这类行原样吐出来，
 * react-markdown 会把行首 # 当标题渲染成巨大加粗字。这里先把哨兵行包成行内代码，
 * 既保留原文（便于排查），又不让它污染正文层级。
 */
const SENTINEL_LINE =
  /^(.*(?:tool_调用工具_识别头|tool_调用工具_识别尾|_tool_读取skill|agent_getjpg|agent_getfile|agent_skill_start|agent_skill_end).*)$/gm;

function tameSentinels(text: string): string {
  return text.replace(SENTINEL_LINE, (line) => {
    const clean = line.replace(/`/g, "'");
    return '`' + clean + '`';
  });
}

/**
 * 助手正文渲染。
 * vendored 的 AssistantMessageBubble 只做纯文本渲染（text 直接塞进 div），
 * 因此 markdown 由这里接管：react-markdown + remark-gfm，
 * 代码块复用 CDS 的 CodeBlock（自带复制与语言标签）。
 */
export function Markdown({ text }: MarkdownProps) {
  const source = useMemo(() => tameSentinels(text || ''), [text]);

  const components = useMemo(
    () => ({
      code(props: any) {
        const { className, children } = props;
        const raw = String(children ?? '').replace(/\n$/, '');
        const match = /language-(\w+)/.exec(className || '');
        const isBlock = !!match || raw.includes('\n');
        if (!isBlock) {
          return <code>{raw}</code>;
        }
        return <CodeBlock code={raw} language={match ? match[1] : 'text'} />;
      },
      pre(props: any) {
        // CodeBlock 自带外层容器，避免 <pre> 嵌套导致的双层背景
        return <>{props.children}</>;
      },
      a(props: any) {
        const href = String(props.href || '');
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (/^https?:/.test(href)) void window.eagent.openExternal(href);
            }}
          >
            {props.children}
          </a>
        );
      }
    }),
    []
  );

  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as any}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
