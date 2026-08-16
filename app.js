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
const SAVE_KEY_SPIDER = "spider-solitaire-save-v1";
const SAVE_KEY_KLONDIKE = "klondike-save-v1";
const MODE_KEY = "solitaire-active-mode";
const SPIDER_COLS = 10;
const SPIDER_START_COUNTS = [6, 6, 6, 6, 5, 5, 5, 5, 5, 5];
const KLONDIKE_COLS = 7;

/* ============================== State ================================ */

let mode = "spider"; // "spider" | "klondike"
let spiderState = null;
let klondikeState = null;
let history = { spider: [], klondike: [] };
let timerHandle = null;
let hintTimeout = null;
let dragCtx = null;

function activeState() { return mode === "spider" ? spiderState : klondikeState; }

/* ============================ Card / Deck ============================= */

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createSpiderState(suitsCount) {
  let id = 1;
  const mk = (suit, rank) => ({ id: id++, suit, rank, faceUp: false });
  const cycle = suitsCount === 1 ? ["S"] : suitsCount === 2 ? ["S", "H"] : ["S", "H", "D", "C"];
  const deck = [];
  for (let set = 0; set < 8; set++) {
    const suit = cycle[set % cycle.length];
    for (let rank = 1; rank <= 13; rank++) deck.push(mk(suit, rank));
  }
  shuffleArray(deck);
  const tableau = Array.from({ length: SPIDER_COLS }, () => []);
  for (let c = 0; c < SPIDER_COLS; c++) {
    for (let n = 0; n < SPIDER_START_COUNTS[c]; n++) tableau[c].push(deck.pop());
    tableau[c][tableau[c].length - 1].faceUp = true;
  }
  return {
    suitsCount,
    tableau,
    stock: deck, // remaining 50 cards
    completed: 0,
    score: 500,
    moves: 0,
    elapsed: 0,
    won: false,
  };
}

function createKlondikeState() {
  let id = 1;
  const mk = (suit, rank, faceUp) => ({ id: id++, suit, rank, faceUp });
  const suitOrder = ["S", "H", "D", "C"];
  const deck = [];
  for (const s of suitOrder) for (let r = 1; r <= 13; r++) deck.push(mk(s, r, false));
  shuffleArray(deck);
  const tableau = [];
  for (let c = 0; c < KLONDIKE_COLS; c++) {
    const col = [];
    for (let n = 0; n <= c; n++) col.push(deck.pop());
    col[col.length - 1].faceUp = true;
    tableau.push(col);
  }
  return {
    tableau,
    stock: deck, // remaining 24 cards, face-down
    waste: [],
    foundations: [
      { suit: null, cards: [] },
      { suit: null, cards: [] },
      { suit: null, cards: [] },
      { suit: null, cards: [] },
    ],
    score: 500,
    moves: 0,
    elapsed: 0,
    won: false,
  };
}

/* ============================== Game setup ============================= */

function newSpiderGame(suitsCount) {
  spiderState = createSpiderState(suitsCount);
  history.spider = [];
  save();
  render();
  updateUndoBtn();
  document.getElementById("win-banner").classList.add("hidden");
}

function newKlondikeGame() {
  klondikeState = createKlondikeState();
  history.klondike = [];
  save();
  render();
  updateUndoBtn();
  document.getElementById("win-banner").classList.add("hidden");
}

/* ============================ Pile access =============================== */

function getPileCards(ref) {
  const st = activeState();
  if (ref.k === "tableau") return st.tableau[ref.i];
  if (ref.k === "waste") return st.waste;
  if (ref.k === "foundation") return st.foundations[ref.i].cards;
  if (ref.k === "stock") return st.stock;
  return null;
}

function refsEqual(a, b) {
  if (!a || !b) return a === b;
  return a.k === b.k && a.i === b.i;
}

function cardIndexInPile(ref, cardId) {
  const cards = getPileCards(ref);
  return cards.findIndex((c) => c.id === cardId);
}

/* ============================ Sequence rules =========================== */

function isFaceUpDescendingSameSuit(cards) {
  for (let i = 0; i < cards.length; i++) {
    if (!cards[i].faceUp) return false;
    if (i > 0 && (cards[i - 1].suit !== cards[i].suit || cards[i - 1].rank !== cards[i].rank + 1)) return false;
  }
  return true;
}

function isFaceUpAltDescending(cards) {
  for (let i = 0; i < cards.length; i++) {
    if (!cards[i].faceUp) return false;
    if (i > 0) {
      const prevColor = SUITS[cards[i - 1].suit].color;
      const curColor = SUITS[cards[i].suit].color;
      if (prevColor === curColor) return false;
      if (cards[i - 1].rank !== cards[i].rank + 1) return false;
    }
  }
  return true;
}

// Returns the draggable group starting at cardIndex in the pile, or null if not draggable.
function getDraggableGroup(ref, cardIndex) {
  const cards = getPileCards(ref);
  if (!cards || cardIndex < 0 || cardIndex >= cards.length) return null;
  if (!cards[cardIndex].faceUp) return null;
  if (ref.k !== "tableau") {
    if (cardIndex !== cards.length - 1) return null;
    return [cards[cardIndex]];
  }
  const group = cards.slice(cardIndex);
  const valid = mode === "spider" ? isFaceUpDescendingSameSuit(group) : isFaceUpAltDescending(group);
  return valid ? group : null;
}

function spiderCanDropOnTableau(targetCol, attachRank) {
  if (targetCol.length === 0) return true;
  const top = targetCol[targetCol.length - 1];
  if (!top.faceUp) return false;
  return top.rank === attachRank + 1;
}

function klondikeCanDropOnTableau(targetCol, leadCard) {
  if (targetCol.length === 0) return leadCard.rank === 13;
  const top = targetCol[targetCol.length - 1];
  if (!top.faceUp) return false;
  return SUITS[top.suit].color !== SUITS[leadCard.suit].color && top.rank === leadCard.rank + 1;
}

function klondikeCanDropOnFoundation(foundation, card) {
  if (foundation.cards.length === 0) return card.rank === 1;
  if (foundation.suit !== card.suit) return false;
  return foundation.cards[foundation.cards.length - 1].rank === card.rank - 1;
}

// leadCard = the card that will sit directly under the target pile's exposed card
// (i.e. group[0] — the topmost/least-exposed card of the dragged run).
function canDropOnRef(leadCard, groupSize, ref) {
  if (ref.k === "tableau") {
    const target = getPileCards(ref);
    if (mode === "spider") return spiderCanDropOnTableau(target, leadCard.rank);
    return klondikeCanDropOnTableau(target, leadCard);
  }
  if (ref.k === "foundation" && mode === "klondike") {
    if (groupSize !== 1) return false;
    const f = klondikeState.foundations[ref.i];
    return klondikeCanDropOnFoundation(f, leadCard);
  }
  return false;
}

/* =============================== Actions =============================== */

function pushHistory() {
  history[mode].push(JSON.stringify(activeState()));
  if (history[mode].length > 60) history[mode].shift();
  updateUndoBtn();
}

function undo() {
  const h = history[mode];
  if (!h.length) return;
  const snap = JSON.parse(h.pop());
  if (mode === "spider") spiderState = snap; else klondikeState = snap;
  clearHint();
  save();
  render();
  updateUndoBtn();
}

function updateUndoBtn() {
  document.getElementById("btn-undo").disabled = history[mode].length === 0;
}

function commitMove(fromRef, cardIndex, toRef) {
  if (refsEqual(fromRef, toRef)) return false;
  const group = getDraggableGroup(fromRef, cardIndex);
  if (!group) return false;
  if (!canDropOnRef(group[0], group.length, toRef)) return false;

  pushHistory();
  const fromArr = getPileCards(fromRef);
  fromArr.splice(cardIndex);
  const toArr = getPileCards(toRef);
  toArr.push(...group);

  if (toRef.k === "foundation") {
    const f = klondikeState.foundations[toRef.i];
    if (!f.suit) f.suit = group[0].suit;
  }
  if (fromRef.k === "tableau") {
    const src = fromArr;
    if (src.length && !src[src.length - 1].faceUp) src[src.length - 1].faceUp = true;
  }

  const st = activeState();
  st.moves++;
  st.score = Math.max(0, st.score - 1);
  if (mode === "klondike" && toRef.k === "foundation") st.score += 5;
  if (mode === "spider" && toRef.k === "tableau") checkCompletedSequence(toRef.i);

  clearHint();
  save();
  render();
  checkWin();
  return true;
}

function checkCompletedSequence(colIndex) {
  const col = spiderState.tableau[colIndex];
  if (col.length < 13) return;
  const tail = col.slice(col.length - 13);
  if (tail[0].rank !== 13) return;
  if (!isFaceUpDescendingSameSuit(tail)) return;
  col.splice(col.length - 13);
  spiderState.completed++;
  spiderState.score += 100;
  if (col.length && !col[col.length - 1].faceUp) col[col.length - 1].faceUp = true;
}

function onStockClick() {
  if (mode === "spider") spiderDealFromStock(); else klondikeStockClick();
}

function spiderDealFromStock() {
  const st = spiderState;
  if (st.stock.length === 0) return false;
  if (st.tableau.some((c) => c.length === 0)) {
    toast("Нельзя раздавать: есть пустая колонка");
    shakeStock();
    return false;
  }
  pushHistory();
  for (let c = 0; c < SPIDER_COLS; c++) {
    const card = st.stock.pop();
    card.faceUp = true;
    st.tableau[c].push(card);
  }
  st.moves++;
  st.score = Math.max(0, st.score - 1);
  for (let c = 0; c < SPIDER_COLS; c++) checkCompletedSequence(c);
  clearHint();
  save();
  render();
  checkWin();
  return true;
}

function klondikeStockClick() {
  const st = klondikeState;
  if (st.stock.length === 0) {
    if (st.waste.length === 0) {
      toast("Колода пуста");
      return false;
    }
    pushHistory();
    while (st.waste.length) {
      const c = st.waste.pop();
      c.faceUp = false;
      st.stock.push(c);
    }
    st.moves++;
    st.score = Math.max(0, st.score - 1);
    clearHint();
    save();
    render();
    return true;
  }
  pushHistory();
  const card = st.stock.pop();
  card.faceUp = true;
  st.waste.push(card);
  st.moves++;
  st.score = Math.max(0, st.score - 1);
  clearHint();
  save();
  render();
  return true;
}

function checkWin() {
  const st = activeState();
  if (st.won) return;
  const done = mode === "spider" ? st.completed === 8 : st.foundations.every((f) => f.cards.length === 13);
  if (done) {
    st.won = true;
    save();
    stopTimer();
    document.getElementById("win-stats").textContent =
      `Ходов: ${st.moves} · Очки: ${st.score} · Время: ${formatTime(st.elapsed)}`;
    document.getElementById("win-banner").classList.remove("hidden");
  }
}

/* ================================ Hints ================================ */

function cloneCard(c) { return { id: c.id, suit: c.suit, rank: c.rank, faceUp: c.faceUp }; }
function cloneTableau(t) { return t.map((col) => col.map(cloneCard)); }

function simulateSpiderMove(tableau, fromCol, cardIndex, toCol) {
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

function findSpiderHint() {
  const st = spiderState;
  let best = null;
  for (let fromCol = 0; fromCol < SPIDER_COLS; fromCol++) {
    const col = st.tableau[fromCol];
    for (let cardIndex = 0; cardIndex < col.length; cardIndex++) {
      const group = getDraggableGroup({ k: "tableau", i: fromCol }, cardIndex);
      if (!group) continue;
      const attachRank = group[0].rank;
      for (let toCol = 0; toCol < SPIDER_COLS; toCol++) {
        if (toCol === fromCol) continue;
        if (!spiderCanDropOnTableau(st.tableau[toCol], attachRank)) continue;
        if (st.tableau[toCol].length === 0 && cardIndex === 0) continue;
        const sim = simulateSpiderMove(st.tableau, fromCol, cardIndex, toCol);
        let score = 0;
        if (sim.completes) score += 10000;
        if (sim.revealed) score += 1000;
        score += sim.runLen * 5;
        score += group.length;
        if (!best || score > best.score) {
          best = { type: "move", fromRef: { k: "tableau", i: fromCol }, cardIndex, toRef: { k: "tableau", i: toCol }, score };
        }
      }
    }
  }
  if (best) return best;
  if (st.stock.length > 0 && !st.tableau.some((c) => c.length === 0)) return { type: "deal" };
  return null;
}

function findKlondikeHint() {
  const st = klondikeState;
  const sources = [];
  for (let c = 0; c < KLONDIKE_COLS; c++) {
    const col = st.tableau[c];
    for (let i = 0; i < col.length; i++) {
      const group = getDraggableGroup({ k: "tableau", i: c }, i);
      if (group) sources.push({ ref: { k: "tableau", i: c }, cardIndex: i, group });
    }
  }
  if (st.waste.length) {
    const i = st.waste.length - 1;
    sources.push({ ref: { k: "waste" }, cardIndex: i, group: [st.waste[i]] });
  }

  let best = null;
  for (const src of sources) {
    const lead = src.group[0];
    const revealsCard = src.ref.k === "tableau" && src.cardIndex > 0 && !st.tableau[src.ref.i][src.cardIndex - 1].faceUp;

    for (let f = 0; f < 4; f++) {
      const toRef = { k: "foundation", i: f };
      if (!canDropOnRef(lead, src.group.length, toRef)) continue;
      let score = 5000 + (revealsCard ? 1000 : 0);
      if (!best || score > best.score) best = { type: "move", fromRef: src.ref, cardIndex: src.cardIndex, toRef, score };
    }
    for (let c = 0; c < KLONDIKE_COLS; c++) {
      if (src.ref.k === "tableau" && src.ref.i === c) continue;
      const toRef = { k: "tableau", i: c };
      if (!canDropOnRef(lead, src.group.length, toRef)) continue;
      if (st.tableau[c].length === 0 && src.ref.k === "tableau" && src.cardIndex === 0) continue;
      let score = 10 + (revealsCard ? 1000 : 0) + (src.ref.k === "waste" ? 50 : 0);
      if (!best || score > best.score) best = { type: "move", fromRef: src.ref, cardIndex: src.cardIndex, toRef, score };
    }
  }
  if (best) return best;
  if (st.stock.length > 0 || st.waste.length > 0) return { type: "deal" };
  return null;
}

function findHint() { return mode === "spider" ? findSpiderHint() : findKlondikeHint(); }

function getPileEl(ref) {
  if (ref.k === "tableau") return document.querySelectorAll(".column")[ref.i];
  if (ref.k === "waste") return document.getElementById("waste");
  if (ref.k === "foundation") return document.querySelectorAll(".foundation-slot")[ref.i];
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
    document.getElementById("stock").classList.add("hint-target", "hint-glow");
    hintTimeout = setTimeout(clearHint, 3000);
    return;
  }
  render();
  const fromEl = getPileEl(hint.fromRef);
  const cards = fromEl.querySelectorAll(".card");
  const startIdx = hint.fromRef.k === "tableau" ? hint.cardIndex : cards.length - 1;
  for (let i = startIdx; i < cards.length; i++) cards[i].classList.add("hint-source", "hint-glow");
  const targetEl = getPileEl(hint.toRef);
  if (targetEl) targetEl.classList.add("column-drop-target");
  hintTimeout = setTimeout(clearHint, 3000);
}

function clearHint() {
  if (hintTimeout) { clearTimeout(hintTimeout); hintTimeout = null; }
  document.querySelectorAll(".hint-source, .hint-glow").forEach((el) => el.classList.remove("hint-source", "hint-glow"));
  document.querySelectorAll(".column-drop-target").forEach((el) => el.classList.remove("column-drop-target"));
  const stockEl = document.getElementById("stock");
  if (stockEl) stockEl.classList.remove("hint-target", "hint-glow");
}

/* =============================== Persist =============================== */

function save() {
  try {
    localStorage.setItem(SAVE_KEY_SPIDER, JSON.stringify(spiderState));
    localStorage.setItem(SAVE_KEY_KLONDIKE, JSON.stringify(klondikeState));
    localStorage.setItem(MODE_KEY, mode);
  } catch (e) { /* storage unavailable */ }
}

function loadState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.tableau) return null;
    return data;
  } catch (e) { return null; }
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
    const st = activeState();
    if (st.won) return;
    st.elapsed++;
    document.getElementById("stat-time").textContent = formatTime(st.elapsed);
    if (st.elapsed % 10 === 0) save();
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
  if (!card.faceUp) return `<div class="pattern"></div>`;
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
  document.getElementById("app").dataset.mode = mode;
  renderStock();
  if (mode === "klondike") { renderWaste(); renderFoundations(); }
  renderTableau();
  const st = activeState();
  document.getElementById("stat-score").innerHTML = `Очки: <b>${st.score}</b>`;
  document.getElementById("stat-moves").innerHTML = `Ходы: <b>${st.moves}</b>`;
  document.getElementById("stat-time").textContent = formatTime(st.elapsed);
  requestAnimationFrame(layoutColumnHeights);
}

function renderStock() {
  const el = document.getElementById("stock");
  el.innerHTML = "";
  const st = activeState();

  if (mode === "spider") {
    const dealsLeft = Math.floor(st.stock.length / SPIDER_COLS);
    if (st.stock.length === 0) { el.classList.add("empty"); return; }
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
    return;
  }

  // klondike
  if (st.stock.length === 0) {
    el.classList.add("empty");
    if (st.waste.length > 0) {
      const icon = document.createElement("div");
      icon.className = "stock-recycle";
      icon.textContent = "↺";
      el.appendChild(icon);
    }
    return;
  }
  el.classList.remove("empty");
  const layers = Math.min(Math.ceil(st.stock.length / 5), 5);
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
  count.textContent = st.stock.length;
  el.appendChild(count);
}

function renderWaste() {
  const el = document.getElementById("waste");
  el.innerHTML = "";
  const st = klondikeState;
  if (!st.waste.length) { el.classList.add("empty"); return; }
  el.classList.remove("empty");
  const card = st.waste[st.waste.length - 1];
  const cardEl = buildCardEl(card);
  cardEl.style.position = "absolute";
  cardEl.style.inset = "0";
  el.appendChild(cardEl);
  attachCardPointerHandlers(cardEl, { k: "waste" }, card);
}

function renderFoundations() {
  const el = document.getElementById("foundations");
  el.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const slot = document.createElement("div");
    slot.className = "foundation-slot";
    slot.dataset.foundationIndex = i;
    const f = klondikeState.foundations[i];
    if (f.cards.length) {
      const top = f.cards[f.cards.length - 1];
      slot.appendChild(buildCardEl(top));
    }
    el.appendChild(slot);
  }
}

function renderTableau() {
  const tableauEl = document.getElementById("tableau");
  const st = activeState();
  tableauEl.style.gridTemplateColumns = `repeat(${st.tableau.length}, 1fr)`;
  tableauEl.innerHTML = "";
  st.tableau.forEach((col, colIndex) => {
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
      attachCardPointerHandlers(cardEl, { k: "tableau", i: colIndex }, card);
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

function attachCardPointerHandlers(cardEl, pileRef, card) {
  if (!card.faceUp) return;
  cardEl.addEventListener("pointerdown", (e) => onCardPointerDown(e, pileRef, cardEl));
  cardEl.addEventListener("dblclick", () => onCardDoubleClick(pileRef, cardIndexInPile(pileRef, card.id)));
}

function onCardDoubleClick(ref, cardIndex) {
  if (mode !== "klondike") return;
  const cards = getPileCards(ref);
  if (!cards || cardIndex !== cards.length - 1) return;
  const card = cards[cardIndex];
  for (let i = 0; i < 4; i++) {
    const toRef = { k: "foundation", i };
    if (canDropOnRef(card, 1, toRef)) {
      commitMove(ref, cardIndex, toRef);
      return;
    }
  }
}

function onCardPointerDown(e, pileRef, cardEl) {
  if (dragCtx) return;
  if (e.button !== undefined && e.button !== 0) return;
  const cardId = Number(cardEl.dataset.cardId);
  const cardIndex = cardIndexInPile(pileRef, cardId);
  const group = getDraggableGroup(pileRef, cardIndex);
  if (!group) {
    const cards = getPileCards(pileRef);
    if (pileRef.k === "tableau" && cardIndex < cards.length - 1) {
      toast(mode === "spider"
        ? "Эту группу нельзя двигать вместе — карты под ней не по порядку одной масти"
        : "Эту группу нельзя двигать вместе — карты должны идти по убыванию с чередованием цвета");
    }
    return;
  }

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
    fromRef: pileRef,
    cardIndex,
    wrapper,
    cardEl,
    startX: e.clientX,
    startY: e.clientY,
    originLeft: originRect.left,
    originTop: originRect.top,
    leadCard: group[0],
    groupSize: group.length,
    pointerId: e.pointerId,
    moved: false,
    lastTargetRef: null,
  };

  try { cardEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  window.addEventListener("pointermove", onCardPointerMove);
  window.addEventListener("pointerup", onCardPointerUp);
  window.addEventListener("pointercancel", onCardPointerUp);
}

function findDropTargetAtPoint(x, y) {
  if (mode === "klondike") {
    const slots = document.querySelectorAll(".foundation-slot");
    for (let i = 0; i < slots.length; i++) {
      const r = slots[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { k: "foundation", i };
    }
  }
  const cols = document.querySelectorAll(".column");
  let best = null, bestDist = Infinity;
  cols.forEach((colEl, idx) => {
    const r = colEl.getBoundingClientRect();
    if (x >= r.left && x <= r.right) {
      const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (dist < bestDist) { bestDist = dist; best = { k: "tableau", i: idx }; }
    }
  });
  return best;
}

function clearDropHighlights() {
  document.querySelectorAll(".column-drop-target").forEach((el) => el.classList.remove("column-drop-target"));
}

function onCardPointerMove(e) {
  if (!dragCtx || e.pointerId !== dragCtx.pointerId) return;
  const dx = e.clientX - dragCtx.startX;
  const dy = e.clientY - dragCtx.startY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragCtx.moved = true;
  dragCtx.wrapper.style.left = (dragCtx.originLeft + dx) + "px";
  dragCtx.wrapper.style.top = (dragCtx.originTop + dy) + "px";

  const target = findDropTargetAtPoint(e.clientX, e.clientY);
  if (!refsEqual(target, dragCtx.lastTargetRef)) {
    clearDropHighlights();
    if (target) {
      const valid = refsEqual(target, dragCtx.fromRef) || canDropOnRef(dragCtx.leadCard, dragCtx.groupSize, target);
      if (valid) {
        const el = getPileEl(target);
        if (el) el.classList.add("column-drop-target");
      }
    }
    dragCtx.lastTargetRef = target;
  }
}

function onCardPointerUp(e) {
  if (!dragCtx || e.pointerId !== dragCtx.pointerId) return;
  const ctx = dragCtx;
  dragCtx = null;

  window.removeEventListener("pointermove", onCardPointerMove);
  window.removeEventListener("pointerup", onCardPointerUp);
  window.removeEventListener("pointercancel", onCardPointerUp);
  try { ctx.cardEl.releasePointerCapture(ctx.pointerId); } catch (err) { /* ignore */ }

  clearDropHighlights();

  const target = ctx.moved ? findDropTargetAtPoint(e.clientX, e.clientY) : null;
  let didMove = false;
  if (target && !refsEqual(target, ctx.fromRef)) {
    didMove = commitMove(ctx.fromRef, ctx.cardIndex, target);
  }
  if (!didMove) {
    ctx.wrapper.remove();
    render();
  } else {
    ctx.wrapper.remove();
  }
}

/* ============================== UI wiring ================================ */

function switchMode(newMode) {
  if (newMode === mode) return;
  mode = newMode;
  clearHint();
  save();
  render();
  updateUndoBtn();
  startTimer();
  document.getElementById("win-banner").classList.toggle("hidden", !activeState().won);
}

function openMenu() {
  document.getElementById("menu-overlay").classList.remove("hidden");
  updateMenuUI();
}
function closeMenu() {
  document.getElementById("menu-overlay").classList.add("hidden");
}
function updateMenuUI() {
  document.querySelectorAll(".mode-btn").forEach((b) => b.classList.toggle("active", b.dataset.game === mode));
  document.getElementById("spider-options").classList.toggle("hidden", mode !== "spider");
  document.querySelectorAll(".diff-btn").forEach((b) => {
    b.classList.toggle("active", mode === "spider" && Number(b.dataset.suits) === spiderState.suitsCount);
  });
}

function wireUI() {
  document.getElementById("btn-menu").addEventListener("click", openMenu);
  document.getElementById("btn-close-menu").addEventListener("click", closeMenu);
  document.getElementById("btn-undo").addEventListener("click", undo);
  document.getElementById("btn-hint").addEventListener("click", showHint);
  document.getElementById("btn-new").addEventListener("click", () => {
    const label = mode === "spider" ? "Паука" : "Косынки";
    if (confirm(`Начать новую игру (${label})? Текущий прогресс будет потерян.`)) {
      if (mode === "spider") newSpiderGame(spiderState.suitsCount); else newKlondikeGame();
      startTimer();
    }
  });
  document.getElementById("btn-again").addEventListener("click", () => {
    document.getElementById("win-banner").classList.add("hidden");
    if (mode === "spider") newSpiderGame(spiderState.suitsCount); else newKlondikeGame();
    startTimer();
  });
  document.getElementById("stock").addEventListener("click", onStockClick);

  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchMode(btn.dataset.game);
      updateMenuUI();
    });
  });

  document.querySelectorAll(".diff-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const suits = Number(btn.dataset.suits);
      const start = () => {
        mode = "spider";
        newSpiderGame(suits);
        startTimer();
        closeMenu();
      };
      if (mode === "spider" && spiderState.moves === 0 && suits === spiderState.suitsCount) { closeMenu(); return; }
      if (mode !== "spider" || spiderState.moves === 0) { start(); return; }
      if (confirm("Начать новую игру с выбранной сложностью? Текущий прогресс Паука будет потерян.")) start();
    });
  });

  window.addEventListener("resize", () => requestAnimationFrame(layoutColumnHeights));
}

/* ================================= Init =================================== */

function init() {
  wireUI();

  const savedMode = (() => {
    try { return localStorage.getItem(MODE_KEY); } catch (e) { return null; }
  })();
  mode = savedMode === "klondike" ? "klondike" : "spider";

  spiderState = loadState(SAVE_KEY_SPIDER) || createSpiderState(1);
  klondikeState = loadState(SAVE_KEY_KLONDIKE) || createKlondikeState();

  render();
  updateUndoBtn();
  if (activeState().won) document.getElementById("win-banner").classList.remove("hidden");
  startTimer();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
})();
