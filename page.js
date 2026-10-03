/* Injected into the active tab. Runs in the extension isolated world. */
(() => {
  const VERSION = 1;
  if (globalThis.__wholeframe?.version === VERSION) return;

  const state = {
    styleEl: null,
    sticky: [],
    prevScrollX: 0,
    prevScrollY: 0,
    scroller: null,
    prevElScroll: 0,
  };

  function scrollingElement() {
    return document.scrollingElement || document.documentElement;
  }

  function findScroller() {
    const se = scrollingElement();
    const docExtra = (se?.scrollHeight || 0) - window.innerHeight;
    if (docExtra > 32) return { kind: "window", el: se };

    let best = null;
    let bestExtra = 120;
    const nodes = document.querySelectorAll("main, article, [role='main'], section, div");
    const limit = Math.min(nodes.length, 4000);
    for (let i = 0; i < limit; i++) {
      const el = nodes[i];
      if (!(el instanceof Element)) continue;
      const extra = el.scrollHeight - el.clientHeight;
      if (extra < bestExtra) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < window.innerWidth * 0.55) continue;
      if (rect.height < window.innerHeight * 0.45) continue;
      best = el;
      bestExtra = extra;
    }
    if (best) return { kind: "element", el: best };
    return { kind: "window", el: se };
  }

  function boxOf(el) {
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    return {
      x,
      y,
      w: Math.max(1, right - x),
      h: Math.max(1, bottom - y),
    };
  }

  function metrics() {
    const sc = state.scroller || findScroller();
    const dpr = window.devicePixelRatio || 1;
    const title = document.title || "page";
    const url = location.href;
    if (sc.kind === "element" && sc.el?.isConnected) {
      const box = boxOf(sc.el);
      return {
        kind: "element",
        fullWidth: Math.max(1, Math.round(sc.el.clientWidth)),
        fullHeight: Math.max(1, Math.round(sc.el.scrollHeight)),
        viewportWidth: Math.max(1, Math.round(sc.el.clientWidth)),
        viewportHeight: Math.max(1, Math.round(sc.el.clientHeight)),
        crop: box,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        dpr,
        title,
        url,
      };
    }
    const se = scrollingElement();
    return {
      kind: "window",
      fullWidth: Math.max(1, Math.round(Math.max(se.scrollWidth, window.innerWidth))),
      fullHeight: Math.max(1, Math.round(Math.max(se.scrollHeight, window.innerHeight))),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      crop: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      dpr,
      title,
      url,
    };
  }

  function prepare() {
    state.prevScrollX = window.scrollX || 0;
    state.prevScrollY = window.scrollY || 0;
    state.scroller = findScroller();
    if (state.scroller.kind === "element") {
      state.prevElScroll = state.scroller.el.scrollTop;
    }

    if (!state.styleEl) {
      const el = document.createElement("style");
      el.setAttribute("data-wholeframe", "1");
      el.textContent = [
        "html[data-wf], html[data-wf] body, html[data-wf] * { scroll-behavior: auto !important; }",
        "html[data-wf]::-webkit-scrollbar, html[data-wf] *::-webkit-scrollbar { width: 0 !important; height: 0 !important; }",
        "html[data-wf], html[data-wf] * { scrollbar-width: none !important; }",
        'html[data-wf-pass="rest"] [data-wf-sticky="1"] { visibility: hidden !important; }',
      ].join("\n");
      (document.documentElement || document.head || document.body).appendChild(el);
      state.styleEl = el;
    }
    document.documentElement.setAttribute("data-wf", "1");
    document.documentElement.setAttribute("data-wf-pass", "first");

    state.sticky = [];
    const root = document.body || document.documentElement;
    if (root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let count = 0;
      let node = walker.nextNode();
      while (node) {
        if (++count > 12000) break;
        const pos = getComputedStyle(node).position;
        if (pos === "fixed" || pos === "sticky") {
          node.setAttribute("data-wf-sticky", "1");
          state.sticky.push(node);
        }
        node = walker.nextNode();
      }
    }
    return metrics();
  }

  function setPass(pass) {
    document.documentElement.setAttribute("data-wf-pass", pass === "rest" ? "rest" : "first");
    return true;
  }

  function scrollToPos(y) {
    const target = Math.max(0, Number(y) || 0);
    const sc = state.scroller || findScroller();
    if (sc.kind === "element" && sc.el?.isConnected) {
      sc.el.scrollTop = target;
      const box = boxOf(sc.el);
      return {
        scrollY: sc.el.scrollTop,
        viewportHeight: sc.el.clientHeight,
        maxScroll: Math.max(0, sc.el.scrollHeight - sc.el.clientHeight),
        crop: box,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
      };
    }
    window.scrollTo(0, target);
    return {
      scrollY: window.scrollY || window.pageYOffset || 0,
      viewportHeight: window.innerHeight,
      maxScroll: Math.max(0, (scrollingElement()?.scrollHeight || 0) - window.innerHeight),
      crop: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    };
  }

  function waitPaint() {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve(true));
      });
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function warm(maxHeight) {
    const cap = Math.max(1, Number(maxHeight) || 50000);
    const sc = state.scroller || findScroller();
    state.scroller = sc;
    let y = 0;
    let hops = 0;
    let lastHeight = 0;
    while (hops < 70 && y < cap) {
      const pos = scrollToPos(y);
      await sleep(70);
      await waitPaint();
      const m = metrics();
      if (m.fullHeight > cap && y > 0) break;
      if (pos.scrollY + 4 >= pos.maxScroll) break;
      if (m.fullHeight === lastHeight && hops > 2 && pos.scrollY + pos.viewportHeight >= m.fullHeight - 4) break;
      lastHeight = m.fullHeight;
      y += Math.max(240, Math.floor(pos.viewportHeight * 0.9));
      hops += 1;
    }
    scrollToPos(0);
    await sleep(60);
    return metrics();
  }

  function restore() {
    document.documentElement.removeAttribute("data-wf");
    document.documentElement.removeAttribute("data-wf-pass");
    for (const el of state.sticky) {
      try { el.removeAttribute("data-wf-sticky"); } catch { /* detached */ }
    }
    state.sticky = [];
    if (state.styleEl) {
      state.styleEl.remove();
      state.styleEl = null;
    }
    const sc = state.scroller;
    if (sc?.kind === "element" && sc.el?.isConnected) {
      sc.el.scrollTop = state.prevElScroll || 0;
    }
    window.scrollTo(state.prevScrollX || 0, state.prevScrollY || 0);
    state.scroller = null;
    return true;
  }

  globalThis.__wholeframe = {
    version: VERSION,
    metrics,
    prepare,
    setPass,
    scrollToPos,
    waitPaint,
    warm,
    restore,
  };
})();
