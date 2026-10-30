// Motor de reglas: compara el texto de un aviso con el perfil del usuario.
// Funciona en el navegador (globalThis.Evaluador) y en Node (module.exports).
(function (root) {
  "use strict";

  // ---------- Catálogo de herramientas ----------
  // family "bi": todas las herramientas de tableros se agrupan en un solo requisito.
  // transfer: si no tenés esta, cuánto te ayuda otra que sí tenés.
  const SKILLS = [
    { id: "sql", label: "SQL", re: [/\bsql\b/, /\bt-sql\b/, /\bpl\/sql\b/] },
    { id: "warehouse", label: "Data warehouse (BigQuery / Snowflake)", re: [/bigquery/, /snowflake/, /redshift/, /data warehouse/, /clickhouse/], transfer: ["sql"] },
    { id: "powerbi", label: "Power BI", family: "bi", re: [/power ?bi/, /\bdax\b/] },
    { id: "tableau", label: "Tableau", family: "bi", re: [/tableau/] },
    { id: "looker", label: "Looker / Looker Studio", family: "bi", re: [/looker/, /data studio/] },
    { id: "qlik", label: "Qlik", family: "bi", re: [/qlik/] },
    { id: "metabase", label: "Metabase", family: "bi", re: [/metabase/] },
    { id: "microstrategy", label: "MicroStrategy", family: "bi", re: [/microstrategy/] },
    { id: "excel", label: "Excel", re: [/\bexcel\b/], transfer: ["sheets"] },
    { id: "sheets", label: "Google Sheets", re: [/google sheets/, /\bsheets?\b/, /google workspace/], transfer: ["excel"] },
    { id: "powerquery", label: "Power Query", re: [/power query/, /\bm query\b/], transfer: ["excel", "powerbi"] },
    { id: "vba", label: "VBA / macros", re: [/\bvba\b/, /\bmacros\b/], transfer: ["python"] },
    { id: "appsscript", label: "Google Apps Script", re: [/apps script/], transfer: ["python"] },
    { id: "python", label: "Python", re: [/\bpython\b/, /\bpandas\b/] },
    { id: "r", label: "R", reRaw: [/(^|[\s,(\/])R(?=[\s,)\/.;:]|$)/], transfer: ["python"] },
    { id: "etl", label: "ETL / pipelines (dbt, Airflow)", re: [/\betl\b/, /\belt\b/, /\bdbt\b/, /airflow/], transfer: ["sql", "python"] },
    { id: "cloud", label: "Nube (AWS / GCP / Azure)", re: [/\baws\b/, /\bgcp\b/, /google cloud/, /\bazure\b/, /databricks/, /bedrock/] },
    { id: "ia", label: "Herramientas de IA", re: [/inteligencia artificial/, /\bia\b/, /\bai\b/, /chatgpt/, /\bclaude\b/, /gemini/, /\bllms?\b/, /copilot/, /genai/, /generative ai/, /\bn8n\b/] },
    { id: "stats", label: "Estadística / modelos predictivos", re: [/estadistic/, /statistic/, /modelos predictivos/, /predictiv/, /machine learning/, /regresion/, /regression/] },
    { id: "webanalytics", label: "Google Analytics / web analytics", re: [/google analytics/, /\bga4\b/, /adobe analytics/, /tag manager/, /web analytics/] },
    { id: "ads", label: "Google Ads / Meta Ads", re: [/google ads/, /meta ads/, /tiktok ads/, /paid media/] },
    { id: "crm", label: "CRM (Salesforce / HubSpot)", re: [/\bcrm\b/, /salesforce/, /hubspot/] },
    { id: "erp", label: "ERP / SAP", re: [/\bsap\b/, /\berp\b/] },
    { id: "git", label: "Git / GitHub", re: [/\bgit\b/, /github/] },
    { id: "research", label: "Investigación (entrevistas, encuestas)", re: [/investigacion de usuarios/, /user research/, /ux research/, /usability test/, /tests? de usabilidad/, /pruebas de usabilidad/, /encuesta/, /\bsurveys?\b/, /focus group/, /cualitativ/, /qualitativ/, /investigacion de mercado/, /market research/, /trabajo de campo/, /voice of the customer/] },
    { id: "hr", label: "RRHH / People Analytics", re: [/people analytics/, /recursos humanos/, /\brrhh\b/, /\brecruiting\b/, /reclutamiento/] },
    { id: "slides", label: "Presentaciones", re: [/powerpoint/, /google slides/, /\bpresentaciones\b/] },
    { id: "spss", label: "SPSS", re: [/\bspss\b/], transfer: ["stata", "r"] },
    { id: "stata", label: "Stata", re: [/\bstata\b/], transfer: ["spss", "r"] },
    { id: "sas", label: "SAS", re: [/\bsas\b/], transfer: ["spss", "python"] },
    { id: "alteryx", label: "Alteryx / KNIME", re: [/alteryx/, /\bknime\b/], transfer: ["powerquery"] },
    { id: "surveys", label: "Plataformas de encuestas (Qualtrics, SurveyMonkey, Forms)", re: [/qualtrics/, /surveymonkey/, /google forms/, /typeform/, /limesurvey/, /kobo ?toolbox/] },
    { id: "qual", label: "Análisis cualitativo (Atlas.ti / NVivo)", re: [/atlas\.? ?ti\b/, /nvivo/, /maxqda/] },
    { id: "uxanalytics", label: "Hotjar / Microsoft Clarity", re: [/hotjar/, /microsoft clarity/, /fullstory/] },
    { id: "productanalytics", label: "Mixpanel / Amplitude", re: [/mixpanel/, /\bamplitude\b/] },
    { id: "jira", label: "Jira / Confluence", re: [/\bjira\b/, /confluence/] },
    { id: "figma", label: "Figma", re: [/\bfigma\b/] },
    { id: "nocode", label: "Airtable / Notion", re: [/airtable/, /\bnotion\b/] },
    { id: "automation", label: "Automatización (Zapier / Make / Power Automate)", re: [/zapier/, /power automate/, /\bmake\.com\b/] },
  ];

  // Idiomas: se detectan y se miden como las herramientas, con tres diferencias:
  // la lengua nativa siempre se cumple, el idioma en que está escrito el aviso cuenta como pedido
  // y el nivel se lee también en la escala europea (A1–C2).
  const LANGS = [
    { id: "lang_es", code: "es", label: "Español", re: [/\bespanol\b/, /\bcastellano\b/, /\bspanish\b/] },
    { id: "lang_en", code: "en", label: "Inglés", re: [/\bingles\b/, /\benglish\b/] },
    { id: "lang_pt", code: "pt", label: "Portugués", re: [/\bportugues\b/, /\bportuguese\b/] },
    { id: "lang_fr", code: "fr", label: "Francés", re: [/\bfrances\b/, /\bfrench\b/] },
    { id: "lang_de", code: "de", label: "Alemán", re: [/\baleman\b/, /\bgerman\b/] },
    { id: "lang_it", code: "it", label: "Italiano", re: [/\bitaliano\b/, /\bitalian\b/] },
  ];
  LANGS.forEach((l) => SKILLS.push({ ...l, lang: true }));

  // Herramientas que agrega el usuario (o que propone la IA) se guardan en profile.customSkills
  // como {id, label, terms}. Se detectan igual que las del catálogo, también en avisos viejos.
  function termRe(t) {
    const n = norm(t).trim().replace(/\s+/g, " ");
    if (n.length < 2) return null;
    const e = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z0-9])" + e + "(?=[^a-z0-9]|$)");
  }
  function allSkills(profile) {
    const custom = ((profile && profile.customSkills) || []).map((c) => ({
      id: c.id, label: c.label, custom: true,
      re: (c.terms && c.terms.length ? c.terms : [c.label]).map(termRe).filter(Boolean),
    }));
    return SKILLS.concat(custom);
  }
  function findSkill(name, profile) {
    const n = norm(name);
    return allSkills(profile).find((sk) => (sk.re || []).some((r) => r.test(n))) || null;
  }

  const LEVEL_NAMES = ["no lo manejo", "básico", "intermedio", "avanzado"];

  // ---------- Utilidades de texto ----------
  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’‘´`]/g, "'");
  }

  function cleanRaw(text) {
    return text
      .replace(/\\([^\w\s])/g, "$1") // escapes de markdown: \+5, R\&D
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links de markdown
      .replace(/[’‘´`]/g, "'")
      .replace(/\r/g, "");
  }

  // Encabezados que vienen pegados al texto anterior ("deadlinesNice-to-have:")
  const GLUED_HEADERS = /(?<=[a-záéíóúñ.):])(?=(?:Nice-to-have|Nice to have|Must-haves|Must haves|Requirements:|Requisitos:|Responsibilities|Benefits|Beneficios|Who You Are|What We're Looking For|What You'll Do|Why Join|Our Hiring Process|Our Values)\b)/g;

  function splitSegments(raw) {
    const t = cleanRaw(raw)
      .replace(GLUED_HEADERS, "\n")
      .replace(/(?<=[:.])-(?=[A-ZÁÉÍÓÚÑa-z])/g, "\n") // bullets con guion pegados
      .replace(/(?<=[a-záéíóú]:)(?=[A-ZÁÉÍÓÚ¿])/g, "\n"); // "Requisitos:Experiencia"
    return t
      .split(/\n+|•|·|(?<=[.;!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/)
      .map((s) => s.replace(/^[\s*\-–—#>]+/, "").trim())
      .filter((s) => s.length > 0);
  }

  const HEADER = {
    req: /^(requisitos|requerimientos|lo que buscamos|que buscamos|que perfil buscamos|what we'?re looking for|what we are looking for|requirements|required|qualifications|must[- ]haves?|to qualify|what you'?ll need|para este rol necesitamos|skills (and|necessary)|tool proficiency|conocimientos(?=\s*:?\s*$| tecnicos| requeridos| necesarios| y habilidades)|who you are|your qualifications|education & experience|education and experience)/,
    nice: /^(deseable|nice[- ]to[- ]haves?|preferred|ideally|se valora|se valorara|valoramos|ademas,? valoramos|what we'?d like to see|plus\b|bonus)/,
    resp: /^(responsabilidades|principales responsabilidades|tus principales|tus responsabilidades|principales tareas|entre sus principales tareas|tareas|funciones|key responsibilities|responsibilities|your key responsibilities|job responsibilities|what you'?ll do|main tasks|tus desafios|estos son los desafios|cual sera tu|que desafios|imaginate|role overview|the role|about the role|your assignment|the mission|mision del puesto|sobre el puesto|descripcion del puesto|tasks and responsibilities)/,
    other: /^(beneficios|que ofrecemos|ofrecemos|te proponemos|benefits|what we offer|why join|why work|por que trabajar|about (us|[a-z]+$)|acerca de|sobre nosotros|our company|our values|nuestra empresa|detalles|hiring process|our hiring process|quick note|sumarte a|equal opportunity|job scam|ai and biometric)/,
  };

  function headerType(segN) {
    const s = segN.replace(/^[^a-z]+/, "").trim();
    if (s.length > 70) return null;
    for (const k of ["nice", "req", "resp", "other"]) if (HEADER[k].test(s)) return k;
    return null;
  }

  const NICE_MARK = /no excluyente|deseable|se valora|valorad|valoramos|\bplus\b|nice[- ]to[- ]have|preferred|preferably|preferentemente|ideally|bonus|se considerara|would be great|desirable/;
  const REQ_MARK = /excluyente|\bmust\b|required|requerid|indispensable|obligatori|imprescindible|is required/;

  function lineClass(segN, section) {
    if (NICE_MARK.test(segN)) return "nice";
    if (REQ_MARK.test(segN)) return "req";
    if (section === "req") return "req";
    if (section === "nice") return "nice";
    if (section === "other") return "other";
    return "mention"; // descripción o responsabilidades
  }

  // ¿El aviso dice qué nivel pide? Si no lo dice, se asume intermedio, pero se marca como "no especifica".
  function levelExplicit(segN) {
    return /avanzad|advanced|\bstrong\b|\bsolid\b|solid[oa]s?\b|expert|dominio|\bdeep\b|fluid|profund|proficien|basic|basico|familiar|exposure|nocion|intermedi|intermediate|\bmedio\b/.test(segN);
  }

  // ---------- Cómo postularse: mail, asunto, idioma del CV, otras instrucciones ----------
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  function applicationInfo(rawText, segs, fullN, englishPosting) {
    const clean = cleanRaw(rawText);
    const emails = [...new Set((clean.match(EMAIL_RE) || []).map((e) => e.replace(/[.,;:)]+$/, "").toLowerCase()))]
      .filter((e) => !/^no-?reply@|@example\./.test(e));
    let subject = "";
    for (const seg of segs) {
      const n = norm(seg);
      if (!/\basunto\b|subject line|\bsubject\b|\breferencia\b|\bref\.?:/.test(n)) continue;
      const q = seg.match(/["“'«]([^"”'»]{3,80})["”'»]/);
      const c = seg.match(/(?:asunto|subject(?: line)?|referencia|ref\.?)\s*(?:del mail|del correo|:|-)?\s*:?\s*([^.;\n]{3,80})/i);
      subject = q ? q[1].trim() : c ? c[1].trim() : seg.slice(0, 120);
      break;
    }
    const CV = "(cv|c\\.v\\.|curriculum(?: vitae)?|resume|resumé|hoja de vida)";
    const EN = "(ingles|english)", ES = "(espanol|castellano|spanish)";
    const near = (lang) => new RegExp(CV + "[^.;\\n]{0,40}\\b(en|in)\\s+(idioma\\s+)?" + lang + "|" + lang + "\\s+(cv|resume|version|curriculum)|" + CV + "\\s+" + lang);
    let cvLanguage = "", cvEvidence = "", cvExplicit = false;
    for (const seg of segs) {
      const n = norm(seg);
      const en = near(EN).test(n), es = near(ES).test(n);
      if (en || es) {
        cvLanguage = en && es ? "inglés y español" : en ? "inglés" : "español";
        cvEvidence = seg.length > 140 ? seg.slice(0, 137) + "…" : seg;
        cvExplicit = true;
        break;
      }
    }
    if (!cvLanguage && englishPosting) cvLanguage = "inglés (sugerido: el aviso está en inglés)";
    const instructions = [];
    if (/pretension(es)? salarial|remuneracion pretendida|salary expectation|expected salary|pretension economica/.test(fullN)) instructions.push("Piden pretensión salarial");
    if (/\bportfolio\b|\bportafolio\b/.test(fullN) && /(envi|adjunt|send|share|compart|link)/.test(fullN)) instructions.push("Mencionan portfolio: sumá el link");
    if (/carta de presentacion|cover letter|motivation letter|carta de motivacion/.test(fullN)) instructions.push("Piden carta de presentación");
    if (/(referencias laborales|professional references)/.test(fullN)) instructions.push("Piden referencias");
    return { emails, subject, cvLanguage, cvExplicit, cvEvidence, instructions };
  }

  function neededLevel(segN) {
    if (/avanzad|advanced|\bstrong\b|\bsolid\b|solid[oa]s?\b|expert|dominio|\bdeep\b|fluid|profund|proficien/.test(segN)) return 3;
    if (/basic|basico|familiar|exposure|nocion/.test(segN)) return 1;
    return 2;
  }

  // ---------- Detectores ----------
  function findYears(segN) {
    if (!/experien/.test(segN)) return null;
    let m;
    if ((m = segN.match(/(\d{1,2})\s*(?:a|-|–|y|to|and)\s*(\d{1,2})\s*(?:anos|years)/))) return +m[1];
    if ((m = segN.match(/(?:\+|mas de|more than|minimo(?: de)?|al menos|at least|minimum(?: of)?|over)\s*(\d{1,2})\s*\+?\s*(?:anos|years)/))) return +m[1];
    if ((m = segN.match(/(\d{1,2})\s*\+?\s*(?:anos|years)/))) return +m[1];
    return null;
  }

  const SENIOR_RE = /\b(senior|sr|lead|manager|gerente|jefe|head|principal|director|coordinator|coordinador)\b/;
  const SEMI_RE = /\b(ssr|semi ?senior|semisenior|semi-senior)\b/;
  const JUNIOR_RE = /\b(junior|jr|trainee|pasante|pasantia|intern|internship|entry[- ]level|sin experiencia)\b/;
  const LEAD_TEAMS_RE = /lider\w*\s+(y gestionando\s+)?(el |este |un |los )?equipos?|gestion de equipos|people management|manag\w* (a )?teams?|lead(ing)? (a )?teams?|referente funcional/;

  const AMBA_RE = /\b(caba|capital federal|gba|amba|buenos aires|zona norte|zona sur|zona oeste|nordelta|villa urquiza|villa ortuzar|palermo|microcentro|puerto madero|vicente lopez|olivos|san isidro|tigre|pilar|belgrano)\b/;
  const OTHER_CITY_RE = /\b(rafaela|sunchales|cordoba|rosario|mendoza|tucuman|neuquen|montevideo|santiago de chile|bogota|lima|ciudad de mexico|madrid|barcelona|sao paulo)\b/;

  function wordCounts(textN) {
    const words = textN.split(/\s+/);
    const en = words.filter((w) => /^(the|and|with|you|our|will|for|of|to|we|your|are|in)$/.test(w)).length;
    const es = words.filter((w) => /^(el|la|los|las|y|con|de|para|en|que|tu|nuestro|del)$/.test(w)).length;
    return { en, es };
  }
  function isMostlyEnglish(textN) {
    const { en, es } = wordCounts(textN);
    return en > es * 1.5 && en > 15;
  }
  // Idioma en que está escrito el aviso ("en", "es" o null si no está claro).
  function postingLanguage(textN) {
    const { en, es } = wordCounts(textN);
    if (en > es * 1.5 && en > 15) return "en";
    if (es > en * 1.5 && es > 15) return "es";
    return null;
  }

  // Nivel de idioma que piden, mirando cerca de donde se nombra el idioma
  // (en "SQL avanzado e inglés intermedio", el "avanzado" es de SQL).
  const LANG_HIGH = /avanzad|advanced|fluent|fluid|fluency|profesional|professional|\bc1\b|\bc2\b|\bb2\b|excellent|excelente|strong|nativ|bilingu|full professional/;
  const LANG_LOW = /basic|basico|elemental|\ba1\b|\ba2\b|nocion/;
  const LANG_MID = /intermedi|intermediate|\bb1\b|conversacional|conversational|medio\b/;
  function langNeed(sk, segN) {
    const r = (sk.re || []).find((x) => x.test(segN));
    const at = r ? segN.search(r) : 0;
    const after = segN.slice(at, at + 45), before = segN.slice(Math.max(0, at - 30), at);
    for (const w of [after, before]) {
      if (LANG_HIGH.test(w)) return { need: 3, explicit: true };
      if (LANG_LOW.test(w)) return { need: 1, explicit: true };
      if (LANG_MID.test(w)) return { need: 2, explicit: true };
    }
    return { need: 2, explicit: false };
  }
  const langById = (id) => LANGS.find((l) => l.id === id) || null;
  const isNative = (profile, id) => { const l = langById(id); return !!(l && profile && profile.nativeLanguage === l.code); };
  // Nivel del usuario en una herramienta o idioma; la lengua nativa cuenta como avanzado.
  function skillLevel(profile, id) {
    if (isNative(profile, id)) return 3;
    const v = ((profile && profile.skills) || {})[id];
    return v !== undefined && v !== null && v !== "" ? Number(v) : null;
  }

  // ---------- Evaluación principal ----------
  // Un dato del perfil en null/undefined significa "todavía no lo sé": en vez de suponer,
  // el motor devuelve una pregunta para hacerle al usuario.
  const known = (v) => v !== undefined && v !== null && v !== "";
  const skillLabel = (id, profile) => (allSkills(profile).find((s) => s.id === id) || { label: id }).label;
  function stem(k) {
    const n = norm(k).trim();
    return n.length > 5 ? n.replace(/(ia|o|a|os|as|es)$/, "") : n;
  }
  function skillHits(sk, seg, segN) {
    return (sk.re || []).some((r) => r.test(segN)) || (sk.reRaw || []).some((r) => r.test(seg));
  }

  function evaluate(rawText, profile, meta) {
    profile = profile || {};
    meta = meta || {};
    const segs = splitSegments(rawText);
    const fullN = norm(cleanRaw(rawText));
    const level = (id) => skillLevel(profile, id);
    const CAT = allSkills(profile);
    const labelOf = (id) => (CAT.find((s) => s.id === id) || { label: id }).label;

    let section = "desc";
    let sawReqSection = false;
    const reqs = {};
    const bi = { tools: new Set(), cls: null, need: 0, line: "" };
    const years = [];
    const flags = []; // {level: 'red'|'yellow'|'info'|'good', text, strong?}
    const reviewLines = [];
    const questions = [];
    let leadTeams = false;
    const rank = { req: 3, mention: 2, nice: 1, other: 0 };
    const clip = (s) => (s.length > 140 ? s.slice(0, 137) + "…" : s);

    segs.forEach((seg) => {
      const segN = norm(seg);
      const h = headerType(segN);
      if (h) {
        section = h;
        if (h === "req") sawReqSection = true;
        return;
      }
      const cls = lineClass(segN, section);
      if (cls === "other") return;
      if (cls === "req") sawReqSection = true;

      let anySkill = false;
      for (const sk of CAT) {
        if (!skillHits(sk, seg, segN)) continue;
        anySkill = true;
        const ln = sk.lang ? langNeed(sk, segN) : null;
        const raw = ln ? ln.need : neededLevel(segN);
        const need = cls === "req" ? raw : Math.min(raw, 2);
        const explicit = ln ? ln.explicit : levelExplicit(segN);
        if (sk.family === "bi") {
          bi.tools.add(sk.id);
          bi.explicit = bi.explicit || explicit;
          if (bi.cls === null || rank[cls] > rank[bi.cls]) { bi.cls = cls; bi.line = seg; }
          if (cls === "req") bi.need = Math.max(bi.need, need);
          else if (!bi.need) bi.need = need;
          continue;
        }
        const cur = reqs[sk.id];
        if (!cur) reqs[sk.id] = { id: sk.id, label: sk.label, cls, need, line: seg, explicit };
        else if (rank[cls] > rank[cur.cls]) { cur.cls = cls; cur.line = seg; cur.need = need; cur.explicit = explicit; }
        else if (cls === cur.cls) { cur.need = Math.max(cur.need, need); cur.explicit = cur.explicit || explicit; }
      }

      const y = findYears(segN);
      const firmYears = /minimo|al menos|at least|minimum|mas de|more than|\d\s*\+|\+\s*\d/.test(segN);
      if (y !== null && y <= 15) years.push({ min: y, nice: cls === "nice" && !firmYears, text: seg });

      if ((cls === "req" || cls === "mention") && LEAD_TEAMS_RE.test(segN)) leadTeams = true;

      // Requisitos que no son herramientas: experiencia en un rubro, especializaciones, etc.
      if (cls === "req" && y === null && !anySkill && reviewLines.length < 4) {
        const excl = /excluyente/.test(segN) && !/no excluyente/.test(segN);
        const exp = /experiencia (comprobable |previa |solida )?(en|con|trabajando|desarrollando|interactuando|analizando)|experience (in|with|analyzing|building|working|supporting)|background (in|with)|expertise (in|with)|track record|conocimiento de (gestion|comercio|procesos|metodologias)|conocimientos? en /.test(segN);
        if (excl || exp) reviewLines.push(clip(seg));
      }
    });

    // ---- Idiomas ----
    // El idioma en que está escrito el aviso cuenta como pedido (al menos intermedio), salvo que sea tu lengua nativa.
    const postLang = langById("lang_" + postingLanguage(fullN));
    if (postLang && !isNative(profile, postLang.id)) {
      const cur = reqs[postLang.id];
      const line = `El aviso está en ${postLang.label.toLowerCase()}: el proceso probablemente también.`;
      if (!cur) reqs[postLang.id] = { id: postLang.id, label: postLang.label, cls: "mention", need: 2, line, explicit: false, implicit: true };
      else if (cur.need < 2) cur.need = 2;
    }
    // Tu lengua nativa solo se muestra si el aviso la pide como excluyente (ahí suma como algo que tenés).
    Object.keys(reqs).forEach((id) => { if (isNative(profile, id) && reqs[id].cls !== "req") delete reqs[id]; });

    // ---- Herramientas ----
    const items = [];
    const ask = (id, label, cls) => {
      if (!questions.some((q) => q.type === "skill" && q.id === id)) questions.push({ type: "skill", id, label, cls });
    };
    Object.values(reqs).forEach((r) => {
      const sk = CAT.find((s) => s.id === r.id);
      const own = level(r.id);
      let status, note = "";
      if (own === null) {
        status = "unknown";
        ask(r.id, r.label, r.cls);
      } else if (own >= r.need) status = "ok";
      else {
        let eff = own, from = null;
        (sk.transfer || []).forEach((t) => {
          const l = level(t);
          if (l !== null && l - 1 > eff) { eff = l - 1; from = t; }
        });
        if (eff >= r.need || own === r.need - 1 || eff === r.need - 1) {
          status = "partial";
          if (from) note = "se transfiere desde " + labelOf(from);
        } else status = "missing";
      }
      if (sk.lang) {
        if (isNative(profile, r.id)) note = "lengua nativa";
        else if (status === "ok" && (profile.langCerts || {})[r.id] === false) note = "sin certificado";
      }
      items.push({ ...r, own, status, note, needName: LEVEL_NAMES[r.need], lang: !!sk.lang });
    });
    if (bi.tools.size) {
      const mentioned = [...bi.tools];
      const need = bi.need || 2;
      const knownLv = mentioned.map(level).filter((l) => l !== null);
      const own = knownLv.length ? Math.max(...knownLv) : null;
      const others = SKILLS.filter((s) => s.family === "bi" && level(s.id) !== null);
      const best = others.reduce((b, s) => (!b || level(s.id) > level(b.id) ? s : b), null);
      mentioned.filter((id) => level(id) === null).forEach((id) => ask(id, labelOf(id), bi.cls));
      let status, note = "";
      if (own !== null && own >= need) status = "ok";
      else if (best && level(best.id) >= need) { status = "partial"; note = "se transfiere desde " + best.label; }
      else if (mentioned.some((id) => level(id) === null)) status = "unknown";
      else if (own === need - 1) status = "partial";
      else status = "missing";
      items.push({ id: "bi", tools: mentioned, label: "Tableros: " + mentioned.map(labelOf).join(" / "), cls: bi.cls, need, own, status, note, line: bi.line, needName: LEVEL_NAMES[need], explicit: !!bi.explicit });
    }

    const active = items.filter((i) => i.cls !== "other");
    const gap = (i) => i.status === "missing" || i.status === "partial";
    const have = active.filter((i) => i.status === "ok");
    const strengths = have.filter((i) => ["research", "hr", "stats"].includes(i.id));
    const missReq = active.filter((i) => i.cls === "req" && i.status === "missing");
    const partialReq = active.filter((i) => i.cls === "req" && i.status === "partial");
    const unknownReq = active.filter((i) => i.cls === "req" && i.status === "unknown");
    const missNice = active.filter((i) => i.cls === "nice" && gap(i));
    const missMention = active.filter((i) => i.cls === "mention" && gap(i));

    // ---- Seniority ----
    // El título guardado del aviso cuenta: muchas veces la selección empieza en la descripción.
    const head = (norm(meta.title || "") + " " + norm(segs.slice(0, 2).join(" ")).slice(0, 220)).trim();
    const bodySenior = /analista (sr\.?|senior)\b|\b(senior|sr\.?) (analyst|data analyst)|senior associate/.test(fullN);
    let seniority = "sin dato";
    const titleN = norm(meta.title || "");
    if (titleN) {
      // Con título, el nivel sale del título: en el texto, palabras como "principal" o "lead" suelen ser otra cosa.
      if (SEMI_RE.test(titleN)) seniority = "semi senior";
      else if (JUNIOR_RE.test(titleN)) seniority = "junior";
      else if (SENIOR_RE.test(titleN)) seniority = "senior";
    } else {
      if (SEMI_RE.test(head)) seniority = "semi senior";
      else if (SENIOR_RE.test(head)) seniority = "senior";
      else if (JUNIOR_RE.test(head)) seniority = "junior";
    }
    if (seniority === "sin dato") {
      if (bodySenior) seniority = "senior";
      else if (/entry[- ]level|sin experiencia/.test(fullN)) seniority = "junior";
    }
    if (seniority === "senior") flags.push({ level: "red", text: "El título indica un puesto senior o de liderazgo." });
    if (seniority === "semi senior") flags.push({ level: "yellow", text: "Es semi senior: suelen esperar 2 a 4 años de experiencia." });
    if (seniority === "junior") flags.push({ level: "good", text: "Es un puesto junior o de entrada." });
    if (leadTeams) flags.push({ level: "red", text: "Pide liderar o gestionar equipos." });

    // ---- Años ----
    const mandatoryYears = years.filter((y) => !y.nice);
    const yearsReq = mandatoryYears.length ? Math.max(...mandatoryYears.map((y) => y.min)) : null;
    const yearsNice = !mandatoryYears.length && years.length ? Math.max(...years.map((y) => y.min)) : null;
    const myYears = known(profile.yearsExperience) ? Number(profile.yearsExperience) : null;
    let yearsGap = 0;
    if (yearsReq !== null) {
      if (myYears === null) {
        questions.push({ type: "years" });
        flags.push({ level: "info", text: `Piden ${yearsReq} año(s) de experiencia.` });
      } else {
        yearsGap = yearsReq - myYears;
        if (yearsGap <= 0) flags.push({ level: "good", text: `Piden ${yearsReq} año(s) de experiencia y vos tenés ${myYears}.` });
        else if (yearsGap <= 2) flags.push({ level: "yellow", text: `Piden ${yearsReq} año(s) de experiencia y tenés ${myYears}. Si cumplís lo demás, postulate igual: muchos lo flexibilizan.` });
        else flags.push({ level: "red", text: `Piden ${yearsReq} año(s) de experiencia: está lejos de tus ${myYears}.` });
      }
    } else if (yearsNice !== null) {
      flags.push({ level: "good", text: `Mencionan ${yearsNice} año(s) de experiencia, pero como deseable.` });
      if (myYears === null) questions.push({ type: "years" });
    }

    // ---- Carrera ----
    const eduSegs = segs.map(norm).filter((s) => /estudiante|graduad|egresad|licenciatura|carreras?\b|bachelor|degree|universitari|profesional (en|de las)|grado universitario|nivel minimo de educacion/.test(s));
    if (eduSegs.length) {
      const eduText = eduSegs.join(" ");
      const kws = (profile.careerKeywords || []).filter(Boolean);
      const rel = (profile.relatedKeywords || []).filter(Boolean);
      const gradOnly = /graduad|egresad|profesional (en|de las)|ser profesional|bachelor'?s degree is required|degree required|\(graduado\)|bachelor'?s degree required/.test(eduText) && !/estudiante|student|en curso|proximos? a graduarse|avanzad|or equivalent|equivalent (work|professional) experience/.test(eduText);
      if (!kws.length || (gradOnly && !known(profile.careerStatus))) questions.push({ type: "career" });
      if (kws.length) {
        const mine = kws.some((k) => eduText.includes(stem(k)));
        const relHit = rel.find((k) => eduText.includes(stem(k)));
        const open = /afines|related|similar|equivalent|equivalente|cualquier carrera|no excluyente|or a related/.test(eduText);
        if (mine) flags.push({ level: "good", text: "Menciona tu carrera." });
        else if (relHit && open) flags.push({ level: "good", text: `No nombra tu carrera, pero acepta afines y menciona ${relHit}, que tenés.` });
        else if (open) flags.push({ level: "yellow", text: "No nombra tu carrera pero dice \"afines\": justificalo con tus otros estudios y proyectos." });
        else if (relHit) flags.push({ level: "yellow", text: `Menciona ${relHit}, que tenés, aunque la lista de carreras no incluye la tuya.` });
        else flags.push({ level: "yellow", strong: true, text: "Lista cerrada de carreras que no incluye la tuya." });
      }
      if (gradOnly && known(profile.careerStatus) && profile.careerStatus !== "graduado") {
        flags.push({ level: "yellow", text: "Parece pedir título. " + (profile.graduationNote || "Si te recibís pronto, aclaralo en el CV y postulate igual.") });
      }
    }

    // ---- Idioma del aviso ----
    // No es excluyente, pero si está por encima de tu nivel suma una alerta (como antes con el inglés).
    const implicitLang = items.find((i) => i.implicit);
    if (implicitLang) {
      if (implicitLang.status === "unknown") flags.push({ level: "info", text: implicitLang.line });
      else if (implicitLang.status === "ok") flags.push({ level: "good", text: implicitLang.line + (implicitLang.note === "sin certificado" ? " Lo tenés, aunque sin certificado: si lo evalúan en la entrevista, bien." : " Lo tenés.") });
      else flags.push({ level: "yellow", text: implicitLang.line + " Está por encima de tu nivel." });
    }
    const englishPosting = isMostlyEnglish(fullN);

    // ---- Lugar y modalidad ----
    const remote = /\bremot|\bremote\b|work from anywhere|100% remoto|full remote/.test(fullN) && !/semanas full remote/.test(fullN);
    const onsite = /\bpresencial\b|on-?site|in the office/.test(fullN);
    const hybrid = /hibrid|hybrid|home office|teletrabajo/.test(fullN);
    const amba = AMBA_RE.test(fullN);
    const otherCity = OTHER_CITY_RE.test(fullN);
    const residency = fullN.match(/residencia en ([^.;\n]{3,60})/);
    const cityN = norm(profile.city || "").trim();
    const cityKnown = cityN.length > 1;
    const inMyCity = cityKnown && fullN.includes(cityN);
    const myCityAmba = cityKnown && AMBA_RE.test(cityN);
    const modality = remote && !onsite ? "remoto" : hybrid ? "híbrido" : onsite ? "presencial" : "sin dato";

    if (!remote && (amba || otherCity || onsite || hybrid || residency) && !cityKnown) questions.push({ type: "city" });
    if (inMyCity) flags.push({ level: "good", text: `Menciona tu ciudad (${profile.city}).` });
    if (residency && !AMBA_RE.test(residency[1]) && !(cityKnown && residency[1].includes(cityN))) {
      flags.push({ level: cityKnown ? "red" : "info", text: "Pide residencia en: " + residency[1].trim() + "." });
    } else if (!remote && amba && !inMyCity) {
      const how = onsite ? "Presencial" : hybrid ? "Híbrido" : "Parece ser";
      if (!cityKnown) flags.push({ level: "info", text: how + " en AMBA (no dice remoto)." });
      else if (myCityAmba) flags.push({ level: "good", text: how + " en AMBA, cerca tuyo." });
      else if (!known(profile.openToBuenosAires)) {
        questions.push({ type: "moveBA" });
        flags.push({ level: "info", text: how + " en AMBA (no dice remoto): implicaría mudarte a Buenos Aires." });
      } else {
        flags.push({ level: profile.openToBuenosAires ? "yellow" : "red", strong: true, text: how + " en AMBA (no dice remoto): implicaría mudarte a Buenos Aires." });
      }
    } else if (!remote && otherCity && !inMyCity && (onsite || hybrid) && cityKnown) {
      flags.push({ level: "red", text: (onsite ? "Presencial" : "Híbrido") + " en otra ciudad." });
    } else if (remote && !onsite) {
      flags.push({ level: "good", text: "Es remoto." });
    }
    const tz = fullN.match(/hora de espana|horario de espana|\bcet\b|\bcst\b|\bpst\b|\best\b time|time ?zones?|zona horaria/);
    if (tz) flags.push({ level: "yellow", text: "Revisá el horario: menciona otra zona horaria (" + tz[0] + ")." });
    if (/visa sponsor|legal authorization|authorized to work|work permit|sponsor (a )?visa/.test(fullN)) flags.push({ level: "yellow", text: "Menciona visas o permiso de trabajo: revisá si contratan desde tu país." });
    if (/secundario completo/.test(fullN)) flags.push({ level: "yellow", strong: true, text: "Pide solo secundario completo: puede ser más operativo de lo que dice el título." });

    // ---- Veredicto ----
    const redFlags = flags.filter((f) => f.level === "red").length;
    const yellowFlags = flags.filter((f) => f.level === "yellow").length;
    const domainReview = reviewLines.some((l) => /expertise|especializacion|especialización|excluyente|comprobable|demonstrated|proven/i.test(l));
    let verdict;
    if (redFlags > 0 || yearsGap >= 3 || missReq.length >= 3) verdict = "red";
    else if (missReq.length >= 1 || partialReq.length >= 2 || yearsGap >= 1 || yellowFlags >= 2 || seniority === "semi senior" || flags.some((f) => f.strong) || reviewLines.length >= 2 || domainReview) verdict = "yellow";
    else verdict = "green";
    const verdictText = { green: "Postulate", yellow: "Alcanzable: revisá lo que falta", red: "Lejos por ahora" }[verdict];
    const provisional = unknownReq.length > 0 || questions.some((q) => q.type !== "skill");

    // Preguntas: primero lo excluyente, después lo demás.
    const qRank = (q) => (q.type === "skill" ? rank[q.cls] || 0 : 4);
    questions.sort((a, b) => qRank(b) - qRank(a));

    const warnings = [];
    if (!sawReqSection) warnings.push("No encontré una sección de requisitos. ¿Seleccionaste el aviso completo (con \"ver más\" desplegado)?");
    if (rawText.length < 400) warnings.push("El texto es muy corto para evaluar bien.");

    return {
      verdict, verdictText, provisional, seniority, modality,
      yearsReq, yearsNice, yearsGap,
      items: active, have, strengths, missReq, partialReq, unknownReq, missNice, missMention,
      application: applicationInfo(rawText, segs, fullN, englishPosting),
      flags, reviewLines, warnings, questions,
      distance: missReq.length + partialReq.length * 0.5 + Math.max(0, yearsGap) + redFlags * 2,
    };
  }

  // ---------- Familias de puesto ----------
  // Agrupan títulos distintos ("Analista de Datos Jr", "Data Analyst Trainee") para comparar en qué puestos te va mejor.
  // Se prueban en orden: las más específicas primero (People Analytics va a RRHH antes que a Data Analyst).
  const FAMILIES = [
    { id: "datascience", label: "Data Science", re: /data scien|cientific[oa] de datos|machine learning|\bml engineer|\bai engineer/ },
    { id: "dataeng", label: "Data Engineering", re: /data engineer|ingenier[oa] de datos|analytics engineer|\betl\b/ },
    { id: "bi", label: "BI / Reporting", re: /business intelligence|\bbi\b|power ?bi|tableau|reporting|\breportes?\b|dashboards?|tableros/ },
    { id: "ux", label: "UX Research", re: /\bux\b|user research|investigacion de usuarios|usabilidad|experiencia de usuario/ },
    { id: "market", label: "Investigación de mercado", re: /market research|investigacion de mercado|estudios de mercado|\binsights?\b|consumer/ },
    { id: "people", label: "RRHH / People Analytics", re: /people|recursos humanos|\brrhh\b|\bhr\b|talent|recruit|reclutamiento|seleccion de personal/ },
    { id: "data", label: "Data Analyst", re: /analista de datos|data analyst|product analyst|analytics|analitica|analista de informacion|analista cuantitativ|\bdata\b(?! entry)/ },
    { id: "research", label: "Investigación social / evaluación", re: /investigador|investigacion|research|monitoreo|evaluacion de (programas|proyectos|impacto|politicas)|\bm&e\b|encuestas|estadistic/ },
    { id: "business", label: "Analista de negocio / funcional", re: /business analyst|analista (de negocios?|funcional|de procesos)|functional analyst|process analyst/ },
    { id: "product", label: "Producto", re: /product (manager|owner)|\bproducto\b/ },
    { id: "marketing", label: "Marketing / Growth", re: /marketing|growth|\bseo\b|\bsem\b|performance|paid media|e-?commerce|comunicacion|redes sociales|community/ },
    { id: "finance", label: "Finanzas / Control de gestión", re: /financ|control de gestion|controller|fp&a|contab|accounting|riesgo|credit/ },
    { id: "ops", label: "Operaciones / Supply chain", re: /operacion|operations|supply|logistic|planeamiento|planning|demand|abastecimiento|compras|procurement/ },
  ];
  const OTHER_FAMILY = "Otro";
  function familyFromTitle(title) {
    const n = norm(title);
    if (!n.trim()) return null;
    const f = FAMILIES.find((x) => x.re.test(n));
    return f ? f.label : null;
  }
  // Lo que devuelve la IA puede venir con otras palabras ("Data Analytics"): se busca el nombre exacto y, si no, por título.
  function familyByName(name) {
    const n = norm(name).trim();
    if (!n) return null;
    if (n === norm(OTHER_FAMILY)) return OTHER_FAMILY;
    const f = FAMILIES.find((x) => norm(x.label) === n);
    return f ? f.label : familyFromTitle(name);
  }

  const api = { evaluate, SKILLS, LANGS, LEVEL_NAMES, splitSegments, norm, known, skillLabel, skillLevel, isNative, allSkills, findSkill, FAMILIES, OTHER_FAMILY, familyFromTitle, familyByName };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Evaluador = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
