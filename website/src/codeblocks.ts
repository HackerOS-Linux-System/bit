import { copyButton, h } from "./dom.js";
import { extForLang, highlight } from "./highlight.js";

/**
 * Fenced code blocks of rendered Markdown: syntax colours (from the ```lang hint) + a Copy button.
 * Works on the sanitized DOM, so it only ever creates text nodes and spans.
 */
export function decorateCode(container: HTMLElement): void {
  container.querySelectorAll("pre").forEach((pre) => {
    if (pre.closest(".snippet")) return;
    const code = pre.querySelector("code");
    const text = pre.textContent ?? "";
    const lang = /(?:^|\s)language-([\w+#.-]+)/.exec(code?.className ?? "")?.[1];
    if (code && lang && text.length < 60_000) {
      const ext = extForLang(lang);
      const tokens = highlight(text, ext, "");
      if (tokens.some((t) => t.kind !== "")) {
        code.replaceChildren(...tokens.map((t) => (t.kind ? h("span", { class: `tok-${t.kind}` }, t.text) : document.createTextNode(t.text))));
      }
    }
    const wrap = h("div", { class: "snippet" });
    pre.replaceWith(wrap);
    wrap.append(pre, copyButton(text));
  });
}

/** "On this page" list from the headings of a rendered README (only when there are enough). */
export function buildToc(container: HTMLElement): HTMLElement | null {
  const heads = [...container.querySelectorAll<HTMLElement>("h2, h3")].filter((x) => x.id);
  if (heads.length < 3) return null;
  const list = h("ul", { class: "toc-list" });
  for (const x of heads) {
    list.append(h("li", { class: x.tagName === "H3" ? "is-sub" : "" }, h("a", { href: `#${x.id}` }, x.textContent ?? "")));
  }
  return h("details", { class: "toc" }, h("summary", {}, "On this page"), list);
}
