(function () {
  "use strict";

  var WIDTH = 360;
  var HEIGHT = 600;
  var DANGER_Y = 110;
  var DANGER_DELAY = 1700;
  var LEVELS = window.JUHOON_LEVELS;
  var Matter = window.Matter;

  if (!Matter || !LEVELS) {
    document.body.innerHTML = "<p style='padding:24px'>游戏资源加载失败，请刷新页面。</p>";
    return;
  }

  var Engine = Matter.Engine;
  var World = Matter.World;
  var Bodies = Matter.Bodies;
  var Body = Matter.Body;
  var Events = Matter.Events;

  var board = document.getElementById("board");
  var ballLayer = document.getElementById("ball-layer");
  var burstLayer = document.getElementById("burst-layer");
  var dropGuide = document.getElementById("drop-guide");
  var dangerLine = document.getElementById("danger-line");
  var startScreen = document.getElementById("start-screen");
  var gameoverScreen = document.getElementById("gameover-screen");
  var startButton = document.getElementById("start-button");
  var restartButton = document.getElementById("restart-button");
  var shareButton = document.getElementById("share-button");
  var soundButton = document.getElementById("sound-toggle");
  var scoreNode = document.getElementById("score");
  var bestNode = document.getElementById("best");
  var nextBall = document.getElementById("next-ball");
  var comboNode = document.getElementById("combo");
  var finalScoreNode = document.getElementById("final-score");
  var resultTitleNode = document.getElementById("result-title");
  var resultCopyNode = document.getElementById("result-copy");

  var engine = null;
  var animationId = 0;
  var lastFrame = 0;
  var balls = new Map();
  var pendingMerges = [];
  var gameState = "intro";
  var score = 0;
  var best = readBest();
  var highestLevel = 0;
  var currentLevel = 0;
  var nextLevel = 1;
  var cursorX = WIDTH / 2;
  var dropReady = false;
  var dangerSince = 0;
  var combo = 0;
  var lastMergeAt = 0;
  var random = Math.random;
  var pointerActive = false;
  var soundEnabled = true;
  var audioContext = null;

  bestNode.textContent = formatNumber(best);
  prepareLayers();
  resetRandom();
  currentLevel = pickSpawnLevel();
  nextLevel = pickSpawnLevel();
  updatePreview();
  updateGuide();

  function prepareLayers() {
    [ballLayer, burstLayer].forEach(function (layer) {
      layer.style.width = WIDTH + "px";
      layer.style.height = HEIGHT + "px";
      layer.style.transformOrigin = "0 0";
    });
    resizeLayers();
  }

  function resizeLayers() {
    var scale = board.clientWidth / WIDTH;
    ballLayer.style.transform = "scale(" + scale + ")";
    burstLayer.style.transform = "scale(" + scale + ")";
    updateGuide();
  }

  function startGame() {
    stopLoop();
    clearWorld();
    resetRandom();
    score = 0;
    highestLevel = 0;
    combo = 0;
    dangerSince = 0;
    currentLevel = pickSpawnLevel();
    nextLevel = pickSpawnLevel();
    cursorX = WIDTH / 2;
    dropReady = true;
    gameState = "playing";
    scoreNode.textContent = "0";
    comboNode.classList.remove("show");
    dangerLine.classList.remove("hot");
    startScreen.hidden = true;
    gameoverScreen.hidden = true;
    board.classList.add("playing");
    board.classList.remove("cooldown");

    engine = Engine.create({ enableSleeping: true });
    engine.gravity.y = 1.05;
    engine.gravity.scale = 0.001;
    addWalls();
    Events.on(engine, "collisionStart", queueMerges);
    updatePreview();
    updateGuide();
    initAudio();
    beep(310, 0.06, 0.035);
    lastFrame = performance.now();
    animationId = requestAnimationFrame(frame);
  }

  function addWalls() {
    var wallOptions = {
      isStatic: true,
      friction: 0.4,
      restitution: 0.05,
      label: "wall",
      render: { visible: false }
    };
    World.add(engine.world, [
      Bodies.rectangle(-10, HEIGHT / 2, 20, HEIGHT + 80, wallOptions),
      Bodies.rectangle(WIDTH + 10, HEIGHT / 2, 20, HEIGHT + 80, wallOptions),
      Bodies.rectangle(WIDTH / 2, HEIGHT + 12, WIDTH + 40, 24, wallOptions)
    ]);
  }

  function frame(now) {
    if (gameState !== "playing" || !engine) return;
    var delta = Math.min(32, Math.max(12, now - lastFrame));
    lastFrame = now;
    Engine.update(engine, delta);
    flushMerges();
    renderBalls();
    checkDanger(now);
    animationId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (animationId) cancelAnimationFrame(animationId);
    animationId = 0;
  }

  function clearWorld() {
    balls.forEach(function (entry) { entry.node.remove(); });
    balls.clear();
    pendingMerges.length = 0;
    ballLayer.innerHTML = "";
    burstLayer.innerHTML = "";
    if (engine) {
      Events.off(engine);
      World.clear(engine.world, false);
      Engine.clear(engine);
      engine = null;
    }
  }

  function createBall(levelIndex, x, y, options) {
    if (!engine) return null;
    var level = LEVELS[levelIndex];
    var body = Bodies.circle(x, y, level.radius, {
      restitution: 0.08,
      friction: 0.025,
      frictionAir: 0.006,
      density: 0.0016,
      slop: 0.04,
      label: "juhoon-" + levelIndex
    });
    body.plugin.juhoonLevel = levelIndex;
    body.plugin.merging = false;
    body.plugin.removed = false;
    body.plugin.spawnGrace = performance.now() + ((options && options.grace) || 1250);

    var node = document.createElement("div");
    node.className = "ball" + (options && options.isNew ? " is-new" : "");
    node.style.width = level.radius * 2 + "px";
    node.style.height = level.radius * 2 + "px";
    node.style.setProperty("--ball-image", "url('" + level.image + "')");
    node.style.setProperty("--ball-color", level.color);
    node.setAttribute("aria-label", level.name);
    ballLayer.appendChild(node);
    balls.set(body.id, { body: body, node: node });
    World.add(engine.world, body);
    highestLevel = Math.max(highestLevel, levelIndex);
    return body;
  }

  function removeBall(body) {
    if (!body || body.plugin.removed) return;
    body.plugin.removed = true;
    var entry = balls.get(body.id);
    if (entry) entry.node.remove();
    balls.delete(body.id);
    World.remove(engine.world, body);
  }

  function renderBalls() {
    balls.forEach(function (entry) {
      var body = entry.body;
      var radius = LEVELS[body.plugin.juhoonLevel].radius;
      entry.node.style.transform =
        "translate(" + (body.position.x - radius) + "px," + (body.position.y - radius) + "px) rotate(" + body.angle + "rad)";
    });
  }

  function queueMerges(event) {
    event.pairs.forEach(function (pair) {
      var a = pair.bodyA;
      var b = pair.bodyB;
      var levelA = a.plugin.juhoonLevel;
      var levelB = b.plugin.juhoonLevel;
      if (levelA === undefined || levelA !== levelB || levelA >= LEVELS.length - 1) return;
      if (a.plugin.merging || b.plugin.merging || a.plugin.removed || b.plugin.removed) return;
      a.plugin.merging = true;
      b.plugin.merging = true;
      pendingMerges.push([a, b, levelA]);
    });
  }

  function flushMerges() {
    if (!pendingMerges.length) return;
    var jobs = pendingMerges.splice(0);
    jobs.forEach(function (job) {
      var a = job[0];
      var b = job[1];
      var level = job[2];
      if (a.plugin.removed || b.plugin.removed) return;
      var next = level + 1;
      var radius = LEVELS[next].radius;
      var x = clamp((a.position.x + b.position.x) / 2, radius, WIDTH - radius);
      var y = (a.position.y + b.position.y) / 2;
      var velocity = {
        x: (a.velocity.x + b.velocity.x) * 0.35,
        y: Math.min(-1.2, (a.velocity.y + b.velocity.y) * 0.2)
      };
      removeBall(a);
      removeBall(b);
      var merged = createBall(next, x, y, { isNew: true, grace: 900 });
      Body.setVelocity(merged, velocity);
      Body.setAngularVelocity(merged, (Math.random() - 0.5) * 0.06);
      addScore(LEVELS[next].points, next);
      burst(x, y, LEVELS[next].color);
      beep(360 + next * 54, 0.055, 0.025);
    });
  }

  function addScore(points, level) {
    var now = performance.now();
    combo = now - lastMergeAt < 950 ? combo + 1 : 1;
    lastMergeAt = now;
    var bonus = combo > 1 ? Math.min(combo, 6) : 1;
    score += points * bonus;
    scoreNode.textContent = formatNumber(score);
    if (score > best) {
      best = score;
      bestNode.textContent = formatNumber(best);
    }
    if (combo > 1) showCombo(combo);
    if (level === LEVELS.length - 1) showCombo("全球大势达成");
  }

  function showCombo(value) {
    comboNode.textContent = typeof value === "number" ? value + " 连击" : value;
    comboNode.classList.add("show");
    clearTimeout(showCombo.timer);
    showCombo.timer = setTimeout(function () { comboNode.classList.remove("show"); }, 900);
  }

  function burst(x, y, color) {
    for (var i = 0; i < 9; i += 1) {
      var dot = document.createElement("i");
      var angle = (Math.PI * 2 * i) / 9;
      var distance = 22 + Math.random() * 26;
      dot.className = "burst";
      dot.style.left = x + "px";
      dot.style.top = y + "px";
      dot.style.setProperty("--burst-color", i % 2 ? color : "#ff806b");
      dot.style.setProperty("--dx", Math.cos(angle) * distance + "px");
      dot.style.setProperty("--dy", Math.sin(angle) * distance + "px");
      burstLayer.appendChild(dot);
      setTimeout(function (node) { node.remove(); }, 540, dot);
    }
  }

  function dropCurrent() {
    if (gameState !== "playing" || !dropReady) return;
    dropReady = false;
    board.classList.add("cooldown");
    var level = LEVELS[currentLevel];
    var x = clamp(cursorX, level.radius + 2, WIDTH - level.radius - 2);
    createBall(currentLevel, x, Math.max(level.radius + 5, 43), { grace: 1350 });
    beep(220, 0.045, 0.018);

    currentLevel = nextLevel;
    nextLevel = pickSpawnLevel();
    updatePreview();
    updateGuide();
    setTimeout(function () {
      if (gameState !== "playing") return;
      dropReady = true;
      board.classList.remove("cooldown");
    }, 390);
  }

  function updateCursor(clientX) {
    var rect = board.getBoundingClientRect();
    cursorX = clamp((clientX - rect.left) * WIDTH / rect.width, 20, WIDTH - 20);
    updateGuide();
  }

  function updateGuide() {
    if (!dropGuide || !LEVELS[currentLevel] || !board.clientWidth) return;
    var scale = board.clientWidth / WIDTH;
    var level = LEVELS[currentLevel];
    var size = level.radius * 2 * scale;
    var x = clamp(cursorX, level.radius + 2, WIDTH - level.radius - 2) * scale - size / 2;
    dropGuide.style.setProperty("--guide-size", size + "px");
    dropGuide.style.setProperty("--guide-image", "url('" + level.image + "')");
    dropGuide.style.setProperty("--guide-color", level.color);
    dropGuide.style.transform = "translateX(" + x + "px)";
  }

  function updatePreview() {
    var level = LEVELS[nextLevel];
    nextBall.style.backgroundImage = "url('" + level.image + "')";
    nextBall.style.setProperty("--preview-color", level.color);
    nextBall.title = level.name;
  }

  function checkDanger(now) {
    var crowded = false;
    balls.forEach(function (entry) {
      var body = entry.body;
      if (body.plugin.removed || now < body.plugin.spawnGrace) return;
      if (body.bounds.min.y < DANGER_Y && body.speed < 1.9) crowded = true;
    });
    if (!crowded) {
      dangerSince = 0;
      dangerLine.classList.remove("hot");
      return;
    }
    if (!dangerSince) dangerSince = now;
    dangerLine.classList.add("hot");
    if (now - dangerSince >= DANGER_DELAY) endGame();
  }

  function endGame() {
    if (gameState !== "playing") return;
    gameState = "ended";
    dropReady = false;
    board.classList.remove("playing", "cooldown");
    dangerLine.classList.remove("hot");
    stopLoop();
    saveBest(best);
    var result = getResult();
    finalScoreNode.textContent = formatNumber(score);
    resultTitleNode.textContent = result.title;
    resultCopyNode.textContent = result.copy;
    gameoverScreen.hidden = false;
    beep(150, 0.16, 0.035);
  }

  function getResult() {
    if (highestLevel >= 10) return { title: "全球大势本人", copy: "最大主训已解锁。你不是在合成，你是在写回归史。" };
    if (highestLevel >= 8) return { title: "奖杯收割机", copy: "离全球巡演只差一点手感，主训已经站上领奖台。" };
    if (highestLevel >= 6) return { title: "直拍常驻嘉宾", copy: "每一次下落都像卡点，你的合成节奏很会抓镜头。" };
    if (highestLevel >= 4) return { title: "回归概念大师", copy: "造型已经有了，下一局把舞台和奖杯一起安排。" };
    return { title: "练习室守门员", copy: "热身完成。再来一局，主训的出道位还等你亲手合成。" };
  }

  function resetRandom() {
    var date = new Date();
    var seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
    random = mulberry32(seed);
  }

  function pickSpawnLevel() {
    var roll = random();
    if (roll < 0.46) return 0;
    if (roll < 0.74) return 1;
    if (roll < 0.92) return 2;
    return 3;
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function initAudio() {
    if (!soundEnabled || audioContext) return;
    var AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) audioContext = new AudioCtor();
  }

  function beep(frequency, duration, volume) {
    if (!soundEnabled || !audioContext) return;
    if (audioContext.state === "suspended") audioContext.resume();
    var oscillator = audioContext.createOscillator();
    var gain = audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    soundButton.classList.toggle("muted", !soundEnabled);
    soundButton.setAttribute("aria-label", soundEnabled ? "关闭音效" : "打开音效");
    if (soundEnabled) {
      initAudio();
      beep(420, 0.05, 0.025);
    }
  }

  async function shareResult() {
    shareButton.disabled = true;
    shareButton.textContent = "生成中";
    try {
      var blob = await makeShareCard();
      var file = new File([blob], "合成金主训-" + score + "分.png", { type: "image/png" });
      var shareData = {
        title: "合成金主训",
        text: "我在《合成金主训》拿到 " + score + " 分，你能合出全球大势吗？",
        files: [file]
      };
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share(shareData);
      } else if (navigator.share) {
        await navigator.share({ title: shareData.title, text: shareData.text, url: location.href });
      } else {
        downloadBlob(blob);
      }
    } catch (error) {
      if (error && error.name !== "AbortError") console.error(error);
    } finally {
      shareButton.disabled = false;
      shareButton.textContent = "分享战绩";
    }
  }

  async function makeShareCard() {
    var canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1440;
    var ctx = canvas.getContext("2d");
    var gradient = ctx.createLinearGradient(0, 0, 1080, 1440);
    gradient.addColorStop(0, "#c6ff72");
    gradient.addColorStop(0.52, "#fffdf8");
    gradient.addColorStop(1, "#bdeaff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1080, 1440);
    ctx.fillStyle = "#17181b";
    ctx.font = "900 52px sans-serif";
    ctx.fillText("JUHOON MERGE", 82, 104);
    ctx.font = "900 118px sans-serif";
    ctx.fillText("合成金主训", 76, 252);
    ctx.font = "800 44px sans-serif";
    ctx.fillText(getResult().title, 80, 346);

    var image = await loadImage(LEVELS[Math.min(highestLevel, LEVELS.length - 1)].image);
    ctx.save();
    ctx.beginPath();
    ctx.arc(540, 730, 330, 0, Math.PI * 2);
    ctx.clip();
    drawCover(ctx, image, 210, 400, 660, 660);
    ctx.restore();
    ctx.lineWidth = 18;
    ctx.strokeStyle = LEVELS[Math.min(highestLevel, LEVELS.length - 1)].color;
    ctx.beginPath();
    ctx.arc(540, 730, 330, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#17181b";
    ctx.font = "900 172px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(formatNumber(score), 540, 1215);
    ctx.font = "800 38px sans-serif";
    ctx.fillText("我的本轮得分 · 你能超过吗？", 540, 1290);
    ctx.font = "600 25px sans-serif";
    ctx.fillStyle = "rgba(23,24,27,.62)";
    ctx.fillText("非官方粉丝小游戏", 540, 1360);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error("图片生成失败")); }, "image/png", 0.92);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = reject;
      image.src = src;
    });
  }

  function drawCover(ctx, image, x, y, width, height) {
    var scale = Math.max(width / image.width, height / image.height);
    var sourceWidth = width / scale;
    var sourceHeight = height / scale;
    var sourceX = (image.width - sourceWidth) / 2;
    var sourceY = (image.height - sourceHeight) / 2;
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
  }

  function downloadBlob(blob) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "合成金主训-" + score + "分.png";
    link.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
  }

  function readBest() {
    try { return Number(localStorage.getItem("juhoon-merge-best")) || 0; }
    catch (error) { return 0; }
  }

  function saveBest(value) {
    try { localStorage.setItem("juhoon-merge-best", String(value)); }
    catch (error) { /* Storage may be disabled. */ }
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("zh-CN").format(value);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  board.addEventListener("pointerdown", function (event) {
    if (gameState !== "playing") return;
    pointerActive = true;
    board.setPointerCapture(event.pointerId);
    updateCursor(event.clientX);
  });
  board.addEventListener("pointermove", function (event) {
    if (gameState === "playing") updateCursor(event.clientX);
  });
  board.addEventListener("pointerup", function (event) {
    if (!pointerActive) return;
    pointerActive = false;
    updateCursor(event.clientX);
    dropCurrent();
  });
  board.addEventListener("pointercancel", function () { pointerActive = false; });
  startButton.addEventListener("click", startGame);
  restartButton.addEventListener("click", startGame);
  shareButton.addEventListener("click", shareResult);
  soundButton.addEventListener("click", toggleSound);
  window.addEventListener("resize", resizeLayers);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && gameState === "playing") lastFrame = performance.now();
  });

  window.__JUHOON_GAME__ = {
    start: startGame,
    dropAt: function (x) { cursorX = clamp(x, 20, WIDTH - 20); dropCurrent(); },
    spawnLevel: function (level, x, y) {
      if (gameState !== "playing") startGame();
      return createBall(clamp(level, 0, LEVELS.length - 1), x || WIDTH / 2, y || 180, { grace: 500 });
    },
    levels: LEVELS
  };
})();
