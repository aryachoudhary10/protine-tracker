"use client";

import { useEffect, useState } from "react";
import { bookmarklet } from "@/lib/bookmarklet.js";
import { TONES } from "@/lib/prompt.js";
import { ThemeToggle } from "../_components/ThemeToggle.jsx";

const TONE_LIST = Object.entries(TONES).map(([id, t]) => ({ id, ...t }));

export default function Tools() {
  // The bookmarklet has to carry this deployment's own origin, which is only
  // knowable in the browser. Rendered empty first so the page still prerenders.
  const [origin, setOrigin] = useState("");
  const [tone, setTone] = useState("natural");
  const [platform, setPlatform] = useState("desktop");

  useEffect(() => {
    setOrigin(window.location.origin);
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) setPlatform("ios");
    else if (/Android/.test(ua)) setPlatform("android");
  }, []);

  const href = origin ? bookmarklet(origin, tone) : "#";

  return (
    <div className="app">
      <header className="top">
        <div className="wrap">
          <div className="top-row">
            <a className="brand" href="/">
              <span className="mark" aria-hidden="true"><i /><i /></span>
              <span className="word">Rephrase</span>
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main>
        <div className="wrap prose">
          <h1>Use it anywhere you type</h1>
          <p className="lede">
            Rephrase is a website, not an app. These three routes let it rewrite text
            directly inside other sites and apps — no install from any store.
          </p>

          {platform === "ios" && (
            <p className="callout">
              You&rsquo;re on iOS. The bookmarklet below is your best option — Safari
              extensions require a native app wrapper.
            </p>
          )}
          {platform === "android" && (
            <p className="callout">
              You&rsquo;re on Android. The browser extension works in Firefox and Kiwi;
              the share sheet works everywhere once you install this site.
            </p>
          )}

          <section>
            <h2>1. Bookmarklet</h2>
            <p>
              Works in every browser, including Safari on iPhone. Select text on any page
              — or just tap into a text box — then run the bookmarklet. It rewrites in
              place, exactly where you were typing.
            </p>

            <label className="field-label" htmlFor="bm-tone">Style</label>
            <select
              id="bm-tone"
              className="select"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            >
              {TONE_LIST.map((t) => (
                <option key={t.id} value={t.id}>{t.label} — {t.hint}</option>
              ))}
            </select>

            <p className="drag-row">
              <a className="drag" href={href} onClick={(e) => e.preventDefault()}>
                Rephrase: {TONE_LIST.find((t) => t.id === tone)?.label}
              </a>
              <span className="drag-hint">← drag this to your bookmarks bar</span>
            </p>

            <details open={platform !== "desktop"}>
              <summary>Adding it on a phone</summary>
              <ol>
                <li>Bookmark any page (Safari: Share → Add Bookmark).</li>
                <li>Edit that bookmark, rename it <b>Rephrase</b>.</li>
                <li>Copy the code below and paste it over the bookmark&rsquo;s URL.</li>
                <li>To use it: type anywhere, then pick <b>Rephrase</b> from the address bar.</li>
              </ol>
              <CopyBox value={href} disabled={!origin} />
            </details>
          </section>

          <section>
            <h2>2. Browser extension</h2>
            <p>
              The closest thing to a keyboard. Adds <b>Rephrase</b> to the right-click menu
              in every text field, plus <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>.
              Pick a rewrite and it replaces what you selected.
            </p>
            <p>
              Works on Chrome, Edge, Brave and Firefox on desktop, and on Android
              through Firefox or Kiwi Browser. Not Safari — those extensions need a
              native app wrapper.
            </p>
            <p>
              It isn&rsquo;t in any store. Load it unpacked from the{" "}
              <code>extension/</code> folder of the repo; the README has the steps.
            </p>
          </section>

          <section>
            <h2>3. Share sheet</h2>
            <p>
              Install this site to your home screen and Android will list Rephrase
              wherever you tap Share. Select text in any app → Share → Rephrase, and it
              opens with the text already loaded.
            </p>
            <p>
              iOS ignores <code>share_target</code> entirely — Safari doesn&rsquo;t implement
              it, so this site can never appear in an iPhone share sheet. Shortcuts can,
              though, and a Shortcut triggered by Back Tap is faster than the share sheet
              anyway.
            </p>
          </section>

          <section>
            <h2>4. iPhone: double-tap the back of your phone</h2>
            <p>
              <b>Copy → double-tap → pick a variant → paste.</b> No app to open. The
              Shortcut reads your clipboard, so there is nothing to paste into.
            </p>

            <p className="field-label">Build the shortcut</p>
            <p>
              Shortcuts app → new shortcut → <b>ⓘ</b> → turn on <i>Show in Share Sheet</i>,
              accept <i>Text</i>. Then add:
            </p>
            <ol className="steps">
              <li><b>If</b> — <i>Shortcut Input</i> <i>has any value</i></li>
              <li>· <b>Set Variable</b> <code>Source</code> to <i>Shortcut Input</i></li>
              <li><b>Otherwise</b></li>
              <li>· <b>Get Clipboard</b>, then <b>Set Variable</b> <code>Source</code> to <i>Clipboard</i></li>
              <li><b>End If</b></li>
              <li>
                <b>Get Contents of URL</b> — <code>{(origin || "https://your-site") + "/api/rephrase"}</code>,
                method <b>POST</b>, header <code>Content-Type: application/json</code>,
                request body <b>JSON</b> with <code>text</code> = <i>Source</i> and{" "}
                <code>tone</code> = <code>{tone}</code>
              </li>
              <li><b>Get Dictionary Value</b> — key <code>variants</code></li>
              <li><b>Choose from List</b></li>
              <li><b>Copy to Clipboard</b> — <i>Chosen Item</i></li>
            </ol>
            <p>
              Name it <b>Rephrase</b>. The If/Otherwise means one shortcut covers both
              triggers: shared text when you use the share sheet, clipboard otherwise.
            </p>

            <p className="field-label">Wire it to Back Tap</p>
            <p>
              Settings → Accessibility → Touch → <b>Back Tap</b> → <b>Double Tap</b> →
              scroll to Shortcuts → <b>Rephrase</b>. Works on iPhone 8 and later.
            </p>
            <p>
              It can also go on a Home Screen widget, in Control Center, or on the Action
              Button if your iPhone has one. Duplicate the shortcut with a different{" "}
              <code>tone</code> value for a second style, or swap <b>Choose from List</b>{" "}
              for a <b>Choose from Menu</b> to pick the tone each time.
            </p>
          </section>

          <section>
            <h2>What about a real keyboard?</h2>
            <p>
              Not possible from a website. Android keyboards must be an{" "}
              <code>InputMethodService</code> and iOS keyboards a keyboard extension —
              both have to ship inside a signed app from the store. The extension above
              gets you the same in-place rewriting without that.
            </p>
          </section>

          <div className="bar-space" aria-hidden="true" />
        </div>
      </main>
    </div>
  );
}

function CopyBox({ value, disabled }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copybox">
      <textarea readOnly value={disabled ? "" : value} rows={3} spellCheck="false" onFocus={(e) => e.target.select()} />
      <button
        type="button"
        className="ghost"
        disabled={disabled}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1800);
          } catch { /* the textarea is selectable as a fallback */ }
        }}
      >
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
