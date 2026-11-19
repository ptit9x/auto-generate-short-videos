/**
 * Tiny syntax highlighter for code-demo scenes (TS/JS/JSX only).
 *
 * Deliberately small: it recognises comments, strings, numbers and a
 * keyword set, and wraps them in <span class="tok-…">. Everything is
 * HTML-escaped. It is NOT a parser — mis-highlighting a weird edge case
 * is acceptable, producing broken/unsafe HTML is not.
 */

const KEYWORDS = new Set([
  "import", "from", "export", "default", "function", "return", "const",
  "let", "var", "async", "await", "new", "if", "else", "try", "catch",
  "finally", "throw", "typeof", "instanceof", "switch", "case", "break",
  "continue", "for", "while", "do", "of", "in", "true", "false", "null",
  "undefined", "this", "class", "extends", "type", "interface",
]);

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function span(cls: string, text: string): string {
  return `<span class="${cls}">${esc(text)}</span>`;
}

/** Highlight ONE line of code. Returns HTML (already escaped). */
export function highlightCodeLine(line: string): string {
  let out = "";
  let plain = "";
  const flush = () => {
    if (plain) { out += esc(plain); plain = ""; }
  };

  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    const rest = line.slice(i);

    // Line comment — consumes the rest of the line.
    if (rest.startsWith("//")) {
      flush();
      out += span("tok-comment", rest);
      break;
    }

    // String / template literal.
    if (ch === "'" || ch === '"' || ch === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) {
        if (line[j] === "\\") j += 1;
        j += 1;
      }
      j = Math.min(j + 1, line.length); // include closing quote
      flush();
      out += span("tok-string", line.slice(i, j));
      i = j;
      continue;
    }

    // Number literal at a word boundary.
    if (/[0-9]/.test(ch) && !/[A-Za-z0-9_$]/.test(line[i - 1] ?? " ")) {
      const m = /^[0-9][0-9_]*(?:\.[0-9]+)?/.exec(rest);
      if (m) {
        flush();
        out += span("tok-number", m[0]);
        i += m[0].length;
        continue;
      }
    }

    // Identifier / keyword.
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(rest)!;
      if (KEYWORDS.has(m[0])) {
        flush();
        out += span("tok-keyword", m[0]);
      } else {
        plain += m[0];
      }
      i += m[0].length;
      continue;
    }

    plain += ch;
    i += 1;
  }
  flush();
  return out;
}
