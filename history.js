const $ = (id) => document.getElementById(id);
const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const VNAME = { green: "Postulate", yellow: "Alcanzable", red: "Lejos" };
let data = null;
let batch = null; // { running, done, total, stop, msg }

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
const jobName = (j) => `<b>${esc(j.title || "Sin título")}</b>${j.company ? " · " + esc(j.company) : ""}`;
const link = (j) => (j.url ? ` <a href="${esc(j.url)}" target="_blank" rel="noopener">ver aviso</a>` : "");

function render() {
  const { jobs, profile, settings } = data;
  const sh = settings.sheets;
  $("syncInfo").innerHTML = !sh.url
    ? 'Google Sheets no está configurado. Podés conectarlo desde <a href="options.html#sheets">Mi perfil</a>.'
    : sh.lastError ? `<span class="status-err">Último intento de sincronizar falló: ${esc(sh.lastError)}</span>`
    : sh.lastSync ? `<span class="status-ok">Sincronizado con Google Sheets el ${new Date(sh.lastSync).toLocaleString("es-AR")}.</span>` : "Google Sheets conectado; todavía no se sincronizó.";
  $("syncBtn").disabled = !sh.url;

  if (!jobs.length) {
    $("content").innerHTML = `<div class="card" style="margin-top:12px">
      <p><b>Todavía no evaluaste ningún aviso.</b></p>
      <ol class="steps">
        <li>Abrí un aviso (LinkedIn, Bumeran, Computrabajo o cualquier sitio) y tocá "ver más" para desplegarlo entero.</li>
        <li>Seleccioná todo el texto, clic derecho y elegí <b>Evaluar este aviso</b>.</li>
        <li>Respondé las preguntas que aparecen: se guardan en tu perfil y no se repiten.</li>
        <li>Cada aviso queda guardado acá. Con varios, vas a ver qué reforzar, qué destacar en el CV y a cuáles conviene aplicar.</li>
      </ol>
      <p class="note">Opcional: conectá una hoja de Google Sheets desde <a href="options.html#sheets">Mi perfil</a> para tener todo en una planilla.</p>
    </div>`;
    return;
  }

  const a = Store.analyze(jobs, profile);
  // Completar con IA los avisos que todavía no tienen análisis (descripción, empresa, idioma del CV, mail…)
  const ai = settings.ai;
  const pending = jobs.filter((j) => !j.synthetic && !(j.ai && j.ai.result && j.ai.result.postulacion));
  const synthetic = jobs.filter((j) => j.synthetic).length;
  const aiReady = ai.apiKey && ai.provider !== "none";
  let batchHtml = "";
  if (batch && batch.running) {
    batchHtml = `<div class="card" style="margin-top:12px"><b>Completando con IA: ${batch.done} de ${batch.total}</b> <span class="note">${esc(batch.msg || "")}</span> <button id="stopBatch" class="small">Detener</button></div>`;
  } else if (pending.length && aiReady) {
    batchHtml = `<div class="card" style="margin-top:12px"><b>${pending.length} aviso(s) sin análisis de IA.</b> <span class="note">La IA agrega descripción, empresa corregida, modalidad, idioma del CV, mail para postular y requisitos que las reglas no ven${EvaluadorIA.canSearch(ai) && ai.companies !== "off" ? ", y busca cada empresa una sola vez (salvo los avisos lejanos)" : ""}. Va de a uno, con pausas, para no pasar el límite del plan gratuito.</span>
      <div class="row tight"><button id="runBatch" class="small primary">Completar con IA</button></div>${batch && batch.msg ? `<p class="note">${esc(batch.msg)}</p>` : ""}</div>`;
  } else if (batch && batch.msg) batchHtml = `<p class="note">${esc(batch.msg)}</p>`;
  const applied = (a.status.postule || 0) + (a.status.entrevista || 0) + (a.status.oferta || 0) + (a.status.rechazado || 0);
  let h = `<div class="tiles">
    <div class="tile"><b>${a.N}</b><span>avisos evaluados</span></div>
    <div class="tile"><b><span class="vdot green"></span>${a.verdicts.green}</b><span>para postularte</span></div>
    <div class="tile"><b><span class="vdot yellow"></span>${a.verdicts.yellow}</b><span>alcanzables</span></div>
    <div class="tile"><b><span class="vdot red"></span>${a.verdicts.red}</b><span>lejos por ahora</span></div>
    <div class="tile"><b>${applied}</b><span>postulaciones</span></div>
  </div>`;

  h += batchHtml;
  if (settings.sheets.pendingRestore) h += `<div class="warn">La hoja tiene datos y la extensión está vacía: la sincronización está frenada. <a href="options.html#sheets">Restaurá desde la hoja</a>.</div>`;
  if (synthetic) h += `<p class="note">${synthetic} aviso(s) restaurados sin su texto original: el veredicto es aproximado y la IA no los analiza. Abrí el link y evaluálos de nuevo para el análisis completo.</p>`;
  if (a.toAsk.length) {
    h += `<div class="warn">Hay ${a.toAsk.length} herramienta(s) sin tu nivel: ${a.toAsk.slice(0, 6).map((s) => esc(s.label)).join(", ")}${a.toAsk.length > 6 ? "…" : ""}. Completalas en <a href="options.html">Mi perfil</a> para que el análisis sea exacto.</div>`;
  }

  // A dónde aplicar
  h += `<div class="section"><h2>Te conviene aplicar</h2>`;
  if (a.apply.length) {
    h += '<div class="card"><ul class="applylist">' + a.apply.slice(0, 8).map(({ job, r }) => {
      const why = r.missReq.length ? "Falta: " + r.missReq.map((i) => i.label).join(", ") :
        r.partialReq.length ? "Casi: " + r.partialReq.map((i) => i.label).join(", ") :
        r.yearsGap > 0 ? `Piden ${r.yearsReq} años` : "Cumplís lo que se pudo medir";
      return `<li><span><span class="vdot ${r.verdict}"></span>${jobName(job)}${r.provisional ? ' <span class="note">(provisorio)</span>' : ""}</span><span class="note">${esc(why)}${link(job)}</span></li>`;
    }).join("") + "</ul></div>";
  } else h += '<p class="note">No quedan avisos verdes o amarillos sin postular.</p>';
  h += "</div>";

  // En qué puestos enfocarte
  const anyApplied = a.families.some((f) => f.applied);
  h += `<div class="section"><h2>En qué puestos enfocarte</h2>`;
  if (a.focus.length) h += `<div class="card"><ul class="tips">` + a.focus.map((t) => `<li><b>${esc(t.strong)}:</b> ${esc(t.text)}</li>`).join("") + "</ul></div>";
  h += `<div class="tablewrap"><table><thead><tr><th>Puesto</th><th class="num">Avisos</th><th class="num">Postulate</th><th class="num">Alcanzables</th><th class="num">Lejos</th>${anyApplied ? '<th class="num">Te llamaron</th>' : ""}<th>Lo que más te frena</th></tr></thead><tbody>` +
    a.families.map((f) => `<tr><td>${esc(f.label)}</td><td class="num">${f.total}</td><td class="num">${f.green || ""}</td><td class="num">${f.yellow || ""}</td><td class="num">${f.red || ""}</td>${anyApplied ? `<td class="num">${f.applied ? `${f.called} de ${f.applied}` : ""}</td>` : ""}<td class="note">${esc(f.gaps.map((g) => `${g.label} (${g.n})`).join(", ") || "—")}</td></tr>`).join("") +
    `</tbody></table></div><p class="note">Son los avisos que elegiste evaluar, no todo el mercado. El puesto de cada aviso se puede corregir en la tabla de abajo.</p></div>`;

  // Qué reforzar
  h += `<div class="section"><h2>Qué reforzar</h2>`;
  if (a.reinforce.length) {
    h += `<div class="tablewrap"><table><thead><tr><th>Herramienta</th><th class="num">Aparece en</th><th class="num">Excluyente en</th><th class="num">Te falta en</th><th class="num">Destraba</th><th>Tu nivel</th></tr></thead><tbody>` +
      a.reinforce.slice(0, 10).map((s) => `<tr><td>${esc(s.label)}${s.lang ? ' <span class="note">· idioma</span>' : ""}</td><td class="num">${s.total}</td><td class="num">${s.req}</td><td class="num">${s.gap}</td><td class="num">${s.unlock || ""}</td><td>${esc(s.myLevel === null ? "sin responder" : Evaluador.LEVEL_NAMES[s.myLevel])}</td></tr>`).join("") +
      `</tbody></table></div><p class="note">"Destraba" = avisos donde es lo único excluyente que te falta: si lo aprendés, pasan a alcanzables. Ojo con los idiomas: subir un nivel lleva meses, no semanas.</p>`;
  } else h += '<p class="note">Por ahora no aparece ninguna herramienta que te falte en varios avisos.</p>';
  h += "</div>";

  // Qué destacar en el CV
  if (a.tips.length) {
    h += `<div class="section"><h2>Qué destacar en tu CV</h2><div class="card"><ul class="tips">` +
      a.tips.map((t) => `<li><b>${esc(t.strong)}:</b> ${esc(t.text)}</li>`).join("") + "</ul></div></div>";
  }

  // Requisitos fuera del catálogo (detectados por la IA)
  if (a.aiOther.length) {
    const tools = a.aiOther.filter((x) => x.tool);
    const other = a.aiOther.filter((x) => !x.tool);
    h += `<div class="section"><h2>Otros requisitos que encontró la IA</h2>`;
    if (tools.length) {
      h += `<p class="note">Herramientas que no están en tu lista. Si las agregás, las busco en todos tus avisos y te pregunto tu nivel.</p><div class="chips">` +
        tools.slice(0, 20).map((x) => `<span class="chip">${esc(x.label)} · ${x.count} aviso(s) <button class="small" data-addtool="${esc(x.label)}">Agregar</button> <button class="small ghost" data-ignoretool="${esc(x.label)}">No es herramienta</button></span>`).join("") + "</div>";
    }
    if (other.length) {
      h += `<p class="note" style="margin-top:10px">Experiencia y otros requisitos (no se miden con reglas):</p><div class="chips">` +
        other.slice(0, 20).map((x) => `<span class="chip">${esc(x.label)} · ${x.count}</span>`).join("") + "</div>";
    }
    h += "</div>";
  }

  // Todos los avisos
  const opts = (cur) => Store.STATUS.map(([v, n]) => `<option value="${v}"${cur === v ? " selected" : ""}>${n}</option>`).join("");
  const famOpts = (cur) => Store.FAMILY_LABELS.map((n) => `<option${cur === n ? " selected" : ""}>${esc(n)}</option>`).join("");
  h += `<div class="section"><h2>Todos los avisos</h2><div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Puesto</th><th>Veredicto</th><th>Te falta</th><th>Estado</th><th>Notas</th><th></th></tr></thead><tbody>` +
    a.evals.map(({ job, r }) => `<tr data-id="${esc(job.id)}">
      <td>${fmtDate(job.created)}</td>
      <td><input class="cell" data-f="title" value="${esc(job.title)}" placeholder="Puesto"><br><input class="cell note" data-f="company" value="${esc(job.company)}" placeholder="Empresa"><br><select class="fam-sel" data-f="family" title="Familia de puesto">${famOpts(Store.familyOf(job))}</select>${link(job)}</td>
      <td class="nowrap"><span class="vdot ${r.verdict}"></span>${VNAME[r.verdict]}${r.provisional ? '<br><span class="note">provisorio</span>' : ""}</td>
      <td class="note">${esc(r.missReq.map((i) => i.label).join(", ") || "—")}</td>
      <td><select data-f="status" class="status-sel">${opts(job.status)}</select></td>
      <td><input class="notes" data-f="notes" value="${esc(job.notes)}" placeholder="Agregar nota"></td>
      <td><button class="small" data-del="1" title="Borrar este aviso">Borrar</button></td>
    </tr>`).join("") + `</tbody></table></div>
    <div class="row" style="margin-top:14px"><button id="wipe" class="small danger">Borrar todos los avisos</button></div></div>`;

  $("content").innerHTML = h;
}

async function reload() {
  data = await Store.load();
  render();
}

function download(name, rows) {
  const blob = new Blob([Store.toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("content").addEventListener("change", async (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (!tr || !e.target.dataset.f) return;
  const f = e.target.dataset.f;
  const patch = { [f]: e.target.value.trim() };
  if (f === "title") patch.titleAuto = false;
  if (f === "company") patch.companyAuto = false;
  if (f === "family") patch.familyManual = true;
  await Store.updateJob(tr.dataset.id, patch);
  Store.scheduleSync();
});
$("content").addEventListener("click", async (e) => {
  if (e.target.id === "runBatch") return runBatch();
  if (e.target.id === "stopBatch") { batch.stop = true; batch.msg = "Deteniendo después del aviso actual…"; return render(); }
  const tr = e.target.closest("tr[data-id]");
  if (tr && e.target.dataset.del) {
    await Store.deleteJob(tr.dataset.id);
    Store.scheduleSync();
  }
  if (e.target.dataset.addtool || e.target.dataset.ignoretool) {
    const p = data.profile;
    if (e.target.dataset.addtool) Store.addCustomSkill(p, e.target.dataset.addtool, [], null);
    else Store.ignoreTerm(p, e.target.dataset.ignoretool);
    await Store.saveProfile(p);
    Store.scheduleSync();
    return;
  }
  if (e.target.id === "wipe") {
    if (e.target.dataset.confirm) {
      await Store.saveJobs([]);
      Store.scheduleSync();
    } else {
      e.target.dataset.confirm = "1";
      e.target.textContent = "¿Seguro? Tocá de nuevo para borrar todo";
    }
  }
});
$("csvJobs").addEventListener("click", () => download("avisos.csv", Store.buildSheets(data.jobs, data.profile, data.companies).Avisos));
$("csvReqs").addEventListener("click", () => download("requisitos.csv", Store.buildSheets(data.jobs, data.profile, data.companies).Requisitos));

// ---------- Completar con IA, de a un aviso ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runBatch() {
  const { jobs, settings, profile } = await Store.load();
  const ai = settings.ai;
  const todo = jobs.filter((j) => !j.synthetic && !(j.ai && j.ai.result && j.ai.result.postulacion));
  batch = { running: true, done: 0, total: todo.length, stop: false, msg: "" };
  render();
  for (const j of todo) {
    if (batch.stop) break;
    batch.msg = "Analizando: " + (j.title || "aviso sin título");
    render();
    try {
      const a = await EvaluadorIA.analyze(j.text || "", profile, ai, { title: j.tabTitle || j.title });
      const updated = await Store.updateJob(j.id, Store.aiPatch(j, a));
      if (updated && updated.company && ai.companies !== "off" && EvaluadorIA.canSearch(ai)) {
        const r = Store.evalJob(updated, profile);
        if (r.verdict !== "red") {
          const out = await Store.ensureCompany(updated.company, ai, updated.title, false);
          if (!out.cached) await sleep(4000);
        }
      }
    } catch (e) {
      batch.msg = "Se detuvo: " + e.message;
      break;
    }
    batch.done++;
    await sleep(4500); // pausa para no pasar el límite por minuto del plan gratuito
  }
  const finished = batch.done === batch.total;
  batch = { running: false, msg: finished ? `Listo: se completaron ${batch.done} aviso(s).` : batch.msg || `Detenido: se completaron ${batch.done} de ${batch.total}.` };
  Store.scheduleSync();
  await reload();
}
$("profileBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("syncBtn").addEventListener("click", async () => {
  $("syncBtn").disabled = true;
  $("syncBtn").textContent = "Sincronizando…";
  try { await Store.syncSheets(); } catch (e) { /* el error queda en settings y se muestra arriba */ }
  $("syncBtn").textContent = "Sincronizar con Sheets";
  await reload();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // No redibujar mientras se escribe una nota.
  if (document.activeElement && document.activeElement.matches("input.notes, input.cell")) return;
  reload();
});

reload();
