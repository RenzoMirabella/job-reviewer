const $ = (id) => document.getElementById(id);
const state = { profile: null, settings: null, job: null, text: "", proposals: [], flash: "", companies: {}, companyStatus: "", aiBusy: false, aiError: "", aiLocal: null };
// Íconos de trazo, todos del mismo grosor; el color sale de la clase (ver styles.css).
const PATHS = {
  ok: "M5 12.5l4.5 4.5L19 7.5",
  no: "M6 6l12 12M18 6L6 18",
  warn: "M12 3.5L21.5 20h-19zM12 10v4M12 16.5v1",
  info: "M4 4h16v16H4zM12 11v6M12 7v1.5",
  partial: "M5 12h14",
  eye: "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  doc: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7",
  mail: "M3 5h18v14H3zM3 5l9 8 9-8",
  tag: "M3 3h8l10 10-8 8L3 11zM7.5 7v1",
  step: "M5 12h14M13 6l6 6-6 6",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L21 21",
  idea: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z",
};
const ic = (name, tone) => `<svg class="i${tone ? " t-" + tone : ""}" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
// Condiciones: ícono + texto oculto para lectores de pantalla (el color solo no alcanza).
const FLAG = {
  good: ic("ok", "good") + '<span class="sr">A favor: </span>',
  yellow: ic("warn", "yellow") + '<span class="sr">Atención: </span>',
  red: ic("no", "red") + '<span class="sr">En contra: </span>',
  info: ic("info", "muted") + '<span class="sr">Dato: </span>',
};
const LEVEL_BTNS = ["No", "Básico", "Intermedio", "Avanzado"];
const CLS_TXT = { req: "excluyente", nice: "deseable", mention: "se usa en el puesto" };
const AI_VERDICT = { verde: "green", amarillo: "yellow", rojo: "red" };
const VERDICT_SHORT = { green: "Postulate", yellow: "Alcanzable", red: "Lejos" };

const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const list = (items, fmt) => "<ul>" + items.map((i) => "<li>" + fmt(i) + "</li>").join("") + "</ul>";
// Marca lo que aportó el análisis con IA, en el lugar donde aparece.
const IA = ' <span class="ia" title="Lo aportó el análisis con IA">IA</span>';

async function refreshState() {
  const d = await Store.load();
  state.profile = d.profile;
  state.settings = d.settings;
  state.companies = d.companies;
  if (state.job) state.job = d.jobs.find((j) => j.id === state.job.id) || state.job;
}

// ---------- IA: qué agrega a lo que ya dijeron las reglas ----------
const aiResult = () => (state.job && state.job.ai && state.job.ai.result) || state.aiLocal;
const aiReady = () => { const ai = state.settings.ai; return !!(ai.apiKey && ai.provider !== "none"); };
// Herramientas que las reglas ya evaluaron (incluye las de la familia "Tableros").
function coveredSkills(r) {
  const ids = new Set();
  [r.have, r.missReq, r.partialReq, r.unknownReq, r.missNice, r.missMention].forEach((arr) =>
    (arr || []).forEach((i) => { ids.add(i.id); (i.tools || []).forEach((t) => ids.add(t)); }));
  return ids;
}
// Un ítem de la IA ("Power BI intermedio") se omite si habla de algo que las reglas ya muestran.
function aiExtra(items, r, labels) {
  const covered = coveredSkills(r);
  const known = labels.map((l) => Evaluador.norm(l));
  return (items || []).filter((t) => {
    const n = Evaluador.norm(t);
    if (known.some((k) => k && (n.includes(k) || k.includes(n)))) return false;
    const m = Evaluador.findSkill(t, state.profile);
    return !(m && (covered.has(m.id) || covered.has(m.family)));
  });
}
// Alertas de la IA que no repiten una condición de las reglas (comparando palabras con contenido).
const words = (s) => new Set(Evaluador.norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3));
function aiNewAlerts(alerts, flags) {
  const fw = flags.map((f) => words(f.text));
  return (alerts || []).filter((a) => {
    const aw = [...words(a)];
    return !aw.length || !fw.some((w) => aw.filter((x) => w.has(x)).length / aw.length >= 0.5);
  });
}

// ---------- Preguntas ----------
function levelButtons(attr, id, current) {
  return '<div class="seg">' + LEVEL_BTNS.map((n, i) => `<button ${attr}="${esc(id)}" data-v="${i}"${current === i ? ' class="on"' : ""}>${n}</button>`).join("") + "</div>";
}
function renderQuestions(qs) {
  if (!qs.length) return "";
  const p = state.profile;
  let h = `<div class="card qcard"><div class="qhead">Contame un poco de vos</div><p class="note">Lo guardo en tu perfil para los próximos avisos.</p>`;
  qs.forEach((q) => {
    h += '<div class="qrow">';
    if (q.type === "skill") {
      const lang = /^lang_/.test(q.id);
      h += `<div class="qtext">${lang ? `¿Qué nivel de <b>${esc(q.label.toLowerCase())}</b> tenés?` : `¿Qué nivel tenés en <b>${esc(q.label)}</b>?`} <span class="note">${CLS_TXT[q.cls] || ""}</span></div>` + levelButtons("data-skill", q.id);
    } else if (q.type === "years") {
      h += `<div class="qtext">¿Cuántos <b>años de experiencia</b> laboral relacionada tenés? <span class="note">Contá trabajos donde hiciste reportes, análisis o manejo de datos.</span></div>
        <div class="row tight"><input id="qYears" type="number" min="0" max="40" step="0.5" style="width:90px"><button data-save="years" class="primary small">Listo</button></div>`;
    } else if (q.type === "career") {
      h += `<div class="qtext">¿Qué <b>carrera</b> estudiás o estudiaste?</div>
        <input id="qCareer" placeholder="Ej.: Economía" value="${esc((p.careerKeywords || []).join(", "))}">
        <select id="qStatus"><option value="estudiante_avanzado">Estudiante avanzado</option><option value="graduado">Graduado</option></select>
        <input id="qRelated" placeholder="Otros estudios: cursos, diplomaturas (separados por coma)" value="${esc((p.relatedKeywords || []).join(", "))}">
        <div class="row tight"><button data-save="career" class="primary small">Listo</button></div>`;
    } else if (q.type === "city") {
      h += `<div class="qtext">¿En qué <b>ciudad</b> vivís?</div>
        <div class="row tight"><input id="qCity" placeholder="Ej.: Rosario" style="flex:1"><button data-save="city" class="primary small">Listo</button></div>`;
    } else if (q.type === "moveBA") {
      h += `<div class="qtext">¿Te <b>mudarías a Buenos Aires</b> por un trabajo?</div>
        <div class="seg"><button data-field="openToBuenosAires" data-v="true">Sí</button><button data-field="openToBuenosAires" data-v="false">No</button></div>`;
    }
    h += "</div>";
  });
  return h + "</div>";
}

async function answer(el) {
  const p = state.profile;
  if (el.dataset.skill) p.skills[el.dataset.skill] = Number(el.dataset.v);
  else if (el.dataset.field === "openToBuenosAires") p.openToBuenosAires = el.dataset.v === "true";
  else if (el.dataset.save === "years") {
    const v = $("qYears").value;
    if (v === "") return $("qYears").focus();
    p.yearsExperience = Number(v);
  } else if (el.dataset.save === "career") {
    const c = $("qCareer").value.split(",").map((s) => s.trim()).filter(Boolean);
    if (!c.length) return $("qCareer").focus();
    p.careerKeywords = c;
    p.careerStatus = $("qStatus").value;
    p.relatedKeywords = $("qRelated").value.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (el.dataset.save === "city") {
    const v = $("qCity").value.trim();
    if (!v) return $("qCity").focus();
    p.city = v;
  } else return;
  await Store.saveProfile(p); // el cambio vuelve a dibujar el panel (storage.onChanged)
  Store.scheduleSync();
}

// ---------- Herramientas nuevas ----------
function renderProposals() {
  const a = state.job && state.job.ai && state.job.ai.result;
  state.proposals = a ? Store.proposalsFor(a, state.profile) : [];
  if (!state.proposals.length) return "";
  let h = `<div class="card qcard"><div class="qhead">La IA encontró herramientas nuevas</div><p class="note">No están en mi lista. Decime tu nivel y las sumo a tu perfil: desde ahí las busco en todos tus avisos, también en los que ya guardaste.</p>`;
  state.proposals.forEach((p, i) => {
    h += `<div class="qrow"><div class="qtext">¿Qué nivel tenés en <b>${esc(p.name)}</b>? <span class="note">${esc(p.tipo)}</span></div>
      <div class="seg">${LEVEL_BTNS.map((n, v) => `<button data-propose="${i}" data-v="${v}">${n}</button>`).join("")}<button data-ignore="${i}" class="ghost">No es una herramienta</button></div></div>`;
  });
  return h + "</div>";
}
function renderAddTool() {
  return `<details id="addTool" class="addtool"><summary>¿Falta una herramienta?</summary>
    ${state.flash ? `<p class="saved">${esc(state.flash)}</p>` : ""}
    <input id="newTool" placeholder="Nombre, ej.: SPSS, Tableau Prep, KoboCollect">
    <div class="note" style="margin:6px 0 4px">¿Qué nivel tenés?</div>
    <div class="seg">${LEVEL_BTNS.map((n, v) => `<button data-addtool="${v}">${n}</button>`).join("")}</div>
  </details>`;
}
async function addTool(name, terms, level, manual) {
  name = (name || "").trim();
  if (!name) return $("newTool") && $("newTool").focus();
  const p = state.profile;
  // Si ya la conozco con ese nombre (ej. "SPSS" o "Notion"), guardo el nivel ahí en vez de duplicarla.
  const match = Evaluador.findSkill(name, p);
  if (match && Evaluador.norm(match.label).includes(Evaluador.norm(name))) p.skills[match.id] = Number(level);
  else Store.addCustomSkill(p, name, terms, level);
  if (manual) state.flash = `Listo: guardé ${name} (${LEVEL_BTNS[level].toLowerCase()}) en tu perfil.`;
  await Store.saveProfile(p);
  Store.scheduleSync();
}

// ---------- Resultado ----------
function jobHeader(j) {
  if (!j) return "";
  const opts = Store.STATUS.map(([v, n]) => `<option value="${v}"${j.status === v ? " selected" : ""}>${n}</option>`).join("");
  const fam = Store.familyOf(j);
  const famOpts = Store.FAMILY_LABELS.map((n) => `<option${fam === n ? " selected" : ""}>${esc(n)}</option>`).join("");
  return `<div class="card job">
    <input id="jTitle" class="jtitle" placeholder="Puesto" value="${esc(j.title)}">
    <input id="jCompany" placeholder="Empresa" value="${esc(j.company)}">
    <div class="row tight"><select id="jStatus" style="width:auto">${opts}</select><select id="jFamily" style="width:auto" title="Familia de puesto: agrupa avisos parecidos en Mis avisos">${famOpts}</select></div>
    <span class="note">Guardado en Mis avisos</span>
    ${j.ai && j.ai.result && j.ai.result.descripcion ? `<p class="desc">${esc(j.ai.result.descripcion)}${IA}</p>` : ""}
  </div>`;
}

// ---------- Cómo postularte ----------
// details() ya une reglas e IA; acá solo se marca lo que no vino de las reglas.
function renderApply(d, r, a) {
  const app = r.application || {};
  const fromAI = (cond) => (cond ? IA : "");
  const rows = [];
  const row = (icon, body, extra) => `<li>${ic(icon)}<span class="li-body">${body}</span>${extra || ""}</li>`;
  const copy = (v) => `<button class="small ghost" data-copy="${esc(v)}">Copiar</button>`;
  if (d.cvIdioma) rows.push(row("doc", `<b>CV en ${esc(d.cvIdioma)}</b>${fromAI(!app.cvExplicit && d.cvIdioma !== app.cvLanguage)}${d.cvCita ? `<br><span class="note">"${esc(d.cvCita)}"</span>` : ""}`));
  d.emails.forEach((m) => {
    const q = d.asunto ? "?subject=" + encodeURIComponent(d.asunto) : "";
    rows.push(row("mail", `Mandalo a <a href="mailto:${esc(m)}${esc(q)}">${esc(m)}</a>${fromAI(!(app.emails || []).includes(m))}`, copy(m)));
  });
  if (d.asunto) rows.push(row("tag", `Asunto: <b>${esc(d.asunto)}</b>${fromAI(!app.subject)}`, copy(d.asunto)));
  d.instrucciones.forEach((t) => rows.push(row("step", esc(t) + fromAI(!(app.instructions || []).includes(t)))));
  if (d.consultora) rows.push(row("search", `Lo publica una consultora de selección: ${esc(d.consultora)}${IA}`));
  if (a && a.consejo) rows.push(row("idea", `<b>Consejo:</b> ${esc(a.consejo)}${IA}`));
  if (!rows.length) return "";
  return `<div class="card apply"><div class="qhead">Cómo postularte</div><ul>${rows.join("")}</ul></div>`;
}

// ---------- Sobre la empresa ----------
function renderCompany() {
  const j = state.job;
  if (!j || !j.company) return "";
  const c = Store.findCompany(state.companies, j.company);
  const ai = state.settings.ai;
  const can = EvaluadorIA.canSearch(ai);
  let h = `<details class="company" id="companyBox"><summary>Sobre la empresa: <b>${esc(j.company)}</b>${c && c.fecha ? IA : ""}</summary>`;
  if (state.companyStatus) h += `<p class="note">${esc(state.companyStatus)}</p>`;
  if (c && c.fecha) {
    const age = Math.round(Store.companyAgeDays(c));
    h += `<ul>
      ${c.rubro ? `<li><b>Rubro:</b> ${esc(c.rubro)}</li>` : ""}
      ${c.que_hace ? `<li>${esc(c.que_hace)}</li>` : ""}
      ${c.tamano && !/sin dato/i.test(c.tamano) ? `<li><b>Tamaño:</b> ${esc(c.tamano)}</li>` : ""}
      ${c.sede && !/sin dato/i.test(c.sede) ? `<li><b>Sede:</b> ${esc(c.sede)}${c.presencia_argentina && !/sin dato/i.test(c.presencia_argentina) ? ` · <b>En Argentina:</b> ${esc(c.presencia_argentina)}` : ""}</li>` : ""}
      ${/^s[ií]/i.test(c.es_consultora || "") ? `<li>${ic("warn", "yellow")}<span class="li-body">Es una consultora de selección: el puesto es para otra empresa.</span></li>` : ""}
      ${c.dato_util ? `<li>${ic("idea")}<span class="li-body">${esc(c.dato_util)}</span></li>` : ""}
      ${c.sitio_web ? `<li><a href="${esc(/^https?:/.test(c.sitio_web) ? c.sitio_web : "https://" + c.sitio_web)}" target="_blank" rel="noopener">Sitio web</a></li>` : ""}
    </ul>
    ${c.metodo === "conocimiento del modelo" ? `<p class="note">Sin búsqueda en internet: es lo que la IA ya sabe de la empresa y puede estar desactualizado. La búsqueda en Google de Gemini solo funciona en el plan pago.</p>` : ""}
    <p class="note">${c.confianza === "baja" ? "Poca certeza: puede ser otra empresa con el mismo nombre. " : ""}${c.metodo === "conocimiento del modelo" ? "Consultado" : "Buscado"} ${age < 1 ? "hoy" : `hace ${age} día(s)`}${(c.fuentes || []).length ? " · Fuentes: " + c.fuentes.slice(0, 3).map((f, i) => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${i + 1}</a>`).join(" ") : ""}</p>`;
    if (can) h += `<button class="small ghost" data-company="refresh">Actualizar</button>`;
  } else if (can) {
    h += `<p class="note">Todavía no la busqué. Se busca una sola vez y queda guardada para todos los avisos de esta empresa.</p><button class="small" data-company="search">Buscar información</button>`;
  } else {
    h += `<p class="note">Para buscar información de la empresa, configurá Gemini o Claude en Mi perfil.</p>`;
  }
  return h + "</details>";
}

async function researchCompany(force) {
  const j = state.job;
  if (!j || !j.company || state.companyBusy) return;
  state.companyBusy = true;
  state.companyStatus = force ? "Actualizando la información de la empresa…" : "Buscando información de la empresa…";
  render();
  try {
    const out = await Store.ensureCompany(j.company, state.settings.ai, j.title, force);
    state.companyStatus = "";
    if (!out.cached) Store.scheduleSync();
  } catch (e) {
    state.companyStatus = "No se pudo buscar la empresa: " + e.message;
  } finally {
    state.companyBusy = false;
    await refreshState();
    render();
  }
}
// Búsqueda automática: solo si está activada, la empresa no está guardada y el aviso vale la pena.
function maybeResearchCompany() {
  const ai = state.settings.ai;
  const j = state.job;
  if (!j || !j.company || ai.companies !== "auto" || !EvaluadorIA.canSearch(ai)) return;
  const c = Store.findCompany(state.companies, j.company);
  if (Store.companyFresh(c)) return;
  const r = Store.evalJob(j, state.profile);
  if (r.verdict === "red") return;
  researchCompany(false);
}

function render() {
  if (!state.text) return;
  // Conservar lo que estabas escribiendo en las preguntas.
  const keep = {};
  document.querySelectorAll(".qcard input, .qcard select").forEach((i) => (keep[i.id] = i.value));

  const r = state.job ? Store.evalJob({ ...state.job, text: state.text }, state.profile) : Evaluador.evaluate(state.text, state.profile);
  const d = state.job ? Store.details(state.job, r) : null;
  let sub = r.missReq.length ? `Te faltan ${r.missReq.length} requisito(s) excluyente(s).` :
    r.verdict === "red" ? "Hay condiciones difíciles de cubrir hoy." :
    r.verdict === "green" && r.reviewLines.length ? "Cumplís lo que pude medir; revisá lo de abajo." : "";
  if (r.provisional) sub = "Provisorio: respondé las preguntas para completarlo. " + sub;

  const addOpen = $("addTool") && $("addTool").open;
  const companyOpen = !!state.companyStatus || ($("companyBox") ? $("companyBox").open : false);
  const a = aiResult();
  const flagLabels = r.have.concat(r.missReq, r.partialReq, r.missNice, r.missMention).map((i) => i.label);
  const aiMissReq = a ? aiExtra(a.falta_excluyente, r, flagLabels) : [];
  const aiHave = a ? aiExtra(a.tiene, r, flagLabels) : [];
  const aiMissNice = a ? aiExtra(a.falta_deseable, r, flagLabels) : [];
  const aiAlerts = a ? aiNewAlerts(a.alertas, r.flags) : [];

  let html = jobHeader(state.job) + renderQuestions(r.questions) + renderVerdict(r, sub, a);
  r.warnings.forEach((w) => (html += `<div class="warn">${esc(w)}</div>`));
  // Por qué: lo que falta y las condiciones del puesto.
  if (r.missReq.length || aiMissReq.length) html += "<h2>Te falta (excluyente)</h2>" + list(
    r.missReq.map((i) => `${FLAG.red}<span class="li-body">${esc(i.label)} <span class="note">· piden ${esc(i.needName)}</span></span>`)
      .concat(aiMissReq.map((t) => `${FLAG.red}<span class="li-body">${esc(t)}${IA}</span>`)), (x) => x);
  if (r.partialReq.length) html += "<h2>Casi</h2>" + list(r.partialReq, (i) => `${ic("partial", "yellow")}<span class="li-body">${esc(i.label)} <span class="note">· piden ${esc(i.needName)}${i.note ? " · " + esc(i.note) : ""}</span></span>`);
  if (r.flags.length || aiAlerts.length) html += "<h2>Condiciones</h2>" + list(
    r.flags.map((f) => `${FLAG[f.level]}<span class="li-body">${esc(f.text)}</span>`)
      .concat(aiAlerts.map((t) => `${FLAG.yellow}<span class="li-body">${esc(t)}${IA}</span>`)), (x) => x);
  if (r.reviewLines.length) html += "<h2>Revisá vos (experiencia específica)</h2>" + list(r.reviewLines, (l) => `${ic("eye", "muted")}<span class="li-body">${esc(l)}</span>`);
  // Lo que tenés y lo que suma.
  if (r.have.length || aiHave.length) {
    html += "<h2>Lo que tenés</h2><div class='chips'>" + r.have.map((i) => `<span class="chip ok">${esc(i.label)}</span>`)
      .concat(aiHave.map((t) => `<span class="chip ok">${esc(t)}${IA}</span>`)).join("") + "</div>";
    if (r.strengths.length) html += `<p class="note">Juega a tu favor: ${r.strengths.map((i) => esc(i.label)).join(", ")}.</p>`;
  }
  if (r.missNice.length || aiMissNice.length) html += "<h2>Deseables que no tenés</h2><div class='chips'>" + r.missNice.map((i) => `<span class="chip">${esc(i.label)}</span>`)
    .concat(aiMissNice.map((t) => `<span class="chip">${esc(t)}${IA}</span>`)).join("") + "</div>";
  if (r.missMention.length) html += "<h2>Se usa en el puesto</h2><div class='chips'>" + r.missMention.map((i) => `<span class="chip">${esc(i.label)}</span>`).join("") + "</div>";
  if (d) html += renderApply(d, r, a);
  html += renderCompany() + renderProposals() + renderAddTool();
  $("result").innerHTML = html;
  if ($("companyBox")) $("companyBox").open = companyOpen;
  if (addOpen || state.flash) $("addTool").open = true;
  state.flash = "";

  Object.entries(keep).forEach(([id, v]) => { const el = $(id); if (el) el.value = v; });
}

// ---------- Veredicto: el de las reglas, con la segunda opinión de la IA debajo ----------
function renderVerdict(r, sub, a) {
  const cls = { green: "v-green", yellow: "v-yellow", red: "v-red" }[r.verdict];
  const pending = r.unknownReq.length > 0;
  // Sin saber tu nivel en algo excluyente, un "Postulate" sería engañoso.
  const main = pending
    ? `<div class="verdict v-pending"><span class="dot"></span><div>Respondé las preguntas para ver el veredicto<small>Con lo que sé hasta ahora: ${esc(r.verdictText.toLowerCase())}.</small></div></div>`
    : `<div class="verdict ${cls}"><span class="dot"></span><div>${esc(r.verdictText)}<small>${esc(sub)}</small></div></div>`;
  let line;
  if (state.aiBusy) line = `<span class="ia">IA</span><span class="vai-text note">Analizando el aviso y buscando herramientas nuevas…</span>`;
  else if (state.aiError) line = `<span class="ia">IA</span><span class="vai-text vai-error">No se pudo hacer el análisis: ${esc(state.aiError)}</span><button class="small" data-ai="run">Reintentar</button>`;
  else if (a) {
    const v = AI_VERDICT[a.veredicto] || "yellow";
    const what = !pending && v === r.verdict ? "Coincide" : `Dice: ${VERDICT_SHORT[v]}`;
    line = `<span class="ia">IA</span><span class="vai-text"><span class="vai-head ai-${v}"><span class="dot"></span>${what}</span>${a.resumen ? ` <span class="note">${esc(a.resumen)}</span>` : ""}</span><button class="small ghost" data-ai="run" title="Vuelve a consultar a la IA (usa tu cuota)">Rehacer</button>`;
  } else if (aiReady()) line = `<span class="vai-text note">¿Querés una segunda opinión?</span><button class="small" data-ai="run">Analizar con IA</button>`;
  else line = `<span class="vai-text note">Para una segunda opinión con IA, <button class="link" data-ai="config">configurala en Mi perfil</button>.</span>`;
  return `<div class="vbox">${main}<div class="vai" aria-live="polite">${line}</div></div>`;
}

async function runAI() {
  if (state.aiBusy) return;
  state.aiBusy = true;
  state.aiError = "";
  render();
  try {
    const a = await EvaluadorIA.analyze(state.text, state.profile, state.settings.ai, { title: state.job && (state.job.tabTitle || state.job.title) });
    if (state.job) {
      state.job = await Store.updateJob(state.job.id, Store.aiPatch(state.job, a));
      Store.scheduleSync();
    } else state.aiLocal = a;
  } catch (e) {
    state.aiError = e.message;
  } finally {
    state.aiBusy = false;
    render();
  }
}

async function handlePending(p) {
  if (!p || !p.text || !p.text.trim()) return;
  state.text = p.text;
  state.aiError = "";
  state.aiLocal = null;
  state.job = await Store.upsertJob({ text: p.text, url: p.url, tabTitle: p.title });
  await refreshState();
  render();
  Store.scheduleSync();
  // Con la IA configurada en automático, cada aviso nuevo se analiza solo (una vez por aviso).
  const ai = state.settings.ai;
  if (ai.auto && ai.apiKey && ai.provider !== "none" && state.job && !state.job.ai) await runAI();
  // Después del análisis (que puede corregir el nombre de la empresa), buscar la empresa si hace falta.
  maybeResearchCompany();
}

// ---------- Eventos ----------
$("result").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.copy) {
    navigator.clipboard.writeText(b.dataset.copy).then(() => { b.textContent = "Copiado ✓"; setTimeout(() => (b.textContent = "Copiar"), 1500); }).catch(() => {});
    return;
  }
  if (b.dataset.ai) return b.dataset.ai === "config" ? chrome.runtime.openOptionsPage() : runAI();
  if (b.dataset.company) return researchCompany(b.dataset.company === "refresh");
  if (b.dataset.skill || b.dataset.field || b.dataset.save) answer(b);
  else if (b.dataset.propose) {
    const p = state.proposals[Number(b.dataset.propose)];
    if (p) addTool(p.name, p.text ? [p.text] : [], Number(b.dataset.v));
  } else if (b.dataset.ignore) {
    const p = state.proposals[Number(b.dataset.ignore)];
    if (p) { Store.ignoreTerm(state.profile, p.name); Store.saveProfile(state.profile); }
  } else if (b.dataset.addtool) addTool($("newTool").value, [], Number(b.dataset.addtool), true);
});
$("result").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.target.closest(".qrow")) return;
  e.preventDefault();
  const b = e.target.closest(".qrow").querySelector("button[data-save]");
  if (b) answer(b);
});
$("result").addEventListener("change", async (e) => {
  if (!state.job) return;
  const map = { jTitle: "title", jCompany: "company", jStatus: "status", jFamily: "family" };
  const field = map[e.target.id];
  if (!field) return;
  const patch = { [field]: e.target.value.trim() };
  if (field === "title") patch.titleAuto = false;
  if (field === "company") patch.companyAuto = false;
  if (field === "family") patch.familyManual = true;
  state.job = await Store.updateJob(state.job.id, patch);
  if (field === "company") render();
  Store.scheduleSync();
});
$("evalPaste").addEventListener("click", () => handlePending({ text: $("paste").value, url: "", title: "" }));
$("optBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("historyBtn").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pending && changes.pending.newValue) handlePending(changes.pending.newValue);
  if (area === "local" && (changes.profile || changes.settings || changes.companies)) refreshState().then(render);
});

(async () => {
  await refreshState();
  const { pending } = await chrome.storage.session.get("pending");
  if (pending && Date.now() - pending.at < 10 * 60 * 1000) handlePending(pending);
})();
