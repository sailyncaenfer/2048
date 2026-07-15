(function(){
  "use strict";

  const SIZE = 4;
  const GAP = 10; // must match the grid-gap used for .board in style.css
  const DIR = { LEFT:0, DOWN:1, RIGHT:2, UP:3 };

  const TILE_BG = ["var(--bg0)","var(--bg2)","var(--bg4)","var(--bg8)","var(--bg16)","var(--bg32)","var(--bg64)",
                    "var(--bg128)","var(--bg256)","var(--bg512)","var(--bg1024)","var(--bg2048)","var(--bg4096)",
                    "var(--bg8192)","var(--bg16384)","var(--bg32768)","var(--bg65536)","var(--bg131072)"];
  const TILE_FG = ["var(--bg0)","var(--fg2)","var(--fg4)","var(--fg8)","var(--fg16)","var(--fg32)",
                    "var(--fg64)","var(--fg128)","var(--fg256)","var(--fg512)","var(--fg1024)","var(--fg2048)","var(--fg4096)",
                    "var(--fg8192)","var(--fg16384)","var(--fg32768)","var(--fg65536)","var(--fg131072)"];
  const TILE_SHADOW = ["rgba(0,0,0,0)","var(--shadow2)","var(--shadow4)","var(--shadow8)","var(--shadow16)","var(--shadow32)",
                    "var(--shadow64)","var(--shadow128)","var(--shadow256)","var(--shadow512)","var(--shadow1024)","var(--shadow2048)","var(--shadow4096)",
                    "var(--shadow8192)","var(--shadow16384)","var(--shadow32768)","var(--shadow65536)","var(--shadow131072)"];
  const TILE_OUTLINE = ["rgba(0,0,0,0)","var(--outline2)","var(--outline4)","var(--outline8)","var(--outline16)","var(--outline32)",
                    "var(--outline64)","var(--outline128)","var(--outline256)","var(--outline512)","var(--outline1024)","var(--outline2048)","var(--outline4096)",
                    "var(--outline8192)","var(--outline16384)","var(--outline32768)","var(--outline65536)","var(--outline131072)"];
  const MAX_TILE_IDX = TILE_BG.length - 1; // 131072

  // Tile values a .vth theme (and the theme-tab preview) can customize.
  const TILE_KEYS = [2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,16384,32768,65536,131072];

  const MODS = [
    { key:"shy",       name:"Shy",       abbr:"SH", accent:"rgb(216, 148, 231)",
      desc:"New tiles spawn opposite your move." },
    { key:"gravity",   name:"Gravity",   abbr:"GR", accent:"rgb(93,138,168)",
      desc:"Every move is performed twice." },
    { key:"touch",     name:"Touch",     abbr:"TC", accent:"rgb(0,150,136)",
      desc:"Only adjacent tiles can be merged." },
    { key:"blocked",   name:"Blocked",   abbr:"BL", accent:"rgb(40,36,30)",
      desc:"An unmergeable tile is spawned at the start of the game." },
    { key:"sloth",     name:"Sloth",     abbr:"SL", accent:"rgb(120, 100, 60)",
      desc:"Tiles only move one cell at a time." },
    { key:"invisible", name:"Invisible", abbr:"IV", accent:"rgb(150,140,140)",
      desc:"Only newly spawned tiles are shown." },
    { key:"coinflip",  name:"Coin Flip", abbr:"CF", accent:"rgb(212,175,55)",
      desc:"Spawnable tiles are equally likely to spawn." },
    { key:"greed",     name:"Greed",     abbr:"GD", accent:"rgb(60, 160, 80)",
      desc:"8's can also spawn: 2 (85%), 4 (10%), 8 (5%)." },
    { key:"volatile",  name:"Volatile",  abbr:"VL", accent:"rgb(252, 76, 228)",
      desc:"Two new tiles spawn after every move instead of one." },
    { key:"extrovert", name:"Extrovert", abbr:"XT", accent:"rgb(255, 140, 66)",
      desc:"If the biggest tile sits in the same spot for 7 moves, it swaps with the tile in a fixed spot toward the center." },
    { key:"lockout",   name:"Lockout",   abbr:"LO", accent:"rgb(255, 79, 79)",
      desc:"A random direction is disabled every move." },
    { key:"magician",  name:"Magician",  abbr:"MG", accent:"rgb(169, 54, 160)",
      desc:"Making the same merge twice spawns a temporary unmergeable block. Make unique merges to make it vanish." },
    { key:"expert",    name:"Expert",    abbr:"EX", accent:"rgb(139, 0, 0)",
      desc:"Tiles are spawned adversarially." },
    { key:"drunk",     name:"Drunk",     abbr:"DR", accent:"rgb(66, 133, 244)",
      desc:"You can't move in the same direction twice in a row." },
  ];

  let nextTileId = 1;

  const state = {
    board: null,          // grid of null | { id, value }
    magicCounter: null,   // grid of numbers, moves alongside board
    score:0, best:0, moveCount:0, gameOver:false,
    lastMergeValue:0,
    spawnLocs: [],
    lastMerges: [],        // [{consumedId, survivorId}] recorded during the most recent move, used to animate merges
    magicLog: [],   // history of merge values while Magician is active, newest first
    animationsEnabled: true,
    tapControlsEnabled: false,
    confirmRestartEnabled: false,
    theme: "light",
    lockedDir: null, // direction disabled this turn while Lockout is active
    lastMoveDir: null, // direction of the last move that actually changed the board, disabled this turn while Drunk is active
    mods: { gravity:false, invisible:false, magician:false, volatile:false, blocked:false, touch:false, coinflip:false, lockout:false, extrovert:false, expert:false, greed:false, sloth:false, shy:false, drunk:false },
    chaosMode: false,     // true once the "chaos" cheat code has been typed in the mods menu
    chaosActiveMod: null, // key of the single mod Chaos Mode currently has switched on
    extrovertTracker: {}, // tile id -> { row, col, streak } for Extrovert's "stayed put" tracking
    spawnStats: { twos: 0, fours: 0, eights: 0 }, // count of real (non-sentinel) tile spawns, by value
    dirCounts: { 0:0, 1:0, 2:0, 3:0 }  // count of directional inputs received, keyed by DIR value
  };

  function loadBestScore() {
    try {
      const saved = localStorage.getItem(getBestScoreKey());
      state.best = saved ? parseInt(saved, 10) : 0;
    } catch(e) {
      state.best = 0;
    }
  }

  // ---------- persistence (save/restore + cross-tab sync) ----------
  // The full board (not just the best score) is persisted so that closing
  // the tab and coming back - or having the game open in several tabs at
  // once - doesn't lose progress. Every tab writes to the same localStorage
  // key after each move; other tabs pick up the change via the "storage"
  // event and re-render themselves to match, so all open instances of the
  // game always show the same, single, current board.
  const SAVE_KEY = "2048modlab_savegame";
  let restoringSave = false; // true while a save is being applied; guards against re-saving mid-restore

  function serializeBoard(grid){
    return grid.map(row => row.map(cell => cell ? { id: cell.id, value: cell.value } : null));
  }

  function snapshotState(){
    return {
      board: serializeBoard(state.board),
      magicCounter: state.magicCounter,
      score: state.score,
      best: state.best,
      moveCount: state.moveCount,
      gameOver: state.gameOver,
      lastMergeValue: state.lastMergeValue,
      spawnLocs: state.spawnLocs,
      magicLog: state.magicLog,
      lockedDir: state.lockedDir,
      lastMoveDir: state.lastMoveDir,
      mods: state.mods,
      chaosMode: state.chaosMode,
      chaosActiveMod: state.chaosActiveMod,
      extrovertTracker: state.extrovertTracker,
      spawnStats: state.spawnStats,
      dirCounts: state.dirCounts,
      nextTileId: nextTileId
    };
  }

  function saveGame(){
    if (restoringSave) return; // don't echo a just-applied remote save right back out
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(snapshotState()));
    } catch(e) {}
  }

  // Applies a previously-saved (or another tab's just-saved) snapshot to
  // the live state and redraws. Used both for the initial page load and
  // for picking up moves made in other open tabs.
  function applySnapshot(data){
    if (!data || !Array.isArray(data.board)) return false;

    restoringSave = true;

    state.board = data.board.map(row => row.map(cell => cell ? { id: cell.id, value: cell.value } : null));
    state.magicCounter = Array.isArray(data.magicCounter) ? data.magicCounter : emptyGrid(0);
    state.score = typeof data.score === "number" ? data.score : 0;
    if (typeof data.best === "number") state.best = data.best;
    state.moveCount = typeof data.moveCount === "number" ? data.moveCount : 0;
    state.gameOver = !!data.gameOver;
    state.lastMergeValue = typeof data.lastMergeValue === "number" ? data.lastMergeValue : 0;
    state.spawnLocs = Array.isArray(data.spawnLocs) ? data.spawnLocs : [];
    state.magicLog = Array.isArray(data.magicLog) ? data.magicLog : [];
    state.lockedDir = (typeof data.lockedDir === "number") ? data.lockedDir : null;
    state.lastMoveDir = (typeof data.lastMoveDir === "number") ? data.lastMoveDir : null;
    if (data.mods) state.mods = Object.assign({}, state.mods, data.mods);
    state.chaosMode = !!data.chaosMode;
    state.chaosActiveMod = data.chaosActiveMod || null;
    state.extrovertTracker = data.extrovertTracker && typeof data.extrovertTracker === "object" ? data.extrovertTracker : {};
    state.spawnStats = data.spawnStats && typeof data.spawnStats === "object"
      ? { twos: data.spawnStats.twos|0, fours: data.spawnStats.fours|0, eights: data.spawnStats.eights|0 }
      : { twos: 0, fours: 0, eights: 0 };
    state.dirCounts = data.dirCounts && typeof data.dirCounts === "object"
      ? { 0: data.dirCounts[0]|0, 1: data.dirCounts[1]|0, 2: data.dirCounts[2]|0, 3: data.dirCounts[3]|0 }
      : { 0:0, 1:0, 2:0, 3:0 };

    if (typeof data.nextTileId === "number") nextTileId = data.nextTileId;

    hideOverlay();
    stopAllMagicAnimations();
    tilesLayerEl.innerHTML = "";
    tileEls.clear();
    syncModCards();
    render();

    restoringSave = false;
    return true;
  }

  function loadGame(){
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      return applySnapshot(JSON.parse(raw));
    } catch(e){
      return false;
    }
  }

  // Fires in every OTHER tab whenever this key changes here - never in the
  // tab that made the change - which is exactly what's needed to mirror a
  // move made in one tab onto every other open instance.
  window.addEventListener("storage", (e) => {
    if (e.key !== SAVE_KEY || !e.newValue) return;
    try {
      applySnapshot(JSON.parse(e.newValue));
    } catch(err) {}
  });

  try {
    const savedAnim = localStorage.getItem("2048modlab_anim");
    if (savedAnim === "off") state.animationsEnabled = false;
  } catch(e) {}

  try {
    const savedTapControls = localStorage.getItem("2048modlab_tapcontrols");
    if (savedTapControls === "on") state.tapControlsEnabled = true;
  } catch(e) {}

  try {
    const savedTheme = localStorage.getItem("2048modlab_theme");
    if (savedTheme === "dark") state.theme = "dark";
  } catch(e) {}

  try {
    const savedConfirmRestart = localStorage.getItem("2048modlab_confirmrestart");
    if (savedConfirmRestart === "on") state.confirmRestartEnabled = true;
  } catch(e) {}

  // ---------- custom tile theme (.vth) ----------
  // Snapshot the CSS file's own light/dark tile colors *before* any custom
  // theme gets applied, so "Reset to Default" always has something true
  // to fall back to, and partial custom themes (e.g. only a few values
  // overridden) can be layered on top of the rest.
  function snapshotBuiltinTheme(mode){
    const prevAttr = document.documentElement.getAttribute("data-theme");
    document.documentElement.setAttribute("data-theme", mode);
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    TILE_KEYS.forEach(v => {
      out[v] = {
        bg: cs.getPropertyValue(`--bg${v}`).trim(),
        fg: cs.getPropertyValue(`--fg${v}`).trim(),
        shadow: cs.getPropertyValue(`--shadow${v}`).trim() || "rgba(0,0,0,0)",
        outline: cs.getPropertyValue(`--outline${v}`).trim() || "rgba(0,0,0,0)",
        text: String(v)
      };
    });
    if (prevAttr === null) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", prevAttr);
    return out;
  }

  const DEFAULT_THEME = {
    light: snapshotBuiltinTheme("light"),
    dark: snapshotBuiltinTheme("dark")
  };

  // { light:{2:{bg,fg,shadow,outline,text}, ...}, dark:{...} }, only the
  // values a person has actually overridden are present here. Anything not
  // in here falls back to DEFAULT_THEME.
  state.customTheme = null;

  // Converts a .vth file's JSON (per-mode objects keyed by "2".."65536"/"super",
  // each holding --tile-background / --tile-color / --tile-shadow-color /
  // --tile-outline-color / --tile-text) into our internal shape.
  function vthToInternal(vth){
    if (!vth || typeof vth !== "object") return null;
    const out = {};
    ["light","dark"].forEach(mode => {
      const src = vth[mode];
      if (!src || typeof src !== "object") return;
      const modeOut = {};
      Object.keys(src).forEach(key => {
        const v = key === "super" ? 131072 : parseInt(key, 10);
        if (!TILE_KEYS.includes(v)) return;
        const entry = src[key] || {};
        modeOut[v] = {
          bg: entry["--tile-background"] || null,
          fg: entry["--tile-color"] || null,
          shadow: entry["--tile-shadow-color"] || null,
          outline: entry["--tile-outline-color"] || null,
          text: (typeof entry["--tile-text"] === "string" && entry["--tile-text"]) || null
        };
      });
      if (Object.keys(modeOut).length) out[mode] = modeOut;
    });
    return Object.keys(out).length ? out : null;
  }

  // Converts our internal (possibly partial) custom theme + defaults back
  // into a full, portable .vth JSON structure for export.
  function internalToVth(){
    const vth = {};
    ["light","dark"].forEach(mode => {
      const eff = getEffectiveTheme(mode);
      const modeOut = {};
      TILE_KEYS.forEach(v => {
        const key = v === 131072 ? "super" : String(v);
        modeOut[key] = {
          "--tile-text": eff[v].text,
          "--tile-color": eff[v].fg,
          "--tile-background": eff[v].bg,
          "--tile-shadow-color": eff[v].shadow,
          "--tile-outline-color": eff[v].outline
        };
      });
      vth[mode] = modeOut;
    });
    return vth;
  }

  function getEffectiveTheme(mode){
    const base = DEFAULT_THEME[mode];
    const custom = state.customTheme && state.customTheme[mode];
    const eff = {};
    TILE_KEYS.forEach(v => {
      const b = base[v];
      const c = custom && custom[v];
      eff[v] = {
        bg: (c && c.bg) || b.bg,
        fg: (c && c.fg) || b.fg,
        shadow: (c && c.shadow) || b.shadow,
        outline: (c && c.outline) || b.outline,
        text: (c && c.text) || b.text
      };
    });
    return eff;
  }

  // Live lookup used while rendering tiles: value -> display text, kept in
  // sync with whichever theme (default or custom) is currently active.
  let currentTileText = {};

  function applyThemeVars(){
    const eff = getEffectiveTheme(state.theme);
    TILE_KEYS.forEach(v => {
      document.documentElement.style.setProperty(`--bg${v}`, eff[v].bg);
      document.documentElement.style.setProperty(`--fg${v}`, eff[v].fg);
      document.documentElement.style.setProperty(`--shadow${v}`, eff[v].shadow);
      document.documentElement.style.setProperty(`--outline${v}`, eff[v].outline);
      currentTileText[v] = eff[v].text;
    });
  }

  const CUSTOM_THEME_KEY = "2048modlab_customtheme";

  function saveCustomTheme(){
    try {
      if (state.customTheme) localStorage.setItem(CUSTOM_THEME_KEY, JSON.stringify(state.customTheme));
      else localStorage.removeItem(CUSTOM_THEME_KEY);
    } catch(e) {}
  }

  try {
    const raw = localStorage.getItem(CUSTOM_THEME_KEY);
    if (raw){
      const parsed = JSON.parse(raw);
      const sampleMode = parsed && (parsed.light || parsed.dark);
      const sampleEntry = sampleMode && Object.values(sampleMode)[0];
      // Already-internal storage (has bg/fg keys) vs a raw .vth file someone saved earlier.
      state.customTheme = (sampleEntry && ("bg" in sampleEntry || "fg" in sampleEntry))
        ? parsed
        : vthToInternal(parsed);
    }
  } catch(e) { state.customTheme = null; }

  function applyTheme(){
    document.documentElement.setAttribute("data-theme", state.theme);
    applyThemeVars();
  }
  applyTheme();


  // ---------- helpers ----------

  function getBestScoreKey() {
    if (state.chaosMode) return "2048modlab_best_chaos";

    const active = MODS
    .filter(mod => state.mods[mod.key])
    .map(mod => mod.key)
    .sort();            // ensures order doesn't matter

    return "2048modlab_best_" + active.join("_");
  }

  function emptyGrid(fill){ return Array.from({length:SIZE}, () => Array(SIZE).fill(fill)); }

  function emptyCells(){
    const cells = [];
    for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) if (state.board[r][c] === null) cells.push([r,c]);
    return cells;
  }

  // ---------- Shy mod: restrict spawns to the far side from the move ----------
  // A tile that just moved (say) right leaves its "wake" along the left
  // column; Shy confines new spawns to that opposite edge. Falls back to
  // every empty cell if that edge happens to be completely full, and is a
  // no-op (returns all empty cells) when Shy is off or no direction is known
  // (e.g. the two starting tiles at the beginning of a game).
  function shyFilterCells(cells, direction){
    if (!state.mods.shy || direction === null || direction === undefined) return cells;
    let filtered;
    switch (direction){
      case DIR.LEFT:  filtered = cells.filter(([r,c]) => c === SIZE-1); break; // moved left -> spawn rightmost column
      case DIR.RIGHT: filtered = cells.filter(([r,c]) => c === 0); break;      // moved right -> spawn leftmost column
      case DIR.UP:    filtered = cells.filter(([r,c]) => r === SIZE-1); break; // moved up -> spawn bottom row
      case DIR.DOWN:  filtered = cells.filter(([r,c]) => r === 0); break;      // moved down -> spawn top row
      default: filtered = cells;
    }
    return filtered.length > 0 ? filtered : cells;
  }

  function rotateRightOnce(grid){
    const t = emptyGrid(null);
    for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) t[r][c] = grid[SIZE-1-c][r];
    return t;
  }

  function rotateTimes(n){
    for (let i=0;i<n;i++){
      state.board = rotateRightOnce(state.board);
      state.magicCounter = rotateRightOnce(state.magicCounter);
    }
  }

  function boardsEqual(a,b){
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const av = a[r][c], bv = b[r][c];
        if ((av === null) !== (bv === null)) return false;
        if (av && bv && (av.id !== bv.id || av.value !== bv.value)) return false;
      }
    }
    return true;
  }

  function cloneBoard(g){
    return g.map(row => row.map(cell => cell ? { id: cell.id, value: cell.value } : null));
  }

  // ---------- Expert mod: adversarial spawn engine ----------
  // The engine itself (Expert's expectiminimax spawn search) lives in
  // adversarial-engine.js, loaded as a separate <script> before this file.
  // It needs a few things from here -- the shared game state, the SIZE
  // constant, the live spawn-probability function, and some small
  // helpers -- so those are handed in as dependencies, and what comes back
  // is the same expertSpawn(direction) function this file used to define
  // inline.
  const { expertSpawn } = createAdversarialEngine({
    SIZE,
    state,
    currentSpawnProbs,
    shyFilterCells,
    emptyCells,
    recordSpawnStat,
    consumeTileId: () => nextTileId++
  });


  // ---------- game setup ----------
  function newGame(){
    if (state.chaosMode){
      if (state.chaosActiveMod === "blocked") removeBlockedTiles();
      if (state.chaosActiveMod === "magician") removeMagicTiles();
      if (state.chaosActiveMod) state.mods[state.chaosActiveMod] = false;

      const key = chaosPickDifferentMod(state.chaosActiveMod);
      state.mods[key] = true;
      state.chaosActiveMod = key;
    }

    state.board = emptyGrid(null);
    state.magicCounter = emptyGrid(0);
    state.score = 0;
    state.moveCount = 0;
    state.gameOver = false;
    state.lastMergeValue = 0;
    state.spawnLocs = [];
    state.magicLog = [];
    state.lockedDir = null;
    state.lastMoveDir = null;
    state.extrovertTracker = {};
    state.spawnStats = { twos: 0, fours: 0, eights: 0 };
    state.dirCounts = { 0:0, 1:0, 2:0, 3:0 };

    const s1 = randomSpawn();
    const s2 = randomSpawn();
    state.spawnLocs = [s1, s2].filter(x => x !== null);

    if (state.mods.blocked) randomSpawnBlock();

    pickLockout();

    hideOverlay();
    lossFlashEl.classList.remove("pulse");
    stopAllMagicAnimations();
    tilesLayerEl.innerHTML = "";
    tileEls.clear();
    render();
    saveGame();
  }

  // Returns the values a spawn can take on and their probabilities,
  // reflecting whichever of Greed / Coin Flip are currently active:
  //   neither:            2 (90%), 4 (10%)
  //   Coin Flip only:     2 (50%), 4 (50%)
  //   Greed only:         2 (85%), 4 (10%), 8 (5%)
  //   Greed + Coin Flip:  2, 4, 8 all equally likely
  // Expert's adversarial engine reads this same function so its search
  // stays consistent with what can actually spawn.
  function currentSpawnProbs(){
    if (state.mods.greed && state.mods.coinflip){
      return { values: [2,4,8], probs: [1/3, 1/3, 1/3] };
    }
    if (state.mods.greed){
      return { values: [2,4,8], probs: [0.85, 0.10, 0.05] };
    }
    if (state.mods.coinflip){
      return { values: [2,4], probs: [0.5, 0.5] };
    }
    return { values: [2,4], probs: [0.9, 0.1] };
  }

  function pickWeightedValue(values, probs){
    const r = Math.random();
    let cum = 0;
    for (let i=0;i<values.length;i++){
      cum += probs[i];
      if (r < cum) return values[i];
    }
    return values[values.length-1];
  }

  function recordSpawnStat(val){
    if (val === 4) state.spawnStats.fours++;
    else if (val === 8) state.spawnStats.eights++;
    else state.spawnStats.twos++;
  }

  function randomSpawn(direction){
    const cells = shyFilterCells(emptyCells(), direction);
    if (cells.length === 0) return null;
    const { values, probs } = currentSpawnProbs();
    const val = pickWeightedValue(values, probs);
    const [r,c] = cells[Math.floor(Math.random()*cells.length)];
    state.board[r][c] = { id: nextTileId++, value: val };
    recordSpawnStat(val);
    return r*SIZE + c;
  }

  function randomSpawnBlock(direction){
    const cells = shyFilterCells(emptyCells(), direction);
    if (cells.length === 0) return null;
    const [r,c] = cells[Math.floor(Math.random()*cells.length)];
    state.board[r][c] = { id: nextTileId++, value: 1 }; // sentinel: permanent obstacle tile
    return r*SIZE + c;
  }

  // Clears every obstacle tile (the Blocked mod's sentinel value) off the
  // board. Used when Chaos Mode switches away from Blocked, since those
  // tiles are only meant to exist while Blocked is the active mod.
  function removeBlockedTiles(){
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        if (state.board[r][c] && state.board[r][c].value === 1){
          state.board[r][c] = null;
          state.magicCounter[r][c] = 0;
        }
      }
    }
  }

  // ---------- move + merge ----------
  const BLOCKED = 0, MOVED = 1, MERGED = 2;

  function moveTileLeft(row, col, merged, mergeValues){
    const b = state.board, m = state.magicCounter;
    if (col === 0) return BLOCKED;

    if (b[row][col-1] === null){
      b[row][col-1] = b[row][col];
      m[row][col-1] = m[row][col];
      b[row][col] = null;
      m[row][col] = 0;
      return MOVED;
    }

    if (state.mods.magician && (m[row][col] !== 0 || m[row][col-1] !== 0)) return BLOCKED;

    if (b[row][col-1].value !== b[row][col].value) return BLOCKED;

    if (!merged[row][col-1]){
      const preMergeValue = b[row][col].value;
      state.lastMerges.push({ consumedId: b[row][col].id, survivorId: b[row][col-1].id });
      b[row][col-1].value *= 2;
      b[row][col] = null;
      merged[row][col-1] = 1;
      state.score += b[row][col-1].value;
      
      mergeValues.push(preMergeValue);
      return MERGED;
    }

    return BLOCKED;
  }

  // "Touch" mod merge rule: two tiles merge only if their ORIGINAL columns
  // were exactly one apart, i.e. nothing (not even an empty cell) separated
  // them. Either or both tiles may still slide to meet in the middle; that
  // doesn't disqualify the merge. A tile that already merged this move can't
  // merge again (no chains). Ported from 2048_touch.c's merge_row_left().
  function mergeRowTouchLeft(row, magicRow, mergeValues){
    const newRow = [null, null, null, null];
    const newMagic = [0, 0, 0, 0];
    let writeIndex = 0;
    let lastOrigCol = -2;   // original column of the tile now at newRow[writeIndex-1]
    let lastMerged = false; // whether that tile already merged this move

    for (let col=0; col<SIZE; col++){
      const cell = row[col];
      if (cell === null) continue;

      const prev = writeIndex > 0 ? newRow[writeIndex-1] : null;
      const prevMagic = writeIndex > 0 && state.mods.magician && newMagic[writeIndex-1] !== 0;
      const curMagic = state.mods.magician && magicRow[col] !== 0;

      if (prev !== null &&
          !lastMerged &&
          !prevMagic && !curMagic &&
          prev.value === cell.value &&
          (col - lastOrigCol === 1)){
        // Same value, previous tile hasn't merged yet, and the two tiles
        // were originally touching (no gap between them).
        state.lastMerges.push({ consumedId: cell.id, survivorId: prev.id });
        newRow[writeIndex-1] = { id: prev.id, value: prev.value * 2 };
        state.score += newRow[writeIndex-1].value;
        mergeValues.push(newRow[writeIndex-1].value);
        lastMerged = true;
        lastOrigCol = col;
      } else {
        newRow[writeIndex] = cell;
        newMagic[writeIndex] = magicRow[col];
        writeIndex += 1;
        lastMerged = false;
        lastOrigCol = col;
      }
    }

    for (let i=0; i<SIZE; i++){
      row[i] = newRow[i];
      magicRow[i] = newMagic[i];
    }
  }

  function moveAndMergeOnce(direction){
    const mergeValues = [];

    rotateTimes(direction);

    if (state.mods.touch){
      for (let row=0; row<SIZE; row++){
        mergeRowTouchLeft(state.board[row], state.magicCounter[row], mergeValues);
      }
    } else {
      const merged = emptyGrid(0);
      for (let row=0; row<SIZE; row++){
        for (let col=0; col<SIZE; col++){
          if (state.board[row][col] === null) continue;
          let tempCol = col;
          let ret;
          do{
            ret = moveTileLeft(row, tempCol, merged, mergeValues);
            if (ret === MOVED) tempCol -= 1;
          } while (ret === MOVED && !state.mods.sloth);
        }
      }
    }

    rotateTimes((SIZE - direction) % SIZE);
    return mergeValues;
  }

  // ---------- lockout mechanics ----------
  // Dry-runs a move on a scratch copy of the board to see whether it would
  // change anything, without touching real game state (score included).
  function wouldMoveChange(direction){
    const savedBoard = state.board;
    const savedMagic = state.magicCounter;
    const savedScore = state.score;

    state.board = cloneBoard(savedBoard);
    state.magicCounter = savedMagic.map(row => row.slice());
    const before = cloneBoard(state.board);
    moveAndMergeOnce(direction);
    const changed = !boardsEqual(before, state.board);

    state.board = savedBoard;
    state.magicCounter = savedMagic;
    state.score = savedScore;
    return changed;
  }

  // Picks a random direction to disable for the upcoming move. Never locks
  // the player's only remaining legal move.
  function pickLockout(){
    if (!state.mods.lockout){ state.lockedDir = null; return; }

    const allDirs = [DIR.LEFT, DIR.RIGHT, DIR.UP, DIR.DOWN];
    const validDirs = allDirs.filter(d => wouldMoveChange(d));

    let candidates = allDirs;
    if (validDirs.length <= 1){
      candidates = allDirs.filter(d => d !== validDirs[0]);
    }

    if (candidates.length === 0){ state.lockedDir = null; return; }
    state.lockedDir = candidates[Math.floor(Math.random() * candidates.length)];
  }

  // ---------- extrovert mechanics ----------
  // Every cell has a fixed "home" cell it teleports to. The four center
  // cells are everyone's ultimate home and map to themselves; the twelve
  // outer cells each belong to one of the four corner "cliques" (the corner
  // plus its two orthogonal neighbors) and map to the center cell on the
  // opposite side of the board, mirrored through the middle.
  const EXTROVERT_TARGET = [
    [[2,2],[2,2],[2,1],[2,1]],
    [[2,2],[1,1],[1,2],[2,1]],
    [[1,2],[2,1],[2,2],[1,1]],
    [[1,2],[1,2],[1,1],[1,1]]
  ];
  const EXTROVERT_STREAK_NEEDED = 8;

  // Extrovert's position tracking runs whenever the mod itself is on, and
  // also passively throughout all of Chaos Mode (per its own special rule),
  // even on moves where some other mod is the one currently switched on.
  function extrovertIsTracking(){
    return state.mods.extrovert || state.chaosMode;
  }
  
  function extrovertIsActive(){
      return state.mods.extrovert;
  }

  // Briefly rings the given cell to call out a teleport swap.
  function spawnExtrovertGlow(r, c){
    const total = tilesLayerEl.clientWidth || tilesLayerEl.offsetWidth || 0;
    const cell = Math.max(0, (total - GAP*(SIZE-1)) / SIZE);
    const x = c*(cell+GAP), y = r*(cell+GAP);

    const glow = document.createElement("div");
    glow.className = "extrovert-glow";
    glow.style.width = cell + "px";
    glow.style.height = cell + "px";
    glow.style.transform = `translate(${x}px, ${y}px)`;
    tilesLayerEl.appendChild(glow);
    setTimeout(() => glow.remove(), 650);
  }

  // Called once per successful move. Finds whichever tile(s) currently hold
  // the board's highest value, tracks how many moves in a row each has sat
  // in the same cell, and teleport-swaps any that have overstayed their
  // welcome (7+ moves) with the tile at their fixed home cell.
  function processExtrovert(){
    if (!extrovertIsTracking()){
      state.extrovertTracker = {};
      return;
    }

    let maxVal = 0;
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const cell = state.board[r][c];
        if (cell && cell.value > 1 && cell.value > maxVal) maxVal = cell.value;
      }
    }
    if (maxVal === 0) return;

    const stillHolding = new Set();

    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        // --- ADD THIS CHECK ---
        // Skip tracking if the tile is in one of the center cells:
        // (1,1), (1,2), (2,1), or (2,2)
        if ((r === 1 || r === 2) && (c === 1 || c === 2)) continue;
        // ----------------------

        const cell = state.board[r][c];
        if (!cell || cell.value !== maxVal) continue;

        const id = cell.id;
        stillHolding.add(id);
        const prev = state.extrovertTracker[id];

        if (prev && prev.row === r && prev.col === c){
          prev.streak += 1;
          prev.value = maxVal;
        } else {
          state.extrovertTracker[id] = { row:r, col:c, streak:1, value:maxVal };
        }

        if (
            extrovertIsActive() &&
            state.extrovertTracker[id].streak >= EXTROVERT_STREAK_NEEDED
        ){
          const [tr, tc] = EXTROVERT_TARGET[r][c];
          delete state.extrovertTracker[id];

          if (tr !== r || tc !== c){
            const other = state.board[tr][tc];
            state.board[r][c] = other;
            state.board[tr][tc] = cell;

            const tmpMagic = state.magicCounter[r][c];
            state.magicCounter[r][c] = state.magicCounter[tr][tc];
            state.magicCounter[tr][tc] = tmpMagic;

            if (other) delete state.extrovertTracker[other.id];

            spawnExtrovertGlow(r, c);
            spawnExtrovertGlow(tr, tc);
          }
        }
      }
    }

    for (const idKey in state.extrovertTracker){
      if (!stillHolding.has(Number(idKey))) delete state.extrovertTracker[idKey];
    }
  }

  // ---------- chaos mode ----------
  // Picks a mod key other than the one passed in.
  function chaosPickDifferentMod(excludeKey){
    const candidates = MODS.map(m => m.key).filter(k => k !== excludeKey);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // Turns Chaos Mode on (picking one random starting mod) or off (dropping
  // whatever mod it currently has active). Always starts a fresh game after,
  // same as toggling a mod square by hand.
  function setChaosMode(on){
    state.chaosMode = on;
    MODS.forEach(m => state.mods[m.key] = false);
    state.chaosActiveMod = null;

    loadBestScore();
    newGame();       // newGame() picks the starting mod itself when chaosMode is true
    syncModCards();  // sync AFTER, so the menu reflects whatever newGame() landed on
  }

  // Called once per successful move while Chaos Mode is active. 10% chance
  // to swap the currently active mod out for a different random one.
  // Returns true if the swap just turned Blocked on, so the caller can spawn
  // an obstacle tile in place of this move's natural spawn.
  function maybeChaosSwitch(){
    if (!state.chaosMode) return false;
    if (Math.random() >= 0.10) return false;

    const oldKey = state.chaosActiveMod;
    const newKey = chaosPickDifferentMod(oldKey);

    if (oldKey){
      state.mods[oldKey] = false;
      if (oldKey === "blocked") removeBlockedTiles();
      if (oldKey === "magician") removeMagicTiles();
    }

    state.mods[newKey] = true;
    state.chaosActiveMod = newKey;

    return newKey === "blocked";
  }

  // ---------- magician mechanics ----------
  function getHighestTile(){
    let highest = 0;
    for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++){
      const cell = state.board[r][c];
      if (state.magicCounter[r][c] === 0 && cell && cell.value > highest) highest = cell.value;
    }
    return highest;
  }

  function magicCounterValue(highest){
    if (highest < 4) return 1;
    let counter = Math.floor(Math.log2(highest) + 1e-6) - 1;
    if (counter < 1) counter = 1;
    return counter;
  }

  function spawnMagicBlock(){
    const cells = emptyCells();
    if (cells.length === 0) return;
    const [r,c] = cells[Math.floor(Math.random()*cells.length)];
    const highest = getHighestTile();
    state.board[r][c] = { id: nextTileId++, value: -1 }; // magic sentinel
    state.magicCounter[r][c] = magicCounterValue(highest);
  }

  // Clears every magic (TV-static) sentinel tile off the board. Used when
  // Chaos Mode switches away from Magician, since those tiles only make
  // sense while Magician is the active mod.
  function removeMagicTiles(){
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        if (state.magicCounter[r][c] !== 0){
          state.board[r][c] = null;
          state.magicCounter[r][c] = 0;
        }
      }
    }
  }

  function processMagic(mergeValues){
    let decrementThisMove = false;
    let spawnsNeeded = 0;

    for (let i=0;i<mergeValues.length;i++){
      let isDup = false;
      if (state.lastMergeValue === mergeValues[i]) isDup = true;
      for (let j=0;j<i;j++){ if (mergeValues[j] === mergeValues[i]){ isDup = true; break; } }
      if (isDup) spawnsNeeded++; else decrementThisMove = true;
    }

    if (mergeValues.length > 0) state.lastMergeValue = mergeValues[mergeValues.length-1];

    if (decrementThisMove && spawnsNeeded === 0){
      for (let r=0;r<SIZE;r++){
        for (let c=0;c<SIZE;c++){
          if (state.magicCounter[r][c] > 0){
            state.magicCounter[r][c]--;
            if (state.magicCounter[r][c] === 0) state.board[r][c] = null;
          }
        }
      }
    }

    for (let i=0;i<spawnsNeeded;i++) spawnMagicBlock();
  }

  // ---------- loss detection ----------
  function isLost(){
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const cur = state.board[r][c];
        if (cur === null) return false;
        const curMagic = state.mods.magician && state.magicCounter[r][c] !== 0;
        if (r !== SIZE-1){
          const down = state.board[r+1][c];
          if (down){
            const downMagic = state.mods.magician && state.magicCounter[r+1][c] !== 0;
            if (!curMagic && !downMagic && cur.value === down.value) return false;
          }
        }
        if (c !== SIZE-1){
          const right = state.board[r][c+1];
          if (right){
            const rightMagic = state.mods.magician && state.magicCounter[r][c+1] !== 0;
            if (!curMagic && !rightMagic && cur.value === right.value) return false;
          }
        }
      }
    }
    return true;
  }

  // ---------- top level move ----------
  function handleMove(direction){
    if (state.gameOver) return;
    if (modalOverlay.classList.contains("show")) return;
    if (infoModalOverlay.classList.contains("show")) return;
    if (state.mods.lockout && state.lockedDir === direction) return;
    if (state.mods.drunk && state.lastMoveDir === direction) return;

    const before = cloneBoard(state.board);
    state.lastMerges = [];
    let mergeValues = moveAndMergeOnce(direction);

    if (state.mods.gravity){
      mergeValues = mergeValues.concat(moveAndMergeOnce(direction));
    }

    let justSpawned = [];

    const changed = !boardsEqual(before, state.board);

    if (changed){
      state.dirCounts[direction] = (state.dirCounts[direction] || 0) + 1;

      if (state.mods.magician){
        processMagic(mergeValues);
        
        // ONLY update the log if a merge actually happened this turn
        if (mergeValues.length > 0) {
          state.magicLog = [...mergeValues].sort((a, b) => b - a);
        }
        // If mergeValues.length is 0, we do NOTHING, 
        // leaving the old state.magicLog exactly as it was.
      }

      const chaosSwitchedToBlocked = state.chaosMode ? maybeChaosSwitch() : false;

      if (chaosSwitchedToBlocked){
        // Blocked just got dealt in by Chaos Mode: its obstacle tile takes
        // priority over the normal random spawn this move.
        const sB = randomSpawnBlock(direction);
        if (sB !== null) justSpawned.push(sB);
      } else {
        const s1 = state.mods.expert ? expertSpawn(direction) : randomSpawn(direction);
        if (s1 !== null) justSpawned.push(s1);
        if (state.mods.volatile){
          const s2 = state.mods.expert ? expertSpawn(direction) : randomSpawn(direction);
          if (s2 !== null) justSpawned.push(s2);
        }
      }
      state.spawnLocs = justSpawned;

      state.moveCount += 1;
      if (state.score > state.best){
        state.best = state.score;
        try { localStorage.setItem(getBestScoreKey(), String(state.best)); } catch(e) {}
      }

      processExtrovert();
      pickLockout();
      state.lastMoveDir = direction;
    }

    const wasGameOver = state.gameOver;
    if (isLost()){
      state.gameOver = true;
    }

    render();

    if (state.gameOver){
      if (!wasGameOver) triggerLossFlash();
    }

    saveGame();
  }

  // ---------- rendering ----------
  const cellGridEl = document.getElementById("cellGrid");
  const tilesLayerEl = document.getElementById("tilesLayer");
  const scoreValEl = document.getElementById("scoreVal");
  const bestValEl = document.getElementById("bestVal");
  const movesValEl = document.getElementById("movesVal");
  const overlayEl = document.getElementById("overlay");
  const overlayTitleEl = document.getElementById("overlayTitle");
  const overlaySubEl = document.getElementById("overlaySub");
  const activeModsRow = document.getElementById("activeModsRow");
  const modalOverlay = document.getElementById("modalOverlay");
  const infoModalOverlay = document.getElementById("infoModalOverlay");
  const magicLogEl = document.getElementById("magicLog");
  const magicLogListEl = document.getElementById("magicLogList");
  const extrovertLogEl = document.getElementById("extrovertLog");
  const extrovertLogListEl = document.getElementById("extrovertLogList");
  const overlayCloseBtn = document.getElementById("overlayClose");
  const confirmRestartOverlayEl = document.getElementById("confirmRestartOverlay");
  const confirmRestartCloseBtn = document.getElementById("confirmRestartClose");
  const confirmRestartCancelBtn = document.getElementById("confirmRestartCancel");
  const confirmRestartConfirmBtn = document.getElementById("confirmRestartConfirm");
  const boardWrapEl = document.getElementById("boardWrap");
  const lossFlashEl = document.getElementById("lossFlash");
  const lockoutGlowEls = {
    [DIR.LEFT]:  document.getElementById("lockoutGlowLeft"),
    [DIR.RIGHT]: document.getElementById("lockoutGlowRight"),
    [DIR.UP]:    document.getElementById("lockoutGlowUp"),
    [DIR.DOWN]:  document.getElementById("lockoutGlowDown"),
  };
  const drunkGlowEls = {
    [DIR.LEFT]:  document.getElementById("drunkGlowLeft"),
    [DIR.RIGHT]: document.getElementById("drunkGlowRight"),
    [DIR.UP]:    document.getElementById("drunkGlowUp"),
    [DIR.DOWN]:  document.getElementById("drunkGlowDown"),
  };
  const tapZoneEls = {
    [DIR.UP]:    document.getElementById("tapZoneUp"),
    [DIR.DOWN]:  document.getElementById("tapZoneDown"),
    [DIR.LEFT]:  document.getElementById("tapZoneLeft"),
    [DIR.RIGHT]: document.getElementById("tapZoneRight"),
  };

  // static empty cell backgrounds, built once
  for (let i=0;i<16;i++){
    const d = document.createElement("div");
    d.className = "cell-bg";
    cellGridEl.appendChild(d);
  }

  // persistent DOM tile elements keyed by tile id, so CSS transitions can
  // animate a tile moving between renders instead of it being torn down
  // and rebuilt from scratch every time.
  const tileEls = new Map();

  // ---------- magic tile TV-static animation ----------
  // Each magic tile gets its own <canvas> driving a noise effect (per-pixel
  // crossfade between random bytes), keyed by the tile's persistent DOM
  // element so it survives re-renders and only tears down when the tile
  // itself is removed from the board.
  const magicAnimators = new Map(); // el -> { raf }

  function stopMagicAnimation(el){
    const anim = magicAnimators.get(el);
    if (anim){
      cancelAnimationFrame(anim.raf);
      magicAnimators.delete(el);
    }
  }

  function stopAllMagicAnimations(){
    for (const el of Array.from(magicAnimators.keys())) stopMagicAnimation(el);
  }

  function startMagicAnimation(el, canvas){
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const n = w * h;

    const img = ctx.createImageData(w, h);
    const d = img.data;
    const bufA = new Uint8Array(n);
    const bufB = new Uint8Array(n);
    for (let i=0;i<n;i++){
      bufA[i] = Math.floor(Math.random()*256);
      bufB[i] = Math.floor(Math.random()*256);
    }

    const progress = new Float32Array(n);
    const speeds = new Float32Array(n);
    for (let i=0;i<n;i++){
      progress[i] = Math.random();
      speeds[i] = 0.5 + Math.random()*0.5;
    }

    const anim = { raf: null };
    magicAnimators.set(el, anim);

    function frame(){
      for (let i=0;i<n;i++){
        progress[i] += 0.02 * speeds[i];
        if (progress[i] >= 1){
          bufA[i] = bufB[i];
          bufB[i] = Math.floor(Math.random()*256);
          progress[i] -= 1;
        }
        const v = (bufA[i] + (bufB[i]-bufA[i]) * progress[i]) / 255;
        const r = (v*100 + 20) | 0;
        const g = (v*10) | 0;
        const b = (v*120 + 50) | 0;
        const p = i*4;
        d[p]=r; d[p+1]=g; d[p+2]=b; d[p+3]=255;
      }
      ctx.putImageData(img, 0, 0);
      if (magicAnimators.has(el)) anim.raf = requestAnimationFrame(frame);
    }
    anim.raf = requestAnimationFrame(frame);
  }

  // Dynamic font sizing: scales down as the display text gets longer, so a
  // custom-themed tile with a word or emoji label (instead of a plain
  // number) still fits and stays readable, without needing preset classes
  // tied to digit counts.
  function computeTileFontSize(text){
    const len = String(text).length;
    if (len <= 2) return "clamp(18px, 6.7vw, 50px)";
    if (len === 3) return "clamp(16px, 5.9vw, 44px)";
    if (len === 4) return "clamp(12px, 4.5vw, 34px)";
    if (len === 5) return "clamp(11px, 4vw, 30px)";
    if (len === 6) return "clamp(9px, 3.2vw, 24px)";
    const scale = Math.max(0.28, 6 / len);
    const minPx = Math.max(7, Math.round(9 * scale));
    const vw = Math.max(1.8, 3.2 * scale).toFixed(2);
    const maxPx = Math.max(12, Math.round(24 * scale));
    return `clamp(${minPx}px, ${vw}vw, ${maxPx}px)`;
  }

  function styleTileContent(el, cellData, isMagic, magicVal){
    el.classList.remove("block", "magic");
    el.style.background = "";
    el.style.color = "";
    el.style.boxShadow = "";
    el.style.textShadow = "";
    el.style.outline = "";

    // 1. Ensure the container centers content
    el.style.display = "flex";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
    el.style.padding = "10px";
    el.style.boxSizing = "border-box"; // Keeps the padding inside the tile
    el.style.textAlign = "center";
    el.style.wordBreak = "break-word"; // Ensures long text wraps correctly

    el.style.lineHeight = "1.2";

    // 2. Define the text logic (skipped for magic tiles: their content is
    // a canvas + counter label, not plain text, and is built/updated in
    // the isMagic branch below. Writing plain text here first would wipe
    // out that canvas/label on every re-render, since el.textContent
    // clears all child nodes -- including ones already correctly built.)
    if (!isMagic){
      const text = String(cellData.value);
      el.textContent = text;

      // 3. Define font size calculation
      // Base size logic: scale down if the text is long,
      // but use Math.max(20, ...) to enforce the minimum.
      const baseSize = Math.max(45 - text.length * 2, 20);
      el.style.fontSize = Math.max(20, baseSize) + "px";
    }

    if (isMagic){
      el.classList.add("magic");
      if (!el._magicCanvas){
        el.innerHTML = "";
        const canvas = document.createElement("canvas");
        canvas.width = 50;
        canvas.height = 50;
        el.appendChild(canvas);
        const label = document.createElement("span");
        label.className = "magic-label";
        el.appendChild(label);
        el._magicCanvas = canvas;
        el._magicLabel = label;
        startMagicAnimation(el, canvas);
      }
      el._magicLabel.textContent = String(magicVal);
      return;
    }

    if (el._magicCanvas){
      stopMagicAnimation(el);
      el._magicCanvas = null;
      el._magicLabel = null;
      el.innerHTML = "";
    }

    if (cellData.value === 1){
      el.classList.add("block");
      el.textContent = "VERY ANNOYING BLOCK!";
      // The generic font-size calculation above (based on the 1-character
      // string "1") set an inline font-size that would override the small
      // clamp() defined for .tile.block in CSS. Clear it so the CSS rule
      // (sized to actually fit "VERY ANNOYING BLOCK!" inside the tile) applies.
      el.style.fontSize = "";
    } else {
      const idx = cellData.value >= 131072 ? MAX_TILE_IDX : Math.log2(cellData.value);
      const tileValue = TILE_KEYS[idx - 1];
      const displayText = (currentTileText[tileValue]) || String(cellData.value);
      el.style.background = TILE_BG[idx];
      el.style.color = TILE_FG[idx];
      el.style.boxShadow = `inset 0 0 0 2px ${TILE_OUTLINE[idx]}, 0 0 14px 3px ${TILE_SHADOW[idx]}`;
      el.style.fontSize = computeTileFontSize(displayText);
      el.textContent = displayText;
    }
  }

  // Timing for the slide/merge sequence. Tiles slide into place first;
  // only once they've arrived does a merge "pop" (or a consumed tile's
  // fade) play, so merges read as two tiles landing on top of each other
  // before resolving into the new value -- rather than everything
  // happening simultaneously.
  const SLIDE_MS = 150;
  const POP_MS = 120;
  const FADE_MS = 100;

  function renderTiles(animate){
    const total = tilesLayerEl.clientWidth || tilesLayerEl.offsetWidth || 0;
    const cell = Math.max(0, (total - GAP*(SIZE-1)) / SIZE);

    const showAll = !state.mods.invisible || state.moveCount === 0 || state.gameOver;
    const visibleSet = new Set(state.spawnLocs);
    const newIds = new Set();

    // Where each surviving tile is headed this render, keyed by id. Consumed
    // (merged-away) tiles use this to find their survivor's landing spot so
    // they can slide there too, instead of just fading out where they stood.
    const targetPos = new Map();
    const consumedToSurvivor = new Map();
    for (const m of state.lastMerges) consumedToSurvivor.set(m.consumedId, m.survivorId);

    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const cellData = state.board[r][c];
        if (!cellData) continue;

        const loc = r*SIZE + c;
        const isMagic = state.mods.magician && state.magicCounter[r][c] !== 0;
        const magicVal = state.magicCounter[r][c];

        // Tiles hidden by the Invisible mod are simply not rendered at all,
        // so they are pixel-for-pixel identical to an empty cell behind them.
        // Magic blocks are always shown even under Invisible, since they're
        // a standing hazard the player needs to track, not something new
        // to memorize each move.
        if (!showAll && !isMagic && !visibleSet.has(loc)) continue;

        const x = c*(cell+GAP), y = r*(cell+GAP);
        targetPos.set(cellData.id, {x, y});

        let el = tileEls.get(cellData.id);
        const isNew = !el;
        if (isNew){
          el = document.createElement("div");
          el.className = "tile";
          tilesLayerEl.appendChild(el);
          tileEls.set(cellData.id, el);
        }

        // A tile can get re-rendered (moved/merged again) before a previous
        // render's delayed pulse-reset timeout has fired. If that stale
        // timeout is left pending, it will later stomp this tile's transform
        // back to an old position, visually overlapping whatever now
        // occupies that cell. Cancel it every time the tile is touched.
        if (el._pulseTimeout){
          clearTimeout(el._pulseTimeout);
          el._pulseTimeout = null;
        }

        el.style.width = cell + "px";
        el.style.height = cell + "px";

        el.style.display = "flex";
        el.style.alignItems = "center";
        el.style.justifyContent = "center";
        el.style.padding = "10px";
        el.style.boxSizing = "border-box";
        el.style.textAlign = "center";

        styleTileContent(el, cellData, isMagic, magicVal);

        if (isNew){
          el.style.transition = "none";
          el.style.transform = `translate(${x}px, ${y}px) scale(${animate ? 0.3 : 1})`;
          el.style.opacity = animate ? "0" : "1";
          void el.offsetWidth; // force reflow so the "from" state is committed
          el.style.transition = animate ? "transform .16s ease-out, opacity .16s ease-out" : "none";
          el.style.transform = `translate(${x}px, ${y}px) scale(1)`;
          el.style.opacity = "1";
        } else {
          const prevValue = Number(el.dataset.value);
          const valueChanged = !Number.isNaN(prevValue) && prevValue !== cellData.value;
          el.style.zIndex = valueChanged ? "2" : "1";
          el.style.opacity = "1";
          if (valueChanged && animate){
            // Slide to the merged cell first, at the same speed as every
            // other tile, staying at scale 1 so it looks like it's simply
            // arriving. Only once it lands does the new, doubled tile pop.
            el.style.transition = `transform ${SLIDE_MS}ms ease`;
            el.style.transform = `translate(${x}px, ${y}px) scale(1)`;
            el._pulseTimeout = setTimeout(() => {
              el.style.transition = `transform ${POP_MS}ms ease`;
              el.style.transform = `translate(${x}px, ${y}px) scale(1.18)`;
              el._pulseTimeout = setTimeout(() => {
                el.style.transform = `translate(${x}px, ${y}px) scale(1)`;
                el._pulseTimeout = null;
              }, POP_MS);
            }, SLIDE_MS);
          } else {
            el.style.transition = animate ? `transform ${SLIDE_MS}ms ease` : "none";
            el.style.transform = `translate(${x}px, ${y}px) scale(1)`;
          }
        }

        el.dataset.value = String(cellData.value);
        newIds.add(cellData.id);
      }
    }

    // remove tiles that no longer exist (consumed by a merge, or now hidden)
    for (const [id, el] of Array.from(tileEls.entries())){
      if (newIds.has(id)) continue;
      tileEls.delete(id);
      stopMagicAnimation(el);
      if (el._pulseTimeout){
        clearTimeout(el._pulseTimeout);
        el._pulseTimeout = null;
      }
      const survivorId = consumedToSurvivor.get(id);
      const target = survivorId !== undefined ? targetPos.get(survivorId) : null;

      if (animate && target){
        // This tile was merged away: slide it on top of the tile it merged
        // into (same timing as a normal move), then let it disappear right
        // as the survivor pops, so the two visually collapse into one.
        el.style.zIndex = "1";
        el.style.transition = `transform ${SLIDE_MS}ms ease`;
        el.style.transform = `translate(${target.x}px, ${target.y}px) scale(1)`;
        setTimeout(() => {
          el.style.transition = `opacity ${FADE_MS}ms ease`;
          el.style.opacity = "0";
          setTimeout(() => el.remove(), FADE_MS);
        }, SLIDE_MS);
      } else if (animate){
        const curTransform = el.style.transform || "";
        el.style.transition = "opacity .15s ease, transform .15s ease";
        el.style.opacity = "0";
        el.style.transform = curTransform.replace(/scale\([^)]*\)/, "").trim() + " scale(0.6)";
        setTimeout(() => el.remove(), 160);
      } else {
        el.remove();
      }
    }
  }

  function render(){
    scoreValEl.textContent = state.score;
    bestValEl.textContent = state.best;
    movesValEl.textContent = state.moveCount;

    renderTiles(state.animationsEnabled);
    renderModChips();
    renderMagicLog();
    renderExtrovertLog();
    renderDirGlows();
  }

  // Renders both the Lockout (red) and Drunk (blue) directional glows.
  // They're independent overlays on the same four edges, so if a single
  // direction happens to be disabled by both mods at once, the two
  // semi-transparent gradients simply sit on top of each other -- no
  // special-casing needed, their colors blend automatically wherever
  // they overlap.
  function renderDirGlows(){
    // Duration is a CSS custom property so it can snap to 0 when
    // animations are disabled, matching the rest of the game's instant mode.
    boardWrapEl.style.setProperty(
      "--lockout-fade",
      state.animationsEnabled ? ".25s" : "0s"
    );
    boardWrapEl.style.setProperty(
      "--drunk-fade",
      state.animationsEnabled ? ".25s" : "0s"
    );

    const lockedDir = (state.mods.lockout && state.lockedDir !== null) ? state.lockedDir : null;
    const drunkDir = (state.mods.drunk && state.lastMoveDir !== null) ? state.lastMoveDir : null;

    for (const dir in lockoutGlowEls){
      // Object keys from a computed-key literal are strings, so compare loosely.
      lockoutGlowEls[dir].classList.toggle("active", lockedDir !== null && Number(dir) === lockedDir);
      drunkGlowEls[dir].classList.toggle("active", drunkDir !== null && Number(dir) === drunkDir);
    }
  }

  // ---------- expected score ----------
  // a(x) = 0                                                     for x = 0
  // a(x) = ((log2(x)-1)*x)^0.9 + ((log2(x)-2)*x)^0.1              for x > 0
  // Fractional powers of a negative base are undefined over the reals, so
  // the sign is pulled out and applied afterward (sign(v) * |v|^p) rather
  // than letting Math.pow silently return NaN.
  function signedPow(v, p){
    if (v === 0) return 0;
    return Math.sign(v) * Math.pow(Math.abs(v), p);
  }

  function expectedTileScore(x) {
      if (!x || x <= 0) return 0;
      const L = Math.log2(x);
      return ((L - 1) * x * 0.9) + ((L - 2) * x * 0.1);
  }

  // Sums a(x) over every real numbered tile on the board. Sentinel tiles
  // (Blocked's obstacle, value 1, and Magician's TV-static block, value -1)
  // aren't real 2048 tiles, so they're skipped rather than fed into a(x).
  function boardExpectedScore(){
    let total = 0;
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const cell = state.board[r][c];
        if (!cell) continue;
        if (cell.value === 1 || cell.value === -1) continue;
        total += expectedTileScore(cell.value);
      }
    }
    return total;
  }

  // ---------- info modal ----------
  const infoBtn = document.getElementById("infoBtn");
  const infoModalClose = document.getElementById("infoModalClose");
  const miniBoardEl = document.getElementById("miniBoard");
  const statGridSpawnsEl = document.getElementById("statGridSpawns");
  const statGridDirsEl = document.getElementById("statGridDirs");
  const statGridScoreEl = document.getElementById("statGridScore");

  function statRow(label, value){
    return `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
  }

  function pct(n, d){
    if (!d) return "0%";
    return (n / d * 100).toFixed(1) + "%";
  }

  function renderMiniBoard() {
    let html = "";
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = state.board[r][c];
        const isMagic = state.mods.magician && state.magicCounter[r][c] !== 0;

        // 1. Always show magic sentinel tiles
        if (isMagic) {
          html += `<div class="mini-cell mini-magic">${state.magicCounter[r][c]}</div>`;
          continue;
        }

        // 2. Check for Invisible mod:
        // If invisible is active, only show the cell if it is in spawnLocs.
        // spawnLocs stores flat indices (r*SIZE+c), matching how the main
        // board's renderTiles() tracks them - NOT [r,c] pairs.
        const isNewlySpawned = state.spawnLocs.includes(r * SIZE + c);
        if (state.mods.invisible && !isNewlySpawned && !state.gameOver  ) {
          html += `<div class="mini-cell"></div>`;
          continue;
        }

        // 3. Render standard tiles or empty cells
        if (!cell || cell.value <= 0) {
          html += `<div class="mini-cell"></div>`;
        } else if (cell.value === 1) {
          html += `<div class="mini-cell mini-block">&#9632;</div>`;
        } else {
          const idx = cell.value >= 131072 ? MAX_TILE_IDX : Math.log2(cell.value);
          const bg = TILE_BG[idx] || "var(--bg0)";
          const fg = TILE_FG[idx] || "var(--fg2)";
          html += `<div class="mini-cell" style="background:${bg}; color:${fg};">${cell.value}</div>`;
        }
      }
    }
    miniBoardEl.innerHTML = html;
  }

  function renderInfoModal(){
    renderMiniBoard();

    // ---- moves ----
    const dc = state.dirCounts;
    const totalDirs = (dc[DIR.UP]||0) + (dc[DIR.DOWN]||0) + (dc[DIR.LEFT]||0) + (dc[DIR.RIGHT]||0);
    statGridDirsEl.innerHTML =
      statRow("Up", `${dc[DIR.UP]||0} (${pct(dc[DIR.UP]||0, totalDirs)})`) +
      statRow("Down", `${dc[DIR.DOWN]||0} (${pct(dc[DIR.DOWN]||0, totalDirs)})`) +
      statRow("Left", `${dc[DIR.LEFT]||0} (${pct(dc[DIR.LEFT]||0, totalDirs)})`) +
      statRow("Right", `${dc[DIR.RIGHT]||0} (${pct(dc[DIR.RIGHT]||0, totalDirs)})`) +
      statRow("Total moves", totalDirs);

    // ---- spawns ----
    const twos = state.spawnStats.twos, fours = state.spawnStats.fours, eights = state.spawnStats.eights || 0;
    const totalSpawns = twos + fours + eights;
    let fourRateLabel, eightRateLabel;
    if (state.mods.expert){
      fourRateLabel = "Adversarial (variable)";
      eightRateLabel = state.mods.greed ? "Adversarial (variable)" : null;
    } else {
      const probs = currentSpawnProbs();
      const idx4 = probs.values.indexOf(4), idx8 = probs.values.indexOf(8);
      fourRateLabel = (probs.probs[idx4]*100).toFixed(1).replace(/\.0$/, "") + "%";
      eightRateLabel = idx8 === -1 ? null : (probs.probs[idx8]*100).toFixed(1).replace(/\.0$/, "") + "%";
    }

    statGridSpawnsEl.innerHTML =
      statRow("2 spawns", twos) +
      statRow("4 spawns", fours) +
      (state.mods.greed ? statRow("8 spawns", eights) : "") +
      statRow("Total spawns", totalSpawns) +
      statRow("Current 4 spawn rate", fourRateLabel) +
      statRow("Observed 4 spawn rate", pct(fours, totalSpawns)) +
      (eightRateLabel !== null ? statRow("Current 8 spawn rate", eightRateLabel) : "") +
      (state.mods.greed ? statRow("Observed 8 spawn rate", pct(eights, totalSpawns)) : "");

    // ---- expected score ----
    const expected = boardExpectedScore();
    const diff = state.score - expected;
    const ratio = expected !== 0 ? pct(state.score, expected) : "N/A";
    statGridScoreEl.innerHTML =
      statRow("Current score", state.score) +
      statRow("Expected score", expected.toFixed(2)) +
      statRow("Difference", diff.toFixed(2)) +
      statRow("Ratio", ratio);
  }

  function openInfoModal(){
    renderInfoModal();
    infoModalOverlay.classList.add("show");
  }
  function closeInfoModal(){ infoModalOverlay.classList.remove("show"); }

  infoBtn.addEventListener("click", openInfoModal);
  infoModalClose.addEventListener("click", closeInfoModal);
  infoModalOverlay.addEventListener("click", (e) => {
    if (e.target === infoModalOverlay) closeInfoModal();
  });

  // Shows every currently-tracked biggest tile, its cell, and how many more
  // moves it can sit still before Extrovert teleports it home. Visible
  // whenever tracking is actually happening (mod on, or passively during
  // Chaos Mode), same condition processExtrovert() uses.
  function renderExtrovertLog(){
    const active = extrovertIsActive();
    extrovertLogEl.classList.toggle("show", active);
    if (!active) return;

    const entries = Object.values(state.extrovertTracker);
    if (entries.length === 0){
      extrovertLogListEl.innerHTML = `<p class="log-empty">Tracking the largest tile&hellip;</p>`;
      return;
    }

    // Inside renderExtrovertLog function
    extrovertLogListEl.innerHTML = entries
      .sort((a, b) => b.streak - a.streak)
      .map(entry => {
        const remaining = Math.max(0, EXTROVERT_STREAK_NEEDED - entry.streak);
        const rowLabel = entry.row + 1, colLabel = entry.col + 1;
        const countText = remaining === 0 ? "next move!" : `${remaining} move${remaining === 1 ? "" : "s"}`;
        
        // Add logic to get the correct colors based on the tile value
        const idx = entry.value >= 131072 ? MAX_TILE_IDX : Math.log2(entry.value);
        const style = `background: ${TILE_BG[idx]}; color: ${TILE_FG[idx]};`;

        return `<div class="extrovert-item" style="${style}">
                  <span class="ext-value">${entry.value}</span>
                  <span class="ext-loc">R${rowLabel}C${colLabel}</span>
                  <span class="ext-count">${countText}</span>
                </div>`;
      })
      .join("");
  }

  function renderMagicLog(){
    magicLogEl.classList.toggle("show", !!state.mods.magician);
    if (!state.mods.magician) return;

    if (state.magicLog.length === 0){
      magicLogListEl.innerHTML = `<p class="log-empty">No merges yet.</p>`;
      return;
    }

    // Map through all merge values from the turn and style them like tiles
    magicLogListEl.innerHTML = state.magicLog
    .sort((a, b) => b - a)
      .map(val => {
        // Because 'val' is now the input (e.g., 4), 
        // this index will point to the '4' tile's color/style
        const idx = val >= 131072 ? MAX_TILE_IDX : Math.log2(val);
        return `<span class="log-item" style="background: ${TILE_BG[idx]}; color: ${TILE_FG[idx]};">
                  ${val}
                </span>`;
      })
      .join("");
  }

  function renderModChips(){
    activeModsRow.innerHTML = "";
    if (state.chaosMode){
      const chaosChip = document.createElement("span");
      chaosChip.className = "mod-chip chaos-chip";
      chaosChip.textContent = "Chaos Mode";
      activeModsRow.appendChild(chaosChip);
    }
    MODS.forEach(m => {
      if (!state.mods[m.key]) return;
      const chip = document.createElement("span");
      chip.className = "mod-chip";
      chip.style.background = m.accent;
      chip.textContent = m.name;
      activeModsRow.appendChild(chip);
    });
  }

  function showOverlay(){
    overlayTitleEl.textContent = "Game Over";
    overlaySubEl.textContent = state.score > 0
      ? `No more moves left. Final score: ${state.score}.`
      : "No more moves left on the board.";
    overlayEl.classList.add("show");
  }
  function hideOverlay(){ overlayEl.classList.remove("show"); }

  // Restarting wipes the current board and score, so when the "Confirm
  // Restart" setting is on we show a small confirmation dialog first
  // rather than restarting immediately. This guards against accidental
  // taps on New Game / R while a game is actually in progress.
  function showConfirmRestartOverlay(){ confirmRestartOverlayEl.classList.add("show"); }
  function hideConfirmRestartOverlay(){ confirmRestartOverlayEl.classList.remove("show"); }

  function requestNewGame(){
    if (state.confirmRestartEnabled && !state.gameOver && (state.score > 0 || state.moveCount > 0)){
      showConfirmRestartOverlay();
      return;
    }
    newGame();
  }

  confirmRestartConfirmBtn.addEventListener("click", () => {
    hideConfirmRestartOverlay();
    newGame();
  });
  confirmRestartCancelBtn.addEventListener("click", hideConfirmRestartOverlay);
  confirmRestartCloseBtn.addEventListener("click", hideConfirmRestartOverlay);
  confirmRestartOverlayEl.addEventListener("click", (e) => {
    if (e.target === confirmRestartOverlayEl) hideConfirmRestartOverlay();
  });

  function triggerLossFlash(){
    // Restart the animation even if a previous pulse is still fading out.
    lossFlashEl.classList.remove("pulse");
    void lossFlashEl.offsetWidth; // force reflow
    lossFlashEl.classList.add("pulse");
  }

  // reposition tiles (no animation) if the layout size changes
  window.addEventListener("resize", () => renderTiles(false));

  // ---------- input ----------
  const KEY_DIR = {
    ArrowLeft: DIR.LEFT,
    ArrowRight: DIR.RIGHT,
    ArrowUp: DIR.UP,
    ArrowDown: DIR.DOWN,

    a: DIR.LEFT, A: DIR.LEFT,
    d: DIR.RIGHT, D: DIR.RIGHT,
    w: DIR.UP, W: DIR.UP,
    s: DIR.DOWN, S: DIR.DOWN,

    h: DIR.LEFT, H: DIR.LEFT,
    j: DIR.DOWN, J: DIR.DOWN,
    k: DIR.UP, K: DIR.UP,
    l: DIR.RIGHT, L: DIR.RIGHT,

    Numpad4: DIR.LEFT,
    Numpad6: DIR.RIGHT,
    Numpad8: DIR.UP,
    Numpad2: DIR.DOWN,
  };

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === "Escape" && modalOverlay.classList.contains("show")){
      closeModal();
      return;
    }
    if (e.key === "Escape" && infoModalOverlay.classList.contains("show")){
      closeInfoModal();
      return;
    }
    if (e.key in KEY_DIR){
      e.preventDefault();
      handleMove(KEY_DIR[e.key]);
    }
  });

  const boardWrap = document.getElementById("boardWrap");
  let touchStartX = 0, touchStartY = 0, touching = false;

  boardWrap.addEventListener("touchstart", (e) => {
    if (state.tapControlsEnabled) return;
    touching = true;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, {passive:true});

  boardWrap.addEventListener("touchend", (e) => {
    if (state.tapControlsEnabled) return;
    if (!touching) return;
    touching = false;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const absX = Math.abs(dx), absY = Math.abs(dy);
    if (Math.max(absX, absY) < 24) return;
    if (absX > absY){
      handleMove(dx > 0 ? DIR.RIGHT : DIR.LEFT);
    } else {
      handleMove(dy > 0 ? DIR.DOWN : DIR.UP);
    }
  }, {passive:true});

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalOverlay.classList.contains("show")){
      closeModal();
      return;
    }

    if (e.key === "Escape" && confirmRestartOverlayEl.classList.contains("show")){
      hideConfirmRestartOverlay();
      return;
    }
  
    // Add this block to handle 'R' for restart
    if (e.key === "r" || e.key === "R") {
      if (e.target.tagName === 'INPUT') return  
      requestNewGame();
      return;
    }
  });

  document.getElementById("newGameBtn").addEventListener("click", requestNewGame);
  document.getElementById("overlayRestart").addEventListener("click", newGame);
  overlayCloseBtn.addEventListener("click", hideOverlay);
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) hideOverlay();
  });
  document.getElementById("resetModsBtn").addEventListener("click", () => {
    state.chaosMode = false;
    state.chaosActiveMod = null;
    MODS.forEach(m => state.mods[m.key] = false);
    syncModCards();
    loadBestScore();
    newGame();
  });

  // ---------- settings modal ----------
  const settingsBtn = document.getElementById("settingsBtn");
  const modalClose = document.getElementById("modalClose");

  function openModal(){
    modalOverlay.classList.add("show");
    chaosKeyBuffer = "";
    syncModCards();
  }
  function closeModal(){ modalOverlay.classList.remove("show"); }

  settingsBtn.addEventListener("click", openModal);
  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // ---------- chaos mode cheat code ----------
  // While the Mods tab of the menu is open, typing the letters "chaos" in
  // sequence toggles Chaos Mode on/off, cheat-code style.
  let chaosKeyBuffer = "";

  function isModsTabOpen(){
    const modsPanel = document.querySelector('.tab-panel[data-panel="mods"]');
    return modalOverlay.classList.contains("show") && modsPanel && !modsPanel.hidden;
  }

  window.addEventListener("keydown", (e) => {
    if (!isModsTabOpen()){
      chaosKeyBuffer = "";
      return;
    }
    if (e.key.length === 1 && /[a-z]/i.test(e.key)){
      chaosKeyBuffer = (chaosKeyBuffer + e.key.toLowerCase()).slice(-5);
      if (chaosKeyBuffer === "chaos"){
        chaosKeyBuffer = "";
        setChaosMode(!state.chaosMode);
      }
    } else {
      chaosKeyBuffer = "";
    }
  });

  // ---------- chaos mode title tap toggle ----------
  // Tapping/clicking the "2048" title 5 times within 2 seconds toggles
  // Chaos Mode, same effect as the "chaos" keyboard cheat code above.
  // Uses a plain "click" listener (fires for touch taps and mouse clicks
  // alike) rather than the Pointer Events API.
  const titleH1 = document.getElementById("titleH1");
  let titleTapCount = 0;
  let titleTapResetTimer = null;

  titleH1.addEventListener("click", () => {
    titleTapCount += 1;

    clearTimeout(titleTapResetTimer);
    titleTapResetTimer = setTimeout(() => {
      titleTapCount = 0;
    }, 2000);

    if (titleTapCount >= 5){
      titleTapCount = 0;
      clearTimeout(titleTapResetTimer);
      setChaosMode(!state.chaosMode);
    }
  });

  // ---------- modal tabs (Mods / Settings) ----------
  const modalTabsEl = document.getElementById("modalTabs");
  const tabPanels = document.querySelectorAll(".tab-panel");

  modalTabsEl.querySelectorAll(".modal-tab-btn").forEach(tabBtn => {
    tabBtn.addEventListener("click", () => {
      const target = tabBtn.dataset.tab;
      modalTabsEl.querySelectorAll(".modal-tab-btn").forEach(b => {
        b.classList.toggle("active", b === tabBtn);
      });
      tabPanels.forEach(panel => {
        panel.hidden = panel.dataset.panel !== target;
      });
    });
  });

  // ---------- animation setting ----------
  const animSegment = document.getElementById("animSegment");

  function syncAnimButtons(){
    animSegment.querySelectorAll(".seg-btn").forEach(btn => {
      const isOn = btn.dataset.val === "on";
      btn.classList.toggle("active", isOn === state.animationsEnabled);
    });
  }

  animSegment.querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.animationsEnabled = btn.dataset.val === "on";
      syncAnimButtons();
      try { localStorage.setItem("2048modlab_anim", btn.dataset.val); } catch(e) {}
    });
  });

  // ---------- theme setting ----------
  const themeSegment = document.getElementById("themeSegment");

  function syncThemeButtons(){
    themeSegment.querySelectorAll(".seg-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.val === state.theme);
    });
  }

  themeSegment.querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.theme = btn.dataset.val;
      syncThemeButtons();
      applyTheme();
      try { localStorage.setItem("2048modlab_theme", state.theme); } catch(e) {}
    });
  });

  // ---------- theme tab: custom .vth tile theme upload, editing + preview ----------
  const vthFileInput = document.getElementById("vthFileInput");
  const resetThemeBtn = document.getElementById("resetThemeBtn");
  const exportThemeBtn = document.getElementById("exportThemeBtn");
  const themeStatusEl = document.getElementById("themeStatus");
  const themeSwatchLightEl = document.getElementById("themeSwatchLight");
  const themeSwatchDarkEl = document.getElementById("themeSwatchDark");
  const themeEditorEl = document.getElementById("themeEditor");
  const themeEditorTitleEl = document.getElementById("themeEditorTitle");
  const editTileText = document.getElementById("editTileText");
  const editTileBg = document.getElementById("editTileBg");
  const editTileFg = document.getElementById("editTileFg");
  const editTileShadow = document.getElementById("editTileShadow");
  const editTileOutline = document.getElementById("editTileOutline");
  const editClearBtn = document.getElementById("editClearBtn");
  const editCancelBtn = document.getElementById("editCancelBtn");

  let editingCell = null; // { mode, value } while the editor panel is open

  // Preview swatches are much smaller than real board tiles, and their
  // container is tiny relative to the viewport, so vw units (used for real
  // tiles) would all collapse to roughly the same size here. Container
  // query units (cqi = 1% of the swatch's own width) instead reproduce the
  // same shrink-as-text-grows shape as computeTileFontSize, just scaled
  // down to fit a swatch about a sixth the size of a real tile.
  function computeSwatchFontSize(text){
    const len = String(text).length;
    if (len <= 2) return "clamp(8px, 42cqi, 16px)";
    if (len === 3) return "clamp(7px, 36cqi, 14px)";
    if (len === 4) return "clamp(6px, 28cqi, 12px)";
    if (len === 5) return "clamp(6px, 24cqi, 11px)";
    if (len === 6) return "clamp(5px, 20cqi, 10px)";
    const scale = Math.max(0.3, 6 / len);
    const minPx = Math.max(4, Math.round(5 * scale));
    const cqi = Math.max(8, 20 * scale).toFixed(2);
    const maxPx = Math.max(6, Math.round(9 * scale));
    return `clamp(${minPx}px, ${cqi}cqi, ${maxPx}px)`;
  }

  function renderThemeSwatchRow(container, mode){
    const eff = getEffectiveTheme(mode);
    container.innerHTML = "";
    TILE_KEYS.forEach(v => {
      const t = eff[v];
      const sw = document.createElement("div");
      sw.className = "theme-swatch";
      sw.style.background = t.bg;
      sw.style.color = t.fg;
      sw.style.boxShadow = `inset 0 0 0 1px rgba(255,255,255,0.20), inset 0 0 0 2px ${t.outline}, 0 0 8px 2px ${t.shadow}`;
      sw.style.fontSize = computeSwatchFontSize(t.text);
      sw.textContent = t.text;
      sw.title = `Click to customize ${v} (${mode} mode)`;
      sw.addEventListener("click", () => openCellEditor(mode, v));
      container.appendChild(sw);
    });
  }

  function renderThemePreview(){
    renderThemeSwatchRow(themeSwatchLightEl, "light");
    renderThemeSwatchRow(themeSwatchDarkEl, "dark");
  }

  function setThemeStatus(text, isError){
    themeStatusEl.textContent = text;
    themeStatusEl.classList.toggle("error", !!isError);
  }

  function openCellEditor(mode, value){
    editingCell = { mode, value };
    const eff = getEffectiveTheme(mode)[value];
    themeEditorTitleEl.textContent = `Editing ${value} — ${mode === "light" ? "Light" : "Dark"} mode`;
    editTileText.value = eff.text;
    editTileBg.value = eff.bg;
    editTileFg.value = eff.fg;
    editTileShadow.value = eff.shadow;
    editTileOutline.value = eff.outline;
    themeEditorEl.hidden = false;
    themeEditorEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeCellEditor(){
    editingCell = null;
    themeEditorEl.hidden = true;
  }

  // Reads whatever's currently in the editor fields and commits it straight
  // to the custom theme — called on every keystroke/change so edits are
  // saved continuously as the person types, with no separate "Save" step.
  function commitEditorValues(){
    if (!editingCell) return;
    const { mode, value } = editingCell;
    if (!state.customTheme) state.customTheme = {};
    if (!state.customTheme[mode]) state.customTheme[mode] = {};
    state.customTheme[mode][value] = {
      text: editTileText.value.trim() || String(value),
      bg: editTileBg.value.trim() || null,
      fg: editTileFg.value.trim() || null,
      shadow: editTileShadow.value.trim() || null,
      outline: editTileOutline.value.trim() || null
    };
    saveCustomTheme();
    applyThemeVars();
    renderThemePreview();
    setThemeStatus(`Customized tile ${value} (${mode} mode) — saved.`);
  }

  [editTileText, editTileBg, editTileFg, editTileShadow, editTileOutline].forEach(input => {
    input.addEventListener("input", commitEditorValues);
  });

  editClearBtn.addEventListener("click", () => {
    if (!editingCell) return;
    const { mode, value } = editingCell;
    if (state.customTheme && state.customTheme[mode]){
      delete state.customTheme[mode][value];
      if (!Object.keys(state.customTheme[mode]).length) delete state.customTheme[mode];
      if (!Object.keys(state.customTheme).length) state.customTheme = null;
    }
    saveCustomTheme();
    applyThemeVars();
    renderThemePreview();
    setThemeStatus(`Reverted tile ${value} (${mode} mode) to default.`);
    closeCellEditor();
  });

  // Changes are already saved live as you type, so this button just closes
  // the panel — there's nothing left to discard.
  editCancelBtn.addEventListener("click", closeCellEditor);

  renderThemePreview();

  vthFileInput.addEventListener("change", () => {
    const file = vthFileInput.files && vthFileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch(e) {
        setThemeStatus("Couldn't read that file — make sure it's a valid .vth/JSON theme.", true);
        vthFileInput.value = "";
        return;
      }

      const internal = vthToInternal(parsed);
      if (!internal){
        setThemeStatus("That file didn't have any recognizable tile colors in it.", true);
        vthFileInput.value = "";
        return;
      }

      state.customTheme = internal;
      saveCustomTheme();
      applyThemeVars();
      renderThemePreview();
      closeCellEditor();
      setThemeStatus(`Loaded custom theme: ${file.name}`);
      vthFileInput.value = "";
    };
    reader.onerror = () => {
      setThemeStatus("Couldn't read that file.", true);
      vthFileInput.value = "";
    };
    reader.readAsText(file);
  });

  resetThemeBtn.addEventListener("click", () => {
    state.customTheme = null;
    saveCustomTheme();
    applyThemeVars();
    renderThemePreview();
    closeCellEditor();
    setThemeStatus("Using default theme.");
  });

  exportThemeBtn.addEventListener("click", () => {
    const vth = internalToVth();
    const blob = new Blob([JSON.stringify(vth, null, 4)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-2048-theme.vth";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setThemeStatus("Exported current theme to my-2048-theme.vth.");
  });

  if (state.customTheme) setThemeStatus("Using a loaded custom theme.");

  // ---------- touch controls setting ----------
  const tapControlsSegment = document.getElementById("tapControlsSegment");

  function syncTapControlsButtons(){
    tapControlsSegment.querySelectorAll(".seg-btn").forEach(btn => {
      const isOn = btn.dataset.val === "on";
      btn.classList.toggle("active", isOn === state.tapControlsEnabled);
    });
  }

  function syncTapZones(){
    for (const dir in tapZoneEls){
      tapZoneEls[dir].classList.toggle("enabled", state.tapControlsEnabled);
    }
  }

  tapControlsSegment.querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.tapControlsEnabled = btn.dataset.val === "on";
      syncTapControlsButtons();
      syncTapZones();
      try { localStorage.setItem("2048modlab_tapcontrols", btn.dataset.val); } catch(e) {}
    });
  });

  // ---------- confirm restart setting ----------
  const confirmRestartSegment = document.getElementById("confirmRestartSegment");

  function syncConfirmRestartButtons(){
    confirmRestartSegment.querySelectorAll(".seg-btn").forEach(btn => {
      const isOn = btn.dataset.val === "on";
      btn.classList.toggle("active", isOn === state.confirmRestartEnabled);
    });
  }

  confirmRestartSegment.querySelectorAll(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.confirmRestartEnabled = btn.dataset.val === "on";
      syncConfirmRestartButtons();
      try { localStorage.setItem("2048modlab_confirmrestart", btn.dataset.val); } catch(e) {}
    });
  });

  // Tapping/clicking an edge zone moves in that direction, same as a
  // keypress or swipe. Use pointerdown (not click) so the move fires the
  // instant the press begins rather than waiting for release. Object keys
  // from the computed-key literal above are strings, so Number() them
  // back into DIR values.
  for (const dir in tapZoneEls){
    tapZoneEls[dir].addEventListener("pointerdown", (e) => {
      if (!state.tapControlsEnabled) return;
      e.preventDefault();
      handleMove(Number(dir));
    });
  }

  // ---------- mods panel ----------
  // Each mod is a square button showing a two-letter abbreviation.
  // Clicking toggles the mod on/off; active mods tilt 10deg clockwise
  // and brighten so it's clear at a glance which are selected.
  const modListEl = document.getElementById("modList");
  const modDescPanelEl = document.getElementById("modDescPanel");

  MODS.forEach(m => {
    const square = document.createElement("button");
    square.type = "button";
    square.className = "mod-square";
    square.style.setProperty("--accent", m.accent);
    square.dataset.key = m.key;
    square.setAttribute("aria-label", m.name);
    square.innerHTML = `<span class="abbr">${m.abbr}</span>`;
    modListEl.appendChild(square);
  });

  modListEl.querySelectorAll(".mod-square").forEach(square => {
    square.addEventListener("click", () => {
      if (state.chaosMode) return; // mods are picked automatically while Chaos Mode is running
      const key = square.dataset.key;
      state.mods[key] = !state.mods[key];
      syncModCards();
      loadBestScore();
      newGame();
    });
  });

  function syncModCards(){
    MODS.forEach(m => {
      const square = modListEl.querySelector(`.mod-square[data-key="${m.key}"]`);
      square.classList.toggle("active", state.mods[m.key]);
      square.classList.toggle("chaos-locked", state.chaosMode);
    });
    renderModDescPanel();
  }

  function renderModDescPanel(){
    if (state.chaosMode){
      const activeMod = MODS.find(m => m.key === state.chaosActiveMod);
      modDescPanelEl.innerHTML = `<div class="mod-desc-item chaos-desc"><b>Chaos Mode:</b> mods shuffle themselves — a 10% chance per move to swap to a different random mod. Type "chaos" again to turn it off.<br>` +
        (activeMod ? ` Currently active: <b>${activeMod.name}</b> &mdash; ${activeMod.desc}` : "") +
        `</div>`;
      return;
    }
    const active = MODS.filter(m => state.mods[m.key]);
    if (active.length === 0){
      modDescPanelEl.innerHTML = `<p class="mod-desc-empty">Select a mod to see its description.</p>`;
      return;
    }
    modDescPanelEl.innerHTML = active
      .map(m => `<div class="mod-desc-item"><b>${m.name}:</b> ${m.desc}</div>`)
      .join("");
  }

  window.setBoard = function(values) {
    let id = 1;

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const v = values[r][c];

        if (v === 0 || v === null) {
          state.board[r][c] = null;
        } else {
            state.board[r][c] = {
              id: id++,
              value: v
            };
          }

          state.magicCounter[r][c] = 0;
        }
      }

      render();
      saveGame();
    };

  // ---------- boot ----------
  syncModCards();
  syncAnimButtons();
  syncThemeButtons();
  syncTapControlsButtons();
  syncTapZones();
  syncConfirmRestartButtons();
  loadBestScore();
  if (!loadGame()) newGame();
})();