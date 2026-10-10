"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let CAT = null, MY = [];
let STATIC = false;   // true на хостинге без сервера: план уходит в чат, а не в папку проекта
const rel = p => (p ? p.replace(/^\//, "") : p);   // пути превью относительные, чтобы работало и в подпапке хостинга
let S = null; // состояние плана
const groups = {}; // id -> группа каталога

function blank() {
  const values = {};
  for (const g of Object.values(groups)) {
    if (g.default !== undefined && g.default !== null) values[g.id] = Array.isArray(g.default) ? [...g.default] : g.default;
    else values[g.id] = g.type === "multi" ? [] : null;
  }
  values.library = [];
  return { recipe: null, recipeName: "", project: { name: "", type: "own", video: "", videoInfo: null, ref: "", brief: "", watermark: true, notes: "" }, values };
}

function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 2600); }
function save() { store.set("studio-draft", S); renderSummary(); }
async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "ошибка");
  return d;
}

// ── превью: грузим, когда видно; играем при наведении ──
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { const v = e.target; v.poster = v.dataset.src.replace(/\.mp4$/, ".jpg"); io.unobserve(v); }
}), { rootMargin: "200px" });
function previewEl(src) {
  if (!src) return null;
  const v = document.createElement("video");
  v.className = "pv"; v.muted = true; v.loop = true; v.playsInline = true; v.preload = "none"; v.dataset.src = rel(src);
  io.observe(v);
  return v;
}
function playIn(c) { const v = c && $("video.pv", c); if (!v) return; if (!v.src) v.src = v.dataset.src; v.play().catch(() => {}); }
document.addEventListener("mouseover", e => playIn(e.target.closest(".card")));
document.addEventListener("touchstart", e => playIn(e.target.closest(".card")), { passive: true });
document.addEventListener("mouseout", e => { const c = e.target.closest(".card"); if (c && !c.contains(e.relatedTarget)) { const v = $("video.pv", c); if (v) v.pause(); } });

function card(opt, on, extraCls = "") {
  const b = document.createElement("button");
  b.type = "button"; b.className = `card ${on ? "on" : ""} ${extraCls}`;
  b.title = [opt.does, opt.when && "Когда брать: " + opt.when].filter(Boolean).join("\n");
  const pv = previewEl(opt.preview); if (pv) b.append(pv);
  b.insertAdjacentHTML("beforeend", `<span class="nm">${opt.name}</span>${opt.does ? `<span class="ds">${opt.does}</span>` : ""}${opt.when ? `<span class="wh">Когда: ${opt.when}</span>` : ""}${opt.src ? `<span class="src">${opt.src}</span>` : ""}`);
  return b;
}

// ── рецепты ──
function renderRecipes() {
  const box = $("#recipes"); box.innerHTML = "";
  for (const r of [...CAT.recipes, ...MY]) {
    const c = card({ name: r.name, does: r.does, preview: r.preview }, S.recipe === r.id, r.mine ? "mine" : "");
    if (!r.preview) { const e = document.createElement("div"); e.className = "pv empty"; e.textContent = "по твоему рефу"; c.prepend(e); }
    c.dataset.id = r.id;
    c.onclick = () => applyRecipe(r);
    box.append(c);
  }
}
function applyRecipe(r) {
  const keepProject = S.project;
  S = blank(); S.project = keepProject;
  for (const [k, v] of Object.entries(r.values || {})) S.values[k] = Array.isArray(v) ? [...v] : v;
  S.recipe = r.id; S.recipeName = r.name;
  renderAll(); save();
  toast(`Рецепт «${r.name}» применён. Всё можно поменять ниже`);
}

// ── шаги из каталога ──
function renderGroup(g) {
  const w = document.createElement("div"); w.className = "group";
  w.innerHTML = `<h3>${g.title}</h3>${g.hint ? `<p class="ghint">${g.hint}</p>` : ""}`;
  const val = S.values[g.id];
  if (g.type === "single" || g.type === "multi") {
    const grid = document.createElement("div");
    grid.className = "grid" + (g.options.some(o => o.preview) ? "" : " compact");
    for (const o of g.options) {
      const on = g.type === "multi" ? (val || []).includes(o.id) : val === o.id;
      const c = card(o, on);
      c.onclick = () => {
        if (g.type === "multi") {
          const arr = S.values[g.id] || (S.values[g.id] = []);
          const i = arr.indexOf(o.id); i >= 0 ? arr.splice(i, 1) : arr.push(o.id);
          c.classList.toggle("on", i < 0);
        } else {
          S.values[g.id] = o.id;
          $$(".card", grid).forEach(x => x.classList.toggle("on", x === c));
        }
        markCustom(); save();
      };
      grid.append(c);
    }
    w.append(grid);
  } else if (g.type === "slider") {
    const o = g.options;
    w.insertAdjacentHTML("beforeend", `<div class="slider"><input type="range" min="${o.min}" max="${o.max}" step="${o.step}" value="${val ?? g.default}"><b>${val ?? g.default}${o.unit}</b></div>`);
    const inp = $("input", w), out = $("b", w);
    inp.oninput = () => { S.values[g.id] = +inp.value; out.textContent = inp.value + o.unit; markCustom(); save(); };
  } else if (g.type === "toggle") {
    w.insertAdjacentHTML("beforeend", `<label class="switch"><input type="checkbox" ${val ? "checked" : ""}><span></span>Включено</label>`);
    $("input", w).onchange = e => { S.values[g.id] = e.target.checked; markCustom(); save(); };
  }
  return w;
}
function markCustom() {
  if (S.recipe && !S.recipeName.endsWith("(изменён)")) { S.recipeName += " (изменён)"; }
}

function renderSteps() {
  const box = $("#steps"); box.innerHTML = "";
  CAT.steps.forEach((st, i) => {
    const sec = document.createElement("section"); sec.className = "step"; sec.id = "step-" + st.id;
    sec.innerHTML = `<div class="step-head"><span class="num">${i + 3}</span><div><h2>${st.title}</h2><p>${st.hint}</p></div></div>`;
    const main = st.groups.filter(g => !g.advanced), adv = st.groups.filter(g => g.advanced);
    main.forEach(g => sec.append(renderGroup(g)));
    if (st.id === "graphics") sec.append(renderLibrary());
    if (adv.length) {
      const d = document.createElement("details"); d.className = "adv";
      d.innerHTML = `<summary>Тонкие настройки: ${adv.map(g => g.title.toLowerCase()).join(", ")}</summary>`;
      adv.forEach(g => d.append(renderGroup(g)));
      sec.append(d);
    }
    box.append(sec);
  });
}

// ── вся библиотека моушн-блоков ──
let libFilter = "talking", libQuery = "";
function renderLibrary() {
  const d = document.createElement("details"); d.className = "adv"; d.id = "libBox";
  d.innerHTML = `<summary>Вся библиотека моушн-блоков: ${CAT.library.length} штук с превью</summary>
    <p class="ghint">Отметь блоки, которые хочешь видеть в ролике. Блоки для говорящего видео отмечены фильтром «Подходят к говорящему»</p>
    <input id="libSearch" placeholder="Поиск: счётчик, стрелка, сплит…" value="${libQuery}">
    <div class="libbar" id="libChips"></div><div class="grid" id="libGrid"></div>`;
  const chips = $("#libChips", d);
  const fams = [["talking", "Подходят к говорящему"], ["all", "Все"], ["picked", "Выбранные"], ...Object.entries(CAT.families)];
  for (const [k, t] of fams) {
    const c = document.createElement("button"); c.type = "button"; c.className = "chip" + (k === libFilter ? " on" : ""); c.textContent = t;
    c.onclick = () => { libFilter = k; $$(".chip", chips).forEach(x => x.classList.toggle("on", x === c)); fillLib(d); };
    chips.append(c);
  }
  $("#libSearch", d).oninput = e => { libQuery = e.target.value.toLowerCase(); fillLib(d); };
  d.addEventListener("toggle", () => { if (d.open) fillLib(d); }, { once: true });
  return d;
}
function fillLib(d) {
  const grid = $("#libGrid", d); grid.innerHTML = "";
  const picked = S.values.library;
  const list = CAT.library.filter(b =>
    (libFilter === "all" || (libFilter === "talking" && b.talking) || (libFilter === "picked" && picked.includes(b.id)) || b.family === libFilter) &&
    (!libQuery || (b.name + " " + b.does).toLowerCase().includes(libQuery)));
  for (const b of list) {
    const c = card({ name: b.name, does: b.does, preview: b.preview, src: CAT.families[b.family] }, picked.includes(b.id));
    c.onclick = () => {
      const i = picked.indexOf(b.id); i >= 0 ? picked.splice(i, 1) : picked.push(b.id);
      c.classList.toggle("on", i < 0); markCustom(); save();
    };
    grid.append(c);
  }
  if (!list.length) grid.innerHTML = `<p class="ghint">Ничего не нашлось</p>`;
}

// ── проект ──
const FIELDS = [["#pName", "name"], ["#pRef", "ref"], ["#pBrief", "brief"], ["#pNotes", "notes"], ["#pWatermark", "watermark"], ["#pVideo", "video"]];
function bindProject() {   // один раз
  for (const [id, key] of FIELDS) {
    const el = $(id);
    if (key === "video") { el.onchange = async () => { S.project.video = el.value.trim().replace(/^"|"$/g, ""); await probe(); save(); }; continue; }
    el.addEventListener(el.type === "checkbox" ? "change" : "input", () => { S.project[key] = el.type === "checkbox" ? el.checked : el.value; save(); });
  }
  $$("#pType button").forEach(b => b.onclick = () => { S.project.type = b.dataset.v; fillProject(); save(); });
  $("#pickVideo").onclick = () => pick("video");
  $("#pickRef").onclick = () => pick("ref");
  $("#fileVideo").onchange = e => onLocalFile("video", e.target.files[0]);
  $("#fileRef").onchange = e => onLocalFile("ref", e.target.files[0]);
}
function fillProject() {    // показать текущие значения
  for (const [id, key] of FIELDS) { const el = $(id); el[el.type === "checkbox" ? "checked" : "value"] = S.project[key] ?? ""; }
  $$("#pType button").forEach(b => b.classList.toggle("on", b.dataset.v === S.project.type));
  document.body.classList.toggle("client", S.project.type === "client");
  showInfo();
}
// браузерный выбор файла (облачная версия): файл никуда не загружается, читаем только размер и длину
function readMeta(file) {
  return new Promise(res => {
    const v = document.createElement("video"), u = URL.createObjectURL(file);
    v.preload = "metadata"; v.muted = true;
    v.onloadedmetadata = () => { res({ width: v.videoWidth, height: v.videoHeight, fps: null, duration: Math.round(v.duration * 10) / 10 }); URL.revokeObjectURL(u); };
    v.onerror = () => { res(null); URL.revokeObjectURL(u); };
    v.src = u;
  });
}
async function onLocalFile(kind, file) {
  if (!file) return;
  if (kind === "video") {
    S.project.video = file.name; S.project.videoInfo = await readMeta(file); $("#pVideo").value = file.name;
    if (!S.project.name) { S.project.name = file.name.replace(/\.[^.]+$/, ""); $("#pName").value = S.project.name; }
    showInfo();
    toast("Файл никуда не загружается. Допиши в поле полный путь к нему на ПК, если знаешь");
  } else { S.project.ref = file.name; $("#pRef").value = file.name; }
  save();
}
async function pick(kind) {
  if (STATIC) { const f = $(kind === "video" ? "#fileVideo" : "#fileRef"); f.value = ""; f.click(); return; }
  toast("Открываю окно выбора файла, оно может появиться поверх браузера");
  try {
    const d = await api("/api/pick", { kind });
    if (!d.path) return;
    if (kind === "video") {
      S.project.video = d.path; S.project.videoInfo = d.info; $("#pVideo").value = d.path;
      if (!S.project.name) { S.project.name = d.path.split("\\").pop().replace(/\.[^.]+$/, ""); $("#pName").value = S.project.name; }
      showInfo();
    } else { S.project.ref = d.path; $("#pRef").value = d.path; }
    save();
  } catch (e) { toast("Не открылось окно: вставь путь к файлу в поле рядом"); }
}
async function probe() {
  if (!S.project.video) { S.project.videoInfo = null; return showInfo(); }
  if (STATIC) return showInfo();
  try { S.project.videoInfo = (await api("/api/probe", { path: S.project.video })).info; } catch { S.project.videoInfo = null; }
  showInfo();
}
function showInfo() {
  const i = S.project.videoInfo, el = $("#videoInfo");
  if (!S.project.video) { el.textContent = ""; el.className = "meta"; return; }
  if (!i) { el.textContent = STATIC ? "Путь запомнил. Размер и частоту кадров Claude определит сам при монтаже" : "Файл не читается. Проверь путь"; el.className = "meta"; return; }
  const vert = i.height > i.width ? "вертикальное" : "горизонтальное";
  el.textContent = `✓ ${vert}, ${i.width}×${i.height}, ${i.fps ? i.fps + " к/с, " : ""}${Math.floor(i.duration / 60)}:${String(Math.round(i.duration % 60)).padStart(2, "0")}`;
  el.className = "meta ok";
}

// ── сводка ──
function names(gid) {
  const g = groups[gid], v = S.values[gid];
  if (!g || v == null) return "";
  if (g.type === "slider") return v + "%";
  if (g.type === "toggle") return v ? "да" : "нет";
  const ids = Array.isArray(v) ? v : [v];
  return ids.map(id => (g.options.find(o => o.id === id) || {}).name).filter(Boolean).join(", ");
}
function renderSummary() {
  const P = S.project, v = S.values, L = [];
  const sec = (t, s) => s && L.push(`<div class="sum-sec"><b>${t}</b>${s}</div>`);
  sec("Рецепт", S.recipeName || "свой набор");
  sec("Видео", P.video ? (P.name || P.video.split("\\").pop()) : "");
  sec("Ритм", [names("pauses") && "паузы: " + names("pauses").toLowerCase(), names("tempo").toLowerCase(), names("push").toLowerCase()].filter(Boolean).join(" · "));
  sec("Хук", [names("hook"), names("hookextras").toLowerCase()].filter(Boolean).join(" + "));
  const tech = (v.techniques || []).length, lib = v.library.length;
  sec("Графика", `${tech + lib} приёмов, ${names("cardstyle").toLowerCase()}, ${names("density").toLowerCase()}`);
  sec("Переходы", names("transitions"));
  sec("Цвет", `${names("look")}, сила ${v.strength ?? 50}%`);
  sec("Звук", `${names("music")} · эффекты: ${names("sfx").toLowerCase()}${v.drop ? " · удар на ключевой фразе" : ""}`);
  sec("Выход", `${names("format")} · ${names("platforms")}`);
  const warn = [];
  if (!P.video) warn.push("Выбери видео в шаге 2");
  if (!P.name) warn.push("Дай проекту название");
  $("#summary").innerHTML = L.join("") + warn.map(w => `<div class="sum-warn">• ${w}</div>`).join("");
}

// ── сохранение ──
async function savePlan() {
  if (!S.project.name || !S.project.video) {
    toast(!S.project.video ? "Сначала выбери видео" : "Дай проекту название");
    $("#step-project").scrollIntoView({ behavior: "smooth" }); return;
  }
  if (STATIC) return savePlanStatic();
  try {
    const d = await api("/api/save", S);
    try { await navigator.clipboard.writeText(d.phrase); } catch {}
    const r = $("#result"); r.hidden = false;
    r.innerHTML = `<b>План сохранён.</b> Фраза уже скопирована, вставь её мне в чат Claude:
      <code>${d.phrase}</code>
      <div class="hint">Папка: ${d.folder} (там plan.json для меня и brief.md для тебя)</div>
      <div class="row wrap" style="margin-top:10px"><button class="ghost" id="copyAgain">Скопировать ещё раз</button><button class="ghost" id="openFolder">Открыть папку проекта</button></div>`;
    $("#copyAgain").onclick = async () => { try { await navigator.clipboard.writeText(d.phrase); toast("Скопировано"); } catch { toast("Выдели фразу и скопируй вручную"); } };
    $("#openFolder").onclick = () => api("/api/open", { path: d.folder });
    r.scrollIntoView({ behavior: "smooth", block: "center" });
    toast("Готово, фраза в буфере");
  } catch (e) { toast("Не сохранилось: " + e.message); }
}
// ── облачная версия: план собирается в браузере и уходит в чат ──
const slug = n => n.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, "").trim().replace(/[\s_]+/g, "-").slice(0, 60) || "проект";
function briefMd(plan) {
  const v = plan.values || {}, P = plan.project || {}, lib = Object.fromEntries(CAT.library.map(b => [b.id, b]));
  const L = [`# ${P.name || "Проект"} - ТЗ на монтаж`, "",
    `Собрано в Монтажной студии ${plan.saved}. Рецепт: ${plan.recipeName || "свой набор"}`, "",
    "## 1. Роль",
    "Ты видеомонтажёр с 10-летним опытом, motion design. Монтируешь через HyperFrames по `montage-rules.md` и `MOTION.md`. Куда ставить каждый приём, решаешь по смыслу речи. Перед рендером план по секундам", "",
    "## 2. Проект", `- Тип: ${P.type === "client" ? "заказ клиента" : "свой рилз"}`];
  const i = P.videoInfo;
  L.push(`- Исходник: \`${P.video || ""}\`` + (i ? ` (${i.width}×${i.height}, ${i.fps ? i.fps + " к/с, " : ""}${i.duration} с)` : ""));
  if (P.ref) L.push(`- Реф: \`${P.ref}\``);
  if (P.type === "client") L.push(`- Водяной знак до оплаты: ${P.watermark ? "да, сеткой по всему кадру" : "нет"}`);
  if (P.brief) L.push("- ТЗ и переписка клиента:", "", "```", P.brief, "```");
  if (P.notes) L.push("", `Пожелания автора: ${P.notes}`);
  L.push("");
  for (const st of CAT.steps) {
    L.push(`## ${st.num}. ${st.title}`);
    for (const g of st.groups) {
      const val = v[g.id];
      if (val == null) continue;
      if (g.type === "slider") L.push(`- ${g.title}: ${val}%`);
      else if (g.type === "toggle") L.push(`- ${g.title}: ${val ? "да" : "нет"}`);
      else {
        const items = (Array.isArray(val) ? val : [val]).map(id => g.options.find(o => o.id === id)).filter(Boolean);
        if (!items.length) L.push(`- ${g.title}: ничего`);
        else if (items.length === 1) L.push(`- ${g.title}: **${items[0].name}**. ${items[0].does}`);
        else { L.push(`- ${g.title}:`); items.forEach(it => L.push(`  - **${it.name}**. ${it.does}` + (it.src ? ` (${it.src})` : ""))); }
      }
    }
    if (st.id === "graphics" && (v.library || []).length) {
      L.push("- Блоки из библиотеки motion-blocks:");
      v.library.forEach(b => lib[b] && L.push(`  - **${lib[b].name}** (\`${b}\`). ${lib[b].does}`));
    }
    L.push("");
  }
  L.push("## Сдача", "Чек-лист из `montage-rules.md`: лица открыты (faces.py), текст ≥2 с, ровный цвет, BT.709, громкость около -14 LUFS, звук без провалов. Один файл без v2/v3. Копия в `Готовое\\Видео`, открыть папку");
  return L.join("\n") + "\n";
}
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function copyText(t, ok) { try { await navigator.clipboard.writeText(t); toast(ok); } catch { toast("Не вышло скопировать: скачай файл ниже"); } }
function savePlanStatic() {
  const plan = JSON.parse(JSON.stringify(S));
  plan.saved = new Date().toISOString().slice(0, 10);
  const folder = slug(plan.project.name);
  plan.folder = folder;
  const plans = store.get("studio-plans", []).filter(p => p.folder !== folder);
  store.set("studio-plans", [plan, ...plans].slice(0, 30));
  const phrase = `Смонтируй проект ${folder}`;
  const msg = `${phrase}\nПЛАН СТУДИИ:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``;
  const r = $("#result"); r.hidden = false;
  r.innerHTML = `<b>План готов.</b> Нажми «Скопировать для Claude» и вставь в чат Claude на своём ПК. Он сам сохранит план в папку проекта и начнёт монтаж
    <code>${phrase}</code>
    <div class="hint">В сообщение входит весь план: рецепт, выбранные приёмы, пожелания. Видео должно лежать на ПК по указанному пути</div>
    <div class="row wrap" style="margin-top:10px"><button class="primary" id="copyPlan">Скопировать для Claude</button><button class="ghost" id="dlPlan">Скачать plan.json</button><button class="ghost" id="dlBrief">Скачать brief.md</button></div>`;
  $("#copyPlan").onclick = () => copyText(msg, "Скопировано, вставь в чат Claude");
  $("#dlPlan").onclick = () => download("plan.json", JSON.stringify(plan, null, 1), "application/json");
  $("#dlBrief").onclick = () => download("brief.md", briefMd(plan), "text/markdown");
  copyText(msg, "План скопирован, вставь в чат Claude");
  r.scrollIntoView({ behavior: "smooth", block: "center" });
}
async function saveRecipe() {
  const name = prompt("Как назвать твой рецепт?", S.recipeName.replace(" (изменён)", "") || "Мой стиль");
  if (!name) return;
  const does = prompt("Одной строкой: что это за стиль?", "Мой набор настроек") || "";
  try {
    const r = STATIC ? { id: "my-" + slug(name), name, does, preview: null, mine: true, values: JSON.parse(JSON.stringify(S.values)) }
                     : await api("/api/recipes", { name, does, preview: null, values: S.values });
    if (STATIC) store.set("studio-recipes", MY.filter(x => x.id !== r.id).concat(r));
    MY = MY.filter(x => x.id !== r.id).concat(r); S.recipe = r.id; S.recipeName = r.name;
    renderRecipes(); save(); toast(`Рецепт «${name}» сохранён`);
  } catch (e) { toast(e.message); }
}

// ── мои планы ──
async function openPlans() {
  const m = $("#plansModal"), list = $("#plansList"); m.hidden = false; list.innerHTML = "Загружаю…";
  const local = store.get("studio-plans", []);
  const plans = STATIC ? local.map(p => ({ folder: p.folder, name: p.project.name, saved: p.saved })) : await api("/api/plans");
  list.innerHTML = plans.length ? "" : `<p class="ghint">Пока нет сохранённых планов</p>`;
  if (STATIC) list.insertAdjacentHTML("beforeend", `<p class="ghint">Планы хранятся в этом браузере. Если очистишь данные сайта, они пропадут, поэтому важные скачивай файлом</p>`);
  for (const p of plans) {
    const row = document.createElement("div"); row.className = "plan-row";
    row.innerHTML = `<div><b>${p.name}</b><div class="hint">${p.saved || ""} · ${p.folder}</div></div><button class="ghost">Открыть</button>`;
    $("button", row).onclick = async () => {
      const d = STATIC ? local.find(x => x.folder === p.folder) : await api("/api/plan/" + encodeURIComponent(p.folder));
      S = Object.assign(blank(), { recipe: d.recipe, recipeName: d.recipeName, project: d.project });
      Object.assign(S.values, d.values); m.hidden = true; renderAll(); save(); toast(`Открыт план «${p.name}»`);
    };
    list.append(row);
  }
}

// ── тема ──
function initTheme() {
  const t = store.get("studio-theme", null);
  if (t) document.documentElement.dataset.theme = t;
  $("#theme").onclick = () => {
    const dark = getComputedStyle(document.documentElement).colorScheme === "dark";
    const nt = dark ? "light" : "dark"; document.documentElement.dataset.theme = nt; store.set("studio-theme", nt);
  };
}

function renderAll() { renderRecipes(); renderSteps(); fillProject(); renderSummary(); }

(async function init() {
  initTheme();
  STATIC = true;   // сервер студии есть только на localhost: на внешних адресах пробу не делаем, чтобы не шуметь 404
  if (["localhost", "127.0.0.1"].includes(location.hostname)) try { const r = await fetch("api/ping"); STATIC = !(r.ok && (await r.json()).ok); } catch {}
  document.body.classList.toggle("static", STATIC);
  if (STATIC) {
    $("#step-done .step-head p").textContent = "Соберу план и скопирую его одним сообщением для чата Claude";
    $("#save").textContent = "Готово, собрать план"; $("#pVideo").placeholder = "полный путь к файлу на ПК или хотя бы имя файла";
  }
  CAT = STATIC ? await (await fetch("catalog.json")).json() : await api("/api/catalog");
  for (const st of CAT.steps) for (const g of st.groups) groups[g.id] = g;
  if (STATIC) MY = store.get("studio-recipes", []);
  else try { MY = await api("/api/recipes"); } catch { MY = []; }
  const draft = store.get("studio-draft", null);
  S = blank();
  if (draft && draft.values) { Object.assign(S.values, draft.values); S.project = Object.assign(S.project, draft.project); S.recipe = draft.recipe; S.recipeName = draft.recipeName; }
  else applyRecipeSilently(CAT.recipes[0]);
  bindProject(); renderAll();
  $("#save").onclick = savePlan; $("#save2").onclick = savePlan; $("#saveRecipe").onclick = saveRecipe;
  $("#openPlans").onclick = openPlans;
  $("#resetAll").onclick = () => { if (confirm("Начать новый план? Текущие настройки очистятся")) { S = blank(); applyRecipeSilently(CAT.recipes[0]); renderAll(); save(); $("#result").hidden = true; } };
  $$("[data-close]").forEach(b => b.onclick = () => b.closest(".modal").hidden = true);
})();
function applyRecipeSilently(r) { for (const [k, v] of Object.entries(r.values || {})) S.values[k] = Array.isArray(v) ? [...v] : v; S.recipe = r.id; S.recipeName = r.name; }
