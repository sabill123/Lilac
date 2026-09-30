/* ============================================================
   마크다운 렌더러 — 원본 components/legal/legal-document.tsx 대체.

   원본은 react-markdown + remark-gfm 을 쓴다. 라일락은 React가 없고
   법무 문서 3종만 렌더하면 되므로, 그 문서들이 실제로 쓰는 문법만
   지원하는 최소 파서를 둔다.

   지원: 제목(h1~h4) · 문단 · 순서/비순서 목록(중첩) · GFM 표 ·
        수평선 · 인용 · 굵게 · 기울임 · 인라인 코드 · 링크

   원본과 동일하게 표는 .legal-table-wrap 으로 감싼다.
   좁은 화면에서만 가로 스크롤이 걸리게 하려는 장치다.
   ============================================================ */

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 인라인 서식 — 이스케이프 후 적용해 마크업 주입을 막는다 */
function inline(src: string): string {
  let s = escapeHtml(src);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|#[^)\s]*)\)/g,
    '<a href="$2" rel="noopener noreferrer">$1</a>',
  );
  // 링크 문법 없이 놓인 순수 URL도 링크로 (약관 본문에 자주 등장)
  s = s.replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, '$1<a href="$2" rel="noopener noreferrer">$2</a>');
  return s;
}

const isTableSep = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  /** 목록 — 들여쓰기 깊이로 중첩을 만든다 */
  function readList(): string {
    const stack: { depth: number; ordered: boolean }[] = [];
    const buf: string[] = [];

    const close = (toDepth: number) => {
      while (stack.length && stack[stack.length - 1].depth > toDepth) {
        buf.push(stack.pop()!.ordered ? '</ol>' : '</ul>');
      }
    };

    while (i < lines.length) {
      const raw = lines[i];
      const m = raw.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (!m) {
        // 목록 항목의 이어지는 줄(들여쓴 본문)은 같은 li에 붙인다
        if (stack.length && /^\s{2,}\S/.test(raw) && raw.trim()) {
          buf.push(' ' + inline(raw.trim()));
          i++;
          continue;
        }
        if (!raw.trim() && stack.length) {
          // 빈 줄 다음이 여전히 목록이면 이어간다
          const next = lines[i + 1] || '';
          if (/^(\s*)([-*+]|\d+\.)\s+/.test(next)) {
            i++;
            continue;
          }
        }
        break;
      }
      const depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
      const ordered = /\d+\./.test(m[2]);
      const top = stack[stack.length - 1];

      if (!top || depth > top.depth) {
        stack.push({ depth, ordered });
        buf.push(ordered ? '<ol>' : '<ul>');
      } else if (depth < top.depth) {
        close(depth);
      }
      buf.push(`<li>${inline(m[3])}</li>`);
      i++;
    }
    close(-1);
    return buf.join('');
  }

  function readTable(): string {
    const head = cells(lines[i]);
    i += 2; // 헤더 + 구분선
    const rows: string[][] = [];
    while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
      rows.push(cells(lines[i]));
      i++;
    }
    return (
      '<div class="legal-table-wrap"><table><thead><tr>' +
      head.map((h) => `<th>${inline(h)}</th>`).join('') +
      '</tr></thead><tbody>' +
      rows
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('') +
      '</tbody></table></div>'
    );
  }

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // 수평선
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr />'); i++; continue; }

    // 제목
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    // GFM 표
    if (line.includes('|') && isTableSep(lines[i + 1] || '')) { out.push(readTable()); continue; }

    // 인용
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(inline(lines[i].replace(/^>\s?/, '')));
        i++;
      }
      out.push(`<blockquote><p>${buf.join(' ')}</p></blockquote>`);
      continue;
    }

    // 목록
    if (/^(\s*)([-*+]|\d+\.)\s+/.test(line)) { out.push(readList()); continue; }

    // 문단
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !(lines[i].includes('|') && isTableSep(lines[i + 1] || ''))
    ) {
      buf.push(inline(lines[i].trim()));
      i++;
    }
    if (buf.length) out.push(`<p>${buf.join('<br />')}</p>`);
  }

  return out.join('\n');
}
