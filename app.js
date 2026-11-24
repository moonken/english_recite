/**
 * 自然拼读背单词 - 应用逻辑
 * 功能:单词卡片(自然拼读分段着色)、已会、生词本、上一个/下一个(点卡片亦等同下一个)、
 *      章节切换弹层、学完一章跳下一章、
 *      单词测试(听写 / 看中文写英文 / 看英文选中文,错词自动进生词本,测完可复习错词)、
 *      指定单词背诵(独立词表 specified_words.js,富内容卡片:词组/近义词/词根词缀/词源)
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
 * 用于同义词/反义词/缩略词组;非词对词条(含 parts 为空的词条)返回 null
 * @returns {{sides:Array, seps:Array}|null}
 */
function splitPairSides(parts) {
  if (!parts) return null;
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
  return (word.parts || []).filter(p => p.ph).map(p => "/" + p.ph + "/").join("  ");
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

/**
 * 播放真人发音(有道词典音源,失败 TTS 兜底)
 * @param {string} text 要朗读的文本
 * @param {Element} [btn] 触发按钮(播放期间进入"加载中"禁用态,播完还原)
 * @param {boolean} [whole] true=整句/词组朗读不拆分(指定单词词组);默认按词对规则只读 – / = 之前的部分
 */
function playWord(text, btn, whole = false) {
  // 词对词条只朗读左半部分( – / = 之前);整句朗读(whole)不做拆分
  const speakText = whole ? text.trim() : text.split(/[–=]/)[0].trim();
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

/* ---- 指定单词组:外部提供的背诵词表(specified_words.js,96 词) ----
 * 词条在普通字段外另带英美音标/完整释义/例句/词组/近义词/词根词缀/词源,
 * 以及由 build_specified_parts.mjs 生成的自然拼读分段 w 字段(卡片着色与逐音素拼读共用),
 * 学习页对这类词走"指定单词卡片"渲染分支(见 renderSpecCard);id 为 9001+,与普通词库(1~1379)隔离
 * 并入分组列表最前:首页分组卡片、章节弹层、生词本分组、测试范围都会自动出现该组 */
const SPEC_GROUP = {
  id: 35,
  name: "指定单词",
  words: SPECIFIED_WORDS.map(w => ({ ...w, spec: true })),
};
WORDS_DATA.groups.unshift(SPEC_GROUP);

/* ---- 六上生词组:沪教版(五四学制)(2024)六年级上册词表(grade6_words.js,157 词) ----
 * 覆盖 Starter + Unit 1~6,词条为普通拼读卡片(en/zh/sub/parts),sub 为单元标签;
 * parts 由 build_grade6.mjs 生成(优先复用现有词库同名词条,其余新生成,含铁律与音素映射校验);
 * 词 id 为 10001+,与普通词库(1~1379)、指定单词组(9001~9096)隔离,已会/生词本共用 localStorage;
 * 按 sub 单元切分为 7 个独立章节(Starter + Unit 1~6,组 id 36~42),每个单元可单独背诵/测试/收藏;
 * 章节即分组:首页卡片、章节弹层、生词本分组、测试范围都按单元出现,排在指定单词组之后 */
const GRADE6_UNITS = [...new Set(GRADE6_WORDS.map(w => w.sub))]; // 去重且保持词表单元顺序
const GRADE6_GROUPS = GRADE6_UNITS.map((sub, i) => ({
  id: 36 + i,
  name: "六上 · " + sub,
  words: GRADE6_WORDS.filter(w => w.sub === sub),
}));
WORDS_DATA.groups.splice(1, 0, ...GRADE6_GROUPS);

// 拍平全部单词,便于"全部单词"模式和按 id 查找
const ALL_WORDS = [];
WORDS_DATA.groups.forEach(g => {
  g.words.forEach(w => ALL_WORDS.push({ ...w, groupName: g.name, groupId: g.id }));
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
  groupId: 0,     // 当前章节(分组)id;0 表示非章节会话(全部单词/生词本),用于章节切换与"下一章节"
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
  // 测试入口:显示生词本数量
  $("entry-test-count").textContent = wordbook.length
    ? `生词本 ${wordbook.length} 词 · 混合题型 · 可选范围`
    : "先收藏生词再来测试";

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
 * @param {number} [groupId] 章节(分组)id;非章节会话(全部单词/生词本)传 0
 */
function startSession(words, source, groupId = 0) {
  if (!words.length) return;
  showLoading(); // 全屏 loading:准备学习数据
  session.words = shuffle(words);
  session.idx = 0;
  session.knownCount = 0;
  session.knownIds = new Set(); // 重置本次已会标记集合
  session.source = source;
  session.groupId = groupId;
  renderStudySource(); // 右上角章节名(点击可切换章节)
  renderWordNav(); // 渲染侧边单词导航
  switchView("study");
  renderCard();
  hideLoading();
}

/** 开始学习某个章节:记录章节 id,供章节弹层高亮与完成后"下一章节"使用 */
function startGroup(g) {
  startSession(g.words.map(w => ({ ...w, groupName: g.name, groupId: g.id })), g.name, g.id);
}

/** 学习页右上角章节名(带下拉箭头,点击弹出章节列表) */
function renderStudySource() {
  $("study-source-name").textContent = session.source;
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

/** 渲染当前单词卡片:普通词条走自然拼读卡片,指定单词走富内容卡片 */
function renderCard() {
  const w = session.words[session.idx];
  const known = store.getKnown();
  const wordbook = store.getWordbook();

  // 进度显示
  $("study-progress-text").textContent = `${session.idx + 1}/${session.words.length}`;
  $("study-progress-bar").style.width = ((session.idx + 1) / session.words.length * 100) + "%";

  // 角标与子分组标签(两种卡片通用)
  $("known-badge").classList.toggle("show", known.has(w.id));
  $("wordbook-badge").classList.toggle("show", wordbook.includes(w.id));
  $("sub-name").textContent = w.sub || w.groupName || "";

  if (w.spec) {
    renderSpecCard(w); // 指定单词:富内容卡片(无自然拼读分段)
  } else {
    // 卡片内容:自然拼读着色单词 + 整词音标 + 释义
    // 词对词条:音标拆到左右小卡片内(隐藏整词音标行),发音/拼读按钮也在卡片内(隐藏下方按钮行)
    $("phonics-word").innerHTML = renderPhonicsHTML(w);
    const pairMode = isPairEntry(w);
    $("phonetic").style.display = pairMode ? "none" : "";
    $("phonetic").textContent = pairMode ? "" : fullPhonetic(w);
    document.querySelector(".sound-btns").style.display = pairMode ? "none" : "";
    $("meaning").textContent = w.zh || "(无释义)";
    // 无释义词条(如缩略词组):隐藏释义行,避免多余占位
    $("meaning").style.display = w.zh ? "" : "none";
    $("meaning").classList.remove("spec");
    // 普通词条:恢复拼读按钮与颜色图例,隐藏指定单词详情区
    $("btn-phonics-read").style.display = "";
    document.querySelector(".legend").style.display = "";
    $("spec-detail").style.display = "none";
  }

  updateWordNav(); // 侧边导航联动:高亮当前词、刷新已会勾

  // 切换单词时自动播放发音:词对词条(同义/反义/缩略)连续读出两侧,其余读整词
  if (!playPairBothSides(w)) playWord(w.en, $("btn-sound"));
}

/**
 * 渲染指定单词卡片:彩色自然拼读分段单词 + 英美音标 + 主释义 + 可折叠详情(词组/近义词/词根词缀/词源)
 * 指定单词的分段数据(w 字段)由 build_specified_parts.mjs 生成注入,拼读/发音按钮与普通词条共用
 */
function renderSpecCard(w) {
  $("phonics-word").innerHTML = renderPhonicsHTML(w);
  // 音标行:英式/美式读音相同只展示一条
  $("phonetic").style.display = "";
  $("phonetic").textContent = w.phonUk === w.phonUs
    ? "/" + w.phonUk + "/"
    : "英 /" + w.phonUk + "/  ·  美 /" + w.phonUs + "/";
  document.querySelector(".sound-btns").style.display = "";
  // 主释义:整条展示(比普通词条字号小,详见 .meaning.spec 样式);其余义项在详情区"释义"小节
  const meaning = $("meaning");
  meaning.textContent = w.mainZh || w.zh || "(无释义)";
  meaning.style.display = w.mainZh || w.zh ? "" : "none";
  meaning.classList.add("spec");
  const detail = $("spec-detail");
  detail.innerHTML = renderSpecDetailHTML(w);
  detail.style.display = "";
}

/**
 * 渲染指定单词的可折叠详情区
 * 小节:词组(默认展开)/近义词/词根词缀/词源;空数据小节不渲染
 * 词组带发音按钮(data-play-ph),由 spec-detail 的事件委托处理
 */
function renderSpecDetailHTML(w) {
  // sec(openFlag):词组小节默认展开,其余默认收起
  const sec = (title, count, body, openFlag) =>
    `<div class="sp-sec${openFlag ? " open" : ""}">` +
    `<div class="sp-sec-head">${title}<span class="sp-count">${count}</span><span class="sp-caret">▶</span></div>` +
    `<div class="sp-sec-body">${body}</div></div>`;
  const secs = [];

  // 词组:每条带发音按钮(默认展开,便于跟读记忆)
  if (w.phrases.length) {
    secs.push(sec("词组", w.phrases.length, w.phrases.map((p, i) =>
      `<div class="sp-ph">` +
      `<button class="sp-play" data-play-ph="${i}" title="播放词组发音" aria-label="播放词组发音">🔊</button>` +
      `<span class="sp-en">${escapeHTML(p.c)}</span><span class="sp-cn">${escapeHTML(p.cn)}</span>` +
      `</div>`).join(""), true));
  }
  // 近义词:词性 + 释义 + 同义词胶囊
  if (w.synos.length) {
    secs.push(sec("近义词", w.synos.length, w.synos.map(s =>
      `<div class="sp-syn"><b>${escapeHTML(s.pos)}</b>${escapeHTML(s.cn)}` +
      (s.ws && s.ws.length
        ? `<div class="sp-ws">${s.ws.map(x => `<i>${escapeHTML(x)}</i>`).join("")}</div>`
        : "") +
      `</div>`).join("")));
  }
  // 词根词缀:词根 + 按词性分组的派生词
  const rel = w.relWords;
  if (rel && (rel.root || (rel.rels && rel.rels.length))) {
    const relBody =
      (rel.root ? `<div class="sp-root">词根:${escapeHTML(rel.root)}</div>` : "") +
      (rel.rels || []).map(r =>
        `<div class="sp-rel"><b>${escapeHTML(r.pos)}</b>` +
        (r.words || []).map(x =>
          `<div class="sp-rel-word"><span class="sp-en">${escapeHTML(x.c)}</span><span class="sp-cn">${escapeHTML(x.cn)}</span></div>`
        ).join("") +
        `</div>`).join("");
    secs.push(sec("词根词缀", (rel.rels || []).reduce((n, r) => n + (r.words || []).length, 0), relBody));
  }
  // 词源:t=标题(词:义),d=说明(保留换行)
  if (w.etymology.length) {
    secs.push(sec("词源", w.etymology.length, w.etymology.map(e =>
      `<div class="sp-ety">` +
      (e.t ? `<p class="sp-en">${escapeHTML(e.t)}</p>` : "") +
      `<p class="sp-cn">${escapeHTML(e.d || "")}</p>` +
      `</div>`).join("")));
  }
  return secs.join("");
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

/**
 * 学习完成弹层:统计 + 下一章节 / 再来一遍 / 返回首页三个去处
 * "下一章节"只在章节会话且后面还有章节时显示(最后一章、全部单词、生词本会话都不显示)
 */
function showFinish() {
  stopSpeak();
  $("finish-stats").innerHTML =
    `本组共 ${session.words.length} 个单词<br>本次标记已会 ${session.knownCount} 个`;
  const next = nextChapter();
  $("btn-next-chapter").style.display = next ? "" : "none";
  if (next) $("btn-next-chapter").textContent = `下一章节:${next.name}`;
  $("finish-mask").classList.add("show");
}

/** 当前章节的下一个章节;非章节会话或已是最后一章时返回 null */
function nextChapter() {
  if (!session.groupId) return null;
  const i = WORDS_DATA.groups.findIndex(g => g.id === session.groupId);
  return i >= 0 && i + 1 < WORDS_DATA.groups.length ? WORDS_DATA.groups[i + 1] : null;
}

/* ==================================================================
 * 六·五、章节切换弹层(学习页右上角章节名)
 * ================================================================== */

/** 渲染章节列表:序号 + 章节名 + 词数,当前正在学的章节高亮 */
function renderChapterList() {
  $("chapter-list").innerHTML = WORDS_DATA.groups.map(g => `
    <button class="chapter-item${g.id === session.groupId ? " current" : ""}" data-group="${g.id}">
      <span class="ch-id">${g.id}.</span>
      <span class="ch-name">${escapeHTML(g.name)}</span>
      <span class="ch-count">${g.words.length} 词</span>
    </button>`).join("");
}

/** 打开章节弹层,并把当前章节滚动到可见位置 */
function openChapterPopup() {
  renderChapterList();
  $("chapter-mask").classList.add("show");
  const cur = $("chapter-list").querySelector(".chapter-item.current");
  if (cur) cur.scrollIntoView({ block: "nearest" });
}

/** 关闭章节弹层 */
function closeChapterPopup() {
  $("chapter-mask").classList.remove("show");
}

/* ==================================================================
 * 七、生词本页
 * ================================================================== */

/**
 * 渲染生词本页:按章节分组展示,每组可折叠
 * 顶部显示总生词本统计,下方按章节列出单词
 */
function renderWordbook() {
  const wb = store.getWordbook().map(id => WORD_BY_ID.get(id)).filter(Boolean);
  const chapters = groupWordbookByChapter();

  // 顶部统计
  $("wb-total-tip").textContent = wb.length
    ? `共收藏 ${wb.length} 个生词,分布在 ${chapters.length} 个章节`
    : "生词本还是空的,学习时点击\"+ 加入生词本\"收藏单词吧";

  // 按章节渲染
  const container = $("wb-chapters");
  if (!chapters.length) {
    container.innerHTML = `<div class="empty-tip">还没有收藏任何单词</div>`;
    return;
  }

  container.innerHTML = chapters.map(ch => `
    <div class="wb-chapter" data-gid="${ch.groupId}">
      <div class="wb-chapter-head">
        <span class="wb-caret">▶</span>
        <span class="wb-chapter-name">${ch.groupId}. ${escapeHTML(ch.groupName)}</span>
        <span class="wb-chapter-count">${ch.words.length} 词</span>
        <div class="wb-chapter-btns">
          <button class="wb-ch-btn" data-test-chapter="${ch.groupId}">测试</button>
          <button class="wb-ch-study" data-study-chapter="${ch.groupId}">背诵</button>
        </div>
      </div>
      <div class="wb-chapter-body">
        <div class="wordbook-list">
          ${ch.words.map(w => `
            <div class="wordbook-item">
              <div class="wb-word">${escapeHTML(w.en)}<small>${escapeHTML(w.zh || "")}</small></div>
              <button class="btn-play" data-play="${w.id}">🔊</button>
              <button class="btn-remove" data-remove="${w.id}">移除</button>
            </div>`).join("")}
        </div>
      </div>
    </div>`).join("");
}

/* ==================================================================
 * 七·五、单词测试:听写 / 看中文写英文 / 看英文选中文
 * 每组最多 TEST_LIMIT 题:生词本单词全部必考,已会单词随机抽取补足,每词只考一次;
 * 三种模式出题时都会朗读该词(真人发音),答错的词直接加入生词本
 * (并按互斥规则取消其"已会"标记);测完在结果页可"复习错词",进入学习页只背这些错词
 * ================================================================== */

/** 三种测试模式:id 对应 test.mode,name 用于顶栏与模式卡片 */
const TEST_MODES = [
  { id: "dictation", name: "听写", desc: "只听真人发音,写出英文单词" },
  { id: "zh2en", name: "看中文写英文", desc: "看中文释义(同时播发音),写出英文单词" },
  { id: "en2zh", name: "看英文选中文", desc: "看英文单词并听发音,选出正确的中文释义" },
];

/** 各模式的题干提示语 */
const TEST_PROMPTS = {
  dictation: "听发音,写出英文单词",
  zh2en: "看中文,写出英文单词",
  en2zh: "看英文,选出正确的中文释义",
};

// 测试会话状态
const test = {
  mode: "dictation", // 当前模式(默认听写)
  words: [],         // 本次题目:题源洗牌后的结果,每词一题
  idx: 0,            // 当前题号
  results: [],       // 每题结果 {word, correct, given}
  locked: false,     // 本题是否已判分(判分后锁定,防止改答案)
  options: [],       // 选择题的四个选项(中文释义)
  answerZh: "",      // 选择题的正确释义
};

// 本组答错的词(结果页"复习错词"用;学完弹层"再来一遍"也靠它重开同一份词表)
let reviewWords = [];

/** 取词条第一个中文义项(题干、选项、错题列表展示用) */
function firstZh(w) {
  return (w.zh || "").split(/[;,;、]/)[0] || "(无释义)";
}

/**
 * 把生词本按章节(分组)归类
 * @returns {Array<{groupId:number, groupName:string, words:Array}>} 每章含词列表,按组排序;空生词本返回空数组
 */
function groupWordbookByChapter() {
  const wb = store.getWordbook();
  const map = new Map(); // groupId -> {groupId, groupName, words}
  for (const id of wb) {
    const w = WORD_BY_ID.get(id);
    if (!w) continue;
    const gid = w.groupId;
    if (!map.has(gid)) {
      const g = WORDS_DATA.groups.find(x => x.id === gid);
      map.set(gid, { groupId: gid, groupName: g ? g.name : "未知分组", words: [] });
    }
    map.get(gid).words.push(w);
  }
  return [...map.values()].sort((a, b) => a.groupId - b.groupId);
}

/** 每组测试的题数上限(生词本必考词超出上限时,这一组只考生词本) */
const TEST_LIMIT = 50;

/**
 * 构建测试题库:根据范围和选项生成候选词列表
 * @param {string} scope - "all" 全部生词本, 或 "chapter:N" 某章节
 * @param {boolean} includeKnown - 是否包含已会单词
 * @returns {Array} 候选单词数组
 */
function buildTestPool(scope, includeKnown) {
  const wbIds = new Set(store.getWordbook());
  const known = store.getKnown();

  // 确定范围内的生词本单词(必考)
  let wbWords;
  if (scope === "all") {
    wbWords = ALL_WORDS.filter(w => wbIds.has(w.id));
  } else {
    const gid = parseInt(scope.split(":")[1]);
    wbWords = ALL_WORDS.filter(w => wbIds.has(w.id) && w.groupId === gid);
  }

  // 可选池:非生词本单词(或已会单词)
  let optional = [];
  if (includeKnown) {
    // 包含已会单词:从已会中抽(排除已在生词本的)
    optional = ALL_WORDS.filter(w => known.has(w.id) && !wbIds.has(w.id));
    if (scope !== "all") {
      const gid = parseInt(scope.split(":")[1]);
      optional = optional.filter(w => w.groupId === gid);
    }
  } else {
    // 不包含已会:从非生词本、非已会中抽
    optional = ALL_WORDS.filter(w => !wbIds.has(w.id) && !known.has(w.id));
    if (scope !== "all") {
      const gid = parseInt(scope.split(":")[1]);
      optional = optional.filter(w => w.groupId === gid);
    }
  }

  return { wbWords, optional };
}

/** 模式中文名(顶栏与结果页展示) */
function testModeName(id) {
  const m = TEST_MODES.find(x => x.id === id);
  return m ? m.name : "";
}

/** 切换测试阶段:setup 选模式 / quiz 答题 / result 结果 */
function showTestStage(name) {
  document.querySelectorAll("#view-test .test-stage").forEach(el => {
    el.classList.toggle("show", el.id === "test-" + name);
  });
}

/** 打开测试页:支持预设范围(从生词本页进入时) */
function openTest(scope = "all") {
  renderTestSetup(scope);
  switchView("test");
}

/** 渲染测试配置页:选范围/模式/数量/选项 */
function renderTestSetup(presetScope = "all") {
  stopSpeak();
  const chapters = groupWordbookByChapter();

  // 范围下拉:全部生词本 + 各章节(仅显示有生词的章节)
  const scopeSelect = $("tc-scope");
  scopeSelect.innerHTML = `<option value="all">全部生词本</option>` +
    chapters.map(ch => `<option value="chapter:${ch.groupId}">${ch.groupId}. ${escapeHTML(ch.groupName)} (${ch.words.length}词)</option>`).join("");
  scopeSelect.value = presetScope;

  // 模式切换按钮(可多选)
  $("mode-toggles").innerHTML = TEST_MODES.map(m => `
    <button class="mode-toggle selected" data-mode="${m.id}" aria-pressed="true">
      <span class="mt-name">${m.name}</span>
      <span class="mt-desc">${m.desc.split(",")[0]}</span>
    </button>`).join("");
  $("tc-mixed-label").style.display = "none";

  // 数量输入:默认 20
  $("tc-qty").value = 20;

  // 选项:默认不包含已会
  $("tc-include-known").checked = false;

  // 更新题库信息
  updateTestPoolInfo();
  showTestStage("setup");
}

/** 更新题库信息(范围/选项变化时调用) */
function updateTestPoolInfo() {
  const scope = $("tc-scope").value;
  const includeKnown = $("tc-include-known").checked;
  const { wbWords, optional } = buildTestPool(scope, includeKnown);
  const maxQty = wbWords.length + optional.length;

  $("tc-max-qty").textContent = maxQty;
  $("test-pool-count").textContent = `题库 ${maxQty} 词`;

  const info = [];
  info.push(`生词本 ${wbWords.length} 词(必考)`);
  if (optional.length) info.push(`可选池 ${optional.length} 词`);
  if (includeKnown) info.push(`含已会单词`);
  $("tc-info").textContent = info.join(" · ");

  // 数量不能超过题库上限
  const qtyInput = $("tc-qty");
  if (+qtyInput.value > maxQty) qtyInput.value = maxQty;
  qtyInput.max = maxQty;

  // 题库为空时禁用开始按钮
  $("btn-start-test").disabled = !maxQty;
}

/** 开始测试:读取配置,构建题库,随机分配模式 */
function startTest() {
  const scope = $("tc-scope").value;
  const includeKnown = $("tc-include-known").checked;
  const qty = Math.min(+$("tc-qty").value || 20, 200);

  // 读取选中的模式(至少一个)
  const selectedModes = [...document.querySelectorAll("#mode-toggles .mode-toggle.selected")]
    .map(btn => btn.dataset.mode);
  if (!selectedModes.length) return;

  // 构建题库
  const { wbWords, optional } = buildTestPool(scope, includeKnown);
  if (!wbWords.length && !optional.length) return;

  // 必考词 + 随机补足
  const must = shuffle(wbWords);
  const quota = Math.max(0, qty - must.length);
  const pool = must.concat(shuffle(optional).slice(0, quota));
  if (!pool.length) return;

  // 保存配置到测试状态
  test.config = { scope, modes: selectedModes, qty, includeKnown };
  test.words = shuffle(pool);
  test.idx = 0;
  test.results = [];

  showLoading();
  showTestStage("quiz");
  renderTestQuestion();
  hideLoading();
}

/** 渲染当前题目:按模式(混合时随机选)决定题干与作答区;三种模式都自动播放该词真人发音 */
function renderTestQuestion() {
  const w = test.words[test.idx];

  // 混合模式:每道题随机选一个模式
  if (test.config && test.config.modes.length > 1) {
    test.mode = test.config.modes[Math.floor(Math.random() * test.config.modes.length)];
  } else if (test.config && test.config.modes.length === 1) {
    test.mode = test.config.modes[0];
  }
  // else: 保持 test.mode 不变(兼容旧逻辑)

  const writing = test.mode !== "en2zh"; // 听写 / 看中文写英文都是写答题
  test.locked = false;
  test.options = [];
  test.answerZh = "";

  // 进度与模式名
  $("test-progress-text").textContent = `${test.idx + 1}/${test.words.length}`;
  $("test-progress-bar").style.width = ((test.idx + 1) / test.words.length * 100) + "%";
  $("test-mode-name").textContent = testModeName(test.mode);
  $("test-prompt").textContent = TEST_PROMPTS[test.mode];

  // 题干主体:听写只给发音不给文字
  if (test.mode === "dictation") {
    $("test-question").textContent = "";
  } else if (test.mode === "zh2en") {
    $("test-question").textContent = w.zh || "(无释义)";
  } else {
    $("test-question").innerHTML =
      escapeHTML(w.en) + `<span class="q-ipa">${escapeHTML(fullPhonetic(w))}</span>`;
  }

  // 作答区:写答题显示输入框,选择题显示四个选项;重听按钮三种模式都提供
  $("btn-test-listen").style.display = "";
  $("test-input-row").style.display = writing ? "" : "none";
  $("test-options").style.display = writing ? "none" : "";
  const input = $("test-input");
  input.value = "";
  input.disabled = false;
  input.className = "";
  if (writing) input.focus({ preventScroll: true }); // 写答题直接聚焦,手机自动弹键盘

  if (!writing) {
    test.answerZh = firstZh(w);
    test.options = buildTestOptions(w, test.answerZh);
    $("test-options").innerHTML = test.options
      .map((zh, i) => `<button data-i="${i}">${escapeHTML(zh)}</button>`).join("");
  }

  // 反馈清空;主按钮:写答题为"提交答案",选择题先禁用(点选项即判分)
  const fb = $("test-feedback");
  fb.className = "test-feedback";
  fb.textContent = "";
  const main = $("btn-test-main");
  main.textContent = writing ? "提交答案" : "下一题";
  main.disabled = !writing;

  // 三种模式出题都自动朗读该词一遍(词对词条读左侧,与学习页一致),可随时点大喇叭重听
  playWord(w.en, $("btn-test-listen"));
}

/** 生成选择题选项:正确释义 + 三个不重复的干扰释义(题库不足 4 词时从全部单词补) */
function buildTestOptions(w, answerZh) {
  const cand = shuffle(test.words.length >= 4 ? test.words : ALL_WORDS);
  const picked = [answerZh];
  for (const c of cand) {
    if (c.id === w.id) continue;
    const zh = firstZh(c);
    if (picked.includes(zh)) continue; // 释义重复会出现多个"正确答案",跳过
    picked.push(zh);
    if (picked.length === 4) break;
  }
  return shuffle(picked);
}

/** 归一化答案:转小写、去首尾空格、合并连续空格、去句末点号 */
function normalizeAnswer(s) {
  return s.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.。]+$/, "");
}

/** 写答题判分:整条英文拼对、或词对词条任一侧拼对,都算正确 */
function isSpellingCorrect(input, w) {
  const got = normalizeAnswer(input);
  if (!got) return false;
  const accepts = [w.en];
  const pair = splitPairSides(w.parts);
  if (pair) pair.sides.forEach(s => accepts.push(sideText(s)));
  return accepts.some(a => normalizeAnswer(a) === got);
}

/** 主按钮:未判分时提交写答内容,已判分时进入下一题 */
function onTestMain() {
  if (!$("test-quiz").classList.contains("show")) return;
  if (!test.locked) submitWrittenAnswer();
  else goNextQuestion();
}

/** 提交写答答案(输入为空时不判分,避免误判错) */
function submitWrittenAnswer() {
  const input = $("test-input");
  const val = input.value.trim();
  if (!val) return;
  finishQuestion(isSpellingCorrect(val, test.words[test.idx]), val);
}

/** 选择题:点选项即判分 */
function answerOption(i) {
  if (test.locked) return;
  finishQuestion(test.options[i] === test.answerZh, test.options[i]);
}

/**
 * 判分收尾:记录结果、答错的词直接加入生词本、锁定本题并展示反馈
 * @param {boolean} correct 是否答对
 * @param {string} given 用户给出的答案(写答的拼写 / 选中的释义)
 */
function finishQuestion(correct, given) {
  const w = test.words[test.idx];
  test.locked = true;
  test.results.push({ word: w, correct, given });
  if (!correct) addWrongToWordbook(w); // 错词直接进生词本

  const fb = $("test-feedback");
  fb.className = "test-feedback " + (correct ? "right" : "wrong");
  fb.textContent = correct
    ? "回答正确 ✓"
    : `正确答案:${w.en} · ${firstZh(w)}(已加入生词本)`;

  // 作答区锁定并着色:选择题标出正确项与错选项,写答题给输入框着色
  if (test.mode === "en2zh") {
    $("test-options").querySelectorAll("button").forEach(btn => {
      const zh = test.options[+btn.dataset.i];
      btn.disabled = true;
      if (zh === test.answerZh) btn.classList.add("right");
      else if (zh === given) btn.classList.add("wrong");
    });
  } else {
    const input = $("test-input");
    input.disabled = true;
    input.classList.add(correct ? "right" : "wrong");
  }

  // 主按钮切到"下一题"(最后一题为"查看结果")
  const main = $("btn-test-main");
  main.disabled = false;
  main.textContent = test.idx >= test.words.length - 1 ? "查看结果" : "下一题";
}

/**
 * 答错的词直接加入生词本;按"已会/生词本互斥"规则同时取消其已会标记
 * (测试就是检验"已会"是否真的会,答错说明还不该算已会)
 */
function addWrongToWordbook(w) {
  const wb = store.getWordbook();
  if (!wb.includes(w.id)) {
    wb.push(w.id);
    store.setWordbook(wb);
  }
  const known = store.getKnown();
  if (known.delete(w.id)) store.setKnown(known);
}

/** 下一题;已是最后一题则进入结果页 */
function goNextQuestion() {
  stopSpeak();
  if (test.idx >= test.words.length - 1) { showTestResult(); return; }
  test.idx++;
  renderTestQuestion();
}

/** 结果页:答对/答错统计 + 错题列表(错题已自动加入生词本) */
function showTestResult() {
  stopSpeak();
  const wrong = test.results.filter(r => !r.correct);
  const right = test.results.length - wrong.length;
  reviewWords = wrong.map(r => r.word); // 记住错词,供"复习错词"与学完后"再来一遍"复用

  // 显示使用的模式(混合时显示多个)
  const modesUsed = test.config && test.config.modes.length > 1
    ? test.config.modes.map(testModeName).join(" + ")
    : testModeName(test.mode);
  $("result-mode-name").textContent = modesUsed;

  $("result-summary").innerHTML =
    `<div class="rs-big">${right} / ${test.results.length}</div>` +
    `<div class="rs-sub">答对 ${right} 题 · 答错 ${wrong.length} 题` +
    (wrong.length ? "<br>错题已加入生词本,并取消「已会」标记" : "") +
    `</div>`;
  $("result-list-title").style.display = wrong.length ? "" : "none";
  $("result-list-title").textContent = `错题(${wrong.length})`;
  $("result-list").innerHTML = wrong.length
    ? wrong.map(r => `
      <div class="result-item">
        <span class="ri-en">${escapeHTML(r.word.en)}</span>
        <span class="ri-zh">${escapeHTML(r.word.zh || "")}</span>
        <span class="ri-given">你的答案:${escapeHTML(r.given || "未作答")}</span>
      </div>`).join("")
    : `<div class="empty-tip">全部答对 🎉</div>`;
  // 复习错词按钮:有错题才显示,点击进入学习页只背这些错词
  const reviewBtn = $("btn-review-wrong");
  reviewBtn.style.display = wrong.length ? "" : "none";
  reviewBtn.textContent = `复习错词(${wrong.length})`;
  showTestStage("result");
}

/** 复习错词:把本组答错的词作为一次学习会话(单词卡片 + 发音 + 拼读),学完可再来一遍 */
function reviewWrongWords() {
  if (!reviewWords.length) return;
  startSession(reviewWords, `错词复习(${reviewWords.length})`);
}

/** 测试页事件绑定(由 bindEvents 调用) */
function bindTestEvents() {
  // ---- 模式切换按钮(可多选) ----
  $("mode-toggles").addEventListener("click", e => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    btn.classList.toggle("selected");
    btn.setAttribute("aria-pressed", btn.classList.contains("selected"));
    // 显示/隐藏"混合出题"标签
    const selected = document.querySelectorAll("#mode-toggles .mode-toggle.selected");
    $("tc-mixed-label").style.display = selected.length > 1 ? "" : "none";
  });

  // ---- 范围/选项变化时更新题库信息 ----
  $("tc-scope").addEventListener("change", updateTestPoolInfo);
  $("tc-include-known").addEventListener("change", updateTestPoolInfo);

  // ---- 数量预设按钮 ----
  $("tc-presets").addEventListener("click", e => {
    const btn = e.target.closest("[data-qty]");
    if (!btn) return;
    $("tc-qty").value = btn.dataset.qty;
  });

  // ---- 开始测试 ----
  $("btn-start-test").addEventListener("click", startTest);
  $("btn-test-back").addEventListener("click", () => { stopSpeak(); renderHome(); switchView("home"); });

  // ---- 答题:提交/下一题、重听发音、选选项、退出本组 ----
  $("btn-test-main").addEventListener("click", onTestMain);
  $("btn-test-listen").addEventListener("click", () => playWord(test.words[test.idx].en, $("btn-test-listen")));
  $("test-options").addEventListener("click", e => {
    const btn = e.target.closest("[data-i]");
    if (btn) answerOption(+btn.dataset.i);
  });
  $("btn-quiz-back").addEventListener("click", () => renderTestSetup(test.config ? test.config.scope : "all"));

  // ---- 结果页:复习错词 / 再来一遍(同配置重新出题)/ 换模式 / 返回首页 ----
  $("btn-review-wrong").addEventListener("click", reviewWrongWords);
  $("btn-test-again").addEventListener("click", startTest);
  $("btn-result-back").addEventListener("click", () => renderTestSetup(test.config ? test.config.scope : "all"));
  $("btn-test-home").addEventListener("click", () => { renderHome(); switchView("home"); });

  // ---- 回车:未判分时提交答案,已判分时下一题 ----
  document.addEventListener("keydown", e => {
    if (!$("view-test").classList.contains("active")) return;
    if (!$("test-quiz").classList.contains("show")) return;
    if (e.key !== "Enter") return;
    // 焦点在按钮上时由按钮自己响应回车,避免一次回车触发两件事
    if (e.target.closest && e.target.closest("button")) return;
    e.preventDefault();
    onTestMain();
  });
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
    if (g) startGroup(g);
  });

  // ---- 首页:全部单词 ----
  $("entry-all").addEventListener("click", () => startSession(ALL_WORDS, "全部单词"));

  // ---- 首页:进入生词本 ----
  $("entry-wordbook").addEventListener("click", () => { renderWordbook(); switchView("wordbook"); });

  // ---- 首页:进入单词测试 ----
  $("entry-test").addEventListener("click", openTest);

  // ---- 学习页:卡片点击 = 下一个单词;卡片内动态渲染的按钮用事件委托 ----
  // 用捕获阶段处理:发音按钮点击后 innerHTML 被同步替换,原点击目标(图标/文字)脱离 DOM,
  // 若在冒泡阶段再 closest("button") 会因目标已断链而失配,导致点发音误翻页
  $("flashcard").addEventListener("click", e => {
    // 卡片内按钮(发音/拼读/词对按钮/例句发音):一律不翻页
    const btn = e.target.closest("button");
    if (btn) {
      // 词对小卡片的"拼读"按钮:只播该侧的自然拼读
      if (btn.classList.contains("pair-phonics-read")) {
        playPhonicsReading(session.words[session.idx], btn, +btn.dataset.side);
        return;
      }
      // 词对小卡片的"发音"按钮:只朗读该侧
      if (btn.classList.contains("pair-play")) {
        const pair = splitPairSides(session.words[session.idx].parts);
        if (pair) playWord(sideText(pair.sides[+btn.dataset.side]), btn);
        return;
      }
      return; // 其余按钮各自有监听处理播放
    }
    // 指定单词详情区:点击内部不翻页(内容可滚动、含折叠小节与发音按钮)
    if (e.target.closest("#spec-detail")) return;
    goNext(); // 点卡片空白处等同"下一个"
  }, true);

  // ---- 学习页:侧边导航点击跳转(事件委托) ----
  $("word-nav").addEventListener("click", e => {
    const item = e.target.closest(".word-nav-item");
    if (!item) return;
    stopSpeak();
    session.idx = +item.dataset.i;
    renderCard();
  });

  // ---- 指定单词详情区:小节折叠/展开 + 词组发音(事件委托) ----
  $("spec-detail").addEventListener("click", e => {
    // 词组发音
    const phBtn = e.target.closest("[data-play-ph]");
    if (phBtn) {
      const w = session.words[session.idx];
      const p = w.phrases && w.phrases[+phBtn.dataset.playPh];
      if (p) playWord(p.c, phBtn, true);
      return;
    }
    // 小节标题:折叠/展开
    const head = e.target.closest(".sp-sec-head");
    if (head) head.parentElement.classList.toggle("open");
  });

  // ---- 学习页:发音/自然拼读/导航/操作按钮 ----
  $("btn-sound").addEventListener("click", () => playWord(session.words[session.idx].en, $("btn-sound")));
  $("btn-phonics-read").addEventListener("click", () => playPhonicsReading(session.words[session.idx], $("btn-phonics-read")));
  $("btn-next").addEventListener("click", goNext);
  $("btn-prev").addEventListener("click", goPrev);
  $("btn-known").addEventListener("click", markKnown);
  $("btn-add-wordbook").addEventListener("click", toggleWordbook);
  $("btn-study-back").addEventListener("click", () => { stopSpeak(); renderHome(); switchView("home"); });

  // ---- 学习页:右上角章节名 → 弹出章节列表,点章节即切换 ----
  $("study-source").addEventListener("click", openChapterPopup);
  $("chapter-list").addEventListener("click", e => {
    const item = e.target.closest("[data-group]");
    if (!item) return;
    const g = WORDS_DATA.groups.find(x => x.id === +item.dataset.group);
    closeChapterPopup();
    if (g) startGroup(g);
  });
  // 关闭按钮 / 遮罩空白处 / Esc 都能收起章节弹层
  $("btn-chapter-close").addEventListener("click", closeChapterPopup);
  $("chapter-mask").addEventListener("click", e => {
    if (e.target === $("chapter-mask")) closeChapterPopup();
  });

  // ---- 生词本页:章节折叠/展开、测试/背诵、播放/移除(事件委托) ----
  $("wb-chapters").addEventListener("click", e => {
    // 章节头部点击:折叠/展开
    const head = e.target.closest(".wb-chapter-head");
    if (head) {
      const chapter = head.closest(".wb-chapter");
      chapter.classList.toggle("open");
      return;
    }
    // 测试某章节
    const testBtn = e.target.closest("[data-test-chapter]");
    if (testBtn) {
      openTest("chapter:" + testBtn.dataset.testChapter);
      return;
    }
    // 背诵某章节
    const studyBtn = e.target.closest("[data-study-chapter]");
    if (studyBtn) {
      const gid = +studyBtn.dataset.studyChapter;
      const g = WORDS_DATA.groups.find(x => x.id === gid);
      if (g) {
        const wb = store.getWordbook();
        const words = g.words.filter(w => wb.includes(w.id)).map(w => ({ ...w, groupName: g.name }));
        if (words.length) startSession(words, `${g.name} 生词本`);
      }
      return;
    }
    // 播放发音
    const playBtn = e.target.closest("[data-play]");
    if (playBtn) {
      const w = WORD_BY_ID.get(+playBtn.dataset.play);
      playWord(w.en, playBtn);
      return;
    }
    // 移除单词
    const removeBtn = e.target.closest("[data-remove]");
    if (removeBtn) {
      store.setWordbook(store.getWordbook().filter(id => id !== +removeBtn.dataset.remove));
      renderWordbook();
      return;
    }
  });
  $("btn-wordbook-back").addEventListener("click", () => { renderHome(); switchView("home"); });
  // 测试全部生词
  $("btn-wb-test-all").addEventListener("click", () => openTest("all"));
  // 背诵全部生词
  $("btn-study-wordbook").addEventListener("click", () => {
    const wb = store.getWordbook().map(id => WORD_BY_ID.get(id)).filter(Boolean);
    if (wb.length) startSession(wb, "生词本");
  });

  // ---- 完成弹层:下一章节/再来一遍/返回首页 ----
  $("btn-next-chapter").addEventListener("click", () => {
    const next = nextChapter();
    $("finish-mask").classList.remove("show");
    if (next) startGroup(next); // 直接进入下一章节(重新洗牌)
  });
  $("btn-again").addEventListener("click", () => {
    $("finish-mask").classList.remove("show");
    // 按当前来源重新开一组(重新洗牌)
    const g = WORDS_DATA.groups.find(x => x.id === session.groupId);
    if (g) { startGroup(g); return; }
    const src = session.source;
    if (src === "全部单词") startSession(ALL_WORDS, src);
    else if (src.startsWith("错词复习")) {
      // 复习会话:重开同一份错词表(重新洗牌)
      if (reviewWords.length) startSession(reviewWords, src); else { renderHome(); switchView("home"); }
    } else if (src === "生词本") {
      const wb = store.getWordbook().map(id => WORD_BY_ID.get(id)).filter(Boolean);
      if (wb.length) startSession(wb, src); else { renderHome(); switchView("home"); }
    } else { renderHome(); switchView("home"); }
  });
  $("btn-finish-home").addEventListener("click", () => {
    $("finish-mask").classList.remove("show");
    renderHome();
    switchView("home");
  });

  // ---- 键盘快捷键:← 上一个 → 下一个 空格 播放发音 Esc 关章节弹层 ----
  document.addEventListener("keydown", e => {
    if (!$("view-study").classList.contains("active")) return;
    if (e.key === "Escape") { closeChapterPopup(); return; }
    if (e.key === "ArrowRight") goNext();
    else if (e.key === "ArrowLeft") goPrev();
    else if (e.key === " ") { e.preventDefault(); playWord(session.words[session.idx].en, $("btn-sound")); }
  });

  bindTestEvents(); // 单词测试页的交互
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
