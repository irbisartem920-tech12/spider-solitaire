(() => {
"use strict";

/* ============================= Constants ============================= */

const SUITS = {
  S: { symbol: "♠", color: "black" },
  H: { symbol: "♥", color: "red" },
  D: { symbol: "♦", color: "red" },
  C: { symbol: "♣", color: "black" },
};
const RANK_LABELS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SAVE_KEY = "spider-solitaire-save-v1";
const COL_COUNT = 10;
const START_COUNTS = [6, 6, 6, 6, 5, 5, 5, 5, 5, 5];

/* ============================== State ================================ */

let state = null;
let history = [];
let cardIdSeq = 1;
let timerHandle = null;
let hintTimeout = null;
let dragCtx = null;

/* ============================ Card / Deck ============================= */

function makeCard(suit, rank) {
  return { id: cardIdSeq++, suit, rank, faceUp: false };
}

function buildShuffledDeck(suitsCount) {
  const cycle = suitsCount === 1 ? ["S"] : suitsCount === 2 ? ["S", "H"] : ["S", "H", "D", "C"];
  const deck = [];
  for (let set = 0; set < 8; set++) {
    const suit = cycle[set % cycle.length];
    for (let rank = 1; rank <= 13; rank++) deck.push(makeCard(suit, rank));
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/* ============================== Game setup ============================= */

function newGame(suitsCount) {
  cardIdSeq = 1;
  const deck = buildShuffledDeck(suitsCount);
  const tableau = Array.from({ length: COL_COUNT }, () => []);
  for (let c = 0; c < COL_COUNT; c++) {
    for (let n = 0; n < START_COUNTS[c]; n++) {
      const card = deck.pop();
      tableau[c].push(card);
    }
    tableau[c][tableau[c].length - 1].faceUp = true;
  }
  state = {
    suitsCount,
    tableau,
    stock: deck, // remaining 50 cards
    completed: 0,
    score: 500,
    moves: 0,
    elapsed: 0,
    won: false,
  };
  history = [];
  save();
  render();
  updateUndoBtn();
}

/* ============================ Sequence rules =========================== */

function isFaceUpDescendingSameSuit(cards) {
  for (let i = 0; i < cards.length; i++) {
    if (!cards[i].faceUp) return false;
    if (i > 0 && (cards[i - 1].suit !== cards[i].suit || cards[i - 1].rank !== cards[i].rank + 1)) return false;
  }
  return true;
}

// Returns the draggable group starting at cardIndex in column, or null if not draggable.
function getDraggableGroup(colIndex, cardIndex) {
  const col = state.tableau[colIndex];
  if (cardIndex < 0 || cardIndex >= col.length) return null;
  if (!col[cardIndex].faceUp) return null;
  const group = col.slice(cardIndex);
  if (isFaceUpDescendingSameSuit(group)) return group;
  return null;
}

function canDropOn(targetCol, bottomRankOfGroup) {
  if (targetCol.length === 0) return true;
  const top = targetCol[targetCol.length - 1];
  if (!top.faceUp) return false;
  return top.rank === bottomRankOfGroup + 1;
}

/* =============================== Actions =============================== */

function pushHistory() {
  history.push(JSON.stringify({
    tableau: state.tableau,
    stock: state.stock,
    completed: state.completed,
    score: state.score,
    moves: state.moves,
  }));
  if (history.length > 60) history.shift();
  updateUndoBtn();
}

function undo() {
  if (!history.length) return;
  const snap = JSON.parse(history.pop());
  state.tableau = snap.tableau;
  state.stock = snap.stock;
  state.completed = snap.completed;
  state.score = snap.score;
  state.moves = snap.moves;
  clearHint();
  save();
  render();
  updateUndoBtn();
}

function updateUndoBtn() {
  document.getElementById("btn-undo").disabled = history.length === 0;
}

function performMove(fromCol, cardIndex, toCol) {
  const group = getDraggableGroup(fromCol, cardIndex);
  if (!group) return false;
  if (!canDropOn(state.tableau[toCol], group[group.length - 1].rank)) return false;
  if (fromCol === toCol) return false;

  pushHistory();
  state.tableau[fromCol].splice(cardIndex);
  state.tableau[toCol].push(...group);

  const src = state.tableau[fromCol];
  if (src.length && !src[src.length - 1].faceUp) src[src.length - 1].faceUp = true;

  state.moves++;
  state.score = Math.max(0, state.score - 1);

  checkCompletedSequence(toCol);
  clearHint();
  save();
  render();
  checkWin();
  return true;
}

function checkCompletedSequence(colIndex) {
  const col = state.tableau[colIndex];
  if (col.length < 13) return;
  const tail = col.slice(col.length - 13);
  if (tail[0].rank !== 13) return;
  if (!isFaceUpDescendingSameSuit(tail)) return;
  col.splice(col.length - 13);
  state.completed++;
  state.score += 100;
  if (col.length && !col[col.length - 1].faceUp) col[col.length - 1].faceUp = true;
}

function dealFromStock() {
  if (state.stock.length === 0) return false;
  if (state.tableau.some((c) => c.length === 0)) {
    toast("Нельзя раздавать: есть пустая колонка");
    shakeStock();
    return false;
  }
  pushHistory();
  for (let c = 0; c < COL_COUNT; c++) {
    const card = state.stock.pop();
    card.faceUp = true;
    state.tableau[c].push(card);
  }
  state.moves++;
  state.score = Math.max(0, state.score - 1);
  for (let c = 0; c < COL_COUNT; c++) checkCompletedSequence(c);
  clearHint();
  save();
  render();
  checkWin();
  return true;
}

function checkWin() {
  if (state.completed === 8 && !state.won) {
    state.won = true;
    save();
    stopTimer();
    document.getElementById("win-stats").textContent =
      `Ходов: ${state.moves} · Очки: ${state.score} · Время: ${formatTime(state.elapsed)}`;
    document.getElementById("win-banner").classList.remove("hidden");
  }
}

/* ================================ Hints ================================ */

function cloneCard(c) { return { id: c.id, suit: c.suit, rank: c.rank, faceUp: c.faceUp }; }
function cloneTableau(t) { return t.map((col) => col.map(cloneCard)); }

function simulateMove(tableau, fromCol, cardIndex, toCol) {
  const t = cloneTableau(tableau);
  const group = t[fromCol].splice(cardIndex);
  t[toCol].push(...group);
  const src = t[fromCol];
  const revealed = src.length > 0 && !src[src.length - 1].faceUp;
  if (revealed) src[src.length - 1].faceUp = true;
  const dst = t[toCol];
  let runLen = 1;
  for (let i = dst.length - 1; i > 0; i--) {
    if (dst[i - 1].suit === dst[i].suit && dst[i - 1].rank === dst[i].rank + 1) runLen++;
    else break;
  }
  const completes = dst.length >= 13 && runLen >= 13;
  return { revealed, runLen, completes };
}

function findHint() {
  let best = null;
  for (let fromCol = 0; fromCol < COL_COUNT; fromCol++) {
    const col = state.tableau[fromCol];
    for (let cardIndex = 0; cardIndex < col.length; cardIndex++) {
      const group = getDraggableGroup(fromCol, cardIndex);
      if (!group) continue;
      const bottomRank = group[group.length - 1].rank;
      for (let toCol = 0; toCol < COL_COUNT; toCol++) {
        if (toCol === fromCol) continue;
        if (!canDropOn(state.tableau[toCol], bottomRank)) continue;
        // Skip pointless empty-to-empty-ish moves (moving a full column to another empty column)
        if (state.tableau[toCol].length === 0 && cardIndex === 0) continue;
        const sim = simulateMove(state.tableau, fromCol, cardIndex, toCol);
        let score = 0;
        if (sim.completes) score += 10000;
        if (sim.revealed) score += 1000;
        score += sim.runLen * 5;
        score += group.length; // prefer moving bigger valid groups
        if (!best || score > best.score) {
          best = { type: "move", fromCol, cardIndex, toCol, score };
        }
      }
    }
  }
  if (best) return best;
  if (state.stock.length > 0 && !state.tableau.some((c) => c.length === 0)) {
    return { type: "deal" };
  }
  return null;
}

function showHint() {
  clearHint();
  const hint = findHint();
  if (!hint) {
    toast("Ходов не найдено. Попробуйте отменить ход.");
    return;
  }
  if (hint.type === "deal") {
    const stockEl = document.getElementById("stock");
    stockEl.classList.add("hint-target", "hint-glow");
    hintTimeout = setTimeout(clearHint, 3000);
    return;
  }
  render(); // ensure DOM fresh
  const colEl = document.querySelectorAll(".column")[hint.fromCol];
  const cards = colEl.querySelectorAll(".card");
  for (let i = hint.cardIndex; i < cards.length; i++) {
    cards[i].classList.add("hint-source", "hint-glow");
  }
  const targetColEl = document.querySelectorAll(".column")[hint.toCol];
  targetColEl.classList.add("column-drop-target");
  hintTimeout = setTimeout(clearHint, 3000);
}

function clearHint() {
  if (hintTimeout) { clearTimeout(hintTimeout); hintTimeout = null; }
  document.querySelectorAll(".hint-source, .hint-glow").forEach((el) => el.classList.remove("hint-source", "hint-glow"));
  document.querySelectorAll(".column-drop-target").forEach((el) => el.classList.remove("column-drop-target"));
  document.getElementById("stock").classList.remove("hint-target", "hint-glow");
}

/* =============================== Persist =============================== */

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      suitsCount: state.suitsCount,
      tableau: state.tableau,
      stock: state.stock,
      completed: state.completed,
      score: state.score,
      moves: state.moves,
      elapsed: state.elapsed,
      won: state.won,
      cardIdSeq,
    }));
  } catch (e) { /* storage unavailable */ }
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || !data.tableau) return false;
    state = data;
    cardIdSeq = data.cardIdSeq || 1;
    history = [];
    return true;
  } catch (e) { return false; }
}

/* ================================ Timer ================================ */

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function startTimer() {
  stopTimer();
  timerHandle = setInterval(() => {
    if (state.won) return;
    state.elapsed++;
    document.getElementById("stat-time").textContent = formatTime(state.elapsed);
    if (state.elapsed % 10 === 0) save();
  }, 1000);
}

function stopTimer() {
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
}

/* =============================== Toast ================================= */

let toastTimeout = null;
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.getElementById("app").appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove("show"), 1800);
}

function shakeStock() {
  const el = document.getElementById("stock");
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 400);
}

/* =============================== Rendering ============================== */

function cardHTML(card) {
  if (!card.faceUp) {
    return `<div class="pattern"></div>`;
  }
  const suit = SUITS[card.suit];
  const label = RANK_LABELS[card.rank];
  return `
    <div class="card-corner top"><span class="rank">${label}</span><span class="suit">${suit.symbol}</span></div>
    <div class="card-center">${suit.symbol}</div>
    <div class="card-corner bottom"><span class="rank">${label}</span><span class="suit">${suit.symbol}</span></div>
  `;
}

function buildCardEl(card) {
  const el = document.createElement("div");
  el.className = "card " + (card.faceUp ? "face-up " + SUITS[card.suit].color : "face-down");
  el.dataset.cardId = card.id;
  el.innerHTML = cardHTML(card);
  return el;
}

function render() {
  renderStock();
  renderTableau();
  document.getElementById("stat-score").innerHTML = `Очки: <b>${state.score}</b>`;
  document.getElementById("stat-moves").innerHTML = `Ходы: <b>${state.moves}</b>`;
  document.getElementById("stat-time").textContent = formatTime(state.elapsed);
  requestAnimationFrame(layoutColumnHeights);
}

function renderStock() {
  const el = document.getElementById("stock");
  el.innerHTML = "";
  const dealsLeft = Math.floor(state.stock.length / COL_COUNT);
  if (state.stock.length === 0) {
    el.classList.add("empty");
    return;
  }
  el.classList.remove("empty");
  const layers = Math.min(dealsLeft, 5);
  for (let i = 0; i < layers; i++) {
    const back = document.createElement("div");
    back.className = "stock-card card face-down";
    back.style.top = `${-i * 2}px`;
    back.style.left = `${i * 2}px`;
    back.innerHTML = `<div class="pattern"></div>`;
    el.appendChild(back);
  }
  const count = document.createElement("div");
  count.className = "stock-count";
  count.textContent = dealsLeft;
  el.appendChild(count);
}

function renderTableau() {
  const tableauEl = document.getElementById("tableau");
  tableauEl.innerHTML = "";
  state.tableau.forEach((col, colIndex) => {
    const colEl = document.createElement("div");
    colEl.className = "column";
    colEl.dataset.colIndex = colIndex;
    let nd = 0, nu = 0;
    col.forEach((card) => {
      const cardEl = buildCardEl(card);
      cardEl.style.setProperty("--nd", nd);
      cardEl.style.setProperty("--nu", nu);
      if (card.faceUp) nu++; else nd++;
      colEl.appendChild(cardEl);
      attachCardPointerHandlers(cardEl, colIndex, card);
    });
    tableauEl.appendChild(colEl);
  });
}

function layoutColumnHeights() {
  document.querySelectorAll(".column").forEach((colEl) => {
    const last = colEl.lastElementChild;
    if (!last) { colEl.style.height = ""; return; }
    const h = last.offsetTop + last.offsetHeight;
    colEl.style.height = h + "px";
  });
}

/* ============================ Drag & Drop =============================== */

function attachCardPointerHandlers(cardEl, colIndex, card) {
  if (!card.faceUp) return;
  cardEl.addEventListener("pointerdown", (e) => onCardPointerDown(e, colIndex, cardEl));
}

function cardIndexInColumn(colIndex, cardId) {
  return state.tableau[colIndex].findIndex((c) => c.id === cardId);
}

function onCardPointerDown(e, colIndex, cardEl) {
  if (dragCtx) return; // a drag is already in progress
  if (e.button !== undefined && e.button !== 0) return;
  const cardId = Number(cardEl.dataset.cardId);
  const cardIndex = cardIndexInColumn(colIndex, cardId);
  const group = getDraggableGroup(colIndex, cardIndex);
  if (!group) return;

  const colEl = cardEl.parentElement;
  if (!colEl) return;
  const cardEls = Array.from(colEl.children).slice(cardIndex);
  if (!cardEls.length) return;
  const rects = cardEls.map((el) => el.getBoundingClientRect());
  const originRect = rects[0];
  if (!originRect) return;

  clearHint();
  e.preventDefault();

  const wrapper = document.createElement("div");
  wrapper.className = "drag-wrapper";
  wrapper.style.position = "fixed";
  wrapper.style.left = originRect.left + "px";
  wrapper.style.top = originRect.top + "px";
  wrapper.style.width = originRect.width + "px";
  wrapper.style.pointerEvents = "none";

  cardEls.forEach((el, i) => {
    el.classList.add("dragging");
    el.style.position = "absolute";
    el.style.left = "0px";
    el.style.top = (rects[i].top - originRect.top) + "px";
    el.style.removeProperty("--nd");
    el.style.removeProperty("--nu");
    wrapper.appendChild(el);
  });
  document.getElementById("drag-layer").appendChild(wrapper);

  dragCtx = {
    fromCol: colIndex,
    cardIndex,
    wrapper,
    cardEl,
    startX: e.clientX,
    startY: e.clientY,
    originLeft: originRect.left,
    originTop: originRect.top,
    bottomRank: group[group.length - 1].rank,
    pointerId: e.pointerId,
    moved: false,
    lastTargetCol: null,
  };

  try { cardEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  window.addEventListener("pointermove", onCardPointerMove);
  window.addEventListener("pointerup", onCardPointerUp);
  window.addEventListener("pointercancel", onCardPointerUp);
}

function onCardPointerMove(e) {
  if (!dragCtx || e.pointerId !== dragCtx.pointerId) return;
  const dx = e.clientX - dragCtx.startX;
  const dy = e.clientY - dragCtx.startY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragCtx.moved = true;
  dragCtx.wrapper.style.left = (dragCtx.originLeft + dx) + "px";
  dragCtx.wrapper.style.top = (dragCtx.originTop + dy) + "px";

  const target = findColumnAtPoint(e.clientX, e.clientY);
  if (target !== dragCtx.lastTargetCol) {
    document.querySelectorAll(".column-drop-target").forEach((el) => el.classList.remove("column-drop-target"));
    if (target !== null) {
      const valid = target === dragCtx.fromCol || canDropOn(state.tableau[target], dragCtx.bottomRank);
      if (valid) {
        document.querySelectorAll(".column")[target].classList.add("column-drop-target");
      }
    }
    dragCtx.lastTargetCol = target;
  }
}

function findColumnAtPoint(x, y) {
  const cols = document.querySelectorAll(".column");
  let best = null, bestDist = Infinity;
  cols.forEach((colEl, idx) => {
    const r = colEl.getBoundingClientRect();
    if (x >= r.left && x <= r.right) {
      const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (dist < bestDist) { bestDist = dist; best = idx; }
    }
  });
  return best;
}

function onCardPointerUp(e) {
  if (!dragCtx || e.pointerId !== dragCtx.pointerId) return;
  const ctx = dragCtx;
  dragCtx = null;

  window.removeEventListener("pointermove", onCardPointerMove);
  window.removeEventListener("pointerup", onCardPointerUp);
  window.removeEventListener("pointercancel", onCardPointerUp);
  try { ctx.cardEl.releasePointerCapture(ctx.pointerId); } catch (err) { /* ignore */ }

  document.querySelectorAll(".column-drop-target").forEach((el) => el.classList.remove("column-drop-target"));

  const target = ctx.moved ? findColumnAtPoint(e.clientX, e.clientY) : null;
  let didMove = false;
  if (target !== null && target !== ctx.fromCol) {
    didMove = performMove(ctx.fromCol, ctx.cardIndex, target);
  }
  if (!didMove) {
    // snap back: just remove wrapper and re-render (cards return via CSS position)
    ctx.wrapper.remove();
    render();
  } else {
    ctx.wrapper.remove();
  }
}

/* ============================== UI wiring ================================ */

function openMenu() {
  document.getElementById("menu-overlay").classList.remove("hidden");
  document.querySelectorAll(".diff-btn").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.suits) === state.suitsCount);
  });
}
function closeMenu() {
  document.getElementById("menu-overlay").classList.add("hidden");
}

function wireUI() {
  document.getElementById("btn-menu").addEventListener("click", openMenu);
  document.getElementById("btn-close-menu").addEventListener("click", closeMenu);
  document.getElementById("btn-undo").addEventListener("click", undo);
  document.getElementById("btn-hint").addEventListener("click", showHint);
  document.getElementById("btn-new").addEventListener("click", () => {
    if (confirm("Начать новую игру? Текущий прогресс будет потерян.")) {
      newGame(state.suitsCount);
      startTimer();
    }
  });
  document.getElementById("btn-again").addEventListener("click", () => {
    document.getElementById("win-banner").classList.add("hidden");
    newGame(state.suitsCount);
    startTimer();
  });
  document.getElementById("stock").addEventListener("click", dealFromStock);
  document.querySelectorAll(".diff-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const suits = Number(btn.dataset.suits);
      closeMenu();
      if (suits !== state.suitsCount || confirm("Начать новую игру с выбранной сложностью?")) {
        newGame(suits);
        startTimer();
      }
    });
  });
  window.addEventListener("resize", () => requestAnimationFrame(layoutColumnHeights));
}

/* ================================= Init =================================== */

function init() {
  wireUI();
  if (!load()) {
    state = null;
    newGame(1);
  } else {
    render();
    updateUndoBtn();
    if (state.won) document.getElementById("win-banner").classList.remove("hidden");
  }
  startTimer();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
})();
