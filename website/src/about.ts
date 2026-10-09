import { copyButton } from "./dom.js";
import { initChrome } from "./chrome.js";

initChrome();
document.querySelectorAll<HTMLElement>("[data-copy]").forEach((el) => {
  const text = el.getAttribute("data-copy") ?? "";
  el.append(copyButton(text));
});
