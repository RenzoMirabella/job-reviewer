// Análisis con IA y búsqueda de empresas, usando la clave de API de cada usuario (Gemini, Claude o DeepSeek).
// La clave queda guardada en el navegador y la llamada va directo al proveedor.
(function (root) {
  const DEFAULT_MODELS = { gemini: "gemini-3.5-flash-lite", anthropic: "claude-haiku-5-5", deepseek: "deepseek-chat" };
  // Modelo para buscar empresas. En Gemini, la búsqueda en Google solo está disponible en el plan pago
  // (5.000 búsquedas gratis por mes); en el plan gratuito se usa lo que el modelo ya sabe.
  const DEFAULT_SEARCH_MODELS = { gemini: "gemini-3.5-flash-lite", anthropic: "claude-haiku-5-5" };
  const LV = ["no lo maneja", "básico", "intermedio", "avanzado"];
  const k = (v) => v !== undefined && v !== null && v !== "";

  function buildPrompt(text, profile, meta) {
    const skills = Object.entries(profile.skills || {})
      .filter(([, v]) => k(v))
      .map(([id, v]) => `${(root.Evaluador && root.Evaluador.skillLabel(id, profile)) || id}: ${LV[v]}`)
      .join(", ");
    const sd = "sin dato";
    const E = root.Evaluador;
    const families = E ? E.FAMILIES.map((f) => f.label).concat(E.OTHER_FAMILY).join("|") : "";
    return `Sos un asesor de empleo honesto. Compará este aviso con el perfil del candidato y respondé SOLO con un JSON válido, en español rioplatense, con esta forma:
{"puesto":"título del puesto",${families ? `"familia":"${families}",` : ""}"empresa":"nombre de la empresa que contrata, o vacío","consultora":"si publica una consultora de selección para un cliente, su nombre; si no, vacío","descripcion":"2 o 3 oraciones simples: qué haría la persona en el día a día y en qué área","modalidad":"remoto|híbrido|presencial|sin dato","ubicacion":"ciudad o país del puesto, o vacío","veredicto":"verde|amarillo|rojo","resumen":"una oración","requisitos":[{"nombre":"Excel","clase":"herramienta|experiencia|otro","texto":"como aparece escrito en el aviso","tipo":"excluyente|deseable","nivel":"básico|intermedio|avanzado|no especifica"}],"tiene":["..."],"falta_excluyente":["..."],"falta_deseable":["..."],"alertas":["..."],"postulacion":{"cv_idioma":"inglés|español|inglés y español|no especifica","cv_idioma_cita":"frase exacta del aviso que lo indica, o vacío","email":"mail al que hay que mandar el CV, o vacío","asunto":"asunto que piden para el mail, o vacío","instrucciones":["otras indicaciones para postularse: pretensión salarial, portfolio, formulario, código de referencia, etc."]},"consejo":"una o dos oraciones sobre cómo postularse o qué preparar"}

Criterios: verde = cumple lo excluyente y conviene postularse ya; amarillo = le faltan una o dos cosas o algo de experiencia; rojo = puesto senior, muchos años de experiencia o varios excluyentes que no tiene. Distinguí siempre lo excluyente de lo deseable. ${families ? `En "familia" elegí una sola opción de la lista, según lo que la persona haría en el día a día aunque el título diga otra cosa; si ninguna encaja, "${E.OTHER_FAMILY}". ` : ""}En "requisitos" listá cada herramienta, conocimiento o experiencia de dominio que pida el aviso, con un nombre corto. "clase" es "herramienta" solo para software, lenguajes o plataformas concretas (ej. SPSS, Jira, BigQuery); "experiencia" para rubros o tareas (ej. paid media, logística); "otro" para lo demás. En "texto" copiá la palabra o frase exacta con la que el aviso nombra ese requisito (ej. "IBM SPSS"). Usá "no especifica" en "nivel" si el aviso no dice qué nivel pide. Detectá condiciones como presencialidad, residencia u horario. En "postulacion" poné solo lo que el aviso dice explícitamente: no inventes mails ni asuntos. Si el aviso está en inglés y no aclara el idioma del CV, poné "no especifica" y mencionalo en el consejo. Si un dato del perfil dice "${sd}", no supongas: mencionalo en "alertas" como algo a confirmar.
${meta && meta.title ? `\nTítulo de la pestaña donde estaba el aviso (puede traer puesto y empresa): ${meta.title}\n` : ""}
PERFIL:
- Experiencia laboral relacionada: ${k(profile.yearsExperience) ? profile.yearsExperience + " año(s)" : sd}
- Carrera: ${(profile.careerKeywords || []).join(", ") || sd} (${profile.careerStatus === "graduado" ? "graduado" : profile.careerStatus ? "estudiante avanzado" : sd}). ${profile.graduationNote || ""}
- Otros estudios: ${(profile.relatedKeywords || []).join(", ") || sd}
- Lengua nativa: ${(E && (E.LANGS.find((l) => l.code === profile.nativeLanguage) || {}).label) || sd}${Object.entries(profile.langCerts || {}).filter(([, v]) => v === true).map(([id]) => `; certificado de ${E ? E.skillLabel(id, profile).toLowerCase() : id}`).join("")}
- Ciudad:${profile.city || sd}${profile.openToBuenosAires === true ? ", abierto a mudarse a Buenos Aires" : profile.openToBuenosAires === false ? ", no se mudaría a Buenos Aires" : ""}; acepta remoto
- Herramientas e idiomas: ${skills || sd}
${profile.extraNotes ? "- Notas: " + profile.extraNotes : ""}

AVISO:
"""
${text.slice(0, 12000)}
"""`;
  }

  function companyPrompt(name, context) {
    return `Buscá en internet información actual sobre la empresa "${name}"${context ? ` (aparece en un aviso de empleo: ${context})` : ""}. Respondé SOLO con un JSON válido, en español rioplatense, con esta forma:
{"empresa":"nombre oficial","rubro":"a qué se dedica, en pocas palabras","que_hace":"2 o 3 oraciones: qué hace, productos o clientes principales","tamano":"cantidad aproximada de empleados o 'chica/mediana/grande', o 'sin dato'","sede":"ciudad y país de la casa central","presencia_argentina":"si opera en Argentina y dónde, o 'sin dato'","sitio_web":"URL oficial o vacío","es_consultora":"sí si es una consultora de selección o reclutamiento que publica avisos de terceros; si no, no","dato_util":"algo útil para preparar una entrevista (novedad reciente, cultura, producto), o vacío","confianza":"alta|media|baja"}
Si no encontrás la empresa o hay varias con el mismo nombre, decilo en "que_hace" y poné "confianza":"baja". No inventes datos.`;
  }

  function companyKnowledgePrompt(name, context) {
    return `Sin buscar en internet, contá lo que sabés de la empresa "${name}"${context ? ` (aparece en un aviso de empleo: ${context})` : ""}. Respondé SOLO con un JSON válido, en español rioplatense, con esta forma:
{"empresa":"nombre oficial","rubro":"a qué se dedica, en pocas palabras","que_hace":"2 o 3 oraciones: qué hace, productos o clientes principales","tamano":"cantidad aproximada de empleados o 'chica/mediana/grande', o 'sin dato'","sede":"ciudad y país de la casa central","presencia_argentina":"si opera en Argentina y dónde, o 'sin dato'","sitio_web":"URL oficial si la sabés con seguridad, o vacío","es_consultora":"sí si es una consultora de selección o reclutamiento que publica avisos de terceros; si no, no","dato_util":"algo útil para preparar una entrevista, o vacío","confianza":"alta|media|baja"}
Si no conocés la empresa con seguridad (por ejemplo, es chica, local o hay varias con ese nombre), no inventes: decilo en "que_hace", dejá el resto en "sin dato" y poné "confianza":"baja".`;
  }

  function extractJson(s) {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a < 0 || b < a) throw new Error("La IA no devolvió un JSON.");
    return JSON.parse(s.slice(a, b + 1));
  }

  function friendlyError(provider, status, data) {
    const msg = (data && data.error && (data.error.message || data.error.status)) || "Error " + status;
    if (status === 429) return provider === "gemini"
      ? "Llegaste al límite del plan gratuito de Gemini. Probá de nuevo en un rato."
      : "Llegaste al límite de uso de tu clave. Probá de nuevo en un rato.";
    if (status === 401 || status === 403) return "La clave de API no es válida para " + ({ gemini: "Gemini", anthropic: "Claude", deepseek: "DeepSeek" }[provider] || provider) + ". Revisala en Mi perfil.";
    if (status === 404) return "El modelo no existe o tu clave no tiene acceso a él: " + msg;
    return msg;
  }

  // ---------- Llamadas por proveedor ----------
  // Gemini: API generateContent (Google la marca como "legacy" pero sigue funcionando y está documentada).
  async function callGemini(apiKey, model, prompt, { json = true, search = false, maxTokens = 8192 } = {}) {
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
    };
    if (json && !search) body.generationConfig.responseMimeType = "application/json";
    if (search) body.tools = [{ google_search: {} }];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(friendlyError("gemini", res.status, data)); err.status = res.status; err.raw = (data.error && data.error.message) || ""; throw err; }
    const cand = (data.candidates || [])[0];
    if (!cand) throw new Error("Gemini no devolvió respuesta" + (data.promptFeedback && data.promptFeedback.blockReason ? " (" + data.promptFeedback.blockReason + ")" : "") + ".");
    const text = ((cand.content && cand.content.parts) || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
    const chunks = (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
    const sources = chunks.filter((c) => c.web && c.web.uri).map((c) => ({ title: c.web.title || c.web.uri, url: c.web.uri }));
    return { text, sources };
  }

  async function callClaude(apiKey, model, prompt, { search = false, maxTokens = 1800 } = {}) {
    const body = { model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] };
    if (search) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(friendlyError("anthropic", res.status, data));
    const blocks = data.content || [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("");
    const sources = [];
    blocks.filter((b) => b.type === "web_search_tool_result" && Array.isArray(b.content)).forEach((b) =>
      b.content.forEach((r) => r.url && sources.push({ title: r.title || r.url, url: r.url })));
    return { text, sources };
  }

  async function callDeepSeek(apiKey, model, prompt) {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + apiKey },
      body: JSON.stringify({ model, max_tokens: 1800, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(friendlyError("deepseek", res.status, data));
    return { text: data.choices[0].message.content, sources: [] };
  }

  function check(ai) {
    if (!ai || !ai.apiKey || !ai.provider || ai.provider === "none") throw new Error("Configurá un proveedor y tu clave de API en Mi perfil.");
  }

  // ---------- Análisis del aviso ----------
  async function analyze(text, profile, ai, meta) {
    check(ai);
    const model = ai.model || DEFAULT_MODELS[ai.provider];
    const prompt = buildPrompt(text, profile, meta);
    let out;
    if (ai.provider === "gemini") out = await callGemini(ai.apiKey, model, prompt);
    else if (ai.provider === "anthropic") out = await callClaude(ai.apiKey, model, prompt);
    else if (ai.provider === "deepseek") out = await callDeepSeek(ai.apiKey, model, prompt);
    else throw new Error("Proveedor desconocido.");
    return extractJson(out.text);
  }

  // ---------- Búsqueda de la empresa (una vez por empresa; el resultado se guarda) ----------
  function canSearch(ai) {
    return !!(ai && ai.apiKey && (ai.provider === "gemini" || ai.provider === "anthropic"));
  }
  // En Gemini: primero intenta buscar en Google; si el plan no lo permite (plan gratuito), describe la
  // empresa con lo que el modelo ya sabe y lo marca como "conocimiento". info.searchBlocked avisa que
  // conviene no reintentar la búsqueda por un tiempo.
  async function researchCompany(name, ai, context, opts) {
    check(ai);
    if (!canSearch(ai)) throw new Error("La búsqueda de empresas necesita Gemini o Claude (DeepSeek no busca en internet).");
    opts = opts || {};
    const model = ai.searchModel || DEFAULT_SEARCH_MODELS[ai.provider];
    let out, metodo = "búsqueda en internet", searchBlocked = false, motivo = "";
    if (ai.provider === "gemini") {
      const blocked = ai.searchBlockedUntil && new Date(ai.searchBlockedUntil) > new Date() && !opts.force;
      if (!blocked) {
        try { out = await callGemini(ai.apiKey, model, companyPrompt(name, context), { search: true, json: false }); }
        catch (e) {
          if (e.status === 401 || (e.status === 403 && /api key|permission/i.test(e.raw) && !/ground|search/i.test(e.raw))) throw e;
          searchBlocked = true;
          motivo = e.message;
        }
      }
      if (!out) {
        metodo = "conocimiento del modelo";
        out = await callGemini(ai.apiKey, ai.model || DEFAULT_MODELS.gemini, companyKnowledgePrompt(name, context), { json: true });
      }
    } else {
      out = await callClaude(ai.apiKey, model, companyPrompt(name, context), { search: true });
    }
    const info = extractJson(out.text);
    const seen = new Set();
    info.fuentes = out.sources.filter((s) => !seen.has(s.url) && seen.add(s.url)).slice(0, 5);
    info.modelo = metodo === "conocimiento del modelo" ? ai.model || DEFAULT_MODELS.gemini : model;
    info.metodo = metodo;
    if (searchBlocked) { info.searchBlocked = true; info.motivo_sin_busqueda = motivo; }
    return info;
  }

  root.EvaluadorIA = { analyze, researchCompany, canSearch, DEFAULT_MODELS, DEFAULT_SEARCH_MODELS, buildPrompt, companyPrompt, companyKnowledgePrompt };
})(globalThis);
