import {
  MIN_WORD_LENGTH,
  DIFFICULTIES,
  applyCellToPath,
  areAdjacent,
  lineCells,
  sameCell,
  wordFromCells,
} from "@dxl/word-grid-engine";
import QRCode from "qrcode";
import { wsUrl } from "./config.js";

const state = {
  wordSet: new Set(),
  players: [],
  activeId: null,
  isHost: false,
  roomCode: "",
  rankings: [],
  grid: [],
  remainingMs: 0,
  endAt: 0,
  timerId: null,
  endSent: false,
  selecting: false,
  grewByDrag: false,
  startCell: null,
  path: [],
  leaving: false,
};

let socket = null;

const screens = {
  setup: document.getElementById("screen-setup"),
  lobby: document.getElementById("screen-lobby"),
  play: document.getElementById("screen-play"),
  results: document.getElementById("screen-results"),
};

const els = {
  form: document.getElementById("setup-form"),
  selfName: document.getElementById("self-name"),
  hostBtn: document.getElementById("host-btn"),
  joinBtn: document.getElementById("join-btn"),
  joinCode: document.getElementById("join-code"),
  setupInvite: document.getElementById("setup-invite"),
  setupError: document.getElementById("setup-error"),
  lobbyCode: document.getElementById("lobby-code"),
  lobbySettings: document.getElementById("lobby-settings"),
  lobbyQrWrap: document.getElementById("lobby-qr-wrap"),
  lobbyQr: document.getElementById("lobby-qr"),
  lobbyLink: document.getElementById("lobby-link"),
  lobbyPlayers: document.getElementById("lobby-players"),
  lobbyStart: document.getElementById("lobby-start"),
  lobbyStartHint: document.getElementById("lobby-start-hint"),
  lobbyWait: document.getElementById("lobby-wait"),
  lobbyHome: document.getElementById("lobby-home"),
  lobbyHomeHint: document.getElementById("lobby-home-hint"),
  lobbyError: document.getElementById("lobby-error"),
  board: document.getElementById("board"),
  timer: document.getElementById("timer"),
  readout: document.getElementById("selection-readout"),
  switcher: document.getElementById("player-switcher"),
  standings: document.getElementById("live-standings"),
  foundHeading: document.getElementById("found-heading"),
  foundList: document.getElementById("found-list"),
  winner: document.getElementById("winner-banner"),
  resultsBody: document.getElementById("results-body"),
  playHome: document.getElementById("play-home"),
  playAgain: document.getElementById("play-again"),
  resultsHome: document.getElementById("results-home"),
  toast: document.getElementById("toast"),
};

let toastTimer = 0;
const IDLE_HINT = "Drag through connected letters.";
let currentScreen = "setup";

function showScreen(name) {
  Object.entries(screens).forEach(([key, node]) => {
    node.hidden = key !== name;
  });
  document.body.classList.toggle("is-playing", name === "play");
  document.documentElement.classList.toggle("is-playing", name === "play");
  document.documentElement.classList.remove("is-dragging");
  currentScreen = name;
}

function showError(node, message) {
  node.hidden = !message;
  node.textContent = message ?? "";
}

function showToast(message) {
  els.toast.hidden = false;
  els.toast.textContent = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 1600);
}

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function selfName() {
  return els.selfName.value.trim();
}

function inviteCodeFromUrl() {
  try {
    const raw = new URLSearchParams(location.search).get("code") ?? "";
    return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  } catch {
    return "";
  }
}

function applyInviteFromUrl() {
  const code = inviteCodeFromUrl();
  if (!code) return;
  els.joinCode.value = code;
  els.setupInvite.hidden = false;
  els.setupInvite.textContent = `Joining room ${code}. Enter your name, then tap Join room.`;
  els.selfName.focus();
}

function clearInviteFromUrl() {
  if (!inviteCodeFromUrl()) return;
  history.replaceState({}, "", `${location.pathname || "/"}${location.hash}`);
  els.setupInvite.hidden = true;
  els.setupInvite.textContent = "";
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return socket;
  }
  socket = new WebSocket(wsUrl());
  socket.addEventListener("message", (event) => {
    try {
      onServerMessage(JSON.parse(event.data));
    } catch {
      showError(els.setupError, "Could not read the server message.");
    }
  });
  socket.addEventListener("close", () => {
    if (state.leaving || !screens.setup.hidden) {
      state.leaving = false;
      return;
    }
    showError(els.setupError, "Disconnected from the room.");
    showScreen("setup");
  });
  return socket;
}

function goHome() {
  state.leaving = true;
  window.clearInterval(state.timerId);
  state.isHost = false;
  state.roomCode = "";
  state.activeId = null;
  if (socket) {
    socket.close();
    socket = null;
  }
  showError(els.setupError, "");
  showScreen("setup");
}

// Outgoing frames use `action` so API Gateway's route selection expression
// ($request.body.action) dispatches them to the Lambda's $default route.
function send(payload) {
  const ws = connect();
  const frame = { ...payload, action: payload.action ?? payload.type };
  const fire = () => ws.send(JSON.stringify(frame));
  if (ws.readyState === WebSocket.OPEN) fire();
  else ws.addEventListener("open", fire, { once: true });
}

function formatDuration(sec) {
  if (sec % 60 === 0) return `${sec / 60} min`;
  return `${sec}s`;
}

// The QR code is drawn in the browser rather than on the server: the client
// already knows the join URL, so the backend never needs to render an image.
function renderQr(joinUrl) {
  QRCode.toDataURL(joinUrl, {
    width: 280,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#002145", light: "#ffffff" },
  })
    .then((dataUrl) => {
      els.lobbyQr.src = dataUrl;
      els.lobbyQrWrap.hidden = false;
    })
    .catch(() => {
      // Losing the QR is not fatal; the room code and link still work.
      els.lobbyQr.removeAttribute("src");
      els.lobbyQrWrap.hidden = true;
    });
}

function renderLobby(payload) {
  state.roomCode = payload.code;
  state.players = payload.players;
  els.lobbyCode.textContent = payload.code;
  const spec = DIFFICULTIES[payload.difficulty] ?? DIFFICULTIES.medium;
  els.lobbySettings.textContent = `${spec.label} · ${payload.size}×${payload.size} · ${formatDuration(payload.durationSec)}`;
  const joinAt = payload.joinUrl && payload.joinUrl.startsWith("http")
    ? payload.joinUrl
    : `${location.origin}${location.pathname}?code=${payload.code}`;
  renderQr(joinAt);
  els.lobbyLink.textContent = `Or open ${joinAt}`;
  els.lobbyPlayers.innerHTML = payload.players
    .map((player) => {
      const you = player.id === state.activeId ? " (you)" : "";
      const host = player.id === payload.hostId ? " · host" : "";
      return `<li><span class="swatch" style="background:${player.color}"></span>${player.name}${you}${host}</li>`;
    })
    .join("");
  els.lobbyStart.hidden = !state.isHost;
  els.lobbyStartHint.hidden = !state.isHost;
  els.lobbyHomeHint.hidden = !state.isHost;
  els.lobbyStart.disabled = false;
  els.lobbyStart.textContent = "Start round";
  showError(els.lobbyError, "");
  showScreen("lobby");
}

function renderSwitcher() {
  els.switcher.innerHTML = "";
  state.players.forEach((player) => {
    const chip = document.createElement("div");
    chip.className = `chip${player.id === state.activeId ? " active" : ""}`;
    chip.style.setProperty("--chip", player.color);
    chip.textContent = player.name;
    els.switcher.appendChild(chip);
  });
}

function renderStandings() {
  els.standings.innerHTML = (state.rankings ?? [])
    .map(
      (row) => `
        <div class="standing">
          <span>${row.name}</span>
          <span>${row.wordCount} words</span>
          <strong>${row.points} pts</strong>
        </div>
      `,
    )
    .join("");
}

function renderFoundList() {
  const active = state.players.find((player) => player.id === state.activeId);
  const row = state.rankings.find((item) => item.id === state.activeId);
  els.foundHeading.textContent = `${active?.name ?? "You"} · finds`;
  const items = [
    ...(row?.unique ?? []).map((word) => ({ ...word, kind: "unique" })),
    ...(row?.shared ?? []).map((word) => ({ ...word, kind: "shared" })),
  ];
  if (items.length === 0) {
    els.foundList.innerHTML = "<li>No words yet</li>";
    return;
  }
  els.foundList.innerHTML = items
    .map(
      (item) => `
        <li class="${item.kind}">
          <span>${item.word}</span>
          <span>${item.points} pts</span>
        </li>
      `,
    )
    .join("");
}

function refreshPlayUi() {
  renderSwitcher();
  renderStandings();
  renderFoundList();
}

function cellAtPoint(x, y, { clamp = false } = {}) {
  const size = state.grid.length;
  if (!size) return null;
  const rect = els.board.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const inside = x >= rect.left && y >= rect.top && x < rect.right && y < rect.bottom;
  if (!inside && !clamp) return null;
  const c = Math.min(size - 1, Math.max(0, Math.floor(((x - rect.left) / rect.width) * size)));
  const r = Math.min(size - 1, Math.max(0, Math.floor(((y - rect.top) / rect.height) * size)));
  return { r, c };
}

function setPath(path, valid) {
  state.path = path;
  els.board.querySelectorAll(".cell").forEach((node) => {
    node.classList.remove("is-path", "is-valid", "is-origin");
  });
  path.forEach((cell, index) => {
    const node = els.board.querySelector(`[data-r="${cell.r}"][data-c="${cell.c}"]`);
    if (!node) return;
    node.classList.add("is-path");
    if (valid) node.classList.add("is-valid");
    if (index === 0) node.classList.add("is-origin");
  });

  if (!path.length) {
    els.readout.textContent = IDLE_HINT;
    els.readout.classList.remove("is-selecting", "is-valid");
    return;
  }
  const word = wordFromCells(state.grid, path);
  els.readout.textContent = word;
  els.readout.classList.add("is-selecting");
  els.readout.classList.toggle("is-valid", Boolean(valid));
}

function renderBoard() {
  const size = state.grid.length;
  els.board.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  els.board.style.setProperty("--board-size", String(size));
  els.board.style.gap = size >= 12 ? "1px" : size >= 10 ? "2px" : "3px";
  document.documentElement.style.setProperty("--board-size", String(size));
  els.board.innerHTML = "";
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.r = String(r);
      cell.dataset.c = String(c);
      cell.role = "gridcell";
      cell.textContent = state.grid[r][c];
      els.board.appendChild(cell);
    }
  }
  fitBoard();
}

function fitBoard() {
  if (screens.play.hidden) return;
  const rail = els.board.parentElement;
  if (!rail) return;
  if (!window.matchMedia("(max-width: 860px)").matches) {
    els.board.style.width = "";
    els.board.style.height = "";
    return;
  }
  const styles = getComputedStyle(rail);
  const padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
  const padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
  const side = Math.floor(
    Math.max(132, Math.min(rail.clientWidth - padX, rail.clientHeight - padY)),
  );
  els.board.style.width = `${side}px`;
  els.board.style.height = `${side}px`;
}

function pathIsValid(path) {
  if (path.length < MIN_WORD_LENGTH) return false;
  return state.wordSet.has(wordFromCells(state.grid, path).toLowerCase());
}

function trySubmitPath() {
  const path = state.path;
  state.selecting = false;
  state.startCell = null;
  setPath([], false);
  if (path.length < MIN_WORD_LENGTH) {
    if (path.length > 1) showToast(`Need at least ${MIN_WORD_LENGTH} letters`);
    return;
  }
  send({ type: "find", cells: path });
}

function onPointerDown(event) {
  if (screens.play.hidden) return;
  const cell = cellAtPoint(event.clientX, event.clientY);
  if (!cell) return;
  event.preventDefault();

  if (state.path.length && !state.selecting) {
    const last = state.path[state.path.length - 1];
    if (sameCell(cell, last)) {
      if (state.path.length >= MIN_WORD_LENGTH) trySubmitPath();
      return;
    }
    const extended = applyCellToPath(state.path, cell);
    if (extended && extended !== state.path) {
      setPath(extended, pathIsValid(extended));
      return;
    }
    if (state.path.length === 1) {
      const line = lineCells(state.path[0].r, state.path[0].c, cell.r, cell.c);
      if (line && line.length >= MIN_WORD_LENGTH && !areAdjacent(state.path[0], cell)) {
        setPath(line, pathIsValid(line));
        trySubmitPath();
        return;
      }
    }
  }

  state.selecting = true;
  state.grewByDrag = false;
  state.startCell = cell;
  document.documentElement.classList.add("is-dragging");
  setPath([cell], false);
  if (event.currentTarget?.setPointerCapture && event.pointerId != null) {
    event.currentTarget.setPointerCapture(event.pointerId);
  }
}

function onPointerMove(event) {
  if (!state.selecting || !state.path.length) return;
  event.preventDefault();
  const cell = cellAtPoint(event.clientX, event.clientY, { clamp: true });
  if (!cell) return;
  const next = applyCellToPath(state.path, cell);
  if (!next || next === state.path) return;
  state.grewByDrag = true;
  setPath(next, pathIsValid(next));
}

function onPointerUp() {
  document.documentElement.classList.remove("is-dragging");
  if (!state.selecting) return;
  state.selecting = false;
  if (state.grewByDrag && state.path.length >= MIN_WORD_LENGTH) trySubmitPath();
}

function tick(now) {
  state.remainingMs = Math.max(0, state.endAt - now);
  els.timer.textContent = formatTime(state.remainingMs);
  els.timer.classList.toggle("urgent", state.remainingMs <= 10_000);
  // Lazy round end: the server has no timer, so the client nudges it once
  // when its local countdown reaches zero. The server finalises and broadcasts.
  if (state.remainingMs <= 0 && !state.endSent) {
    state.endSent = true;
    send({ type: "endcheck" });
  }
}

function beginRound(payload) {
  state.grid = payload.grid;
  state.players = payload.players;
  state.rankings = payload.rankings ?? [];
  state.endAt = payload.endAt;
  state.endSent = false;
  renderBoard();
  refreshPlayUi();
  showScreen("play");
  window.requestAnimationFrame(() => {
    fitBoard();
    window.requestAnimationFrame(fitBoard);
  });
  tick(Date.now());
  window.clearInterval(state.timerId);
  state.timerId = window.setInterval(() => tick(Date.now()), 200);
}

function showResults(rankings) {
  window.clearInterval(state.timerId);
  state.timerId = null;
  state.rankings = rankings;
  const winner = rankings[0];
  const tied = rankings.filter((row) => row.points === winner.points);
  els.winner.innerHTML =
    tied.length > 1
      ? `<h2>Tie at ${winner.points} pts</h2><p>${tied.map((row) => row.name).join(" and ")} share the lead.</p>`
      : `<h2>${winner.name} wins</h2><p>${winner.points} points from ${winner.wordCount} words · ${winner.uniqueCount} unique</p>`;

  els.resultsBody.innerHTML = rankings
    .map((row, index) => {
      const renderRows = (items, kind) =>
        items
          .map(
            (item) => `
              <tr>
                <td>${item.word}</td>
                <td><span class="badge ${kind}">${kind}</span></td>
                <td>${item.length} letters</td>
                <td class="pts">${item.points}</td>
              </tr>
            `,
          )
          .join("");
      const all = row.unique.concat(row.shared);
      const table =
        all.length === 0
          ? `<p class="meta">No words found.</p>`
          : `
            <table class="word-table">
              <thead>
                <tr><th>Word</th><th>Kind</th><th>Length</th><th class="pts">Points</th></tr>
              </thead>
              <tbody>
                ${renderRows(row.unique, "unique")}
                ${renderRows(row.shared, "shared")}
              </tbody>
            </table>
          `;
      return `
        <article class="result-player">
          <div class="result-head">
            <h3><span class="swatch" style="background:${row.color};display:inline-block;margin-right:8px;vertical-align:middle"></span>${index + 1}. ${row.name}</h3>
            <strong>${row.points} pts</strong>
          </div>
          <p class="meta">${row.wordCount} words · ${row.uniqueCount} unique (${row.unique.reduce((s, w) => s + w.points, 0)} pts) · ${row.sharedCount} shared (${row.shared.reduce((s, w) => s + w.points, 0)} pts)</p>
          ${table}
        </article>
      `;
    })
    .join("");
  els.playAgain.hidden = !state.isHost;
  showScreen("results");
}

function onServerMessage(message) {
  if (message.type === "error") {
    const node = screens.lobby.hidden ? els.setupError : els.lobbyError;
    showError(node, message.message);
    els.lobbyStart.disabled = false;
    els.lobbyStart.textContent = "Start round";
    return;
  }
  if (message.type === "welcome") {
    state.activeId = message.playerId;
    state.isHost = message.isHost;
    clearInviteFromUrl();
    return;
  }
  if (message.type === "lobby") {
    window.clearInterval(state.timerId);
    renderLobby(message);
    return;
  }
  if (message.type === "round") {
    beginRound(message);
    return;
  }
  if (message.type === "find-ok") {
    state.rankings = message.rankings;
    showToast(`${message.word} · ${message.kind} · ${message.points} pts`);
    if (navigator.vibrate) navigator.vibrate(12);
    refreshPlayUi();
    return;
  }
  if (message.type === "find-err") {
    showToast(message.message);
    return;
  }
  if (message.type === "scores") {
    state.rankings = message.rankings;
    refreshPlayUi();
    return;
  }
  if (message.type === "ended") {
    showResults(message.rankings);
    return;
  }
  if (message.type === "closed") {
    showError(els.setupError, message.message);
    showScreen("setup");
  }
}

function bindBoard() {
  const pointerOpts = { passive: false };
  els.board.addEventListener("pointerdown", onPointerDown, pointerOpts);
  els.board.addEventListener("pointermove", onPointerMove, pointerOpts);
  els.board.addEventListener("touchmove", (event) => {
    if (state.selecting) event.preventDefault();
  }, pointerOpts);
  els.board.addEventListener("dragstart", (event) => event.preventDefault());
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", fitBoard);
  window.visualViewport?.addEventListener("resize", fitBoard);
}

function bindSetup() {
  els.hostBtn.addEventListener("click", () => {
    if (!selfName()) {
      showError(els.setupError, "Enter your name.");
      return;
    }
    showError(els.setupError, "");
    send({
      type: "host",
      name: selfName(),
      size: Number(els.form.elements.size.value),
      durationSec: Number(els.form.elements.duration.value),
      difficulty: els.form.elements.difficulty.value,
    });
  });

  els.joinBtn.addEventListener("click", () => {
    if (!selfName()) {
      showError(els.setupError, "Enter your name.");
      return;
    }
    const code = els.joinCode.value.trim();
    if (!code) {
      showError(els.setupError, "Enter the room code.");
      return;
    }
    showError(els.setupError, "");
    send({ type: "join", name: selfName(), code });
  });

  els.lobbyStart.addEventListener("click", () => {
    els.lobbyStart.disabled = true;
    els.lobbyStart.textContent = "Starting…";
    showError(els.lobbyError, "");
    send({ type: "start" });
  });

  els.lobbyHome.addEventListener("click", goHome);
  els.playHome.addEventListener("click", goHome);
  els.resultsHome.addEventListener("click", goHome);

  els.playAgain.addEventListener("click", () => {
    if (state.isHost) send({ type: "again" });
    else goHome();
  });

  els.joinCode.addEventListener("input", () => {
    els.joinCode.value = els.joinCode.value.toUpperCase();
  });
}

async function loadWords() {
  // Served from the same Pages deployment; import.meta.env.BASE_URL respects the base path.
  const response = await fetch(`${import.meta.env.BASE_URL}words.txt`);
  if (!response.ok) throw new Error("Could not load words.txt");
  const text = await response.text();
  state.wordSet = new Set(
    text
      .split(/\s+/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => /^[a-z]{3,12}$/.test(word)),
  );
}

bindSetup();
bindBoard();
showScreen("setup");
applyInviteFromUrl();

loadWords().catch((error) => showError(els.setupError, error.message));
