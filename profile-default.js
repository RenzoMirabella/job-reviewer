// Perfil vacío: la extensión arranca sin saber nada y va preguntando a medida que aparecen requisitos.
// null = todavía no lo sé. Niveles: 0 = no lo manejo, 1 = básico, 2 = intermedio, 3 = avanzado.
(function (root) {
  const EMPTY_PROFILE = {
    schema: 3,
    yearsExperience: null,
    careerStatus: null, // "estudiante_avanzado" | "graduado"
    careerKeywords: [], // ej. ["Economía"]
    relatedKeywords: [], // otros estudios, ej. ["Curso de Análisis de Datos"]
    graduationNote: "",
    nativeLanguage: "es", // código de LANGS en rules.js; los otros idiomas se guardan en skills (lang_en, lang_pt…)
    langCerts: {}, // {lang_en: true|false}: si tenés certificado de ese idioma
    city: "",
    openToBuenosAires: null,
    skills: {},
    customSkills: [], // herramientas agregadas por vos o propuestas por la IA: {id, label, terms}
    ignoredTerms: [], // propuestas de la IA que descartaste
    extraNotes: "",
  };
  const DEFAULT_SETTINGS = {
    ai: { provider: "none", apiKey: "", model: "", auto: true, companies: "auto", searchModel: "" },
    sheets: { url: "", token: "", auto: true, lastSync: "", lastError: "" },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = { EMPTY_PROFILE, DEFAULT_SETTINGS };
  else { root.EMPTY_PROFILE = EMPTY_PROFILE; root.DEFAULT_SETTINGS = DEFAULT_SETTINGS; }
})(typeof globalThis !== "undefined" ? globalThis : this);
