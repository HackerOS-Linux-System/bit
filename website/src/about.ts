import { copyButton } from "./dom.js";
import { initTheme } from "./theme.js";

initTheme();
document.querySelectorAll<HTMLElement>("[data-copy]").forEach((el) => {
  const text = el.getAttribute("data-copy") ?? "";
  el.append(copyButton(text));
});
