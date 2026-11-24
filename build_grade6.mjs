// 六上生词组构建脚本:node build_grade6.mjs
// 作用:读取 grade6_words.json(沪教版五四学制2024六上词表,en/zh/sub),生成 grade6_words.js
//   - id 从 10001 起(普通词库 1~1379、指定单词组 9001~9087 之外,互不重叠;已会/生词本共用 localStorage)
//   - 拼读分段 parts 优先复用现有词库(words.js + specified_words.js)中同名词条,保证与既有卡片着色一致;
//     复用不到的词用 grade6_parts.json(en -> w 三元组数组,格式与 words.json 的 w 一致)新生成注入
//   - 全量机械校验(违反即报错退出,不写文件):
//       铁律A:每个字母串分段字母拼接 == 原文
//       铁律B:分段读音拼接 == 音标去重音符(ˈˌ)  —— 与 validate_words.mjs 同口径
//       类型码合法(c/d/v/t/l/s);每个分段读音都能在 app.js 的 IPA_TO_PHONEMES 找到映射
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const LIST = path.join(DIR, "grade6_words.json");
const PARTS = path.join(DIR, "grade6_parts.json");
const APP = path.join(DIR, "app.js");
const OUT = path.join(DIR, "grade6_words.js");
const START_ID = 10001;

// 分段类型码 -> 完整类型名(与 build_words_js.mjs / build_specified_parts.mjs 一致)
const TYPE_NAME = { c: "consonant", d: "cdigraph", v: "vowel", t: "vteam", l: "long", s: "silent" };
const TYPE_VALUES = new Set(Object.values(TYPE_NAME));

// 用 vm 加载定义全局的数据文件(等效浏览器 script 标签)
function loadGlobal(file, varName) {
  const src = fs.readFileSync(path.join(DIR, file), "utf8");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + `\nthis.__V = ${varName};`, ctx);
  return ctx.__V;
}

// 从 app.js 截取 IPA_TO_PHONEMES(与运行时同源),取键集合做音素映射覆盖校验
const appSrc = fs.readFileSync(APP, "utf8");
const m = appSrc.match(/const IPA_TO_PHONEMES = (\{[\s\S]*?\n\});/);
if (!m) throw new Error("app.js 中找不到 IPA_TO_PHONEMES");
const IPA_KEYS = new Set(Object.keys(vm.runInNewContext("(" + m[1] + ")")));

// 复用映射:en(小写) -> parts(普通词库 + 指定单词组)
const reuse = new Map();
const WORDS_DATA = loadGlobal("words.js", "WORDS_DATA");
for (const g of WORDS_DATA.groups) for (const w of g.words) {
  if (w.parts && !reuse.has(w.en.toLowerCase())) reuse.set(w.en.toLowerCase(), w.parts);
}
const SPECIFIED_WORDS = loadGlobal("specified_words.js", "SPECIFIED_WORDS");
for (const w of SPECIFIED_WORDS) {
  if (w.parts && !reuse.has(w.en.toLowerCase())) reuse.set(w.en.toLowerCase(), w.parts);
}

const list = JSON.parse(fs.readFileSync(LIST, "utf8"));
const partsData = JSON.parse(fs.readFileSync(PARTS, "utf8"));
const errors = [];

// 把新生成的 w 三元组数组转成 parts(按字母串/符号串切分 en,与 build_words_js.mjs 同构)
function buildPartsFromTriples(en, triples) {
  const tokens = en.match(/[A-Za-z]+|[^A-Za-z]+/g) || [];
  const letterTokens = tokens.filter(t => /^[A-Za-z]+$/.test(t));
  if (letterTokens.length !== triples.length) {
    errors.push(`${en}: 字母串 ${letterTokens.length} 个,w 三元组 ${triples.length} 条,数量不符`);
    return null;
  }
  const parts = [];
  let wi = 0;
  for (const tok of tokens) {
    if (/^[A-Za-z]+$/.test(tok)) {
      const tri = triples[wi++];
      if (tri[0] !== tok) errors.push(`${en}: 三元组原文 "${tri[0]}" != 词内字母串 "${tok}"`);
      const [t, ph, segs] = tri;
      parts.push({ t, ph, segs: segs.map(([lt, k, snd]) => ({ t: lt, k: TYPE_NAME[k] || k, s: snd })) });
    } else {
      parts.push({ t: tok });
    }
  }
  return parts;
}

// 校验单个词条的 parts(复用与新生成统一口径)
function checkParts(en, parts) {
  if (!parts) { errors.push(`${en}: 缺少 parts`); return; }
  for (const p of parts) {
    if (!p.segs) continue; // 符号串(空格/连字符)无分段
    const letters = p.segs.map(s => s.t).join("");
    const sounds = p.segs.map(s => s.s).join("");
    if (letters !== p.t) errors.push(`${en} "${p.t}": 铁律A 字母拼接 "${letters}" != 原文`);
    const ipaPlain = (p.ph || "").replace(/[ˈˌ]/g, "");
    if (sounds !== ipaPlain) errors.push(`${en} "${p.t}": 铁律B 读音拼接 "${sounds}" != 音标去重音 "${ipaPlain}"`);
    for (const s of p.segs) {
      if (!TYPE_VALUES.has(s.k)) errors.push(`${en} "${p.t}": 非法分段类型 "${s.k}"(分段 ${s.t})`);
      if (s.s && !IPA_KEYS.has(s.s)) errors.push(`${en} "${p.t}": 读音 /${s.s}/ 无音素映射(分段 ${s.t})`);
    }
  }
}

const entries = [];
let reuseCount = 0, genCount = 0;
list.forEach((item, i) => {
  const id = START_ID + i;
  const key = item.en.toLowerCase();
  let parts;
  if (reuse.has(key)) {
    parts = reuse.get(key);
    reuseCount++;
  } else {
    const triples = partsData[item.en];
    if (!triples) { errors.push(`${item.en}: 既无法复用,grade6_parts.json 中也无新生成分段`); parts = null; }
    else { parts = buildPartsFromTriples(item.en, triples); genCount++; }
  }
  checkParts(item.en, parts);
  entries.push({ id, en: item.en, zh: item.zh, sub: item.sub, parts });
});

if (errors.length) {
  console.error(`校验失败,共 ${errors.length} 处:`);
  errors.forEach(e => console.error("  - " + e));
  process.exit(1);
}

const header = `// 六上生词组数据:由 build_grade6.mjs 自动生成,请勿手工编辑
// 来源:沪教版(五四学制)(2024)六年级上册词表(Starter + Unit 1~6),源词表见 grade6_words.json
// 结构:GRADE6_WORDS = [{id,en,zh,sub,parts}],parts 与 words.js 同构({t,ph,segs:[{t,k,s}]})
// id 从 ${START_ID} 起,与普通词库(1~1379)、指定单词组(9001~9087)隔离;已会/生词本共用同一套 localStorage
// parts 优先复用现有词库同名词条(着色一致),其余由 grade6_parts.json 新生成注入(含铁律A/B与音素映射机械校验)
// sub=单元标签(Starter/Unit 1~6,按教材主题归类,源词表为扁平排列,单元边界为尽力归类)
const GRADE6_WORDS = `;
fs.writeFileSync(OUT, header + JSON.stringify(entries) + ";\n");
console.log(`生成完成:${entries.length} 个词条 -> ${OUT}`);
console.log(`复用现有词库分段:${reuseCount} 个;新生成分段:${genCount} 个`);
console.log(`校验通过:铁律A/B + 类型码 + 音素映射覆盖全部 OK`);