import { describe, it, expect } from "vitest";
import { highlightCodeLine } from "./code-highlight.js";

describe("highlightCodeLine", () => {
  it("wraps keywords, strings and numbers in token spans", () => {
    const html = highlightCodeLine("const x = 'users'; // 60_000");
    expect(html).toContain('<span class="tok-keyword">const</span>');
    expect(html).toContain('<span class="tok-string">&#39;users&#39;</span>');
    expect(html).toContain('<span class="tok-comment">// 60_000</span>');
  });

  it("highlights number literals", () => {
    expect(highlightCodeLine("staleTime: 60_000,")).toContain('<span class="tok-number">60_000</span>');
  });

  it("escapes HTML so code can never inject markup", () => {
    const html = highlightCodeLine("if (a < b) return <p>{x}</p>;");
    expect(html).not.toContain("<p>");
    expect(html).toContain("&lt;p&gt;");
    expect(html).toContain('<span class="tok-keyword">if</span>');
    expect(html).toContain('<span class="tok-keyword">return</span>');
  });

  it("does not treat identifiers containing keywords as keywords", () => {
    const html = highlightCodeLine("const constant = returnValue;");
    expect(html).not.toContain('<span class="tok-keyword">constant</span>');
    expect(html).not.toContain('<span class="tok-keyword">returnValue</span>');
  });

  it("handles empty lines", () => {
    expect(highlightCodeLine("")).toBe("");
  });
});
