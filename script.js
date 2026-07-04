(function(){
  "use strict";

  const SIZE = 4;
  const GAP = 10; // must match the grid-gap used for .board in styles.css
  const DIR = { LEFT:0, DOWN:1, RIGHT:2, UP:3 };

  const TILE_BG = ["var(--bg0)","var(--bg2)","var(--bg4)","var(--bg8)","var(--bg16)","var(--bg32)","var(--bg64)",
                    "var(--bg128)","var(--bg256)","var(--bg512)","var(--bg1024)","var(--bg2048)","var(--bg4096)"];
  const TILE_FG = ["var(--bg0)","var(--fg-dark)","var(--fg-dark)","var(--fg-light)","var(--fg-light)","var(--fg-light)",
                    "var(--fg-light)","var(--fg-light)","var(--fg-light)","var(--fg-light)","var(--fg-light)","var(--fg-light)","var(--fg-light)"];

  const MODS = [
    { key:"gravity",   name:"Gravity",   abbr:"GR", accent:"rgb(93,138,168)",
      desc:"Every move is performed twice." },
    { key:"invisible", name:"Invisible", abbr:"IV", accent:"rgb(150,140,140)",
      desc:"Only newly spawned tiles are shown." },
    { key:"magician",  name:"Magician",  abbr:"MG", accent:"rgb(150,40,140)",
      desc:"Making the same merge twice spawns a temporary unmergeable block. Make unique merges to make it vanish." },
    { key:"volatile",  name:"Volatile",  abbr:"VL", accent:"rgb(196,39,39)",
      desc:"Two new tiles spawn after every move instead of one." },
    { key:"blocked",   name:"Blocked",   abbr:"BL", accent:"rgb(40,36,30)",
      desc:"An unmergeable tile is spawned at the start of the game." },
    { key:"touch",     name:"Touch",     abbr:"TC", accent:"rgb(0,150,136)",
      desc:"Tiles only merge if they were already touching, with no gap between them. Sliding two matching tiles together across an empty cell no longer merges them." },
  ];

  let nextTileId = 1;

  const state = {
    board: null,          // grid of null | { id, value }
    magicCounter: null,   // grid of numbers, moves alongside board
    score:0, best:0, moveCount:0, gameOver:false,
    lastMergeValue:0,
    spawnLocs: [],
    magicLog: [],   // history of merge values while Magician is active, newest first
    animationsEnabled: true,
    mods: { gravity:false, invisible:false, magician:false, volatile:false, blocked:false, touch:false }
  };

  function loadBestScore() {
    try {
      const saved = localStorage.getItem(getBestScoreKey());
      state.best = saved ? parseInt(saved, 10) : 0;
    } catch(e) {
      state.best = 0;
    }
  }

  try {
    const savedAnim = localStorage.getItem("2048modlab_anim");
    if (savedAnim === "off") state.animationsEnabled = false;
  } catch(e) {}

  // ---------- helpers ----------

  function getBestScoreKey() {
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

  // ---------- game setup ----------
  function newGame(){
    state.board = emptyGrid(null);
    state.magicCounter = emptyGrid(0);
    state.score = 0;
    state.moveCount = 0;
    state.gameOver = false;
    state.lastMergeValue = 0;
    state.spawnLocs = [];
    state.magicLog = [];

    const s1 = randomSpawn();
    const s2 = randomSpawn();
    state.spawnLocs = [s1, s2].filter(x => x !== null);

    if (state.mods.blocked) randomSpawnBlock();

    hideOverlay();
    stopAllMagicAnimations();
    tilesLayerEl.innerHTML = "";
    tileEls.clear();
    render();
  }

  function randomSpawn(){
    const cells = emptyCells();
    if (cells.length === 0) return null;
    const val = Math.random() < 0.1 ? 4 : 2;
    const [r,c] = cells[Math.floor(Math.random()*cells.length)];
    state.board[r][c] = { id: nextTileId++, value: val };
    return r*SIZE + c;
  }

  function randomSpawnBlock(){
    const cells = emptyCells();
    if (cells.length === 0) return;
    const [r,c] = cells[Math.floor(Math.random()*cells.length)];
    state.board[r][c] = { id: nextTileId++, value: 1 }; // sentinel: permanent obstacle tile
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
          } while (ret === MOVED);
        }
      }
    }

    rotateTimes((SIZE - direction) % SIZE);
    return mergeValues;
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

    const before = cloneBoard(state.board);
    let mergeValues = moveAndMergeOnce(direction);

    if (state.mods.gravity){
      mergeValues = mergeValues.concat(moveAndMergeOnce(direction));
    }

    let justSpawned = [];

    const changed = !boardsEqual(before, state.board);

    if (changed){
      if (state.mods.magician){
        processMagic(mergeValues);
        
        // ONLY update the log if a merge actually happened this turn
        if (mergeValues.length > 0) {
          state.magicLog = [...mergeValues].sort((a, b) => b - a);
        }
        // If mergeValues.length is 0, we do NOTHING, 
        // leaving the old state.magicLog exactly as it was.
      }

      const s1 = randomSpawn();
      if (s1 !== null) justSpawned.push(s1);
      if (state.mods.volatile){
        const s2 = randomSpawn();
        if (s2 !== null) justSpawned.push(s2);
      }
      state.spawnLocs = justSpawned;

      state.moveCount += 1;
      if (state.score > state.best){
        state.best = state.score;
        try { localStorage.setItem(getBestScoreKey(), String(state.best)); } catch(e) {}
      }
    }

    if (isLost()){
      state.gameOver = true;
    }

    render();

    if (state.gameOver){
      setTimeout(showOverlay, state.animationsEnabled ? 260 : 30);
    }
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
  const magicLogEl = document.getElementById("magicLog");
  const magicLogListEl = document.getElementById("magicLogList");
  const overlayCloseBtn = document.getElementById("overlayClose");

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

  function styleTileContent(el, cellData, isMagic, magicVal){
    el.classList.remove("block", "magic");
    el.style.background = "";
    el.style.color = "";

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
    } else {
      const idx = cellData.value >= 4096 ? 12 : Math.log2(cellData.value);
      el.style.background = TILE_BG[idx];
      el.style.color = TILE_FG[idx];
      el.textContent = String(cellData.value);
    }
  }

  function renderTiles(animate){
    const total = tilesLayerEl.clientWidth || tilesLayerEl.offsetWidth || 0;
    const cell = Math.max(0, (total - GAP*(SIZE-1)) / SIZE);

    const showAll = !state.mods.invisible || state.moveCount === 0 || state.gameOver;
    const visibleSet = new Set(state.spawnLocs);
    const newIds = new Set();

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
          el.style.transition = animate ? "transform .18s ease, opacity .15s ease" : "none";
          if (valueChanged && animate){
            el.style.transform = `translate(${x}px, ${y}px) scale(1.18)`;
            el._pulseTimeout = setTimeout(() => {
              el.style.transform = `translate(${x}px, ${y}px) scale(1)`;
              el._pulseTimeout = null;
            }, 130);
          } else {
            el.style.transform = `translate(${x}px, ${y}px) scale(1)`;
          }
          el.style.opacity = "1";
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
      if (animate){
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
        const idx = val >= 4096 ? 12 : Math.log2(val);
        return `<span class="log-item" style="background: ${TILE_BG[idx]}; color: ${TILE_FG[idx]};">
                  ${val}
                </span>`;
      })
      .join("");
  }

  function renderModChips(){
    activeModsRow.innerHTML = "";
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

  // reposition tiles (no animation) if the layout size changes
  window.addEventListener("resize", () => renderTiles(false));

  // ---------- input ----------
  const KEY_DIR = {
    ArrowLeft: DIR.LEFT, a: DIR.LEFT, A: DIR.LEFT,
    ArrowRight: DIR.RIGHT, d: DIR.RIGHT, D: DIR.RIGHT,
    ArrowUp: DIR.UP, w: DIR.UP, W: DIR.UP,
    ArrowDown: DIR.DOWN, s: DIR.DOWN, S: DIR.DOWN,
  };

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalOverlay.classList.contains("show")){
      closeModal();
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
    touching = true;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, {passive:true});

  boardWrap.addEventListener("touchend", (e) => {
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
  
    // Add this block to handle 'R' for restart
    if (e.key === "r" || e.key === "R") {
      newGame();
      return;
    }
  });

  document.getElementById("newGameBtn").addEventListener("click", newGame);
  document.getElementById("overlayRestart").addEventListener("click", newGame);
  overlayCloseBtn.addEventListener("click", hideOverlay);
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) hideOverlay();
  });
  document.getElementById("resetModsBtn").addEventListener("click", () => {
    MODS.forEach(m => state.mods[m.key] = false);
    syncModCards();
    loadBestScore();
    newGame();
  });

  // ---------- settings modal ----------
  const settingsBtn = document.getElementById("settingsBtn");
  const modalClose = document.getElementById("modalClose");

  function openModal(){ modalOverlay.classList.add("show"); }
  function closeModal(){ modalOverlay.classList.remove("show"); }

  settingsBtn.addEventListener("click", openModal);
  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
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
    });
    renderModDescPanel();
  }

  function renderModDescPanel(){
    const active = MODS.filter(m => state.mods[m.key]);
    if (active.length === 0){
      modDescPanelEl.innerHTML = `<p class="mod-desc-empty">Select a mod to see its description.</p>`;
      return;
    }
    modDescPanelEl.innerHTML = active
      .map(m => `<div class="mod-desc-item"><b>${m.name}:</b> ${m.desc}</div>`)
      .join("");
  }

  // ---------- boot ----------
  syncModCards();
  syncAnimButtons();
  loadBestScore();
  newGame();
})();
