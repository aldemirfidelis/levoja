import { Fragment, ReactNode } from 'react';

/**
 * Renderizador de Markdown mínimo e SEGURO (sem HTML bruto) para documentos legais:
 * títulos (#, ##, ###), parágrafos, listas (-, *, 1.) e **negrito**.
 * Gera elementos React — nenhum conteúdo é injetado como HTML.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>,
  );
}

export function Markdown({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const Tag = (level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3') as 'h1';
      blocks.push(<Tag key={blocks.length}>{inline(heading[2])}</Tag>);
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();

  return (
    <div className="space-y-4 text-fg [&_h1]:text-3xl [&_h1]:font-extrabold [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_p]:leading-relaxed [&_p]:text-muted [&_ul]:list-disc [&_ul]:space-y-1 [&_li]:text-muted">
      {blocks}
    </div>
  );
}
