# Wholeframe

Chrome extension that screenshots the **entire page**, not just the window you can see.

It scrolls the page (or the main inner scroller), captures each screen, and stitches one PNG. Sticky headers and footers are kept on the first screen and hidden after that, so they are not repeated down the image. Nothing is uploaded.

## Install

1. Download this repository ([ZIP](https://github.com/rawqubit/wholeframe/archive/refs/heads/main.zip)) and unzip it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose the unzipped `wholeframe` folder (the one that contains `manifest.json`).
5. Pin **Wholeframe** from the puzzle-piece menu.

Chrome 116 or newer.

## Use

- **Capture full page** walks the document and opens a preview tab with download (PNG or JPEG) and copy.
- **Visible area only** grabs the current screen.
- **Wait** gives you a second or three to dismiss a cookie banner.
- **Scroll first** loads lazy images before the real capture.
- Right-click the page for the same two commands.

| Action | Windows / Linux | Mac |
| --- | --- | --- |
| Full page | `Ctrl+Shift+Y` | `⌘⇧Y` |
| Visible area | `Ctrl+Shift+U` | `⌘⇧U` |

Shortcuts can be changed at `chrome://extensions/shortcuts`.

## Notes

- Browser pages (`chrome://`, the Web Store, the new tab) cannot be captured. That is a Chrome rule.
- Pages taller than 50,000 pixels are cut off so an infinite feed cannot hang the browser.
- Extremely tall captures may be scaled down to stay inside Chrome's canvas limits. The preview says so when that happens.
- The toolbar icon is drawn by the extension. No account and no network permission.

## Develop

```bash
node --test test/plan.test.mjs
```

Load the folder as unpacked, edit, then click **Reload** on `chrome://extensions`.

## Privacy

Wholeframe only runs when you invoke it. Screenshots stay in your browser (an extension IndexedDB entry for the latest image, plus whatever you download). See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
