// 词库构建脚本:node build_words_js.mjs
// 作用:读取 words.json(AI 生成的音标+自然拼读分段,见 w 字段),拍平生成 words.js
//   - id 为跨分组连续编号(1..N),顺序与 words.json 完全一致;localStorage 的已会/生词本按 id 记录,编号必须稳定
//   - 子分组(subgroups)拍平到 words,词条附加 sub=子分组名
//   - 每个词条生成 parts:按"字母串/符号串"切分 en,字母串对应 w 中的 [原文,音标,分段]
//     撇号拆开的缩合词(isn't 等)会合并回单个部分,见 mergeContractions
// 运行前会做一致性校验:与旧 words.js 的词条顺序逐个比对,顺序变了直接报错退出,防止 id 漂移
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(DIR, "words.json");      // 源数据(含 w 字段)
const OUT = path.join(DIR, "words.js");        // 输出文件

// 分段类型编码 -> 完整类型名(对应 CSS 类 seg-xxx)
const TYPE_NAME = {
  c: "consonant", // 单辅音
  d: "cdigraph",  // 辅音组合(sh/ch/th 等)
  v: "vowel",     // 单元音
  t: "vteam",     // 元音组合/R 控元音
  l: "long",      // 长元音(magic e 结构)
  s: "silent",    // 不发音字母
};

const data = JSON.parse(fs.readFileSync(SRC, "utf8"));

// 缩合词合并:撇号会把 isn't / can't / I'm / you're 拆成两个 token(如 "isn"+"'"+"t"),
// 展示时合并回一个单词部分:音标直接拼接,撇号挂到前一分段末尾
// 只合并右侧为 1-3 位小写字母的情况,避免误合 Teachers' Day 这类所有格+大写词
function mergeContractions(parts) {
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i], b = parts[i + 1], c = parts[i + 2];
    if (b && !b.segs && b.t === "'" && c && c.segs && /^[a-z]{1,3}$/.test(c.t)) {
      const segs = a.segs.map(s => ({ ...s }));
      segs[segs.length - 1].t += "'"; // 撇号附在前一分段字母后
      segs.push(...c.segs);           // 再接上右侧 token 的分段(如 t)
      out.push({ t: a.t + "'" + c.t, ph: a.ph + c.ph, segs });
      i += 2; // 消费掉撇号与右侧 token
    } else {
      out.push(a);
    }
  }
  return out;
}

// 把词条的 en 切分成 parts:字母串 -> {t,ph,segs},符号串 -> {t}
function buildParts(word) {
  const parts = [];
  const tokens = word.en.match(/[A-Za-z]+|[^A-Za-z]+/g) || [];
  let wi = 0; // w 数组下标(只数字母串)
  for (const tok of tokens) {
    if (/^[A-Za-z]+$/.test(tok)) {
      const w = word.w && word.w[wi++];
      if (!w || w[0] !== tok) throw new Error(`词条 ${word.en}: w 数据与 token "${tok}" 不匹配`);
      const [t, ph, segs] = w;
      parts.push({
        t, // 原文(保留大小写)
        ph, // DJ 音标(含重音符号)
        segs: segs.map(([letters, type, sound]) => {
          if (!TYPE_NAME[type]) throw new Error(`词条 ${word.en}: 未知分段类型 "${type}"`);
          return { t: letters, k: TYPE_NAME[type], s: sound };
        }),
      });
    } else {
      parts.push({ t: tok }); // 空格/连字符/括号等原样保留
    }
  }
  if (word.w && wi !== word.w.length) throw new Error(`词条 ${word.en}: w 数据条数与 token 数不符`);
  return mergeContractions(parts);
}

// 拍平分组 -> 词条,分配连续 id
let nextId = 1;
const groups = data.groups.map(g => {
  const words = [];
  const pushWords = (list, subName) => list.forEach(w => {
    const entry = { id: nextId++, en: w.en, parts: buildParts(w) };
    if (w.zh) entry.zh = w.zh;          // 部分词条(如词性组)没有中文释义
    if (subName) entry.sub = subName;   // 子分组名拍平成 sub 字段
    words.push(entry);
  });
  if (g.subgroups) g.subgroups.forEach(sub => pushWords(sub.words, sub.name));
  else pushWords(g.words);
  return { id: g.id, name: g.name, words };
});

// 与旧 words.js 比对词条顺序:顺序不一致说明 id 会漂移,直接拒绝写入
if (fs.existsSync(OUT)) {
  const oldSrc = fs.readFileSync(OUT, "utf8")
    .replace(/^\/\/.*\n(?:\/\/.*\n)*const WORDS_DATA = /, "").replace(/;\s*$/, "");
  const oldData = JSON.parse(oldSrc);
  const oldEns = oldData.groups.flatMap(g => g.words.map(w => w.en));
  const newEns = groups.flatMap(g => g.words.map(w => w.en));
  if (oldEns.length !== newEns.length || oldEns.some((en, i) => en !== newEns[i])) {
    throw new Error(`词条顺序与旧 words.js 不一致(旧 ${oldEns.length} 条,新 ${newEns.length} 条),为避免 id 漂移已终止`);
  }
}

const header = `// 词库数据:由 build_words_js.mjs 自动生成(words.json + AI 生成音标与自然拼读分段),请勿手工编辑
// 结构:groups[{id,name,words[{id,en,zh?,sub?,parts}]}]
//   parts:按英文 token/符号切分;{t,ph,segs:[{t,k,s}]}=单词(t=原文,ph=DJ 音标,segs=分段);{t}=符号
//   segs:t=分段字母,k=类型(consonant/cdigraph/vowel/vteam/long/silent),s=分段读音(拼接后与 ph 去掉重音一致)
`;
fs.writeFileSync(OUT, header + "const WORDS_DATA = " + JSON.stringify({ groups }) + ";\n");
console.log(`生成完成:${groups.length} 个分组,${nextId - 1} 个词条 -> ${OUT}`);
