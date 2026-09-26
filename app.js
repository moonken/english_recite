/**
 * 自然拼读背单词 - 应用逻辑
 * 功能:单词卡片(自然拼读分段着色)、已会、生词本、上一个/下一个、每组数量设置
 */

/* ==================================================================
 * 一、自然拼读分段渲染(数据来自 words.js 中 AI 预生成的 parts 字段)
 * parts 元素两种:
 *   {t, ph, segs:[{t,k,s}]} 单词:t=原文,ph=DJ 音标,segs=分段(字母/类型/读音)
 *   {t}                     符号:空格、连字符、词对符号等原样展示
 * 分段类型 k:consonant 单辅音 / cdigraph 辅音组合 / vowel 单元音 /
 *            vteam 元音组合·R控 / long 长元音(magic-e) / silent 不发音
 * ================================================================== */

/* 发音 / 自然拼读按钮图标:与 index.html 中卡片底部按钮共用同一份 SVG,
 * stroke 取 currentColor,自动跟随按钮配色 */
const ICON_SOUND =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16 9a4.5 4.5 0 0 1 0 6"/></svg>';
const ICON_PHONICS =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16V9m5 7V5m5 11v-4m5 4V8"/></svg>';

/**
 * 把 parts 按词对分隔符( – 或 = )拆成左右两侧
 * 用于同义词/反义词/缩略词组;非词对词条返回 null
 * @returns {{sides:Array, seps:Array}|null}
 */
function splitPairSides(parts) {
  const sides = [], seps = [];
  let cur = [];
  for (const p of parts) {
    // 分隔符是"无分段读音且含 –/="的符号部分(如 " – "/" = ")
    if (!p.segs && /[–=]/.test(p.t)) {
      sides.push(cur);
      seps.push(p.t.trim());
      cur = [];
    } else {
      cur.push(p);
    }
  }
  sides.push(cur);
  return sides.length > 1 ? { sides, seps } : null;
}

/** 取拆分后某一侧的英文原文(供整侧发音) */
function sideText(side) {
  return side.map(p => p.t).join("").trim();
}

/** 词条是否为两部分词对(同义词/反义词/缩略词) */
function isPairEntry(word) {
  const pair = splitPairSides(word.parts);
  return !!(pair && pair.sides.length === 2);
}

/**
 * 把词条渲染成"分段字母 + 分段读音"的彩色 HTML
 * 每个分段是一个上下结构小块:上行彩色字母,下行与字母同色的读音
 * 可播放(有对应音素)的分段带 data-pi 序号,供自然拼读时高亮动画定位
 * 词对词条(同义词/反义词/缩略词)拆成左右两张小卡片,中间显示连接符,
 * 每张卡片含:着色单词 + 该侧音标 + 单侧发音按钮
 */
function renderPhonicsHTML(word) {
  let pi = 0; // 全局分段序号,与 playPhonicsReading 的计数一致
  // 单个 part → 分段小块 HTML
  const partHTML = part => {
    if (!part.segs) {
      // 空格/连字符等:原样展示,下行留空对齐
      return `<span class="seg-block seg-other">${escapeHTML(part.t)}<span class="seg-sound"></span></span>`;
    }
    return part.segs.map(seg => {
      // 可播放(有对应音素)的分段记录序号,拼读动画按序号高亮
      const playable = seg.s && IPA_TO_PHONEMES[seg.s];
      const piAttr = playable ? ` data-pi="${pi++}"` : "";
      return `<span class="seg-block"${piAttr}>` +
             `<span class="seg-${seg.k}">${escapeHTML(seg.t)}</span>` +
             `<span class="seg-sound seg-${seg.k}">${seg.s ? "/" + seg.s + "/" : ""}</span></span>`;
    }).join("");
  };

  const pair = splitPairSides(word.parts);
  if (pair && pair.sides.length === 2) {
    // 词对:左右两张小卡片 + 中间连接符;发音/拼读按钮放在卡片内
    const cardHTML = (side, i) => `
      <div class="pair-card" data-side="${i}">
        <div class="phonics-word pair-phonics">${side.map(partHTML).join("")}</div>
        <div class="pair-ipa">${side.map(p => p.ph ? "/" + p.ph + "/" : "").join(" ").trim()}</div>
        <div class="pair-btns">
          <button class="pair-play" data-side="${i}" title="播放发音" aria-label="播放发音">${ICON_SOUND}<span class="btn-label">发音</span></button>
          <button class="pair-phonics-read" data-side="${i}" title="自然拼读" aria-label="自然拼读">${ICON_PHONICS}<span class="btn-label">拼读</span></button>
        </div>
      </div>`;
    return `<div class="pair-wrap">` +
           cardHTML(pair.sides[0], 0) +
           `<div class="pair-sep">${escapeHTML(pair.seps[0])}</div>` +
           cardHTML(pair.sides[1], 1) +
           `</div>`;
  }
  return word.parts.map(partHTML).join("");
}

/** 获取词条的整词音标行:词组/词对逐词取音标,用空格连接 */
function fullPhonetic(word) {
  return word.parts.filter(p => p.ph).map(p => "/" + p.ph + "/").join("  ");
}

/** HTML 转义,防止词条中的特殊字符破坏结构 */
function escapeHTML(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ==================================================================
 * 二、发音:优先真人录音(有道词典发音接口),失败时用浏览器 TTS 兜底
 * ================================================================== */

const audioPlayer = new Audio(); // 复用同一个播放器,避免重叠播放
let soundBtn = null; // 当前处于"加载中"的发音按钮 {el, html},被打断/切换时统一恢复

/** 恢复发音按钮为可点状态(还原原内容,含图标) */
function releaseSoundBtn() {
  if (!soundBtn) return;
  soundBtn.el.disabled = false;
  soundBtn.el.innerHTML = soundBtn.html;
  soundBtn = null;
}

function playWord(text, btn) {
  // 词对词条只朗读左半部分( – / = 之前);去掉括号等多余符号
  const speakText = text.split(/[–=]/)[0].trim();
  stopSpeak();

  // 按钮 loading 态:保留图标,只把文字换成"加载中"(播完/中断时还原)
  if (btn) {
    soundBtn = { el: btn, html: btn.innerHTML };
    btn.disabled = true;
    btn.innerHTML = btn.querySelector("svg")
      ? btn.querySelector("svg").outerHTML + '<span class="btn-label">加载中…</span>'
      : "⏳ 加载中…";
  }
  const restore = () => releaseSoundBtn();

  // 真人录音音源(美音 type=2)
  const url = "https://dict.youdao.com/dictvoice?audio=" + encodeURIComponent(speakText) + "&type=2";
  audioPlayer.src = url;
  audioPlayer.onended = restore;
  audioPlayer.onerror = () => {
    // 真人音频加载失败,使用 TTS 兜底
    ttsSpeak(speakText, restore);
  };
  audioPlayer.play().catch(() => ttsSpeak(speakText, restore));
}

/** 浏览器 TTS 兜底朗读 */
function ttsSpeak(text, onend) {
  if (!("speechSynthesis" in window)) { onend && onend(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.85;
  u.onend = () => onend && onend();
  u.onerror = () => onend && onend();
  speechSynthesis.speak(u);
}

// 词对连读任务(打开同义词/反义词/缩略词卡片时左右两侧依次朗读)
let pairRun = null;

/** 中断词对连读(由 stopSpeak 调用),cancelled 标记让后续回调不再推进 */
function abortPairRun() {
  if (pairRun) {
    pairRun.cancelled = true;
    pairRun = null;
  }
}

/**
 * 词对词条(同义词/反义词/缩略词)连续读出两侧英文:左侧 → 右侧
 * 每侧播完自动接下一侧;该侧真人音频失败时用 TTS 兜底继续
 * 任何切词/其他发音都会经 stopSpeak → abortPairRun 中断,不会串音
 * @returns {boolean} 是否为词对词条并已发起连读(普通词条返回 false)
 */
function playPairBothSides(word) {
  const pair = splitPairSides(word.parts);
  if (!pair || pair.sides.length !== 2) return false;
  const texts = pair.sides.map(s => sideText(s)).filter(Boolean);
  if (!texts.length) return false;

  const run = { cancelled: false };
  pairRun = run;
  let idx = 0;
  const playNext = () => {
    if (run.cancelled || idx >= texts.length) {
      if (!run.cancelled) { pairRun = null; clearSegHighlight(); } // 正常播完收尾
      return;
    }
    const t = texts[idx++];
    // 高亮正在朗读的一侧小卡片
    clearSegHighlight();
    const target = document.querySelector(`.pair-card[data-side="${idx - 1}"] .pair-phonics`);
    if (target) target.classList.add("word-playing");
    audioPlayer.onended = playNext;
    audioPlayer.onerror = () => ttsSpeak(t, playNext); // 有道失败 → TTS 读该侧后继续
    audioPlayer.src = "https://dict.youdao.com/dictvoice?audio=" + encodeURIComponent(t) + "&type=2";
    audioPlayer.play().catch(() => ttsSpeak(t, playNext));
  };
  playNext();
  return true;
}

/** 停止当前所有发音(含自然拼读序列) */
function stopSpeak() {
  audioPlayer.pause();
  // 清空自然拼读的待播定时器
  phonicsTimers.forEach(t => clearTimeout(t));
  phonicsTimers = [];
  abortPhonicsRun(); // 中断拼读任务并恢复其按钮(否则按钮会停留在禁用态)
  abortPairRun(); // 中断词对两侧连读,防止旧序列回调继续朗读下一侧
  releaseSoundBtn(); // 中断发音时恢复"加载中"按钮,避免卡死
  clearSegHighlight(); // 清除拼读高亮动画
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

/* ==================================================================
 * 二·五、自然拼读:逐个分段播音素,最后播整词
 * 音源:本地 audio/phonemes/(pindushu 全套 44 个 DJ 音标真人发音),
 *      本地缺失时回退 pindushu 在线地址
 * ================================================================== */

// 分段读音(IPA) → 音素音频文件 id(与 pindushu API 核对过;注意 ph_ee=ə、ph_ii=iː、ph_ou=əʊ、ph_ow=aʊ、ph_uu_short=ʊ、ph_ri=ʒ)
// 组合音(如 ks/kw/əl)无单文件,用多个音素连播
// 缩写词按字母名朗读(如 TV 的 T=/tiː/),这类读音同样拆解成音素连播
const IPA_TO_PHONEMES = {
  // 单辅音
  b: ["b"], d: ["d"], f: ["f"], "ɡ": ["g"], h: ["h"], "dʒ": ["j"],
  k: ["k"], l: ["l"], m: ["m"], n: ["n"], p: ["p"], r: ["r"],
  s: ["s"], t: ["t"], v: ["v"], w: ["w"], j: ["y"], z: ["z"],
  // 辅音组合
  "ʃ": ["sh"], "tʃ": ["ch"], "θ": ["th_unvoiced"], "ð": ["th_voiced"], "ŋ": ["ng"], "ʒ": ["ri"],
  // 组合音:连播多个音素
  ks: ["k", "s"], "ŋk": ["ng", "k"], "ŋɡ": ["ng", "g"], kw: ["k", "w"],
  "ɡz": ["g", "z"], nj: ["n", "y"], "juː": ["y", "uu"], "ɔːl": ["or", "l"],
  "əl": ["ee", "l"], "ən": ["ee", "n"], // 成音节 l/n(如 apple/lesson)
  "wʌ": ["w", "u"], // one/once 开头的 /wʌ/
  // 短元音
  "æ": ["ae"], e: ["e"], "ɪ": ["i"], "ɒ": ["o"], "ʌ": ["u"], "ʊ": ["uu_short"], u: ["uu_short"],
  i: ["i"], // 词尾 y 的读音(如 happy),借用短音 /ɪ/ 音素
  // 长元音
  "eɪ": ["ei"], "iː": ["ii"], "aɪ": ["ai"], "əʊ": ["ou"], "uː": ["uu"],
  // 双元音/R 控
  "ɔɪ": ["oi"], "aʊ": ["ow"], "ɔː": ["or"], "ɑː": ["ar"],
  "ɪə": ["ear"], "eə": ["air"], "ʊə": ["ure"], "ɜː": ["er"], "ə": ["ee"],
  // 三元音(如 fire/flower)
  "aɪə": ["ai", "ee"], "aʊə": ["ow", "ee"],
  // j 起头的读音(如 use/year)
  ju: ["y", "uu"], "jʊ": ["y", "uu_short"], "jə": ["y", "ee"], "jʊə": ["y", "ure"],
  // 字母名读音(缩写词 PE/TV/UN/D.C. 等,按字母名拆音素)
  "tiː": ["t", "ii"], "piː": ["p", "ii"], "viː": ["v", "ii"],
  "siː": ["s", "ii"], "diː": ["d", "ii"], en: ["e", "n"],
  // 注:W 的字母名 /dʌbəljuː/ 不播音素(拆出来不像拼读),仅展示音标
};

let phonicsTimers = []; // 自然拼读序列的定时器,stopSpeak 时统一清理
let phonicsRun = null;  // 当前拼读任务 {cancelled, btn, audio},用于中断时恢复按钮

/** 中断当前拼读任务:停掉正在播的音频、恢复按钮可点(由 stopSpeak 调用) */
function abortPhonicsRun() {
  if (!phonicsRun) return;
  phonicsRun.cancelled = true;
  if (phonicsRun.audio) {
    // 摘掉回调再暂停,避免中断后回调继续推进序列
    phonicsRun.audio.onended = null;
    phonicsRun.audio.onerror = null;
    phonicsRun.audio.pause();
  }
  const btn = phonicsRun.btn;
  phonicsRun = null;
  if (btn) btn.disabled = false;
}

/** 清除自然拼读的高亮动画(含词对小卡片上的整词高亮) */
function clearSegHighlight() {
  document.querySelectorAll(".seg-block.seg-playing").forEach(el => el.classList.remove("seg-playing"));
  document.querySelectorAll(".word-playing").forEach(el => el.classList.remove("word-playing"));
}

/** 高亮指定序号的分段(自然拼读播放到该音素时调用) */
function highlightSeg(pi) {
  clearSegHighlight();
  const el = document.querySelector(`.seg-block[data-pi="${pi}"]`);
  if (el) el.classList.add("seg-playing");
}

/** 获取单个音素音频,本地 404 时回退 pindushu 在线地址 */
function phonemeUrl(id, remote) {
  return remote
    ? "https://img.pindushu.com/phonics/audio/phonemes/ph_" + id + ".mp3"
    : "audio/phonemes/ph_" + id + ".mp3";
}

/**
 * 播放单个音素:优先本地真人录音,失败回退在线音源,都失败则跳过
 * 用独立 Audio 对象播放,避免与整词播放器互相覆盖回调;done 只触发一次防序列分叉
 */
function playPhonemeAudio(id, run, onDone) {
  let finished = false;
  const done = () => {
    if (finished || run.cancelled) return;
    finished = true;
    onDone();
  };
  const local = new Audio(phonemeUrl(id, false));
  run.audio = local;
  local.onended = done;
  local.onerror = () => {
    // 本地缺失 → 试一次在线音源
    const remote = new Audio(phonemeUrl(id, true));
    run.audio = remote;
    remote.onended = done;
    remote.onerror = done;
    remote.play().catch(done);
  };
  local.play().catch(() => {}); // 加载失败统一走 onerror 回退,这里不推进
}

/**
 * 自然拼读:按分段依次播音素,最后整读该侧单词真人发音
 * 播放时对应分段(字母+音标)做放大高亮动画,整读时对应卡片/单词区高亮
 * 任何中断(切词/点发音/再点拼读)都会经 stopSpeak → abortPhonicsRun 恢复按钮,不会卡死禁用态
 * @param {Object} word 词条对象(使用其预生成的 parts 分段数据)
 * @param {Element} btn 触发按钮(播放期间禁用)
 * @param {number} [side] 词对词条只播某一侧(0/1);不传则两侧依次连播
 */
function playPhonicsReading(word, btn, side) {
  stopSpeak();

  // 1) 拆成播放单元:词对 = 每侧一个单元(side 标记高亮目标卡片),指定 side 时只播该侧
  const pair = splitPairSides(word.parts);
  const isPair = !!(pair && pair.sides.length === 2);
  const units = isPair
    ? (side === undefined
        ? [{ parts: pair.sides[0], side: 0 }, { parts: pair.sides[1], side: 1 }]
        : [{ parts: pair.sides[side], side }])
    : [{ parts: word.parts, side: undefined }];

  // 可播分段数(与 renderPhonicsHTML 的 data-pi 计数一致;只播第二侧时需偏移起始序号)
  const playableCount = parts => parts.reduce((n, p) =>
    n + (p.segs ? p.segs.filter(s => s.s && IPA_TO_PHONEMES[s.s]).length : 0), 0);

  // 2) 组装播放序列:[{type:'phoneme',id,pi}|{type:'word',text,side}|{type:'gap',ms}]
  const sequence = [];
  let pi = isPair && side === 1 ? playableCount(pair.sides[0]) : 0;
  for (const unit of units) {
    for (const part of unit.parts) {
      if (!part.segs) continue; // 符号部分跳过
      for (const seg of part.segs) {
        const ids = seg.s && IPA_TO_PHONEMES[seg.s];
        if (!ids) continue; // 不发音字母/无音素映射的读音跳过
        ids.forEach(id => sequence.push({ type: "phoneme", id, pi }));
        pi++;
      }
      sequence.push({ type: "gap", ms: 350 }); // 词与词之间稍长停顿
    }
    sequence.push({ type: "gap", ms: 600 });   // 分段读完,停顿后整读该侧
    sequence.push({ type: "word", text: sideText(unit.parts), side: unit.side });
  }

  // 2) 顺序播放,同时驱动高亮动画;任务对象登记到 phonicsRun 以便中断时恢复按钮
  const run = { cancelled: false, btn, audio: null };
  phonicsRun = run;
  if (btn) btn.disabled = true;
  const finish = () => {
    if (run.cancelled) return;
    phonicsRun = null;
    clearSegHighlight();
    if (btn) btn.disabled = false;
  };

  const playAt = i => {
    if (run.cancelled) return;
    if (i >= sequence.length) { finish(); return; }
    const item = sequence[i];
    if (item.type === "gap") {
      phonicsTimers.push(setTimeout(() => playAt(i + 1), item.ms));
      return;
    }
    if (item.type === "word") {
      // 整词真人发音(有道):整词高亮,结束后恢复
      // 词对模式高亮对应侧小卡片(item.side),普通词条高亮主单词区
      clearSegHighlight();
      const target = item.side === undefined
        ? $("phonics-word")
        : document.querySelector(`.pair-card[data-side="${item.side}"] .pair-phonics`);
      if (target) target.classList.add("word-playing");
      run.audio = audioPlayer;
      audioPlayer.onended = finish;
      audioPlayer.onerror = finish;
      audioPlayer.src = "https://dict.youdao.com/dictvoice?audio=" + encodeURIComponent(item.text) + "&type=2";
      audioPlayer.play().catch(finish);
      return;
    }
    // 音素:高亮对应分段,播完自动接下一个,间隔 120ms
    highlightSeg(item.pi);
    playPhonemeAudio(item.id, run, () => phonicsTimers.push(setTimeout(() => playAt(i + 1), 120)));
  };
  playAt(0);
}

/* ==================================================================
 * 三、数据与状态
 * ================================================================== */

// 拍平全部单词,便于"全部单词"模式和按 id 查找
const ALL_WORDS = [];
WORDS_DATA.groups.forEach(g => {
  g.words.forEach(w => ALL_WORDS.push({ ...w, groupName: g.name }));
});
const WORD_BY_ID = new Map(ALL_WORDS.map(w => [w.id, w]));

// localStorage 持久化:已会单词 id 集合、生词本 id 数组
const store = {
  getKnown() { return new Set(JSON.parse(localStorage.getItem("known_words") || "[]")); },
  setKnown(s) { localStorage.setItem("known_words", JSON.stringify([...s])); },
  getWordbook() { return JSON.parse(localStorage.getItem("wordbook") || "[]"); },
  setWordbook(a) { localStorage.setItem("wordbook", JSON.stringify(a)); },
};

// 学习会话状态
const session = {
  words: [],      // 本次学习的单词列表
  idx: 0,         // 当前下标
  knownCount: 0,  // 本次点击"已会"的数量
  knownIds: new Set(), // 本次会话内标记为已会的词 id,用于"已会/生词本互斥"时准确回退计数
  source: "",     // 来源名称(分组名/全部单词/生词本)
  showMeaning: true, // 当前卡片是否显示释义(默认展示)
};

/* ==================================================================
 * 四、视图切换与全屏 loading
 * ================================================================== */

const $ = id => document.getElementById(id);

function showLoading() { $("loading-mask").classList.add("show"); }
function hideLoading() { $("loading-mask").classList.remove("show"); }

function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  $("view-" + name).classList.add("active");
  window.scrollTo(0, 0);
}

/* ==================================================================
 * 五、首页:分组列表渲染
 * ================================================================== */

function renderHome() {
  const known = store.getKnown();
  const wordbook = store.getWordbook();

  // 快捷入口计数
  $("entry-all-count").textContent = `共 ${ALL_WORDS.length} 词 · 已会 ${known.size} 词`;
  $("entry-wordbook-count").textContent = `已收藏 ${wordbook.length} 词`;

  // 分组卡片:组名 + 词数 + 已会进度 + 开始背诵入口
  $("group-grid").innerHTML = WORDS_DATA.groups.map(g => {
    const knownInGroup = g.words.filter(w => known.has(w.id)).length;
    const pct = g.words.length ? Math.round(knownInGroup / g.words.length * 100) : 0;
    return `
      <div class="group-card">
        <div class="group-name">${g.id}. ${escapeHTML(g.name)}</div>
        <div class="group-info">共 ${g.words.length} 词 · 已会 ${knownInGroup} 词</div>
        <div class="group-progress"><i style="width:${pct}%"></i></div>
        <button class="btn-start" data-group="${g.id}">开始背诵</button>
      </div>`;
  }).join("");
}

/* ==================================================================
 * 六、学习流程
 * ================================================================== */

/** 洗牌(Fisher-Yates),让每次学习顺序随机 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 开始一个学习会话(整组单词全量学习,无数量限制)
 * @param {Array} words 候选单词
 * @param {string} source 来源名称
 */
function startSession(words, source) {
  if (!words.length) return;
  showLoading(); // 全屏 loading:准备学习数据
  session.words = shuffle(words);
  session.idx = 0;
  session.knownCount = 0;
  session.knownIds = new Set(); // 重置本次已会标记集合
  session.source = source;
  session.showMeaning = true; // 释义默认展示
  $("study-source").textContent = source;
  renderWordNav(); // 渲染侧边单词导航
  switchView("study");
  renderCard();
  hideLoading();
}

/**
 * 渲染侧边单词导航:展示本次学习的所有单词(英文 + 首个释义),
 * 点击可跳转到对应单词;掌握状态(已会打勾 / 未会高亮)在 updateWordNav 中刷新
 */
function renderWordNav() {
  $("word-nav").innerHTML = session.words.map((w, i) => `
    <div class="word-nav-item" data-i="${i}">
      <span class="nav-en">${escapeHTML(w.en)}</span>
      <span class="nav-zh">${escapeHTML((w.zh || "").split(/[;,;、]/)[0])}</span>
      <span class="nav-dot"></span>
      <span class="nav-tick">✓</span>
    </div>`).join("");
}

/** 更新侧边导航状态:高亮当前单词、已会打勾、未会橙色高亮,并把当前项滚动到可见位置 */
function updateWordNav() {
  const known = store.getKnown();
  document.querySelectorAll(".word-nav-item").forEach((el, i) => {
    const isKnown = known.has(session.words[i].id);
    el.classList.toggle("active", i === session.idx);
    el.classList.toggle("known", isKnown);
    el.classList.toggle("unknown", !isKnown); // 未标记"已会"的词高亮,便于集中背诵
    el.title = isKnown ? "已会" : "未掌握";
  });
  const cur = document.querySelector(".word-nav-item.active");
  if (cur) cur.scrollIntoView({ block: "nearest" });
}

/** 渲染当前单词卡片 */
function renderCard() {
  const w = session.words[session.idx];
  const known = store.getKnown();
  const wordbook = store.getWordbook();

  // 进度显示
  $("study-progress-text").textContent = `${session.idx + 1}/${session.words.length}`;
  $("study-progress-bar").style.width = ((session.idx + 1) / session.words.length * 100) + "%";

  // 卡片内容:自然拼读着色单词 + 整词音标 + 释义 + 角标
  // 词对词条:音标拆到左右小卡片内(隐藏整词音标行),发音/拼读按钮也在卡片内(隐藏下方按钮行)
  $("phonics-word").innerHTML = renderPhonicsHTML(w);
  const pairMode = isPairEntry(w);
  $("phonetic").style.display = pairMode ? "none" : "";
  $("phonetic").textContent = pairMode ? "" : fullPhonetic(w);
  document.querySelector(".sound-btns").style.display = pairMode ? "none" : "";
  $("meaning").textContent = w.zh || "(无释义)";
  // 无释义词条(如缩略词组):隐藏释义行与"点击卡片隐藏释义"提示,避免多余占位
  $("meaning").style.display = w.zh ? "" : "none";
  document.querySelector(".flip-tip").style.display = w.zh ? "" : "none";
  $("meaning").classList.toggle("hidden", !session.showMeaning);
  $("sub-name").textContent = w.sub || w.groupName || "";
  $("known-badge").classList.toggle("show", known.has(w.id));
  $("wordbook-badge").classList.toggle("show", wordbook.includes(w.id));

  updateWordNav(); // 侧边导航联动:高亮当前词、刷新已会勾

  // 切换单词时自动播放发音:词对词条(同义/反义/缩略)连续读出两侧,普通单词读整词
  if (!playPairBothSides(w)) playWord(w.en, $("btn-sound"));
}

/** 下一个/上一个,到末尾弹出完成页 */
function goNext() {
  stopSpeak();
  if (session.idx >= session.words.length - 1) { showFinish(); return; }
  session.idx++;
  renderCard();
}

function goPrev() {
  stopSpeak();
  if (session.idx <= 0) return;
  session.idx--;
  renderCard();
}

/**
 * 标记当前词为"已会"并自动跳到下一个
 * 与生词本互斥:标记已会时若该词在生词本,则从生词本移除(一个词不能同时既"已会"又是"生词")
 */
function markKnown() {
  const w = session.words[session.idx];
  const known = store.getKnown();
  if (!known.has(w.id)) {
    known.add(w.id);
    store.setKnown(known);
    session.knownCount++;
    session.knownIds.add(w.id);
  }
  // 移除生词本收藏(互斥)
  const wb = store.getWordbook();
  if (wb.includes(w.id)) store.setWordbook(wb.filter(id => id !== w.id));
  $("wordbook-badge").classList.remove("show");
  goNext();
}

/**
 * 当前词加入/移出生词本(再次点击取消);新收藏后自动跳到下一个,便于快速筛出生词
 * 与已会互斥:收藏时若该词已标记"已会",则取消已会标记(并回退本次会话计数)
 */
function toggleWordbook() {
  const w = session.words[session.idx];
  let wb = store.getWordbook();
  const added = !wb.includes(w.id);
  if (added) {
    // 取消已会标记(互斥)
    const known = store.getKnown();
    if (known.has(w.id)) {
      known.delete(w.id);
      store.setKnown(known);
      if (session.knownIds.delete(w.id)) session.knownCount--; // 仅回退本次会话计入的
    }
    $("known-badge").classList.remove("show");
    wb.push(w.id); // 未收藏 → 加入
  } else {
    wb = wb.filter(id => id !== w.id); // 已在生词本 → 移除
  }
  store.setWordbook(wb);
  $("wordbook-badge").classList.toggle("show", added);
  if (added) goNext(); // 收藏成功才翻页;取消收藏时停在原词,便于确认状态
}

/** 学习完成弹层 */
function showFinish() {
  stopSpeak();
  $("finish-stats").innerHTML =
    `本组共 ${session.words.length} 个单词<br>本次标记已会 ${session.knownCount} 个`;
  $("finish-mask").classList.add("show");
}

/* ==================================================================
 * 七、生词本页
 * ================================================================== */

function renderWordbook() {
  const wb = store.getWordbook().map(id => WORD_BY_ID.get(id)).filter(Boolean);
  const list = $("wordbook-list");
  if (!wb.length) {
    list.innerHTML = `<div class="empty-tip">生词本还是空的,学习时点击"＋ 加入生词本"收藏单词吧</div>`;
    return;
  }
  list.innerHTML = wb.map(w => `
    <div class="wordbook-item">
      <div class="wb-word">${escapeHTML(w.en)}<small>${escapeHTML(w.zh || "")} · ${escapeHTML(w.groupName || "")}</small></div>
      <button class="btn-play" data-play="${w.id}">🔊</button>
      <button class="btn-remove" data-remove="${w.id}">移除</button>
    </div>`).join("");
}

/* ==================================================================
 * 八、事件绑定
 * ================================================================== */

function bindEvents() {
  // ---- 首页:分组"开始背诵"(事件委托) ----
  $("group-grid").addEventListener("click", e => {
    const btn = e.target.closest("[data-group]");
    if (!btn) return;
    const g = WORDS_DATA.groups.find(x => x.id === +btn.dataset.group);
    startSession(g.words.map(w => ({ ...w, groupName: g.name })), g.name);
  });

  // ---- 首页:全部单词 ----
  $("entry-all").addEventListener("click", () => startSession(ALL_WORDS, "全部单词"));

  // ---- 首页:进入生词本 ----
  $("entry-wordbook").addEventListener("click", () => { renderWordbook(); switchView("wordbook"); });

  // ---- 学习页:卡片点击隐藏/显示释义 ----
  $("flashcard").addEventListener("click", e => {
    const cur = session.words[session.idx];
    // 词对小卡片的"🔤 拼读"按钮:只播该侧的自然拼读
    const prBtn = e.target.closest(".pair-phonics-read");
    if (prBtn) {
      playPhonicsReading(cur, prBtn, +prBtn.dataset.side);
      return;
    }
    // 词对小卡片的"🔊 发音"按钮:只朗读该侧,不触发隐藏释义
    const pairBtn = e.target.closest(".pair-play");
    if (pairBtn) {
      const pair = splitPairSides(cur.parts);
      if (pair) playWord(sideText(pair.sides[+pairBtn.dataset.side]), pairBtn);
      return;
    }
    if (e.target.closest(".btn-sound")) return; // 点发音/拼读按钮不翻转
    session.showMeaning = !session.showMeaning;
    $("meaning").classList.toggle("hidden", !session.showMeaning);
  });

  // ---- 学习页:侧边导航点击跳转(事件委托) ----
  $("word-nav").addEventListener("click", e => {
    const item = e.target.closest(".word-nav-item");
    if (!item) return;
    stopSpeak();
    session.idx = +item.dataset.i;
    renderCard();
  });

  // ---- 学习页:发音/自然拼读/导航/操作按钮 ----
  $("btn-sound").addEventListener("click", () => playWord(session.words[session.idx].en, $("btn-sound")));
  $("btn-phonics-read").addEventListener("click", () => playPhonicsReading(session.words[session.idx], $("btn-phonics-read")));
  $("btn-next").addEventListener("click", goNext);
  $("btn-prev").addEventListener("click", goPrev);
  $("btn-known").addEventListener("click", markKnown);
  $("btn-add-wordbook").addEventListener("click", toggleWordbook);
  $("btn-study-back").addEventListener("click", () => { stopSpeak(); renderHome(); switchView("home"); });

  // ---- 生词本页:播放/移除(事件委托)、返回、开始背诵 ----
  $("wordbook-list").addEventListener("click", e => {
    const playBtn = e.target.closest("[data-play]");
    const removeBtn = e.target.closest("[data-remove]");
    if (playBtn) {
      const w = WORD_BY_ID.get(+playBtn.dataset.play);
      playWord(w.en, playBtn);
    } else if (removeBtn) {
      store.setWordbook(store.getWordbook().filter(id => id !== +removeBtn.dataset.remove));
      renderWordbook();
    }
  });
  $("btn-wordbook-back").addEventListener("click", () => { renderHome(); switchView("home"); });
  $("btn-study-wordbook").addEventListener("click", () => {
    const wb = store.getWordbook().map(id => WORD_BY_ID.get(id)).filter(Boolean);
    if (wb.length) startSession(wb, "生词本");
  });

  // ---- 完成弹层:再来一组/返回首页 ----
  $("btn-again").addEventListener("click", () => {
    $("finish-mask").classList.remove("show");
    // 按当前来源重新开一组(重新洗牌)
    const src = session.source;
    if (src === "全部单词") startSession(ALL_WORDS, src);
    else if (src === "生词本") {
      const wb = store.getWordbook().map(id => WORD_BY_ID.get(id)).filter(Boolean);
      if (wb.length) startSession(wb, src); else { renderHome(); switchView("home"); }
    } else {
      const g = WORDS_DATA.groups.find(x => x.name === src);
      if (g) startSession(g.words.map(w => ({ ...w, groupName: g.name })), src);
      else { renderHome(); switchView("home"); }
    }
  });
  $("btn-finish-home").addEventListener("click", () => {
    $("finish-mask").classList.remove("show");
    renderHome();
    switchView("home");
  });

  // ---- 键盘快捷键:← 上一个 → 下一个 空格 播放发音 ----
  document.addEventListener("keydown", e => {
    if (!$("view-study").classList.contains("active")) return;
    if (e.key === "ArrowRight") goNext();
    else if (e.key === "ArrowLeft") goPrev();
    else if (e.key === " ") { e.preventDefault(); playWord(session.words[session.idx].en, $("btn-sound")); }
  });
}

/* ==================================================================
 * 九、整屏高度变量
 * ================================================================== */

/**
 * 把实际可视高度与页眉占用写入 CSS 变量:
 *   --vh     可视区高度(移动端地址栏收起/展开、横竖屏切换都会改变)
 *   --chrome body 上下内边距 + 页眉高度,学习页用 可视高度 - --chrome 锁定整屏
 * 学习页因此不需要下拉即可看到完整卡片、操作按钮和铺到底部的单词导航。
 */
function setupViewportVars() {
  const set = () => {
    const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    const cs = getComputedStyle(document.body);
    const header = document.querySelector("header");
    // 页眉占用 = 上内边距 + 页眉外框高度 + 页眉下外边距 + 下内边距
    const hs = getComputedStyle(header);
    const chrome = parseFloat(cs.paddingTop) + header.offsetHeight
      + parseFloat(hs.marginBottom) + parseFloat(cs.paddingBottom);
    document.documentElement.style.setProperty("--vh", h + "px");
    document.documentElement.style.setProperty("--chrome", chrome + "px");
  };
  set();
  window.addEventListener("resize", set);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", set);
}

/* ==================================================================
 * 十、启动
 * ================================================================== */

showLoading();          // 全屏 loading:初始化数据
setupViewportVars();    // 先量好可视高度与页眉,首帧即为整屏布局
renderHome();           // 渲染首页分组
bindEvents();           // 绑定所有交互事件
hideLoading();
