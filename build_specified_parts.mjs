// 指定单词拼读分段构建脚本:node build_specified_parts.mjs
// 作用:读取 specified_parts.json(id -> w 三元组数组,格式与 words.json 的 w 字段一致),
//       机械校验后把自然拼读分段 parts 注入 specified_words.js 的每个词条并重写该文件
// 校验项(违反即报错退出,不写文件):
//   0) 覆盖完整:specified_parts.json 必须恰好覆盖 96 个词条,不多不少
//   1) 词条 en 的字母串与三元组一一对应(数量、原文一致)
//   2) 铁律 A:每个词条各分段的字母拼接 == 词段原文
//   3) 铁律 B:各分段的读音拼接 == 音标去重音符(ˈ ˌ)、冒号归一为 ː、括号读音去掉括号、
//              词尾元音后的 (r) 按英式不卷舌约定丢弃
//   4) 分段类型码必须是 c/d/v/t/l/s
//   5) 每个分段读音都能在 app.js 的 IPA_TO_PHONEMES 找到映射(否则拼读时该段无声)
// 多词词条(如 for example):音标用空格连接后与 phonUk 归一化结果比对
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PARTS = path.join(DIR, "specified_parts.json");
const SRC = path.join(DIR, "specified_words.js");
const APP = path.join(DIR, "app.js");

// 音标归一化:取分号前第一读音、冒号→ː、去重音符、去括号、词尾元音后的 (r) 按英式不卷舌约定丢弃;
// 源词典 "iɡ" 写法(如 for example)归一为标准 ɪɡ
function normalizePhonetic(s) {
  let t = s.split(";")[0].trim().replace(/:/g, "ː").replace(/[()]/g, "").replace(/[ˈˌ]/g, "");
  t = t.replace(/([əɪeʊɔɑɜ])r$/, "$1"); // (r) 只出现在词尾元音后,统一丢弃
  t = t.replace(/(^|[\sˈˌ])i(?=ɡ)/, "$1ɪ");
  return t;
}

// 从 app.js 源码里截取 IPA_TO_PHONEMES 映射(与运行时完全同源)
const appSrc = fs.readFileSync(APP, "utf8");
const m = appSrc.match(/const IPA_TO_PHONEMES = (\{[\s\S]*?\n\});/);
if (!m) throw new Error("app.js 中找不到 IPA_TO_PHONEMES");
const IPA_TO_PHONEMES = vm.runInNewContext("(" + m[1] + ")");

const entries = (() => {
  const src = fs.readFileSync(SRC, "utf8");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + "\nthis.__W = SPECIFIED_WORDS;", ctx);
  return ctx.__W;
})();

const partsData = JSON.parse(fs.readFileSync(PARTS, "utf8"));

// ---- 校验 0:覆盖完整 ----
const entryIds = entries.map(w => String(w.id));
const partIds = Object.keys(partsData);
const missing = entryIds.filter(id => !partIds.includes(id));
const extra = partIds.filter(id => !entryIds.includes(id));
if (missing.length || extra.length) {
  throw new Error(`specified_parts.json 覆盖不符:缺少 ${missing.join(",") || "无"} / 多余 ${extra.join(",") || "无"}`);
}

// 分段类型码(与 build_words_js.mjs 的 TYPE_NAME 一致)
const TYPE_CODES = new Set(["c", "d", "v", "t", "l", "s"]);
const errors = [];

for (const entry of entries) {
  const triples = partsData[String(entry.id)];
  const label = `${entry.id} ${entry.en}`;

  // ---- 校验 1:字母串一一对应 ----
  const tokens = entry.en.match(/[A-Za-z]+|[^A-Za-z]+/g) || [];
  const letterTokens = tokens.filter(t => /^[A-Za-z]+$/.test(t));
  if (letterTokens.length !== triples.length) {
    errors.push(`${label}: 字母串 ${letterTokens.length} 个,w 三元组 ${triples.length} 条,数量不符`);
    continue;
  }
  triples.forEach((tri, i) => {
    if (tri[0] !== letterTokens[i]) errors.push(`${label}: 第 ${i + 1} 条三元组原文 "${tri[0]}" != 词内字母串 "${letterTokens[i]}"`);
  });

  // ---- 校验 2/4/5 + 音标一致性 ----
  for (const [text, ph, segs] of triples) {
    const letters = segs.map(s => s[0]).join("");
    const sounds = segs.map(s => s[2]).join("");
    if (letters !== text) errors.push(`${label} "${text}": 铁律A 分段字母拼接 "${letters}" != 原文`);
    if (sounds !== normalizePhonetic(ph)) {
      errors.push(`${label} "${text}": 铁律B 分段读音拼接 "${sounds}" != 音标归一 "${normalizePhonetic(ph)}"`);
    }
    for (const [lt, k, snd] of segs) {
      if (!TYPE_CODES.has(k)) errors.push(`${label} "${text}": 未知分段类型 "${k}"(分段 ${lt})`);
      if (snd && !IPA_TO_PHONEMES[snd]) errors.push(`${label} "${text}": 读音 /${snd}/ 无音素音频映射(分段 ${lt}),拼读时该段无声`);
    }
  }

  // ---- 多词词条:各词段音标空格连接后应与 phonUk 归一结果一致 ----
  const joined = triples.map(t => normalizePhonetic(t[1])).join(" ");
  const target = normalizePhonetic(entry.phonUk);
  if (joined !== target) errors.push(`${label}: 音标不一致 w="${joined}" vs phonUk="${target}"`);
}

if (errors.length) {
  console.error(`校验失败,共 ${errors.length} 处:`);
  errors.forEach(e => console.error("  - " + e));
  process.exit(1);
}

// ---- 注入 parts 并重写 specified_words.js ----
// 字母串 -> {t,ph,segs:[{t,k,s}]},符号串 -> {t}(与 build_words_js.mjs 的 buildParts 输出同构)
const TYPE_NAME = { c: "consonant", d: "cdigraph", v: "vowel", t: "vteam", l: "long", s: "silent" };
for (const entry of entries) {
  const triples = partsData[String(entry.id)];
  const parts = [];
  let wi = 0;
  for (const tok of (entry.en.match(/[A-Za-z]+|[^A-Za-z]+/g) || [])) {
    if (/^[A-Za-z]+$/.test(tok)) {
      const [t, ph, segs] = triples[wi++];
      parts.push({ t, ph, segs: segs.map(([lt, k, snd]) => ({ t: lt, k: TYPE_NAME[k], s: snd })) });
    } else {
      parts.push({ t: tok });
    }
  }
  entry.parts = parts;
}

const header = `// 指定单词背诵数据(96 词):由外部词表整理生成,字段含英美音标/完整释义/例句/词组/近义词/词根词缀/词源
// 以及自然拼读分段 parts:由 build_specified_parts.mjs 从 specified_parts.json 生成注入(含机械校验),
//   格式与 words.js 的 parts 完全同构({t,ph,segs:[{t,k,s}]}),卡片彩色分段与逐音素拼读共用
// 音标约定:phonUk/phonUs 保留源词典原样(含括号可选读音);parts 里的音标已解析括号并按英式不卷舌丢弃词尾 (r)
// 与 words.js 普通词条结构相同(自然拼读渲染共用),但额外带 spec 卡片的富内容字段;
// id 从 9001 起(普通词库为 1~1379),互不重叠;已会/生词本与普通单词共用同一套 localStorage 存储
// zh=导航与测试用短释义;mainZh=卡面主释义;
// 源词典串入其他单词的数据已剔除(...词源或词根...以及...的近义词),chores 源数据为空已手工补齐
const SPECIFIED_WORDS = `;

fs.writeFileSync(SRC, header + JSON.stringify(entries) + ";\n");
console.log(`生成完成:${entries.length} 个指定单词全部注入自然拼读分段 -> ${SRC}`);
console.log(`音素映射覆盖:全部分段读音均可在 IPA_TO_PHONEMES 播放`);
