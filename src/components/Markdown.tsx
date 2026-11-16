import { Fragment, type ReactNode } from 'react';

/**
 * Renders a small Markdown subset as React nodes.
 * Never uses dangerouslySetInnerHTML: raw HTML in content is displayed as text,
 * which makes stored-XSS through the editor structurally impossible.
 */

function safeHref(url: string): string | null {
  const value = url.trim();
  if (/^\/(?!\/)/.test(value)) return value;
  if (/^https?:\/\/[^\s]+$/i.test(value)) return value;
  if (/^mailto:[^\s]+$/i.test(value)) return value;
  return null;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${i++}`;
    if (token.startsWith('**')) {
      nodes.push(<strong key={key} className="text-bone-100 font-semibold">{renderInline(token.slice(2, -2), key)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (linkMatch) {
        const href = safeHref(linkMatch[2]);
        nodes.push(
          href
            ? <a key={key} href={href} rel={href.startsWith('http') ? 'noopener noreferrer nofollow' : undefined}
                target={href.startsWith('http') ? '_blank' : undefined}>{linkMatch[1]}</a>
            : <span key={key}>{linkMatch[1]}</span>,
        );
      } else nodes.push(token);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function Markdown({ content, className = '' }: { content: string; className?: string }) {
  if (!content) return null;
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  const flushList = (items: string[], ordered: boolean, k: string) => {
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={k}>
        {items.map((item, idx) => <li key={`${k}-${idx}`}>{renderInline(item, `${k}-${idx}`)}</li>)}
      </Tag>,
    );
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^###\s+/.test(line)) {
      blocks.push(<h3 key={`h${key++}`}>{renderInline(line.replace(/^###\s+/, ''), `h${key}`)}</h3>);
      i++;
      continue;
    }
    if (/^##\s+/.test(line)) {
      blocks.push(<h2 key={`h${key++}`}>{renderInline(line.replace(/^##\s+/, ''), `h${key}`)}</h2>);
      i++;
      continue;
    }
    if (/^#\s+/.test(line)) {
      blocks.push(<h2 key={`h${key++}`}>{renderInline(line.replace(/^#\s+/, ''), `h${key}`)}</h2>);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      blocks.push(<hr key={`hr${key++}`} className="my-6 border-ink-600" />);
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={`q${key++}`}>
          {quote.map((q, idx) => <p key={idx}>{renderInline(q, `q${key}-${idx}`)}</p>)}
        </blockquote>,
      );
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const parseRow = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      blocks.push(
        <table key={`t${key++}`}>
          <thead><tr>{head.map((h, idx) => <th key={idx}>{renderInline(h, `th${idx}`)}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, rIdx) => (
              <tr key={rIdx}>{row.map((cell, cIdx) => <td key={cIdx}>{renderInline(cell, `td${rIdx}-${cIdx}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (/^(\s*[-*])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^(\s*[-*])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^(\s*[-*])\s+/, ''));
        i++;
      }
      flushList(items, false, `ul${key++}`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      flushList(items, true, `ol${key++}`);
      continue;
    }
    if (/^```/.test(line)) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++;
      blocks.push(<pre key={`pre${key++}`}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|\||```|\s*[-*]\s|\d+\.\s|---)/.test(lines[i])
    ) {
      paragraph.push(lines[i]);
      i++;
    }
    if (paragraph.length) {
      blocks.push(<p key={`p${key++}`}>{renderInline(paragraph.join(' '), `p${key}`)}</p>);
    } else {
      i++;
    }
  }

  return <div className={`zm-prose ${className}`}>{blocks.map((b, idx) => <Fragment key={idx}>{b}</Fragment>)}</div>;
}
