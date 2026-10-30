// Prueba el motor y el análisis de "Mis avisos" contra avisos guardados en archivos .md.
//
// Uso:
//   node test/run.js                 → usa los avisos ficticios de test/avisos-ejemplo.md
//   node test/run.js mi-carpeta      → usa todos los .md de esa carpeta
//
// Formatos aceptados para cada aviso dentro del .md:
//   ## Puesto | Empresa              (y debajo el texto del aviso)
//   [Puesto](https://www.linkedin.com/jobs/view/123/)   (y debajo el texto del aviso)
const fs = require("fs");
const path = require("path");
const { evaluate } = require("../rules.js");
const { EMPTY_PROFILE } = require("../profile-default.js");
const Store = require("../store.js");

const target = process.argv[2] || path.join(__dirname, "avisos-ejemplo.md");
const files = fs.statSync(target).isDirectory()
  ? fs.readdirSync(target).filter((f) => f.endsWith(".md")).map((f) => path.join(target, f))
  : [target];

const jobs = [];
const seen = new Set();
for (const file of files) {
  const txt = fs.readFileSync(file, "utf8");
  const re = /^(?:##\s+(.+)|\s*\[([^\]]+)\]\((https:\/\/www\.linkedin\.com\/jobs\/view\/\d+[^)]*)\))\s*$/gm;
  const marks = [...txt.matchAll(re)];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : txt.length;
    const [title, company = ""] = (m[1] || m[2]).split("|").map((s) => s.trim());
    const url = m[3] || "";
    const text = title + "\n" + txt.slice(m.index + m[0].length, end);
    const id = Store.jobKey(url, text);
    if (seen.has(id)) return;
    seen.add(id);
    jobs.push({ id, url: Store.canonicalUrl(url), title, company, status: "evaluado", text, created: new Date().toISOString() });
  });
}
if (!jobs.length) {
  console.log("No encontré avisos. Revisá el formato (## Puesto | Empresa).");
  process.exit(1);
}

// 1) Perfil vacío: ¿qué preguntaría la extensión?
const asked = {};
jobs.forEach((j) => evaluate(j.text, EMPTY_PROFILE).questions.forEach((q) => {
  const k = q.type === "skill" ? q.label : q.type;
  asked[k] = (asked[k] || 0) + 1;
}));
console.log(`Preguntas con el perfil vacío (en cuántos de los ${jobs.length} avisos aparece cada una):`);
Object.entries(asked).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${n}  ${k}`));

// 2) Un perfil inventado, ya respondido: análisis de "Mis avisos".
const profile = JSON.parse(JSON.stringify(EMPTY_PROFILE));
Object.assign(profile, {
  yearsExperience: 1, careerStatus: "estudiante_avanzado", careerKeywords: ["Economía"], relatedKeywords: ["Curso de Análisis de Datos"],
  langCerts: { lang_en: false }, city: "Rosario", openToBuenosAires: false,
  skills: { sql: 2, powerbi: 3, python: 1, excel: 3, sheets: 3, ia: 2, tableau: 1, looker: 1, stats: 2, spss: 0, r: 1, lang_en: 2 },
});
const a = Store.analyze(jobs, profile);
const icon = { green: "🟢", yellow: "🟡", red: "🔴" };
console.log(`\nResultado por aviso (perfil de prueba):`);
a.evals.forEach(({ job, r }) => console.log(`  ${icon[r.verdict]}${r.provisional ? "?" : " "} ${job.title} · ${job.company}`));
console.log(`\nTotal: ${a.N} · 🟢 ${a.verdicts.green} · 🟡 ${a.verdicts.yellow} · 🔴 ${a.verdicts.red}`);
console.log("\nQué reforzar:");
a.reinforce.slice(0, 6).forEach((s) => console.log(`  ${s.label}: aparece en ${s.total}, excluyente en ${s.req}, te falta en ${s.gap}`));
console.log("\nTe falta responder:");
a.toAsk.slice(0, 6).forEach((s) => console.log(`  ${s.label} (${s.unknown} avisos)`));
console.log("\nConsejos para el CV:");
a.tips.forEach((t) => console.log(`  ${t.strong}: ${t.text}`));
console.log("\nEn qué puestos enfocarte:");
a.families.forEach((f) => console.log(`  ${f.label}: ${f.total} aviso(s) · 🟢 ${f.green} · 🟡 ${f.yellow} · 🔴 ${f.red}${f.gaps.length ? " · frena: " + f.gaps.map((g) => g.label).join(", ") : ""}`));
a.focus.forEach((t) => console.log(`  → ${t.strong}: ${t.text}`));

const sh = Store.buildSheets(jobs, profile);
const rect = Object.values(sh).every((rows) => new Set(rows.map((r) => r.length)).size === 1);
console.log(`\nFilas para Google Sheets: Avisos ${sh.Avisos.length - 1}, Requisitos ${sh.Requisitos.length - 1}, Perfil ${sh.Perfil.length - 1} · rectangulares: ${rect ? "sí" : "NO"}`);
if (!rect) process.exit(1);
