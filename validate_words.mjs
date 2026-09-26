// 词库校验脚本:node validate_words.mjs [words.json路径]
// 用途:扩展/修改 words.json 后、生成 words.js 前,全量机械校验音标数据
// 校验项:
//   1. 词条结构:en/zh、w 字段与 en 的字母 token 一一对应
//   2. 铁律 A:分段字母拼接 == token 原文
//   3. 铁律 B:分段读音拼接 == 音标去掉重音符号(ˈˌ)
//   4. 分段类型编码合法(c/d/v/t/l/s)
//   5. 播放覆盖:所有分段读音都能在 app.js 的 IPA_TO_PHONEMES 中找到音素映射
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(DIR, process.argv[2] || "words.json");
const TYPE_OK = new Set(["c", "d", "v", "t", "l", "s"]); // 辅音/辅音组合/元音/元音组合/长元音/不发音

// 从 app.js 源码提取 IPA_TO_PHONEMES 的键集合(校验音素播放覆盖)
const appSrc = fs.readFileSync(path.join(DIR, "app.js"), "utf8");
const mapBody = appSrc.slice(appSrc.indexOf("const IPA_TO_PHONEMES"), appSrc.indexOf("let phonicsTimers"));
const IPA_KEYS = new Set(
  [...mapBody.matchAll(/(?:"([^"]+)"|([a-zæɒːɪəʊʌɑɔɜé]+)):\s*\[/g)].map(m => m[1] || m[2])
);

const data = JSON.parse(fs.readFileSync(SRC, "utf8"));
let count = 0;
const errors = [];
const uncovered = new Map(); // 无音素映射的读音 -> 示例词

// 校验单个词条的 w 字段
function checkWord(w, where) {
  const tokens = w.en.match(/[A-Za-z]+/g) || [];
  if (!Array.isArray(w.w)) {
    if (tokens.length) errors.push(`${where} "${w.en}": 缺少 w 字段`);
    return;
  }
  if (w.w.length !== tokens.length) {
    errors.push(`${where} "${w.en}": w 条数 ${w.w.length} != 字母 token 数 ${tokens.length}`);
    return;
  }
  w.w.forEach(([token, ipa, segs], ti) => {
    if (token !== tokens[ti]) {
      errors.push(`${where} "${w.en}": w[${ti}] 原文 "${token}" != token "${tokens[ti]}"`);
      return;
    }
    const letters = segs.map(s => s[0]).join("");
    const sounds = segs.map(s => s[2]).join("");
    if (letters !== token) errors.push(`${where} "${w.en}": 字母拼接 "${letters}" != "${token}"`);
    const ipaPlain = ipa.replace(/[ˈˌ]/g, "");
    if (sounds !== ipaPlain) errors.push(`${where} "${w.en}": 读音拼接 "${sounds}" != 音标 "${ipaPlain}"`);
    segs.forEach(([, type, sound]) => {
      if (!TYPE_OK.has(type)) errors.push(`${where} "${w.en}": 非法类型编码 "${type}"`);
      if (sound && !IPA_KEYS.has(sound)) {
        if (!uncovered.has(sound)) uncovered.set(sound, w.en);
      }
    });
  });
  count++;
}

const checkList = (words, where) => words.forEach(w => checkWord(w, where));
data.groups.forEach(g => {
  if (g.subgroups) g.subgroups.forEach(sub => checkList(sub.words, `组${g.id} ${g.name}/${sub.name}`));
  else checkList(g.words, `组${g.id} ${g.name}`);
});

console.log(`校验词条:${count} 条`);
if (uncovered.size) {
  console.log("⚠ 以下读音缺少 IPA_TO_PHONEMES 映射(拼读播放时会跳过该分段,需在 app.js 补充):");
  uncovered.forEach((word, sound) => console.log(`   /${sound}/ 如 ${word}`));
}
if (errors.length) {
  console.log(`✗ 发现 ${errors.length} 处错误:`);
  errors.slice(0, 50).forEach(e => console.log("  -", e));
  if (errors.length > 50) console.log(`  ...另有 ${errors.length - 50} 条`);
  process.exit(1);
}
console.log("✓ 全部通过(结构 + 铁律 + 类型编码)");
