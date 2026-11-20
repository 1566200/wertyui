(function () {
  "use strict";

  var SEALED = window.__SEALED__;
  var REMEMBER_KEY = "env-cards-key-v1";
  var REMEMBER_DAYS = 30;
  var $ = function (id) { return document.getElementById(id); };

  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function importPassword(password, salt, iter) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"])
      .then(function (base) {
        return crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" },
          base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]
        );
      });
  }

  function decryptWith(key, iv, data) {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, data);
  }

  function openApp(text) {
    window.CARDS = JSON.parse(text);
    var lock = $("lock");
    if (lock) lock.hidden = true;
    $("app").hidden = false;
    if (typeof window.startCards === "function") window.startCards();
  }

  function remembered() {
    try {
      var raw = localStorage.getItem(REMEMBER_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.k || !obj.t) return null;
      if (Date.now() - obj.t > REMEMBER_DAYS * 864e5) { localStorage.removeItem(REMEMBER_KEY); return null; }
      return obj.k;
    } catch (e) { return null; }
  }

  function remember(rawKeyB64) {
    try { localStorage.setItem(REMEMBER_KEY, JSON.stringify({ k: rawKeyB64, t: Date.now() })); } catch (e) {}
  }

  function boot() {
    if (!SEALED) { return; }

    var salt = b64ToBytes(SEALED.salt);
    var iv = b64ToBytes(SEALED.iv);
    var data = b64ToBytes(SEALED.ct);

    var saved = remembered();
    if (saved) {
      crypto.subtle.importKey("raw", b64ToBytes(saved), { name: "AES-GCM" }, false, ["decrypt"])
        .then(function (k) { return decryptWith(k, iv, data); })
        .then(function (buf) { openApp(new TextDecoder().decode(buf)); })
        .catch(function () { try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {} });
      // 记住的钥匙失败时仍显示锁屏
      setTimeout(function () { if ($("app").hidden) $("lock").hidden = false; }, 60);
    }

    var form = $("lock-form");
    var input = $("lock-password");
    var err = $("lock-error");
    var btn = $("lock-submit");
    var rememberBox = $("lock-remember");
    var toggle = $("lock-toggle");

    if (toggle) {
      toggle.addEventListener("change", function () {
        input.type = toggle.checked ? "text" : "password";
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var pwd = input.value;
      if (!pwd) return;
      btn.disabled = true;
      btn.textContent = "解锁中…";
      err.textContent = "";
      importPassword(pwd, salt, SEALED.iter)
        .then(function (k) { return decryptWith(k, iv, data).then(function (buf) { return { k: k, buf: buf }; }); })
        .then(function (r) {
          if (rememberBox && rememberBox.checked) {
            crypto.subtle.exportKey("raw", r.k).then(function (raw) { remember(bytesToB64(new Uint8Array(raw))); }).catch(function () {});
          } else {
            try { localStorage.removeItem(REMEMBER_KEY); } catch (e) {}
          }
          openApp(new TextDecoder().decode(r.buf));
        })
        .catch(function () {
          err.textContent = "密码不对，再试一次";
          input.select();
          btn.disabled = false;
          btn.textContent = "解锁";
          var box = document.querySelector(".lock-card");
          if (box) { box.classList.remove("shake"); void box.offsetWidth; box.classList.add("shake"); }
        });
    });

    setTimeout(function () { try { input.focus(); } catch (e) {} }, 120);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.startCards = window.startCards || function () {};
})();

window.startCards = function () {
  "use strict";

  var STORE_KEY = "env-cards-mastered-v1";
  var FILTER_KEY = "env-cards-filter-v1";

  var el = {
    card: document.getElementById("card"),
    badge: document.getElementById("badge"),
    counter: document.getElementById("counter"),
    question: document.getElementById("question"),
    hint: document.getElementById("hint"),
    answer: document.getElementById("answer"),
    notice: document.getElementById("notice"),
    points: document.getElementById("points"),
    quote: document.getElementById("quote"),
    cite: document.getElementById("cite"),
    mnemonic: document.getElementById("mnemonic-box"),
    bar: document.getElementById("bar"),
    pcount: document.getElementById("pcount"),
    btnPrev: document.getElementById("btn-prev"),
    btnNext: document.getElementById("btn-next"),
    btnReveal: document.getElementById("btn-reveal"),
    btnMaster: document.getElementById("btn-master"),
    btnReset: document.getElementById("btn-reset"),
    btnResetDrawer: document.getElementById("btn-reset-drawer"),
    btnShuffle: document.getElementById("btn-shuffle"),
    btnIndex: document.getElementById("btn-index"),
    filters: document.querySelectorAll(".chip[data-filter]"),
    drawer: document.getElementById("drawer"),
    drawerClose: document.getElementById("drawer-close"),
    indexList: document.getElementById("index-list")
  };

  var state = {
    filter: "all",
    order: [],
    pos: 0,
    revealed: false,
    mastered: {}
  };

  /* ---------- 存储 ---------- */
  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) state.mastered = JSON.parse(raw) || {};
    } catch (e) { state.mastered = {}; }
    try {
      var f = localStorage.getItem(FILTER_KEY);
      if (f === "term" || f === "qa" || f === "todo" || f === "all") state.filter = f;
    } catch (e) {}
  }
  function saveMastered() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.mastered)); } catch (e) {}
  }
  function saveFilter() {
    try { localStorage.setItem(FILTER_KEY, state.filter); } catch (e) {}
  }

  function isMastered(id) { return !!state.mastered[id]; }

  function masteredCount() {
    return CARDS.filter(function (c) { return isMastered(c.id); }).length;
  }

  /* ---------- 卡池/顺序 ---------- */
  function pool() {
    if (state.filter === "term") return CARDS.filter(function (c) { return c.kind === "term"; });
    if (state.filter === "qa") return CARDS.filter(function (c) { return c.kind === "qa"; });
    if (state.filter === "todo") return CARDS.filter(function (c) { return !isMastered(c.id); });
    return CARDS.slice();
  }

  function rebuildOrder(keepId) {
    var ids = pool().map(function (c) { return c.id; });
    state.order = ids;
    if (keepId && ids.indexOf(keepId) >= 0) {
      state.pos = ids.indexOf(keepId);
    } else {
      state.pos = 0;
    }
  }

  function currentCard() {
    var id = state.order[state.pos];
    for (var i = 0; i < CARDS.length; i++) if (CARDS[i].id === id) return CARDS[i];
    return null;
  }

  /* ---------- 富文本：**粗体** ---------- */
  function inline(text) {
    var safe = String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return safe.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  function renderPoints(list) {
    el.points.innerHTML = "";
    list.forEach(function (raw) {
      var isSub = raw.charAt(0) === "-";
      var text = isSub ? raw.slice(1) : raw;
      var li = document.createElement("li");
      if (isSub) li.className = "sub";
      li.innerHTML = inline(text);
      el.points.appendChild(li);
    });
  }

  /* ---------- 渲染 ---------- */
  function render() {
    var card = currentCard();

    if (!card) {
      el.badge.textContent = "完成";
      el.badge.className = "badge";
      el.counter.textContent = "0 / 0";
      el.question.textContent = "这个筛选下没有卡片了 🎉";
      el.hint.textContent = "换一个筛选，或点“重置”重新开始";
      el.answer.hidden = true;
      el.mnemonic.hidden = true;
      el.card.classList.remove("revealed");
      el.btnPrev.disabled = true;
      el.btnNext.disabled = true;
      el.btnMaster.disabled = true;
      updateProgress();
      updateIndex();
      return;
    }

    var idx = state.pos;
    el.card.classList.toggle("revealed", state.revealed);
    el.badge.textContent = card.label;
    el.badge.className = "badge" + (card.kind === "qa" ? " qa" : "");
    el.counter.textContent = (idx + 1) + " / " + state.order.length;
    el.question.textContent = card.q;

    if (card.notice) {
      el.notice.hidden = false;
      el.notice.textContent = card.notice;
    } else {
      el.notice.hidden = true;
      el.notice.textContent = "";
    }

    renderPoints(card.points);
    el.quote.textContent = card.quote;
    el.cite.innerHTML =
      '<span class="c-ch">' + escapeHtml(card.ch) + "</span>" +
      '<span aria-hidden="true">·</span>' +
      "<span>" + escapeHtml(card.sec) + "</span>" +
      '<span class="tag">书 p.' + escapeHtml(card.pages) + "</span>" +
      '<span class="tag">PDF p.' + escapeHtml(card.pdf) + "</span>";

    el.mnemonic.innerHTML = '<b>助记·非原文</b>' + escapeHtml(card.mnemonic || "");
    el.mnemonic.hidden = true;

    el.answer.hidden = !state.revealed;
    if (state.revealed) el.mnemonic.hidden = false;

    el.btnReveal.textContent = state.revealed ? "收起答案" : "显示答案";
    el.btnMaster.disabled = false;
    el.btnMaster.setAttribute("aria-pressed", isMastered(card.id) ? "true" : "false");
    el.btnMaster.textContent = isMastered(card.id) ? "✓ 已掌握" : "标记已掌握 (M)";
    el.btnPrev.disabled = state.pos <= 0;
    el.btnNext.disabled = state.pos >= state.order.length - 1;

    updateProgress();
    updateIndex();
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function updateProgress() {
    var total = CARDS.length;
    var done = masteredCount();
    el.bar.style.width = (total ? (done / total) * 100 : 0) + "%";
    el.pcount.textContent = done + " / " + total;
  }

  /* ---------- 目录 ---------- */
  function buildIndex() {
    el.indexList.innerHTML = "";
    CARDS.forEach(function (c, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "index-item";
      b.dataset.id = c.id;
      b.innerHTML =
        '<span class="no">' + (i + 1) + "</span>" +
        '<span class="txt">' + escapeHtml(c.q) + "</span>" +
        '<span class="dot" aria-hidden="true"></span>';
      b.addEventListener("click", function () {
        jumpTo(c.id);
        closeDrawer();
      });
      el.indexList.appendChild(b);
    });
  }

  function updateIndex() {
    var cur = state.order[state.pos];
    Array.prototype.forEach.call(el.indexList.children, function (node) {
      var id = node.dataset.id;
      node.classList.toggle("done", isMastered(id));
      node.classList.toggle("current", id === cur);
    });
  }

  function jumpTo(id) {
    var i = state.order.indexOf(id);
    if (i < 0) {
      state.filter = "all";
      syncFilterUI();
      rebuildOrder(id);
      i = state.order.indexOf(id);
    }
    if (i >= 0) {
      state.pos = i;
      state.revealed = false;
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  /* ---------- 交互 ---------- */
  function reveal(on) {
    if (!currentCard()) return;
    state.revealed = typeof on === "boolean" ? on : !state.revealed;
    el.card.classList.toggle("revealed", state.revealed);
    el.answer.hidden = !state.revealed;
    el.mnemonic.hidden = !state.revealed;
    el.btnReveal.textContent = state.revealed ? "收起答案" : "显示答案";
  }

  function go(delta) {
    var next = state.pos + delta;
    if (next < 0 || next >= state.order.length) return;
    state.pos = next;
    state.revealed = false;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleMaster() {
    var card = currentCard();
    if (!card) return;
    if (isMastered(card.id)) delete state.mastered[card.id];
    else state.mastered[card.id] = Date.now();
    saveMastered();
    render();
    if (state.filter === "todo" && isMastered(card.id)) {
      rebuildOrder(null);
      state.revealed = false;
      render();
    }
  }

  function applyFilter(f) {
    state.filter = f;
    saveFilter();
    syncFilterUI();
    rebuildOrder(null);
    state.revealed = false;
    render();
  }

  function syncFilterUI() {
    Array.prototype.forEach.call(el.filters, function (b) {
      b.classList.toggle("active", b.dataset.filter === state.filter);
    });
  }

  function shuffle() {
    var arr = state.order.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    state.order = arr;
    state.pos = 0;
    state.revealed = false;
    render();
  }

  function openDrawer() {
    el.drawer.hidden = false;
    updateIndex();
  }
  function closeDrawer() { el.drawer.hidden = true; }

  function resetAll() {
    if (!window.confirm("确定清空全部“已掌握”记录吗？")) return;
    state.mastered = {};
    saveMastered();
    rebuildOrder(null);
    state.revealed = false;
    render();
  }

  /* ---------- 事件 ---------- */
  el.card.addEventListener("click", function (e) {
    if (e.target.closest("details, a, button, summary")) return;
    reveal();
  });

  el.btnReveal.addEventListener("click", function () { reveal(); });
  el.btnPrev.addEventListener("click", function () { go(-1); });
  el.btnNext.addEventListener("click", function () { go(1); });
  el.btnMaster.addEventListener("click", toggleMaster);
  el.btnReset.addEventListener("click", resetAll);
  if (el.btnResetDrawer) el.btnResetDrawer.addEventListener("click", resetAll);
  el.btnShuffle.addEventListener("click", shuffle);
  el.btnIndex.addEventListener("click", openDrawer);
  el.drawerClose.addEventListener("click", closeDrawer);
  el.drawer.addEventListener("click", function (e) {
    if (e.target === el.drawer) closeDrawer();
  });

  Array.prototype.forEach.call(el.filters, function (b) {
    b.addEventListener("click", function () { applyFilter(b.dataset.filter); });
  });

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      reveal();
    } else if (e.key === "ArrowRight") {
      e.preventDefault(); go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault(); go(-1);
    } else if (e.key === "m" || e.key === "M") {
      e.preventDefault(); toggleMaster();
    } else if (e.key === "s" || e.key === "S") {
      e.preventDefault(); shuffle();
    } else if (e.key === "Escape") {
      closeDrawer();
    } else if (e.key === "i" || e.key === "I") {
      e.preventDefault();
      el.drawer.hidden ? openDrawer() : closeDrawer();
    }
  });

  /* 移动端左右滑动 */
  var touchX = null, touchY = null;
  el.card.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) return;
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  el.card.addEventListener("touchend", function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      go(dx < 0 ? 1 : -1);
    }
  }, { passive: true });

  /* ---------- 启动 ---------- */
  loadState();
  syncFilterUI();
  rebuildOrder(null);
  buildIndex();
  render();
};

if (!window.__SEALED__) {
  var appEl = document.getElementById("app"), lockEl = document.getElementById("lock");
  if (appEl) appEl.hidden = false;
  if (lockEl) lockEl.hidden = true;
  window.startCards();
}
