import { copyButton, h } from "./dom.js";

/** Release assets of the bit.io mobile apps. */
export const APP_DOWNLOADS = {
  android: {
    url: "https://github.com/HackerOS-Linux-System/bit/releases/download/v0.3/bit-io-android-app.apk",
    file: "bit-io-android-app.apk",
  },
  ios: {
    url: "https://github.com/HackerOS-Linux-System/bit/releases/download/v0.3/bit-io-ios-app.ipa",
    file: "bit-io-ios-app.ipa",
  },
} as const;

/** Shown to HackerOS users instead of a download. */
export const HACKEROS_COMMAND = "hacker unpack bit-app";

type Platform = "hackeros" | "android" | "ios";

const PLATFORMS: Array<{ id: Platform; name: string; hint: string; glyph: string }> = [
  { id: "hackeros", name: "HackerOS", hint: "install from the package source", glyph: "⌘" },
  { id: "android", name: "Android", hint: "download the .apk", glyph: "▲" },
  { id: "ios", name: "iOS", hint: "download the .ipa", glyph: "●" },
];

/** Starts a download without leaving the page (GitHub serves release assets as attachments). */
function startDownload(url: string, file: string): void {
  const a = h("a", { href: url, download: file, rel: "noopener" });
  a.style.display = "none";
  document.body.append(a);
  a.click();
  a.remove();
}

function buildDialog(): HTMLDialogElement {
  const dialog = h("dialog", { class: "app-dialog", "aria-labelledby": "app-dialog-title" });
  const body = h("div", { class: "app-dialog-body" });
  dialog.append(body);

  const close = (): void => dialog.close();

  const chooser = (): void => {
    const buttons = PLATFORMS.map((p) => {
      const b = h(
        "button",
        { class: "platform", type: "button", "data-platform": p.id },
        h("span", { class: "platform-glyph", "aria-hidden": "true" }, p.glyph),
        h("span", { class: "platform-text" }, h("b", {}, p.name), h("small", {}, p.hint)),
      );
      b.addEventListener("click", () => result(p.id));
      return b;
    });
    const closeBtn = h("button", { class: "icon-btn app-dialog-close", type: "button", "aria-label": "Close" }, "×");
    closeBtn.addEventListener("click", close);
    body.replaceChildren(
      closeBtn,
      h("h2", { id: "app-dialog-title" }, "Get the bit.io app"),
      h("p", { class: "muted" }, "Which platform are you on?"),
      h("div", { class: "platforms" }, ...buttons),
    );
    buttons[0]?.focus();
  };

  const back = (): HTMLButtonElement => {
    const b = h("button", { class: "btn", type: "button" }, "← Choose another platform");
    b.addEventListener("click", chooser);
    return b;
  };

  const result = (platform: Platform): void => {
    const title = h("h2", { id: "app-dialog-title" }, platform === "hackeros" ? "bit.io on HackerOS" : platform === "android" ? "bit.io for Android" : "bit.io for iOS");
    const closeBtn = h("button", { class: "icon-btn app-dialog-close", type: "button", "aria-label": "Close" }, "×");
    closeBtn.addEventListener("click", close);

    if (platform === "hackeros") {
      body.replaceChildren(
        closeBtn,
        title,
        h("p", { class: "muted" }, "Run this in a terminal:"),
        h("div", { class: "install app-command" }, h("span", {}, `$ ${HACKEROS_COMMAND}`), copyButton(HACKEROS_COMMAND)),
        h("div", { class: "app-actions" }, back()),
      );
      return;
    }

    const dl = APP_DOWNLOADS[platform];
    startDownload(dl.url, dl.file);
    body.replaceChildren(
      closeBtn,
      title,
      h("p", { class: "muted" }, `Your download of ${dl.file} has started.`),
      h("p", { class: "small muted" }, "Nothing happened? ", h("a", { href: dl.url, rel: "noopener" }, `Download ${dl.file}`), "."),
      h("div", { class: "app-actions" }, back()),
    );
  };

  // a click on the backdrop (the <dialog> element itself) closes it
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });
  dialog.addEventListener("close", chooser);
  chooser();
  return dialog;
}

/** Adds the "Get the app" button to the header of every page and opens the platform picker. */
export function initGetApp(): void {
  const wrap = document.querySelector(".nav .wrap");
  if (!wrap || wrap.querySelector("[data-get-app]")) return;

  const button = h("button", { class: "btn primary get-app", type: "button", "data-get-app": "", "aria-haspopup": "dialog" }, "Get the app");
  const themeToggle = wrap.querySelector("[data-theme-toggle]");
  if (themeToggle) wrap.insertBefore(button, themeToggle);
  else wrap.append(button);

  let dialog: HTMLDialogElement | null = null;
  button.addEventListener("click", () => {
    if (!dialog) {
      dialog = buildDialog();
      document.body.append(dialog);
    }
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });
}
