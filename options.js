const $ = (id) => document.getElementById(id);
const LEVELS = ["No lo manejo", "Básico", "Intermedio", "Avanzado"];
let settings = null;

const split = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const optVal = (v) => (v === null || v === undefined ? "" : String(v));

function fillProfile(p) {
  $("years").value = optVal(p.yearsExperience);
  $("status").value = optVal(p.careerStatus);
  $("city").value = p.city || "";
  $("ba").value = optVal(p.openToBuenosAires);
  $("careers").value = (p.careerKeywords || []).join(", ");
  $("related").value = (p.relatedKeywords || []).join(", ");
  $("gradNote").value = p.graduationNote || "";
  $("notes").value = p.extraNotes || "";

  // Idiomas: la lengua nativa no se pregunta; el certificado, solo si ya tenés algún nivel.
  const nat = $("native");
  nat.innerHTML = "";
  Evaluador.LANGS.forEach((l) => nat.add(new Option(l.label, l.code)));
  nat.value = p.nativeLanguage || "es";
  const langs = $("langs");
  langs.innerHTML = "";
  Evaluador.LANGS.filter((l) => l.code !== nat.value).forEach((l) => {
    const label = document.createElement("label");
    label.htmlFor = "sk-" + l.id;
    label.textContent = l.label;
    const sel = document.createElement("select");
    sel.id = "sk-" + l.id;
    sel.add(new Option("Sin responder", ""));
    LEVELS.forEach((name, i) => sel.add(new Option(name, String(i))));
    sel.value = optVal(p.skills[l.id]);
    langs.append(label, sel);
    if (p.skills[l.id] >= 1) {
      const cl = document.createElement("label");
      cl.htmlFor = "cert-" + l.id;
      cl.textContent = `¿Tenés certificado de ${l.label.toLowerCase()}?`;
      const cs = document.createElement("select");
      cs.id = "cert-" + l.id;
      [["Sin responder", ""], ["No", "false"], ["Sí", "true"]].forEach(([n, v]) => cs.add(new Option(n, v)));
      cs.value = optVal((p.langCerts || {})[l.id]);
      langs.append(cl, cs);
    }
  });

  const box = $("skills");
  box.innerHTML = "";
  Evaluador.allSkills(p).filter((sk) => !sk.lang).forEach((sk) => {
    const label = document.createElement("label");
    label.htmlFor = "sk-" + sk.id;
    label.textContent = sk.label;
    if (sk.custom) {
      const tag = document.createElement("span");
      tag.className = "note";
      tag.textContent = " · agregada por vos ";
      const rm = document.createElement("button");
      rm.className = "small ghost";
      rm.textContent = "Quitar";
      rm.dataset.remove = sk.id;
      label.append(tag, rm);
    }
    const sel = document.createElement("select");
    sel.id = "sk-" + sk.id;
    sel.add(new Option("Sin responder", ""));
    LEVELS.forEach((name, i) => sel.add(new Option(name, String(i))));
    sel.value = optVal(p.skills[sk.id]);
    box.append(label, sel);
  });
  const ign = p.ignoredTerms || [];
  $("ignored").innerHTML = ign.length
    ? "Propuestas de la IA que descartaste: " + ign.map((t) => `<span class="chip">${t.replace(/[<>&"]/g, "")} <button class="small ghost" data-unignore="${t.replace(/"/g, "&quot;")}">restaurar</button></span>`).join(" ")
    : "";
}

function fillSettings(s) {
  $("provider").value = s.ai.provider || "none";
  $("model").value = s.ai.model || "";
  $("key").value = s.ai.apiKey || "";
  $("aiAuto").checked = s.ai.auto !== false;
  $("companiesMode").value = s.ai.companies || "auto";
  $("searchModel").value = s.ai.searchModel || "";
  updatePlaceholders();
  $("model").placeholder = EvaluadorIA.DEFAULT_MODELS[$("provider").value] || "";
  $("sheetUrl").value = s.sheets.url || "";
  $("autoSync").checked = s.sheets.auto !== false;
  $("script").value = Store.appsScriptCode(s.sheets.token);
  showSheetStatus(s.sheets);
}

function showSheetStatus(sh) {
  const el = $("sheetStatus");
  el.className = "note";
  if (sh.lastError) { el.className = "status-err"; el.textContent = sh.lastError; }
  else if (sh.lastSync) { el.className = "status-ok"; el.textContent = "Última sincronización: " + new Date(sh.lastSync).toLocaleString("es-AR"); }
  else el.textContent = sh.url ? "Conectada, sin sincronizar todavía." : "";
}

function readProfile(base) {
  const num = (v) => (v === "" ? null : Number(v));
  const bool = (v) => (v === "" ? null : v === "true");
  const skills = {};
  // La lengua nativa no tiene selector de nivel: se conserva lo que hubiera.
  Evaluador.allSkills(base).forEach((sk) => { const el = $("sk-" + sk.id); const v = el ? el.value : optVal(base.skills[sk.id]); if (v !== "") skills[sk.id] = Number(v); });
  const langCerts = { ...(base.langCerts || {}) };
  Evaluador.LANGS.forEach((l) => { const el = $("cert-" + l.id); if (el) { if (el.value === "") delete langCerts[l.id]; else langCerts[l.id] = el.value === "true"; } });
  return {
    ...base,
    yearsExperience: num($("years").value),
    careerStatus: $("status").value || null,
    nativeLanguage: $("native").value,
    langCerts,
    city: $("city").value.trim(),
    openToBuenosAires: bool($("ba").value),
    careerKeywords: split($("careers").value),
    relatedKeywords: split($("related").value),
    graduationNote: $("gradNote").value.trim(),
    extraNotes: $("notes").value.trim(),
    skills,
  };
}

function flash(id, text) {
  $(id).textContent = text;
  setTimeout(() => ($(id).textContent = ""), 2200);
}

$("save").addEventListener("click", async () => {
  const { profile } = await Store.load();
  await Store.saveProfile(readProfile(profile));
  Store.scheduleSync();
  flash("saved", "Guardado ✓");
});
$("reset").addEventListener("click", async (e) => {
  if (!e.target.dataset.confirm) {
    e.target.dataset.confirm = "1";
    e.target.textContent = "¿Seguro? Se borran tus respuestas (no los avisos)";
    return;
  }
  delete e.target.dataset.confirm;
  e.target.textContent = "Empezar de cero";
  const empty = JSON.parse(JSON.stringify(EMPTY_PROFILE));
  await Store.saveProfile(empty);
  fillProfile(empty);
  flash("saved", "Perfil vacío ✓");
});
// Agregar, quitar y restaurar herramientas propias
$("addCustom").addEventListener("click", async () => {
  const name = $("customName").value.trim();
  if (!name) return $("customName").focus();
  const { profile } = await Store.load();
  const p = readProfile(profile);
  const match = Evaluador.findSkill(name, p);
  if (match && Evaluador.norm(match.label).includes(Evaluador.norm(name))) {
    flash("customMsg", `${name} ya está en la lista, como "${match.label}".`);
    return;
  }
  const lvl = $("customLevel").value;
  Store.addCustomSkill(p, name, $("customTerms").value.split(",").map((t) => t.trim()).filter(Boolean), lvl === "" ? null : Number(lvl));
  await Store.saveProfile(p);
  fillProfile(p);
  $("customName").value = $("customTerms").value = "";
  flash("customMsg", "Agregada ✓");
  Store.scheduleSync();
});
document.addEventListener("click", async (e) => {
  const id = e.target.dataset && e.target.dataset.remove;
  const un = e.target.dataset && e.target.dataset.unignore;
  if (!id && !un) return;
  e.preventDefault();
  const { profile } = await Store.load();
  const p = readProfile(profile);
  if (id) Store.removeCustomSkill(p, id);
  if (un) p.ignoredTerms = (p.ignoredTerms || []).filter((t) => t !== un);
  await Store.saveProfile(p);
  fillProfile(p);
  Store.scheduleSync();
});
function updatePlaceholders() {
  const p = $("provider").value;
  $("model").placeholder = EvaluadorIA.DEFAULT_MODELS[p] || "";
  $("searchModel").placeholder = EvaluadorIA.DEFAULT_SEARCH_MODELS[p] || "no disponible con este proveedor";
}
$("provider").addEventListener("change", updatePlaceholders);
$("saveAI").addEventListener("click", async () => {
  const { profile } = await Store.load();
  settings.ai = { provider: $("provider").value, model: $("model").value.trim(), apiKey: $("key").value.trim(), auto: $("aiAuto").checked, companies: $("companiesMode").value, searchModel: $("searchModel").value.trim() };
  await Store.saveSettings(settings);
  await Store.saveProfile({ ...profile, extraNotes: $("notes").value.trim() });
  flash("savedAI", "Guardado ✓");
});

$("copyScript").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("script").value); flash("copied", "Copiado ✓"); }
  catch (e) { $("script").closest("details").open = true; $("script").select(); flash("copied", "Copialo desde el cuadro de abajo"); }
});
$("saveSheet").addEventListener("click", async () => {
  settings.sheets.url = $("sheetUrl").value.trim();
  settings.sheets.auto = $("autoSync").checked;
  settings.sheets.lastError = "";
  await Store.saveSettings(settings);
  if (!settings.sheets.url) return showSheetStatus(settings.sheets);
  $("sheetStatus").className = "note";
  $("sheetStatus").textContent = "Probando…";
  try {
    const ping = await Store.pingSheets(settings.sheets.url, settings.sheets.token);
    // Si la extensión está vacía y la hoja tiene avisos, no sincronizar: ofrecer restaurar.
    const check = ping.version >= 2 ? await Store.checkBeforeFirstSync() : { sheetJobs: 0 };
    if (check.sheetJobs !== 0) {
      settings = (await Store.load()).settings;
      $("restoreBox").hidden = false;
      $("sheetStatus").className = "status-ok";
      $("sheetStatus").textContent = check.sheetJobs > 0
        ? `Conectado. La hoja tiene ${check.sheetJobs} aviso(s) y la extensión está vacía: tocá "Restaurar desde la hoja".`
        : "Conectado. No pude leer la hoja: tocá \"Restaurar desde la hoja\" para intentarlo.";
      return;
    }
    // Primero traer las empresas guardadas en la hoja (si reinstalaste), después sincronizar.
    let extra = "";
    if (ping.version >= 2) {
      const n = await Store.importCompaniesFromSheet();
      if (n) extra = ` · recuperé ${n} empresa(s) de la hoja`;
    } else extra = " · actualizá el código de la hoja para poder recuperar empresas";
    await Store.syncSheets();
    flash("sheetStatus", "Conectado y sincronizado ✓" + extra);
  } catch (e) {
    settings.sheets.lastError = e.message;
    await Store.saveSettings(settings);
  }
});
$("syncNow").addEventListener("click", async () => {
  $("sheetStatus").className = "note";
  $("sheetStatus").textContent = "Sincronizando…";
  try { await Store.syncSheets(); } catch (e) { /* queda en lastError */ }
});
$("restoreBtn").addEventListener("click", async () => {
  $("sheetStatus").className = "note";
  $("sheetStatus").textContent = "Leyendo Perfil, Avisos, Requisitos y Empresas…";
  try {
    const n = await Store.restoreFromSheet();
    const d = await Store.load();
    settings = d.settings;
    fillProfile(d.profile);
    $("restoreBox").hidden = true;
    $("sheetStatus").className = "status-ok";
    $("sheetStatus").textContent = `Listo: recuperé tu perfil (${n.herramientas} herramientas), ${n.avisos} aviso(s)` + (n.empresas ? ` y ${n.empresas} empresa(s)` : "") + "." +
      (n.sinTexto ? ` ${n.sinTexto} no tenían el texto guardado: los reconstruí con sus requisitos.` : "");
  } catch (e) {
    $("sheetStatus").className = "status-err";
    $("sheetStatus").textContent = e.message;
  }
});
$("overwriteBtn").addEventListener("click", async (e) => {
  if (!e.target.dataset.confirm) { e.target.dataset.confirm = "1"; e.target.textContent = "¿Seguro? Se borra lo que tiene la hoja. Tocá de nuevo"; return; }
  settings.sheets.pendingRestore = false;
  await Store.saveSettings(settings);
  try { await Store.syncSheets({ overwrite: true }); $("restoreBox").hidden = true; } catch (err) { /* queda en lastError */ }
});
$("importCompanies").addEventListener("click", async () => {
  $("sheetStatus").className = "note";
  $("sheetStatus").textContent = "Leyendo la pestaña Empresas…";
  try {
    const n = await Store.importCompaniesFromSheet();
    $("sheetStatus").className = "status-ok";
    $("sheetStatus").textContent = n ? `Recuperé ${n} empresa(s) de la hoja.` : "No había empresas nuevas para traer.";
  } catch (e) {
    $("sheetStatus").className = "status-err";
    $("sheetStatus").textContent = e.message;
  }
});
$("historyBtn").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.settings) { settings = Store.mergeSettings(changes.settings.newValue); showSheetStatus(settings.sheets); }
  // Si respondiste una pregunta en el panel mientras esta página estaba abierta, reflejarlo.
  if (changes.profile && !document.activeElement.matches("input, select, textarea")) fillProfile(Store.mergeProfile(changes.profile.newValue));
});

(async () => {
  const d = await Store.load();
  settings = d.settings;
  if (!settings.sheets.token) {
    settings.sheets.token = Store.newToken();
    await Store.saveSettings(settings);
  }
  fillProfile(d.profile);
  fillSettings(settings);
  $("restoreBox").hidden = !settings.sheets.pendingRestore;
})();
