// Guarda perfil, avisos y configuración; calcula el análisis de "Mis avisos" y sincroniza con Google Sheets.
// Las funciones de cálculo no dependen de Chrome y se pueden probar en Node.
(function (root) {
  "use strict";
  const E = root.Evaluador || require("./rules.js");
  const P = root.EMPTY_PROFILE ? { EMPTY_PROFILE: root.EMPTY_PROFILE, DEFAULT_SETTINGS: root.DEFAULT_SETTINGS } : require("./profile-default.js");

  const STATUS = [
    ["evaluado", "Sin postular"],
    ["postule", "Postulé"],
    ["entrevista", "Entrevista"],
    ["oferta", "Oferta"],
    ["rechazado", "Me rechazaron"],
    ["descartado", "Descartado"],
  ];
  const statusName = (s) => (STATUS.find((x) => x[0] === s) || STATUS[0])[1];
  const VERDICT_NAME = { green: "Postulate", yellow: "Alcanzable", red: "Lejos" };
  const CLS_NAME = { req: "excluyente", nice: "deseable", mention: "se menciona" };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const levelName = (v) => (E.known(v) ? E.LEVEL_NAMES[v] : "sin responder");

  // ---------- Perfil y configuración ----------
  function mergeProfile(p) {
    if (!p || (p.schema !== 2 && p.schema !== 3)) return clone(P.EMPTY_PROFILE);
    const m = { ...clone(P.EMPTY_PROFILE), ...p, skills: { ...(p.skills || {}) }, customSkills: p.customSkills || [], ignoredTerms: p.ignoredTerms || [], langCerts: { ...(p.langCerts || {}) } };
    // Versión 2: el inglés era un dato aparte; ahora es un idioma más, con el resto de las herramientas.
    if (p.schema === 2) {
      if (E.known(p.english) && !E.known(m.skills.lang_en)) m.skills.lang_en = Number(p.english);
      if (p.englishCertified === true || p.englishCertified === false) m.langCerts.lang_en = p.englishCertified;
      m.schema = 3;
    }
    delete m.english;
    delete m.englishCertified;
    return m;
  }
  function mergeSettings(s) {
    s = s || {};
    return { ai: { ...P.DEFAULT_SETTINGS.ai, ...(s.ai || {}) }, sheets: { ...P.DEFAULT_SETTINGS.sheets, ...(s.sheets || {}) } };
  }
  async function load() {
    const d = await chrome.storage.local.get(["profile", "jobs", "settings", "companies"]);
    return { profile: mergeProfile(d.profile), jobs: d.jobs || [], settings: mergeSettings(d.settings), companies: d.companies || {} };
  }
  const saveProfile = (profile) => chrome.storage.local.set({ profile });
  const saveSettings = (settings) => chrome.storage.local.set({ settings });
  const saveJobs = (jobs) => chrome.storage.local.set({ jobs });
  const saveCompanies = (companies) => chrome.storage.local.set({ companies });

  // ---------- Empresas: una búsqueda por empresa, guardada y reutilizada ----------
  const COMPANY_MAX_AGE_DAYS = 180;
  // "MercadoLibre S.R.L.", "Mercado Libre" y "Mercado Libre Argentina" → "mercadolibre"
  function companyKey(name) {
    let n = E.norm(name || "").replace(/&/g, " y ").replace(/[.,()]/g, " ");
    n = n.replace(/\b(s ?a ?s|s ?r ?l|s ?a|s ?a ?u|sociedad anonima|inc|llc|ltd|ltda|limited|corp|corporation|co|gmbh|plc|group|grupo|holding)\b/g, " ");
    n = n.replace(/\b(argentina|arg|latam|latinoamerica|latin america|cono sur|south america|sudamerica)\b/g, " ");
    n = n.replace(/[^a-z0-9 ]+/g, " ").trim().replace(/(\s+(de|del|la|y))+$/, "");
    return n.replace(/[^a-z0-9]+/g, "");
  }
  // Lo que viene de una búsqueda dura 6 meses; lo que el modelo "sabe" sin buscar, 30 días.
  function companyFresh(c) {
    return !!c && companyAgeDays(c) < (c.metodo === "conocimiento del modelo" ? 30 : COMPANY_MAX_AGE_DAYS);
  }
  function companyAgeDays(c) {
    return c && c.fecha ? (Date.now() - new Date(c.fecha).getTime()) / 86400000 : Infinity;
  }
  function findCompany(companies, name) {
    const key = companyKey(name);
    return key ? companies[key] || null : null;
  }
  async function saveCompany(name, info) {
    const { companies } = await load();
    const key = companyKey(name);
    if (!key) return null;
    companies[key] = { ...(companies[key] || {}), ...info, key, nombre: name, fecha: new Date().toISOString() };
    await saveCompanies(companies);
    return companies[key];
  }
  // Busca la empresa solo si no está guardada o si la información tiene más de 6 meses (o si force).
  async function ensureCompany(name, ai, context, force) {
    const { companies } = await load();
    const cached = findCompany(companies, name);
    if (cached && !force && companyFresh(cached)) return { info: cached, cached: true };
    const info = await root.EvaluadorIA.researchCompany(name, ai, context, { force });
    // Si la búsqueda en Google no está disponible (plan gratuito de Gemini), no reintentar por 7 días.
    const { settings } = await load();
    if (info.searchBlocked) settings.ai.searchBlockedUntil = new Date(Date.now() + 7 * 86400000).toISOString();
    else if (info.metodo === "búsqueda en internet") settings.ai.searchBlockedUntil = "";
    await saveSettings(settings);
    delete info.searchBlocked;
    return { info: await saveCompany(name, info), cached: false };
  }

  // ---------- Herramientas propias y propuestas de la IA ----------
  const slug = (s) => E.norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  // Requisitos que la IA marcó como herramienta y que el catálogo (ni tus herramientas) reconoce.
  function proposalsFor(aiResult, profile) {
    const ignored = (profile.ignoredTerms || []).map(E.norm);
    const seen = new Set();
    return ((aiResult && aiResult.requisitos) || []).filter((q) => {
      const name = String(q.nombre || "").trim();
      if (!name || (q.clase && q.clase !== "herramienta")) return false;
      const key = E.norm(name);
      if (seen.has(key) || ignored.includes(key)) return false;
      seen.add(key);
      if (E.findSkill(name, profile)) return false;
      if (q.texto && String(q.texto).length <= 40 && E.findSkill(q.texto, profile)) return false;
      return true;
    }).map((q) => ({ name: String(q.nombre).trim(), text: q.texto && String(q.texto).length <= 40 ? String(q.texto).trim() : "", tipo: q.tipo || "" }));
  }
  function addCustomSkill(profile, name, terms, level) {
    name = String(name || "").trim();
    if (!name) return null;
    const id = "c-" + slug(name);
    profile.customSkills = profile.customSkills || [];
    let c = profile.customSkills.find((x) => x.id === id);
    const all = [name].concat(terms || []).map((t) => String(t).trim()).filter(Boolean);
    if (c) c.terms = [...new Set(c.terms.concat(all))];
    else profile.customSkills.push((c = { id, label: name, terms: [...new Set(all)] }));
    if (level !== null && level !== undefined) profile.skills[id] = Number(level);
    return c;
  }
  function removeCustomSkill(profile, id) {
    profile.customSkills = (profile.customSkills || []).filter((c) => c.id !== id);
    delete profile.skills[id];
  }
  function ignoreTerm(profile, name) {
    profile.ignoredTerms = [...new Set((profile.ignoredTerms || []).concat(String(name).trim()))];
  }

  // ---------- Avisos ----------
  const SITE_RE = /^(linkedin|bumeran|computrabajo|zonajobs|indeed|glassdoor|get ?on ?board|workana|empleos|jobs)\b/i;
  function linkedinId(url) {
    const m = (url || "").match(/\/jobs\/view\/(\d+)|currentJobId=(\d+)/);
    return m ? m[1] || m[2] : null;
  }
  function canonicalUrl(url) {
    const id = linkedinId(url);
    return id ? `https://www.linkedin.com/jobs/view/${id}/` : url || "";
  }
  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function jobKey(url, text) {
    const id = linkedinId(url);
    return id ? "li-" + id : "t-" + hash(E.norm(text).replace(/\s+/g, " ").trim().slice(0, 600));
  }
  const SEARCH_PAGE_RE = /^(buscar|empleos|jobs|search|busqueda|búsqueda|todos los empleos|ofertas de empleo|resultados)\b/i;
  function guessTitleCompany(tabTitle, text) {
    let title = "", company = "";
    const t = (tabTitle || "").replace(/^\(\d+\)\s*/, "").trim();
    // LinkedIn arma el título como "Puesto | Empresa | LinkedIn": se separa solo por "|",
    // porque el puesto puede tener guiones ("Strategy & Consulting - Retail Consultant").
    let parts = t.split(/\s+\|\s+/).map((s) => s.trim()).filter(Boolean);
    // Otros portales usan " - " ("Puesto - Empresa - Bumeran"): solo si termina en el nombre del sitio.
    if (parts.length < 2) {
      const dash = t.split(/\s+[-–—]\s+/).map((s) => s.trim()).filter(Boolean);
      if (dash.length >= 2 && SITE_RE.test(dash[dash.length - 1])) parts = dash;
    }
    if (parts.length >= 2 && SITE_RE.test(parts[parts.length - 1])) parts = parts.slice(0, -1);
    else if (parts.length < 2) parts = [];
    if (parts.length && !SEARCH_PAGE_RE.test(parts[0])) {
      title = parts[0];
      company = parts.length >= 2 ? parts[parts.length - 1] : "";
    }
    if (!title) {
      const first = E.splitSegments(text || "")[0] || "";
      if (first.length <= 90) title = first;
    }
    return { title, company };
  }

  async function upsertJob({ text, url, tabTitle }) {
    const { jobs } = await load();
    const id = jobKey(url, text);
    const now = new Date().toISOString();
    let job = jobs.find((j) => j.id === id);
    const g = guessTitleCompany(tabTitle, text);
    if (job) {
      if (job.synthetic || text.length > (job.text || "").length) { job.text = text.slice(0, 20000); job.synthetic = false; }
      job.lastSeen = now;
      if (tabTitle) job.tabTitle = tabTitle;
      if (job.titleAuto !== false && g.title) job.title = g.title;
      if (job.companyAuto !== false && g.company) job.company = g.company;
    } else {
      job = { id, created: now, lastSeen: now, url: canonicalUrl(url), tabTitle: tabTitle || "", title: g.title, company: g.company, titleAuto: true, companyAuto: true, status: "evaluado", notes: "", text: text.slice(0, 20000) };
      jobs.unshift(job);
    }
    await saveJobs(jobs);
    return job;
  }
  // Guarda el análisis de la IA en el aviso y completa puesto/empresa si no los editaste a mano.
  function aiPatch(job, a) {
    const patch = { ai: { at: new Date().toISOString(), result: a } };
    if (a.puesto && (job.titleAuto !== false || !job.title)) patch.title = String(a.puesto).trim();
    if (a.empresa && (job.companyAuto !== false || !job.company)) patch.company = String(a.empresa).trim();
    return patch;
  }
  async function updateJob(id, patch) {
    const { jobs } = await load();
    const j = jobs.find((x) => x.id === id);
    if (!j) return null;
    Object.assign(j, patch);
    await saveJobs(jobs);
    return j;
  }
  async function deleteJob(id) {
    const { jobs } = await load();
    await saveJobs(jobs.filter((j) => j.id !== id));
  }

  const SEVERITY = { green: 0, yellow: 1, red: 2 };
  const VERDICT_TEXT = { green: "Postulate", yellow: "Alcanzable: revisá lo que falta", red: "Lejos por ahora" };
  function evalJob(job, profile) {
    const r = E.evaluate(job.text || "", profile, { title: job.title });
    if (job.synthetic) {
      // Aviso restaurado sin su texto: se pierden alertas (presencialidad, carrera, experiencia específica),
      // así que se usa el veredicto más prudente entre el original y el recalculado.
      if (job.restoredVerdict && SEVERITY[job.restoredVerdict] > SEVERITY[r.verdict]) {
        r.verdict = job.restoredVerdict;
        r.verdictText = VERDICT_TEXT[r.verdict];
      }
      r.flags.push({ level: "info", text: "Aviso restaurado sin el texto original: evaluálo de nuevo desde el link para un análisis completo." });
      r.warnings = [];
    }
    return r;
  }

  // Une lo que detectan las reglas con lo que devolvió la IA (la IA completa lo que las reglas no ven).
  function details(job, r) {
    const a = (job.ai && job.ai.result) || {};
    const post = a.postulacion || {};
    const app = r.application || {};
    const aiLang = post.cv_idioma && !/no especifica/i.test(post.cv_idioma) ? post.cv_idioma : "";
    const emails = [...new Set(app.emails.concat(post.email ? [String(post.email).toLowerCase().trim()] : []))].filter(Boolean);
    // Si las reglas ya detectaron algo (ej. pretensión salarial), no repetir lo mismo dicho por la IA.
    const TOPICS = [/pretensi|salar|remunerac/, /portfolio|portafolio/, /carta|cover|motivation/, /referenc/];
    const topic = (t) => TOPICS.findIndex((re) => re.test(E.norm(t)));
    const ruleTopics = new Set(app.instructions.map(topic).filter((i) => i >= 0));
    const aiInstr = (Array.isArray(post.instrucciones) ? post.instrucciones : []).filter((t) => t && !ruleTopics.has(topic(t)));
    const instr = [...new Set(app.instructions.concat(aiInstr))];
    const aiMod = a.modalidad && !/sin dato/i.test(a.modalidad) ? a.modalidad : "";
    const motivo = r.verdict === "green" ? [] : r.flags.filter((f) => f.level === "red" || f.level === "yellow").map((f) => f.text);
    if (r.verdict !== "green" && r.reviewLines.length) motivo.push("Revisar experiencia específica que piden");
    return {
      descripcion: a.descripcion || "",
      consultora: a.consultora || "",
      modalidad: r.modality !== "sin dato" ? r.modality : aiMod || "sin dato",
      cvIdioma: app.cvExplicit ? app.cvLanguage : aiLang || app.cvLanguage || "",
      cvCita: app.cvExplicit ? app.cvEvidence : post.cv_idioma_cita || "",
      emails, asunto: app.subject || post.asunto || "", instrucciones: instr, motivo,
    };
  }

  // ---------- Familia de puesto ----------
  // Lo que corregiste a mano manda; después, lo que dijo la IA (lee el aviso entero); después, lo restaurado de la hoja; al final, el título.
  const FAMILY_LABELS = E.FAMILIES.map((f) => f.label).concat(E.OTHER_FAMILY);
  function familyOf(job) {
    if (job.familyManual && job.family) return job.family;
    const ai = job.ai && job.ai.result && job.ai.result.familia;
    return (ai && E.familyByName(ai)) || job.family || E.familyFromTitle(job.title) || E.OTHER_FAMILY;
  }

  // ---------- Análisis de "Mis avisos" ----------
  // Re-evalúa cada aviso con el perfil actual, así el análisis se actualiza cuando respondés preguntas.
  function analyze(jobs, profile) {
    const evals = jobs.map((job) => ({ job, r: evalJob(job, profile) }));
    const N = evals.length;
    const skills = {};
    const keyOf = (i) => (i.id === "bi" ? "bi" : i.id);
    const ensure = (i) => {
      const k = keyOf(i);
      if (!skills[k]) {
        const lab = i.id === "bi" ? "Herramienta de tableros (Power BI, Tableau, Looker…)" : i.label;
        skills[k] = { id: k, label: lab, lang: !!i.lang, native: E.isNative(profile, k), total: 0, req: 0, nice: 0, mention: 0, gap: 0, unknown: 0, score: 0, unlock: 0, ok: 0, tools: new Set() };
      }
      return skills[k];
    };
    const verdicts = { green: 0, yellow: 0, red: 0 };
    const status = {};
    let seniorCount = 0, closedCareer = 0, yearsFar = 0, yearsNear = 0, noYears = 0, remote = 0;
    const aiOther = {};
    const fams = {};
    const APPLIED = ["postule", "entrevista", "oferta", "rechazado"];

    evals.forEach(({ job, r }) => {
      verdicts[r.verdict]++;
      const fl = familyOf(job);
      const fb = (fams[fl] = fams[fl] || { label: fl, total: 0, green: 0, yellow: 0, red: 0, applied: 0, called: 0, dist: [], gaps: {} });
      fb.total++;
      fb[r.verdict]++;
      if (APPLIED.includes(job.status)) fb.applied++;
      if (job.status === "entrevista" || job.status === "oferta") fb.called++;
      fb.dist.push(r.distance);
      // Qué te frena en esta familia: excluyentes que faltan, años y puestos senior.
      const gap = (k) => { fb.gaps[k] = (fb.gaps[k] || 0) + 1; };
      r.missReq.forEach((i) => gap(i.id === "bi" ? "Herramienta de tableros" : i.label));
      if (r.yearsGap >= 1) gap("años de experiencia");
      if (r.seniority === "senior") gap("puesto senior");
      status[job.status] = (status[job.status] || 0) + 1;
      if (r.seniority === "senior") seniorCount++;
      if (r.flags.some((f) => /Lista cerrada/.test(f.text))) closedCareer++;
      if (r.yearsReq === null) noYears++;
      else if (r.yearsGap >= 3) yearsFar++;
      else if (r.yearsGap >= 1) yearsNear++;
      if (r.modality === "remoto") remote++;
      r.items.forEach((i) => {
        const s = ensure(i);
        s.total++;
        s[i.cls]++;
        if (i.tools) i.tools.forEach((t) => s.tools.add(t));
        if (i.status === "unknown") s.unknown++;
        if (i.status === "ok") s.ok++;
        // Si se transfiere desde otra herramienta que manejás bien, no lo contamos como algo a reforzar.
        const transfer = i.status === "partial" && /se transfiere/.test(i.note || "");
        if ((i.status === "missing" || (i.status === "partial" && !transfer)) && i.cls !== "mention") s.gap++;
        const w = { req: { missing: 3, partial: 1.5 }, nice: { missing: 1, partial: 0.5 }, mention: { missing: 0.5, partial: 0.25 } };
        if (!transfer) s.score += (w[i.cls] && w[i.cls][i.status]) || 0;
      });
      // Si un aviso tiene un solo excluyente que te falta y nada más grave, aprenderlo lo "destraba".
      const hardRed = r.flags.some((f) => f.level === "red") || r.yearsGap >= 3;
      if (!hardRed && r.missReq.length === 1) ensure(r.missReq[0]).unlock++;
      const ai = job.ai && job.ai.result && job.ai.result.requisitos;
      (ai || []).forEach((q) => {
        const name = String(q.nombre || "").trim();
        if (!name) return;
        const n = E.norm(name);
        if (E.findSkill(name, profile) || (profile.ignoredTerms || []).map(E.norm).includes(n)) return;
        aiOther[n] = aiOther[n] || { label: name, count: 0, req: 0, tool: !q.clase || q.clase === "herramienta" };
        aiOther[n].count++;
        if (/excluyente/.test(E.norm(q.tipo || ""))) aiOther[n].req++;
      });
    });

    const lvOf = (id) => { const v = E.skillLevel(profile, id); return v === null ? -1 : v; };
    const list = Object.values(skills).map((s) => {
      const lv = s.id === "bi" ? Math.max(-1, ...[...s.tools].map(lvOf)) : lvOf(s.id);
      return { ...s, tools: [...s.tools], myLevel: lv >= 0 ? lv : null };
    });
    const reinforce = list.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || b.total - a.total);
    // Los idiomas tienen su propio consejo (certificarlo); "un proyecto que lo use" es para herramientas.
    const highlight = list.filter((s) => !s.lang && s.ok > 0 && s.req + s.nice >= 2 && s.gap === 0 && s.myLevel !== null && s.myLevel >= 2).sort((a, b) => b.req + b.nice - (a.req + a.nice));
    const toAsk = list.filter((s) => s.unknown > 0).sort((a, b) => b.unknown - a.unknown);

    const tips = [];
    highlight.slice(0, 4).forEach((s) => tips.push({ strong: s.label, text: `aparece como requisito en ${s.req + s.nice} de ${N} avisos y lo tenés en nivel ${E.LEVEL_NAMES[s.myLevel]}. Que se vea arriba en el CV, con un proyecto concreto que lo use.` }));
    const CERT_EXAMPLE = { lang_en: "EF SET, que es gratis, o TOEFL", lang_pt: "Celpe-Bras", lang_fr: "DELF", lang_de: "Goethe", lang_it: "CILS", lang_es: "DELE o SIELE" };
    list.filter((s) => s.lang && !s.native && s.total >= 2 && s.myLevel !== null && s.myLevel >= 1 && (profile.langCerts || {})[s.id] !== true)
      .sort((a, b) => b.total - a.total).slice(0, 2)
      .forEach((s) => tips.push({ strong: s.label, text: `lo piden en ${s.total} de ${N} avisos. Sin certificado, conviene un test o certificado (por ejemplo ${CERT_EXAMPLE[s.id] || "uno oficial"}) para respaldarlo en el CV.` }));
    if (yearsFar + yearsNear >= Math.max(2, N * 0.3)) tips.push({ strong: "Experiencia", text: `${yearsFar + yearsNear} avisos piden más años de los que tenés. Presentá como experiencia los proyectos con datos reales (investigación, trabajos de cursos, freelance) con resultados concretos.` });
    if (closedCareer >= 2) tips.push({ strong: "Carrera", text: `${closedCareer} avisos tienen una lista cerrada de carreras sin la tuya: poné tus otros estudios y herramientas en el resumen, arriba de todo.` });
    if (seniorCount >= Math.max(2, N * 0.25)) tips.push({ strong: "Búsquedas", text: `${seniorCount} de ${N} avisos eran senior o de liderazgo: ajustá los filtros para no perder tiempo con esos.` });

    const apply = evals
      .filter(({ job, r }) => job.status === "evaluado" && r.verdict !== "red")
      .sort((a, b) => (a.r.verdict === b.r.verdict ? 0 : a.r.verdict === "green" ? -1 : 1) || a.r.distance - b.r.distance);

    // En qué puestos enfocarte: la familia con más avisos a tu alcance (oferta y cercanía a la vez).
    const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const families = Object.values(fams).map((b) => ({
      label: b.label, total: b.total, green: b.green, yellow: b.yellow, red: b.red, applied: b.applied, called: b.called,
      reach: b.green + b.yellow, distance: median(b.dist),
      gaps: Object.entries(b.gaps).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([label, n]) => ({ label, n })),
    })).sort((a, b) => (a.label === E.OTHER_FAMILY) - (b.label === E.OTHER_FAMILY) || b.reach - a.reach || b.reach / b.total - a.reach / a.total || b.green - a.green || a.distance - b.distance);
    const focus = [];
    const named = families.filter((f) => f.label !== E.OTHER_FAMILY);
    const best = named.find((f) => f.reach > 0);
    if (N < 5) focus.push({ strong: "Todavía son pocos avisos", text: `con ${N} no alcanza para elegir un puesto. Evaluá al menos 10, de puestos distintos, y esta comparación se vuelve confiable.` });
    if (best) {
      const alt = named.find((f) => f !== best && f.reach > 0 && f.reach >= best.reach - 1);
      const how = best.total === 1
        ? `el único aviso de este puesto que miraste ${best.green ? "es para postularte ya" : "está a tu alcance"}. Es uno solo: tomalo como pista, no como conclusión.`
        : `${best.reach} de los ${best.total} avisos de este puesto que miraste están a tu alcance (${best.green} para postularte ya).`;
      focus.push({ strong: `Enfocate en ${best.label}`, text: how + (alt ? ` ${alt.label} le sigue de cerca (${alt.reach} de ${alt.total}): sirve como segunda opción con el mismo CV ajustado.` : "") });
    }
    named.filter((f) => f !== best && f.total >= 2 && f.reach / f.total < 0.34 && f.gaps.length).slice(0, 2).forEach((f) => {
      focus.push({ strong: f.label, text: `aparece en ${f.total} avisos pero casi todos te quedan lejos. Lo que más te frena: ${f.gaps.map((g) => `${g.label} (${g.n})`).join(", ")}.` });
    });
    const appliedTotal = families.reduce((s, f) => s + f.applied, 0);
    const called = families.filter((f) => f.called > 0).sort((a, b) => b.called / b.applied - a.called / a.applied)[0];
    if (appliedTotal >= 3 && called) focus.push({ strong: "Donde te llaman", text: `en ${called.label} te llamaron en ${called.called} de ${called.applied} postulaciones. Es la mejor señal de qué CV está funcionando.` });
    const other = fams[E.OTHER_FAMILY];
    if (other && other.total >= Math.max(2, N * 0.3)) focus.push({ strong: "Sin clasificar", text: `${other.total} avisos no encajan en ningún puesto de la lista. Revisá su familia en la tabla de abajo y corregila si hace falta.` });

    return {
      N, evals, verdicts, status, reinforce, highlight, toAsk, tips, apply, families, focus,
      counts: { seniorCount, closedCareer, yearsFar, yearsNear, noYears, remote },
      aiOther: Object.values(aiOther).filter((x) => x.count >= 1).sort((a, b) => b.count - a.count),
    };
  }

  // ---------- Filas para Google Sheets / CSV ----------
  function buildSheets(jobs, profile, companies) {
    companies = companies || {};
    const avisos = [["id", "fecha", "puesto", "familia de puesto", "empresa", "consultora", "link", "estado", "veredicto", "motivo", "excluyentes que faltan", "casi", "deseables que faltan", "seniority", "años pedidos", "modalidad", "descripción", "idioma del CV", "mail para postular", "asunto del mail", "otras indicaciones", "notas", "texto del aviso"]];
    const reqs = [["aviso_id", "puesto", "familia de puesto", "empresa", "estado", "veredicto", "requisito", "detalle", "tipo", "nivel pedido", "mi nivel", "cumplo", "fuente"]];
    const cumple = { ok: "sí", partial: "casi", missing: "no", unknown: "sin responder" };
    const byCompany = {};
    jobs.forEach((j) => {
      const r = evalJob(j, profile);
      const d = details(j, r);
      const verdict = VERDICT_NAME[r.verdict] + (r.provisional ? " (provisorio)" : "");
      const fam = familyOf(j);
      avisos.push([
        j.id, (j.created || "").slice(0, 10), j.title || "", fam, j.company || "", d.consultora, j.url || "", statusName(j.status),
        verdict, d.motivo.join(" · "), r.missReq.map((i) => i.label).join(", "), r.partialReq.map((i) => i.label).join(", "), r.missNice.map((i) => i.label).join(", "),
        r.seniority, r.yearsReq === null ? "" : r.yearsReq, d.modalidad, d.descripcion, d.cvIdioma, d.emails.join(", "), d.asunto, d.instrucciones.join(" · "), j.notes || "",
        // El texto queda en la hoja para poder restaurar todo si reinstalás la extensión.
        j.synthetic ? "" : String(j.text || "").slice(0, 45000),
      ]);
      const base = [j.id, j.title || "", fam, j.company || "", statusName(j.status), verdict];
      r.items.forEach((i) => {
        const bi = i.id === "bi";
        const mine = bi ? (i.own === null ? "sin responder" : E.LEVEL_NAMES[i.own]) : E.isNative(profile, i.id) ? "nativo" : levelName(E.skillLevel(profile, i.id));
        const detalle = bi ? i.tools.map((t) => E.skillLabel(t, profile)).join(", ") : i.implicit ? "el aviso está en " + i.label.toLowerCase() : i.lang ? "idioma" : "";
        reqs.push(base.concat([
          bi ? "Herramienta de tableros" : i.label, detalle,
          CLS_NAME[i.cls] || i.cls, i.explicit ? i.needName : "no especifica", mine, cumple[i.status] || i.status, "reglas",
        ]));
      });
      // Requisitos que encontró la IA y las reglas no ven (experiencia en un rubro, herramientas nuevas…)
      const seen = new Set();
      ((j.ai && j.ai.result && j.ai.result.requisitos) || []).forEach((q) => {
        const name = String(q.nombre || "").trim();
        const key = E.norm(name);
        if (!name || seen.has(key)) return;
        seen.add(key);
        if (E.findSkill(name, profile) || (q.texto && String(q.texto).length <= 40 && E.findSkill(q.texto, profile))) return;
        reqs.push(base.concat([name, q.clase || "", q.tipo || "", q.nivel || "no especifica", "—", "a revisar", "IA"]));
      });
      const ck = companyKey(j.company);
      if (ck) {
        const b = (byCompany[ck] = byCompany[ck] || { nombre: j.company, avisos: 0, estados: {} });
        b.avisos++;
        b.estados[statusName(j.status)] = (b.estados[statusName(j.status)] || 0) + 1;
      }
    });
    const empresas = [["empresa", "rubro", "qué hace", "tamaño", "sede", "presencia en Argentina", "sitio web", "consultora de selección", "dato útil para la entrevista", "confianza", "cómo se obtuvo", "fuentes", "fecha de búsqueda", "avisos evaluados", "estados", "clave"]];
    const keys = [...new Set(Object.keys(byCompany).concat(Object.keys(companies)))];
    keys.forEach((k) => {
      const c = companies[k] || {};
      const b = byCompany[k] || { nombre: c.nombre || c.empresa || "", avisos: 0, estados: {} };
      empresas.push([
        c.empresa || b.nombre, c.rubro || "", c.que_hace || "", c.tamano || "", c.sede || "", c.presencia_argentina || "", c.sitio_web || "",
        c.es_consultora || "", c.dato_util || "", c.confianza || (c.fecha ? "" : "sin buscar"), c.metodo || "",
        (c.fuentes || []).map((f) => f.url).join(" "), (c.fecha || "").slice(0, 10), b.avisos,
        Object.entries(b.estados).map(([n, v]) => `${v} ${n.toLowerCase()}`).join(", "), k,
      ]);
    });
    const perfil = [["dato", "valor"],
      ["años de experiencia", E.known(profile.yearsExperience) ? profile.yearsExperience : "sin responder"],
      ["carrera", (profile.careerKeywords || []).join(", ")],
      ["estado de la carrera", profile.careerStatus === "graduado" ? "graduado" : profile.careerStatus ? "estudiante avanzado" : "sin responder"],
      ["otros estudios", (profile.relatedKeywords || []).join(", ")],
      ["lengua nativa", (E.LANGS.find((l) => l.code === profile.nativeLanguage) || { label: "" }).label],
      ["ciudad", profile.city || ""],
      ["se mudaría a Buenos Aires", profile.openToBuenosAires === null ? "sin responder" : profile.openToBuenosAires ? "sí" : "no"],
      ["nota sobre el título", profile.graduationNote || ""],
    ];
    E.LANGS.forEach((l) => { const c = (profile.langCerts || {})[l.id]; if (c === true || c === false) perfil.push(["certificado de " + l.label.toLowerCase(), c ? "sí" : "no"]); });
    E.allSkills(profile).forEach((s) => { if (E.known(profile.skills[s.id])) perfil.push([s.label, E.LEVEL_NAMES[profile.skills[s.id]]]); });
    return { Avisos: avisos, Requisitos: reqs, Empresas: empresas, Perfil: perfil };
  }

  // Lee la pestaña Empresas (filas de la hoja) y la convierte en la memoria de empresas.
  function companiesFromRows(rows) {
    if (!rows || rows.length < 2) return {};
    const h = rows[0].map((x) => E.norm(String(x)));
    const col = (name) => h.indexOf(E.norm(name));
    const out = {};
    rows.slice(1).forEach((r) => {
      const get = (n) => { const i = col(n); return i >= 0 ? String(r[i] || "") : ""; };
      const fecha = get("fecha de búsqueda");
      if (!fecha) return; // empresas que nunca se buscaron
      const nombre = get("empresa");
      const key = get("clave") || companyKey(nombre);
      if (!key) return;
      out[key] = {
        key, nombre, empresa: nombre, rubro: get("rubro"), que_hace: get("qué hace"), tamano: get("tamaño"), sede: get("sede"),
        presencia_argentina: get("presencia en Argentina"), sitio_web: get("sitio web"), es_consultora: get("consultora de selección"),
        dato_util: get("dato útil para la entrevista"), confianza: get("confianza"), metodo: get("cómo se obtuvo"),
        fuentes: get("fuentes").split(/\s+/).filter(Boolean).map((u) => ({ title: u, url: u })),
        fecha: new Date(fecha).toISOString(),
      };
    });
    return out;
  }

  function toCsv(rows) {
    return "﻿" + rows.map((r) => r.map((c) => {
      const s = String(c === null || c === undefined ? "" : c);
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")).join("\r\n");
  }

  // ---------- Google Sheets (vía Apps Script) ----------
  function newToken() {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function appsScriptCode(token) {
    return `/** @OnlyCurrentDoc */
// Código para tu hoja de Google Sheets. Recibe los datos del Evaluador de avisos
// y reescribe las pestañas Avisos, Requisitos, Empresas y Perfil. También puede leer Empresas
// para recuperar las empresas ya buscadas si reinstalás la extensión.
const TOKEN = '${token}';

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  if (data.token !== TOKEN) return respond({ ok: false, error: 'Token incorrecto' });
  if (data.ping) return respond({ ok: true, ping: true, version: 2 });
  if (data.read) {
    const rsh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(data.read);
    return respond({ ok: true, rows: rsh ? rsh.getDataRange().getDisplayValues() : [] });
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(data.sheets).forEach(function (name) {
    const rows = data.sheets[name];
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clearContents();
    if (rows.length) sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    sh.setFrozenRows(1);
  });
  return respond({ ok: true, at: new Date().toISOString() });
}

function doGet() {
  return respond({ ok: true, message: 'Evaluador de avisos: la hoja está lista.' });
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`;
  }
  async function postToSheet(url, body) {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/.test(url || "")) {
      throw new Error("El link tiene que ser el de la aplicación web: empieza con https://script.google.com/macros/s/ y termina en /exec.");
    }
    let res;
    try {
      res = await fetch(url, { method: "POST", body: JSON.stringify(body) });
    } catch (e) {
      throw new Error("No se pudo conectar con Google. Revisá tu conexión.");
    }
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch (e) {
      throw new Error("La hoja no respondió como esperaba. Revisá que la implementación tenga acceso para \"Cualquier usuario\" y que pegaste el código completo.");
    }
    if (!data.ok) throw new Error(data.error === "Token incorrecto" ? "El código de la hoja tiene otro token: volvé a copiarlo desde Mi perfil." : data.error || "Error de la hoja.");
    return data;
  }
  async function pingSheets(url, token) {
    return postToSheet(url, { token, ping: true });
  }
  // ---------- Restaurar desde la hoja (si reinstalaste la extensión) ----------
  async function readSheet(name) {
    const { settings } = await load();
    let data;
    try { data = await postToSheet(settings.sheets.url, { token: settings.sheets.token, read: name }); }
    catch (e) { throw new Error(/no respondió como esperaba|otro token/.test(e.message) ? "Para leer la hoja, pegá el código nuevo en Apps Script y volvé a implementarlo (Mi perfil → Google Sheets)." : e.message); }
    if (!Array.isArray(data.rows)) throw new Error("Para leer la hoja, pegá el código nuevo en Apps Script y volvé a implementarlo (Mi perfil → Google Sheets).");
    return data.rows;
  }
  function rowsToObjects(rows) {
    if (!rows || rows.length < 2) return [];
    const h = rows[0].map((x) => String(x).trim());
    return rows.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? "" : String(r[i])])));
  }
  function profileFromRows(rows, base) {
    const p = mergeProfile(base);
    const levelOf = (v) => { const i = E.LEVEL_NAMES.indexOf(String(v).trim().toLowerCase()); return i >= 0 ? i : null; };
    const yesNo = (v) => (/^s[ií]$/i.test(v) ? true : /^no$/i.test(v) ? false : null);
    const list = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
    rowsToObjects(rows).forEach(({ dato, valor }) => {
      const d = E.norm(dato || "");
      if (!d) return;
      if (d === "anos de experiencia") { const n = parseFloat(String(valor).replace(",", ".")); p.yearsExperience = isNaN(n) ? null : n; }
      else if (d === "carrera") p.careerKeywords = list(valor);
      else if (d === "estado de la carrera") p.careerStatus = /graduad/i.test(valor) ? "graduado" : /estudiante/i.test(valor) ? "estudiante_avanzado" : null;
      else if (d === "otros estudios") p.relatedKeywords = list(valor);
      // Hojas viejas tienen la fila "inglés": como ahora es un idioma con ese nombre, la toma el caso general de abajo.
      else if (d === "lengua nativa") { const l = E.LANGS.find((x) => E.norm(x.label) === E.norm(valor)); if (l) p.nativeLanguage = l.code; }
      else if (/^certificado de /.test(d)) {
        const l = E.LANGS.find((x) => E.norm(x.label) === d.replace(/^certificado de /, ""));
        if (l && yesNo(valor) !== null) p.langCerts[l.id] = yesNo(valor);
      }
      else if (d === "ciudad") p.city = String(valor || "").trim();
      else if (d === "se mudaria a buenos aires") p.openToBuenosAires = yesNo(valor);
      else if (d === "nota sobre el titulo") p.graduationNote = String(valor || "");
      else {
        const lv = levelOf(valor);
        if (lv === null) return;
        const sk = E.allSkills(p).find((x) => E.norm(x.label) === d);
        if (sk) p.skills[sk.id] = lv;
        else { const c = addCustomSkill(p, dato, [], lv); if (!c) return; }
      }
    });
    return p;
  }
  // Si la hoja no tiene el texto del aviso (versiones anteriores), se arma uno con los requisitos guardados.
  // Alcanza para el análisis de "Mis avisos"; al volver a evaluar el aviso desde su link, se reemplaza por el real.
  function syntheticText(a, reqs) {
    const sec = { req: [], nice: [], mention: [] };
    const yrs = parseInt(a["años pedidos"], 10);
    if (yrs > 0) sec.req.push(`Experiencia mínima de ${yrs} años`);
    reqs.forEach((q) => {
      if ((q.fuente || "reglas") !== "reglas") return;
      const name = q.requisito === "Herramienta de tableros" && q.detalle ? q.detalle : q.requisito;
      if (!name) return;
      const nivel = q["nivel pedido"] && !/no especifica/i.test(q["nivel pedido"]) ? " " + q["nivel pedido"] : "";
      const t = E.norm(q.tipo || "");
      // "aviso en inglés" (hojas viejas) es el idioma del aviso: ahora cuenta como mencionado, no como excluyente.
      const where = /excluyente|pedido/.test(t) ? "req" : /deseable/.test(t) ? "nice" : "mention";
      sec[where].push(name + nivel);
    });
    const mod = a.modalidad && !/sin dato/i.test(a.modalidad) ? `Modalidad: ${a.modalidad}` : "";
    return [a.puesto || "Aviso", mod,
      "Requisitos", ...sec.req.map((x) => "- " + x),
      sec.nice.length ? "Deseable" : "", ...sec.nice.map((x) => "- " + x),
      sec.mention.length ? "Tareas" : "", ...sec.mention.map((x) => "- " + x),
    ].filter(Boolean).join("\n");
  }
  function jobsFromRows(avisoRows, reqRows) {
    const reqs = rowsToObjects(reqRows);
    const byId = {};
    reqs.forEach((q) => { (byId[q.aviso_id] = byId[q.aviso_id] || []).push(q); });
    const statusCode = (name) => (STATUS.find(([, n]) => E.norm(n) === E.norm(name || "")) || STATUS[0])[0];
    return rowsToObjects(avisoRows).filter((a) => a.id).map((a) => {
      const real = String(a["texto del aviso"] || "").trim();
      const created = a.fecha ? new Date(a.fecha + "T12:00:00").toISOString() : new Date().toISOString();
      return {
        id: a.id, created, lastSeen: created, url: a.link || "", tabTitle: "", title: a.puesto || "", company: a.empresa || "",
        family: E.familyByName(a["familia de puesto"]) || "",
        titleAuto: true, companyAuto: true, status: statusCode(a.estado), notes: a.notas || "",
        text: real || syntheticText(a, byId[a.id] || []), synthetic: !real, restored: true,
        restoredVerdict: /postulate/i.test(a.veredicto) ? "green" : /alcanzable/i.test(a.veredicto) ? "yellow" : /lejos/i.test(a.veredicto) ? "red" : "",
      };
    });
  }
  async function restoreFromSheet() {
    const { profile, jobs, companies, settings } = await load();
    const [perfilRows, avisoRows, reqRows] = [await readSheet("Perfil"), await readSheet("Avisos"), await readSheet("Requisitos")];
    let empresaRows = [];
    try { empresaRows = await readSheet("Empresas"); } catch (e) { /* hojas viejas no tienen Empresas */ }
    // Perfil: lo de la hoja completa lo que la extensión no sabe; lo que ya respondiste acá se respeta.
    const fromSheet = profileFromRows(perfilRows, profile);
    const merged = mergeProfile(profile);
    Object.keys(fromSheet).forEach((k) => {
      if (k === "skills") Object.entries(fromSheet.skills).forEach(([id, v]) => { if (!E.known(merged.skills[id])) merged.skills[id] = v; });
      else if (k === "langCerts") Object.entries(fromSheet.langCerts).forEach(([id, v]) => { if (merged.langCerts[id] === undefined) merged.langCerts[id] = v; });
      else if (k === "customSkills") merged.customSkills = fromSheet.customSkills;
      else if (!E.known(merged[k]) || (Array.isArray(merged[k]) && !merged[k].length)) merged[k] = fromSheet[k];
    });
    // Avisos: se agregan los que no están en la extensión.
    const have = new Set(jobs.map((j) => j.id));
    const restored = jobsFromRows(avisoRows, reqRows).filter((j) => !have.has(j.id));
    const allJobs = jobs.concat(restored).sort((a, b) => (b.created || "").localeCompare(a.created || ""));
    // Empresas
    const fromCompanies = companiesFromRows(empresaRows);
    let nComp = 0;
    Object.entries(fromCompanies).forEach(([k, v]) => { if (!companies[k]) { companies[k] = v; nComp++; } });
    await saveProfile(merged);
    await saveJobs(allJobs);
    await saveCompanies(companies);
    settings.sheets.pendingRestore = false;
    await saveSettings(settings);
    return {
      avisos: restored.length, sinTexto: restored.filter((j) => j.synthetic).length, empresas: nComp,
      herramientas: Object.keys(merged.skills).length,
    };
  }
  // Al conectar la hoja: si la extensión está vacía y la hoja tiene avisos, frenar la sincronización
  // hasta que restaures (o decidas sobrescribir), para no pisar la hoja con datos vacíos.
  async function checkBeforeFirstSync() {
    const { jobs, settings } = await load();
    if (jobs.length) return { sheetJobs: 0 };
    let rows = [];
    try { rows = await readSheet("Avisos"); } catch (e) { rows = null; }
    const n = rows === null ? -1 : Math.max(0, rows.length - 1);
    if (n !== 0) { settings.sheets.pendingRestore = true; await saveSettings(settings); }
    return { sheetJobs: n };
  }

  // Trae las empresas ya buscadas desde la hoja (sin pisar las que ya están en el navegador).
  async function importCompaniesFromSheet() {
    const { settings, companies } = await load();
    let data;
    try { data = await postToSheet(settings.sheets.url, { token: settings.sheets.token, read: "Empresas" }); }
    catch (e) { throw new Error(/no respondió como esperaba/.test(e.message) ? "Para traer empresas, actualizá el código de la hoja (Mi perfil → Google Sheets) y volvé a implementarlo." : e.message); }
    if (!Array.isArray(data.rows)) throw new Error("Para traer empresas, actualizá el código de la hoja (Mi perfil → Google Sheets) y volvé a implementarlo.");
    const fromSheet = companiesFromRows(data.rows);
    let added = 0;
    Object.entries(fromSheet).forEach(([k, v]) => {
      if (!companies[k] || companyAgeDays(companies[k]) > companyAgeDays(v)) { companies[k] = v; added++; }
    });
    await saveCompanies(companies);
    return added;
  }
  async function syncSheets(opts) {
    const { jobs, profile, settings } = await load();
    const overwrite = opts && opts.overwrite;
    if (settings.sheets.pendingRestore && !overwrite) {
      throw new Error("La hoja tiene datos y la extensión está vacía: restaurá desde la hoja antes de sincronizar (Mi perfil → Google Sheets).");
    }
    // Protección: con la extensión vacía, nunca escribir sin antes mirar si la hoja tiene avisos.
    if (!jobs.length && !overwrite) {
      let rows = null;
      try { rows = await readSheet("Avisos"); } catch (e) { rows = null; }
      if (rows === null || rows.length > 1) {
        settings.sheets.pendingRestore = true;
        settings.sheets.lastError = rows === null
          ? "No sincronicé: la extensión está vacía y no pude revisar la hoja. Actualizá el código de la hoja (Mi perfil → Google Sheets)."
          : `No sincronicé: la hoja tiene ${rows.length - 1} aviso(s) y la extensión está vacía. Restaurá desde la hoja (Mi perfil → Google Sheets).`;
        await saveSettings(settings);
        throw new Error(rows === null
          ? "No sincronicé: la extensión está vacía y no pude revisar la hoja. Actualizá el código de la hoja (Mi perfil → Google Sheets)."
          : `No sincronicé: la hoja tiene ${rows.length - 1} aviso(s) y la extensión está vacía. Restaurá desde la hoja (Mi perfil → Google Sheets).`);
      }
    }
    try {
      const { companies } = await load();
      await postToSheet(settings.sheets.url, { token: settings.sheets.token, sheets: buildSheets(jobs, profile, companies) });
      settings.sheets.lastSync = new Date().toISOString();
      settings.sheets.lastError = "";
      await saveSettings(settings);
    } catch (e) {
      settings.sheets.lastError = e.message;
      await saveSettings(settings);
      throw e;
    }
  }
  let timer = null;
  function scheduleSync() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const { settings } = await load();
      if (!settings.sheets.url || !settings.sheets.auto || settings.sheets.pendingRestore) return;
      syncSheets().catch(() => {});
    }, 2500);
  }

  const api = {
    STATUS, statusName, VERDICT_NAME, CLS_NAME, levelName,
    mergeProfile, mergeSettings, load, saveProfile, saveSettings, saveJobs, saveCompanies,
    companyKey, findCompany, companyAgeDays, companyFresh, saveCompany, ensureCompany, importCompaniesFromSheet, companiesFromRows, COMPANY_MAX_AGE_DAYS,
    evalJob, details, aiPatch, familyOf, FAMILY_LABELS,
    readSheet, profileFromRows, jobsFromRows, syntheticText, restoreFromSheet, checkBeforeFirstSync,
    proposalsFor, addCustomSkill, removeCustomSkill, ignoreTerm,
    jobKey, canonicalUrl, guessTitleCompany, upsertJob, updateJob, deleteJob,
    analyze, buildSheets, toCsv, newToken, appsScriptCode, pingSheets, syncSheets, scheduleSync,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Store = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
