(() => {
"use strict";

const CFG = window.KS_CONFIG;
const sb = window.supabase.createClient(CFG.url, CFG.key);

/* ===== Sabitler ===== */
const STATUS = {
  available: "Boşta", reserved: "Kod gösterildi", in_progress: "Devam ediyor",
  completed: "Tamamlandı", withdrawn: "Sonlandırıldı",
};
const EVENTS = {
  session_start: "Giriş (onam verdi)", consent_declined: "Onam vermedi", resume: "Oturuma geri döndü",
  survey_complete: "Bilgi formunu tamamladı", sort_start: "Kart sıralamaya başladı",
  place: "Kartı yerleştirdi", move: "Kartı taşıdı", undo: "Geri aldı",
  add_blank: "Boş kart ekledi", remove_blank: "Boş kartı sildi",
  complete: "Sıralamayı bitirdi", withdraw: "Oturumu sonlandırdı",
};
const QTYPES = { single: "Tek seçim", multi: "Çoklu seçim", text: "Kısa metin", dept: "Bölüm (kart destesini belirler)" };
const COLORS = ["g1", "g2", "g3", "g4", "g5", "g6"];

/* ===== Durum ===== */
let user = null;
let D = { participants: [], logs: [], groups: [], departments: [], cards: [], survey: [] };
let tab = "overview", ctab = "cards";
const F = {
  ov: { dept: "", scope: "completed", sort: "id" },
  pt: { q: "", status: "used", batch: "", limit: 200 },
  lg: { q: "", type: "", from: "", to: "", limit: 300 },
};

/* ===== Yardımcılar ===== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const pad = n => String(n).padStart(2, "0");
function fmtDate(iso, withSec = false){
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}${withSec ? ":" + pad(d.getSeconds()) : ""}`;
}
function xlDate(iso){
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const diffSec = (a, b) => a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 1000) : null;
function fmtDur(sec){
  if (sec == null || isNaN(sec)) return "";
  if (sec < 60) return `${sec} sn`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} dk ${pad(sec % 60)} sn`;
  return `${Math.floor(m / 60)} sa ${pad(m % 60)} dk`;
}
const pct = (n, t) => t ? Math.round(n / t * 100) : 0;
function median(arr){
  const a = arr.filter(v => v != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}
function toast(msg){
  const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
}
const errMsg = e => (e && (e.message || e.error_description)) || String(e);

/* ===== Veri ===== */
const P_COLS = "code,status,batch,department,stage,created_at,reserved_at,started_at,survey,survey_completed_at,sort_started_at,completed_at,withdrawn_at,deck_order,placements,changes,custom_cards,sorts,user_agent,last_seen_at";
async function fetchAll(table, select, order){
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(select);
    for (const [col, asc] of order) q = q.order(col, { ascending: asc });
    const { data, error } = await q.range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
async function loadContent(){
  const [g, d, c, s] = await Promise.all([
    fetchAll("groups", "*", [["sort_order", true], ["id", true]]),
    fetchAll("departments", "*", [["sort_order", true], ["id", true]]),
    fetchAll("cards", "*", [["sort_order", true], ["id", true]]),
    fetchAll("survey_questions", "*", [["sort_order", true], ["id", true]]),
  ]);
  Object.assign(D, { groups: g, departments: d, cards: c, survey: s });
}
async function loadData(){
  const [p, l] = await Promise.all([
    fetchAll("participants", P_COLS, [["created_at", true], ["code", true]]),
    fetchAll("event_logs", "*", [["id", true]]),
  ]);
  D.participants = p; D.logs = l;
}
async function reload(what = "all"){
  try {
    if (what === "all" || what === "content") await loadContent();
    if (what === "all" || what === "data") await loadData();
  } catch (e) { toast("Veriler yüklenemedi: " + errMsg(e)); }
  render();
}

/* ===== Türetilmiş bilgiler ===== */
const deptLabel = id => id === "all" ? "Tüm bölümler" : ((D.departments.find(d => d.id === id) || {}).label || id || "");
const groupIndex = id => D.groups.findIndex(g => g.id === id);
const seriesVar = id => { const i = groupIndex(id); return i >= 0 && i < 6 ? `var(--s${i + 1})` : "var(--s0)"; };
// Uygulama grubu (kartların Bloom/işlev sınıfı; öğrenciye gösterilmez). Analizde kartın güncel grubu esas alınır.
const CUSTOM_CAT = "Katılımcı kartları";
const catOf = (cardId, snapshot) => ((D.cards.find(c => c.id === cardId) || {}).level || snapshot || "Belirtilmemiş");
const categories = () => [...new Set(D.cards.map(c => c.level).filter(Boolean))];
const catIndex = c => { const i = categories().indexOf(c); return c === CUSTOM_CAT ? 1e6 : i < 0 ? 1e5 : i; };
function groupLabel(id, fallback){ const g = D.groups.find(g => g.id === id); return g ? g.label : (fallback || id || "Yerleştirilmedi"); }

function answeredQ(p, q){
  if (q.type === "dept") return !!p.department;
  const v = (p.survey || {})[q.id];
  if (q.type === "multi") return !!v && (((v.selected || []).length > 0) || !!String(v.other || "").trim());
  return typeof v === "string" && v.trim() !== "";
}
function info(p){
  const qs = D.survey.filter(q => q.active || (p.survey && p.survey[q.id] !== undefined));
  const sorts = p.sorts || [];
  return {
    answered: p.started_at ? qs.filter(q => answeredQ(p, q)).length : 0,
    totalQ: qs.length,
    placed: sorts.filter(s => s.group).length,
    totalCards: sorts.length,
    custom: sorts.filter(s => s.is_custom).length,
    surveySec: diffSec(p.started_at, p.survey_completed_at),
    sortSec: diffSec(p.sort_started_at, p.completed_at),
    totalSec: diffSec(p.started_at, p.completed_at || p.withdrawn_at),
  };
}
function answerText(p, q){
  if (q.type === "dept") return deptLabel(p.department);
  const v = (p.survey || {})[q.id];
  if (v == null) return "";
  if (q.type === "multi") return [...(v.selected || []), ...(String(v.other || "").trim() ? [`Diğer: ${v.other.trim()}`] : [])].join(", ");
  let s = String(v);
  if (q.follow && q.follow.id && v === q.follow.when && p.survey[q.follow.id]) s += ` (${p.survey[q.follow.id]})`;
  return s;
}

/* ===== Görünüm iskeleti ===== */
function render(){
  const app = $("#app");
  if (!user) { app.innerHTML = viewLogin(); return; }
  const tabs = [["overview", "Özet"], ["participants", "Katılımcılar"], ["logs", "Loglar"], ["content", "İçerik"], ["export", "Dışa aktar"]];
  app.innerHTML = `
  <header class="top">
    <div class="top-in">
      <div class="brand">Kart Sıralama <span>· Yönetim</span></div>
      <span class="who">${esc(user.email)}</span>
      <button class="btn btn-sm" id="btnRefresh" type="button">Yenile</button>
      <a class="btn btn-sm" href="../" target="_blank" rel="noopener">Öğrenci ekranı</a>
      <button class="btn btn-sm" id="btnLogout" type="button">Çıkış</button>
    </div>
    <nav class="tabs" role="tablist">
      ${tabs.map(([id, l]) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${tab === id}">${l}</button>`).join("")}
    </nav>
  </header>
  <main id="main">${tab === "overview" ? viewOverview() : tab === "participants" ? viewParticipants() : tab === "logs" ? viewLogs() : tab === "content" ? viewContent() : viewExport()}</main>`;
}

function viewLogin(msg = ""){
  return `<div class="login"><form id="loginForm" novalidate>
    <h1>Yönetici girişi</h1>
    <p>Kart sıralama etkinliği yönetim paneli</p>
    <label class="f"><span>E-posta</span><input type="email" id="lgEmail" autocomplete="username" required></label>
    <label class="f"><span>Şifre</span><input type="password" id="lgPass" autocomplete="current-password" required></label>
    <div class="err" id="lgErr">${esc(msg)}</div>
    <button class="btn btn-primary" type="submit" style="margin-top:8px">Giriş yap</button>
  </form></div>`;
}

/* ===== Özet ===== */
function viewOverview(){
  const f = F.ov;
  const all = D.participants.filter(p => !f.dept || p.department === f.dept);
  const used = all.filter(p => p.started_at);
  const by = s => all.filter(p => p.status === s).length;
  const declined = D.logs.filter(l => l.type === "consent_declined").length;
  const base = all.filter(p => f.scope === "completed" ? p.status === "completed" : p.status === "completed" || p.status === "in_progress");
  const infos = all.filter(p => p.status === "completed").map(info);
  const pool = D.participants.filter(p => p.status === "available").length;

  const stats = [
    ["Giriş yapan", used.length, "onam veren katılımcı"],
    ["Tamamlayan", by("completed"), used.length ? `girenlerin %${pct(by("completed"), used.length)}'i` : ""],
    ["Devam eden", by("in_progress"), ""],
    ["Sonlandıran", by("withdrawn"), "çalışmadan çekilen"],
    ["Onam vermeyen", declined, "kod havuza döndü"],
    ["Ortanca sıralama süresi", fmtDur(median(infos.map(i => i.sortSec))) || "–", "tamamlayanlar"],
    ["Ortanca toplam süre", fmtDur(median(infos.map(i => i.totalSec))) || "–", "girişten bitişe"],
    ["Boştaki kod", pool, "havuzda kullanılmayı bekleyen"],
  ];

  return `
  <div class="sec-head"><div><h2>Özet</h2><p>Grafikler seçilen bölüm ve kapsamdaki katılımcıların yanıtlarından hesaplanır.</p></div></div>
  <div class="toolbar">
    <label>Bölüm<select data-f="ov.dept"><option value="">Tüm bölümler</option>${D.departments.map(d => `<option value="${esc(d.id)}" ${f.dept === d.id ? "selected" : ""}>${esc(d.label)}</option>`).join("")}</select></label>
    <label>Kapsam<select data-f="ov.scope">
      <option value="completed" ${f.scope === "completed" ? "selected" : ""}>Yalnızca tamamlayanlar</option>
      <option value="started" ${f.scope === "started" ? "selected" : ""}>Tamamlayan + devam eden</option>
    </select></label>
  </div>
  <div class="stats">${stats.map(([l, v, d]) => `<div class="stat"><div class="l">${esc(l)}</div><div class="v num">${esc(v)}</div><div class="d">${esc(d)}</div></div>`).join("")}</div>
  ${chartCards(base)}
  ${chartCats(base)}
  ${chartDeptGroups(base)}
  <div class="panel"><h3>Bilgi formu yanıtları</h3><p class="sub">${base.length} katılımcı. Çubukların yanındaki değer kişi sayısı ve yüzdesidir.</p>${chartSurvey(base)}</div>
  <div class="multi">
    <div class="panel"><h3>Günlere göre giriş</h3><p class="sub">Onam verip başlayan katılımcı sayısı (seçilen bölüm)</p>${chartDaily(used)}</div>
    <div class="panel"><h3>Kart sıralama süresi</h3><p class="sub">Tamamlayanların sıralamada geçirdiği süre, dakika aralıkları</p>${chartDurations(infos.map(i => i.sortSec))}</div>
  </div>
  ${customCardsPanel(base)}`;
}

function legendHtml(ids){
  return `<div class="legend">${ids.map(id => `<span><i style="--c:${seriesVar(id)}"></i>${esc(groupLabel(id))}</span>`).join("")}</div>`;
}
function groupIdsIn(base){
  const ids = D.groups.map(g => g.id);
  base.forEach(p => (p.sorts || []).forEach(s => { if (s.group && !ids.includes(s.group)) ids.push(s.group); }));
  return ids;
}

function chartCards(base){
  const gids = groupIdsIn(base);
  const map = new Map();
  base.forEach(p => (p.sorts || []).forEach(s => {
    if (s.is_custom) return;
    if (!map.has(s.card_id)) map.set(s.card_id, { id: s.card_id, text: s.card_text, cat: catOf(s.card_id, s.card_level), counts: {}, n: 0 });
    const r = map.get(s.card_id);
    if (s.group) { r.counts[s.group] = (r.counts[s.group] || 0) + 1; r.n++; }
  }));
  let rows = [...map.values()].map(r => {
    const c = D.cards.find(c => c.id === r.id); if (c) r.text = c.text; return r;
  });
  const s = F.ov.sort;
  const byId = (a, b) => a.id.localeCompare(b.id, "tr", { numeric: true });
  rows.sort((a, b) => s === "id" ? byId(a, b) : s === "cat" ? (catIndex(a.cat) - catIndex(b.cat)) || byId(a, b) : (pct(b.counts[s] || 0, b.n) - pct(a.counts[s] || 0, a.n)) || byId(a, b));
  const body = rows.length ? `
    ${legendHtml(gids)}
    <div class="stack-list">${rows.map((r, i) => `
      ${s === "cat" && (i === 0 || rows[i - 1].cat !== r.cat) ? `<div class="cat-h">${esc(r.cat)}</div>` : ""}
      <div class="srow">
        <div class="lab" title="${esc(r.text)} · ${esc(r.cat)}"><b>${esc(r.id)}</b>${esc(r.text)}</div>
        <div class="sbar ${r.n ? "" : "empty"}">${gids.filter(g => r.counts[g]).map(g => `<i style="width:${r.counts[g] / r.n * 100}%;--c:${seriesVar(g)}" data-tip="${esc(r.id)} (${esc(r.cat)}) · ${esc(groupLabel(g))}: ${r.counts[g]} kişi (%${pct(r.counts[g], r.n)})"></i>`).join("")}</div>
        <div class="n num">${r.n}</div>
      </div>`).join("")}</div>
    <details class="tv"><summary>Tablo olarak göster</summary><div class="tbl-wrap" style="margin-top:8px"><table>
      <thead><tr><th>Kart</th><th>Metin</th><th>Uygulama grubu</th>${gids.map(g => `<th>${esc(groupLabel(g))}</th>`).join("")}<th>n</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.text)}</td><td>${esc(r.cat)}</td>${gids.map(g => `<td class="num">${r.counts[g] || 0} (%${pct(r.counts[g] || 0, r.n)})</td>`).join("")}<td class="num">${r.n}</td></tr>`).join("")}</tbody>
    </table></div></details>` : `<p class="muted">Bu seçimde henüz yerleştirilmiş kart yok.</p>`;
  return `<div class="panel">
    <div class="sec-head" style="margin-bottom:8px"><div><h3>Kartların gruplara dağılımı</h3><p class="sub" style="margin:0">Her çubuk bir kart; bölümler o kartı ilgili gruba koyan katılımcıların oranı. Sağdaki sayı kartı yerleştiren kişi sayısı.</p></div>
      <label class="sortsel"><span class="sr">Sıralama</span><select data-f="ov.sort" aria-label="Kartları sırala">
        <option value="id" ${s === "id" ? "selected" : ""}>Kart koduna göre</option>
        <option value="cat" ${s === "cat" ? "selected" : ""}>Uygulama grubuna göre</option>
        ${gids.map(g => `<option value="${esc(g)}" ${s === g ? "selected" : ""}>“${esc(groupLabel(g))}” oranına göre</option>`).join("")}
      </select></label></div>
    ${body}</div>`;
}

function catRows(base){
  const map = new Map();
  base.forEach(p => (p.sorts || []).forEach(s => {
    const c = s.is_custom ? CUSTOM_CAT : catOf(s.card_id, s.card_level);
    if (!map.has(c)) map.set(c, { cat: c, counts: {}, n: 0, cards: new Set() });
    const r = map.get(c);
    if (!s.is_custom) r.cards.add(s.card_id);
    if (s.group) { r.counts[s.group] = (r.counts[s.group] || 0) + 1; r.n++; }
  }));
  return [...map.values()].filter(r => r.n).sort((a, b) => catIndex(a.cat) - catIndex(b.cat));
}
function chartCats(base){
  const gids = groupIdsIn(base), rows = catRows(base);
  if (!rows.length) return "";
  const cardsTxt = r => r.cat === CUSTOM_CAT ? "boş kartlar" : `${r.cards.size} kart`;
  return `<div class="panel"><h3>Uygulama gruplarına göre dağılım</h3><p class="sub">Her çubuk bir uygulama grubu; o gruptaki kartların tüm yerleştirmeleri içinde her grubun oranı. Sağdaki sayı yerleştirme sayısı.</p>
    ${legendHtml(gids)}
    <div class="stack-list">${rows.map(r => `<div class="srow">
      <div class="lab" title="${esc(r.cat)}">${esc(r.cat)} <span class="muted">(${cardsTxt(r)})</span></div>
      <div class="sbar">${gids.filter(g => r.counts[g]).map(g => `<i style="width:${r.counts[g] / r.n * 100}%;--c:${seriesVar(g)}" data-tip="${esc(r.cat)} · ${esc(groupLabel(g))}: ${r.counts[g]} yerleştirme (%${pct(r.counts[g], r.n)})"></i>`).join("")}</div>
      <div class="n num">${r.n}</div></div>`).join("")}</div>
    <details class="tv"><summary>Tablo olarak göster</summary><div class="tbl-wrap" style="margin-top:8px"><table>
      <thead><tr><th>Uygulama grubu</th><th>Kart</th>${gids.map(g => `<th>${esc(groupLabel(g))}</th>`).join("")}<th>Yerleştirme</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.cat)}</td><td class="num">${r.cat === CUSTOM_CAT ? "–" : r.cards.size}</td>${gids.map(g => `<td class="num">${r.counts[g] || 0} (%${pct(r.counts[g] || 0, r.n)})</td>`).join("")}<td class="num">${r.n}</td></tr>`).join("")}</tbody>
    </table></div></details></div>`;
}

function chartDeptGroups(base){
  const gids = groupIdsIn(base);
  const rows = [...D.departments.map(d => d.id), ...new Set(base.map(p => p.department).filter(id => id && !D.departments.some(d => d.id === id)))]
    .map(id => {
      const counts = {}; let n = 0;
      base.filter(p => p.department === id).forEach(p => (p.sorts || []).forEach(s => { if (s.group) { counts[s.group] = (counts[s.group] || 0) + 1; n++; } }));
      return { id, counts, n, people: base.filter(p => p.department === id).length };
    }).filter(r => r.n);
  if (!rows.length) return "";
  return `<div class="panel"><h3>Bölümlere göre grup kullanımı</h3><p class="sub">Tüm kart yerleştirmelerinin gruplara oranı</p>
    ${legendHtml(gids)}
    <div class="stack-list">${rows.map(r => `<div class="srow">
      <div class="lab">${esc(deptLabel(r.id))} <span class="muted">(${r.people} kişi)</span></div>
      <div class="sbar">${gids.filter(g => r.counts[g]).map(g => `<i style="width:${r.counts[g] / r.n * 100}%;--c:${seriesVar(g)}" data-tip="${esc(deptLabel(r.id))} · ${esc(groupLabel(g))}: ${r.counts[g]} yerleştirme (%${pct(r.counts[g], r.n)})"></i>`).join("")}</div>
      <div class="n num">${r.n}</div></div>`).join("")}</div></div>`;
}

function hbars(items, total){
  const max = Math.max(1, ...items.map(i => i.n));
  return `<div class="hb">${items.map(i => `<div class="lab" title="${esc(i.label)}">${esc(i.label)}</div>
    <div class="track"><div class="bar" style="width:${i.n / max * 85}%" data-tip="${esc(i.label)}: ${i.n} kişi (%${pct(i.n, total)})"></div><span class="val num">${i.n} (%${pct(i.n, total)})</span></div>`).join("")}</div>`;
}
function chartSurvey(base){
  if (!base.length) return `<p class="muted">Bu seçimde katılımcı yok.</p>`;
  const qs = D.survey.filter(q => q.active || base.some(p => (p.survey || {})[q.id] !== undefined));
  return `<div class="multi">${qs.map(q => {
    let items;
    if (q.type === "dept") items = D.departments.map(d => ({ label: d.label, n: base.filter(p => p.department === d.id).length }));
    else if (q.type === "text") {
      const vals = base.map(p => (p.survey || {})[q.id]).filter(v => typeof v === "string" && v.trim());
      return `<div class="mini-chart"><h4>${esc(q.question)}</h4><p class="muted" style="font-size:13.5px;margin:0">${vals.length} yazılı yanıt. Yanıtlar Excel çıktısında.</p></div>`;
    } else {
      const opts = [...(q.options || [])];
      base.forEach(p => { const v = (p.survey || {})[q.id]; const arr = q.type === "multi" ? ((v && v.selected) || []) : (v != null ? [v] : []); arr.forEach(o => { if (!opts.includes(o)) opts.push(o); }); });
      items = opts.map(o => ({ label: o, n: base.filter(p => { const v = (p.survey || {})[q.id]; return q.type === "multi" ? !!(v && (v.selected || []).includes(o)) : v === o; }).length }));
      if (q.type === "multi") items.push({ label: q.other_label || "Diğer", n: base.filter(p => { const v = (p.survey || {})[q.id]; return v && String(v.other || "").trim(); }).length });
    }
    const blank = base.filter(p => !answeredQ(p, q)).length;
    if (blank) items.push({ label: "Yanıtsız", n: blank });
    return `<div class="mini-chart"><h4>${esc(q.question)}${q.type === "multi" ? ` <span class="muted" style="font-weight:400">(çoklu)</span>` : ""}</h4>${hbars(items, base.length)}</div>`;
  }).join("")}</div>`;
}

function columns(items){
  if (!items.length) return `<p class="muted">Henüz veri yok.</p>`;
  const max = Math.max(1, ...items.map(i => i.n));
  return `<div class="cols">${items.map(i => `<div class="col"><span class="cap num">${i.n || ""}</span><div class="bar" style="height:${i.n / max * 100}%" data-tip="${esc(i.tip || i.label)}: ${i.n}"></div></div>`).join("")}</div>
    <div class="col-x">${items.map((i, k) => `<span>${items.length > 14 && k % Math.ceil(items.length / 10) ? "" : esc(i.label)}</span>`).join("")}</div>`;
}
function chartDaily(used){
  if (!used.length) return columns([]);
  const key = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const counts = {}; used.forEach(p => { const k = key(p.started_at); counts[k] = (counts[k] || 0) + 1; });
  const keys = Object.keys(counts).sort();
  const items = [];
  for (let d = new Date(keys[0] + "T12:00:00"); key(d) <= keys[keys.length - 1] && items.length < 120; d.setDate(d.getDate() + 1)) {
    const k = key(d); items.push({ label: `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`, tip: fmtDate(d.toISOString()).slice(0, 10), n: counts[k] || 0 });
  }
  return columns(items);
}
function chartDurations(secs){
  const v = secs.filter(s => s != null);
  if (!v.length) return columns([]);
  const maxMin = Math.ceil(Math.max(...v) / 60);
  const step = maxMin <= 20 ? 2 : maxMin <= 60 ? 5 : 10;
  const items = [];
  for (let a = 0; a < Math.max(maxMin, step); a += step) items.push({ label: `${a}–${a + step}`, tip: `${a}–${a + step} dk`, n: v.filter(s => s / 60 >= a && s / 60 < a + step).length });
  return columns(items);
}
function customCardsPanel(base){
  const rows = [];
  base.forEach(p => (p.sorts || []).filter(s => s.is_custom).forEach(s => rows.push({ code: p.code, dept: p.department, text: s.card_text, group: s.group, label: s.group_label })));
  if (!rows.length) return "";
  return `<div class="panel"><h3>Katılımcıların boş karta yazdıkları</h3><p class="sub">${rows.length} kart</p>
    <div class="tbl-wrap"><table><thead><tr><th>Kod</th><th>Bölüm</th><th>Kart metni</th><th>Grup</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td class="code">${esc(r.code)}</td><td>${esc(deptLabel(r.dept))}</td><td>${esc(r.text)}</td><td>${r.group ? `<span class="swatch" style="--c:${seriesVar(r.group)}"></span>${esc(groupLabel(r.group, r.label))}` : "–"}</td></tr>`).join("")}</tbody></table></div></div>`;
}

/* ===== Katılımcılar ===== */
function filteredParticipants(){
  const f = F.pt, q = f.q.trim().toUpperCase();
  return D.participants.filter(p =>
    (!q || p.code.includes(q)) &&
    (f.status === "all" || (f.status === "used" ? p.status !== "available" && p.status !== "reserved" : p.status === f.status)) &&
    (!f.batch || (p.batch || "") === f.batch)
  ).sort((a, b) => (Date.parse(b.started_at || b.reserved_at || b.created_at) - Date.parse(a.started_at || a.reserved_at || a.created_at)) || a.code.localeCompare(b.code));
}
function viewParticipants(){
  const f = F.pt;
  const rows = filteredParticipants();
  const batches = [...new Set(D.participants.map(p => p.batch || ""))].filter(Boolean).sort();
  const counts = Object.fromEntries(Object.keys(STATUS).map(s => [s, D.participants.filter(p => p.status === s).length]));
  return `
  <div class="sec-head"><div><h2>Katılımcılar</h2><p>Kimlik bilgisi tutulmaz; her katılımcı yalnızca koduyla izlenir. Öğrenci ekranı açıldığında havuzdaki boş kodlardan biri otomatik verilir, havuz biterse sistem yeni kod üretir.</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="btnAddOne" type="button">Tek kod ekle</button>
      <button class="btn" id="btnGen" type="button">Toplu kod üret</button>
      <button class="btn" id="btnImport" type="button">Listeden kod yükle</button>
      <button class="btn btn-primary" id="btnXlsP" type="button">Excel indir</button>
    </div></div>
  <div class="toolbar">
    <label class="grow">Kod ara<input type="search" data-f="pt.q" value="${esc(f.q)}" placeholder="ör. K7M3"></label>
    <label>Durum<select data-f="pt.status">
      <option value="used" ${f.status === "used" ? "selected" : ""}>Giriş yapanlar (${counts.in_progress + counts.completed + counts.withdrawn})</option>
      <option value="all" ${f.status === "all" ? "selected" : ""}>Tüm kodlar (${D.participants.length})</option>
      ${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${l} (${counts[k]})</option>`).join("")}
    </select></label>
    <label>Etiket<select data-f="pt.batch"><option value="">Tümü</option>${batches.map(b => `<option ${f.batch === b ? "selected" : ""}>${esc(b)}</option>`).join("")}</select></label>
  </div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>Kod</th><th>Durum</th><th>Bölüm</th><th>Etiket</th><th>Giriş</th><th>Bilgi formu</th><th>Kart</th><th>Sıralama süresi</th><th>Toplam süre</th><th>Son etkinlik</th><th><span class="sr">İşlemler</span></th></tr></thead>
    <tbody>${rows.slice(0, f.limit).map(p => { const i = info(p); return `<tr>
      <td class="code">${esc(p.code)}</td>
      <td><span class="chip ${p.status}">${STATUS[p.status]}</span></td>
      <td>${esc(deptLabel(p.department))}</td>
      <td>${esc(p.batch || "")}</td>
      <td class="num">${fmtDate(p.started_at)}</td>
      <td class="num">${p.started_at ? `${i.answered} / ${i.totalQ}` : ""}</td>
      <td class="num">${i.totalCards ? `${i.placed} / ${i.totalCards}${i.custom ? ` <span class="muted">(+${i.custom} boş)</span>` : ""}` : ""}</td>
      <td class="num">${fmtDur(i.sortSec)}</td>
      <td class="num">${fmtDur(i.totalSec)}</td>
      <td class="num">${fmtDate(p.last_seen_at)}</td>
      <td class="acts"><button class="btn btn-sm" data-detail="${esc(p.code)}" type="button">Detay</button><button class="btn btn-sm" data-edit="${esc(p.code)}" type="button">Düzenle</button></td>
    </tr>`; }).join("") || `<tr><td colspan="11" class="muted" style="padding:20px">Bu filtrede kayıt yok.</td></tr>`}</tbody>
  </table>${rows.length > f.limit ? `<div class="more-row"><button class="btn" data-more="pt" type="button">Daha fazla göster (${rows.length - f.limit} kaldı)</button></div>` : ""}</div>`;
}

function participantDetail(code){
  const p = D.participants.find(p => p.code === code); if (!p) return;
  const i = info(p);
  const logs = D.logs.filter(l => l.code === code);
  const gids = groupIdsIn([p]);
  const sorts = p.sorts || [];
  const qs = D.survey.filter(q => q.active || (p.survey || {})[q.id] !== undefined);
  openDlg(`<div class="dlg">
    <h2>Katılımcı ${esc(p.code)} <span class="chip ${p.status}" style="vertical-align:3px">${STATUS[p.status]}</span></h2>
    <dl class="kv">
      <dt>Bölüm</dt><dd>${esc(deptLabel(p.department)) || "–"}</dd>
      <dt>Etiket</dt><dd>${esc(p.batch || "–")}</dd>
      <dt>Kod gösterildi</dt><dd>${fmtDate(p.reserved_at, true) || "–"}</dd>
      <dt>Giriş (onam)</dt><dd>${fmtDate(p.started_at, true) || "–"}</dd>
      <dt>Bilgi formu bitti</dt><dd>${fmtDate(p.survey_completed_at, true) || "–"} ${i.surveySec != null ? `<span class="muted">(${fmtDur(i.surveySec)})</span>` : ""}</dd>
      <dt>Sıralama başladı</dt><dd>${fmtDate(p.sort_started_at, true) || "–"}</dd>
      <dt>Tamamlandı</dt><dd>${fmtDate(p.completed_at, true) || "–"} ${i.sortSec != null ? `<span class="muted">(sıralama ${fmtDur(i.sortSec)})</span>` : ""}</dd>
      ${p.withdrawn_at ? `<dt>Sonlandırıldı</dt><dd>${fmtDate(p.withdrawn_at, true)}</dd>` : ""}
      <dt>Toplam süre</dt><dd>${fmtDur(i.totalSec) || "–"}</dd>
      <dt>Yanıtlanan soru</dt><dd>${i.answered} / ${i.totalQ}</dd>
      <dt>Yerleştirilen kart</dt><dd>${i.placed} / ${i.totalCards}${i.custom ? ` (${i.custom} boş kart dahil)` : ""}</dd>
      <dt>Son etkinlik</dt><dd>${fmtDate(p.last_seen_at, true) || "–"}</dd>
    </dl>
    <div class="det-grid">
      <section><h3>Bilgi formu</h3><ul class="ans">${qs.map(q => `<li><b>${esc(q.question)}</b>${esc(answerText(p, q)) || `<span class="muted">Yanıtsız</span>`}</li>`).join("")}</ul></section>
      <section><h3>Kart sıralaması</h3>${sorts.length ? gids.map(g => { const list = sorts.filter(s => s.group === g); return list.length ? `<div class="gsec"><h4><span class="swatch" style="--c:${seriesVar(g)}"></span>${esc(groupLabel(g, list[0].group_label))} (${list.length})</h4><ul>${list.map(s => `<li>${s.is_custom ? "<i>" : ""}${esc(s.card_text)}${s.is_custom ? "</i>" : ""}${s.changes ? ` <span class="muted">(${s.changes} kez taşındı)</span>` : ""}</li>`).join("")}</ul></div>` : ""; }).join("") + (sorts.some(s => !s.group) ? `<div class="gsec"><h4>Yerleştirilmedi (${sorts.filter(s => !s.group).length})</h4></div>` : "") : `<p class="muted">Henüz kart yok.</p>`}</section>
    </div>
    <h3 style="font-size:16px;margin:16px 0 8px">Log kayıtları (${logs.length})</h3>
    <div class="timeline tbl-wrap"><table><thead><tr><th>Zaman</th><th>Olay</th><th>Ayrıntı</th></tr></thead>
      <tbody>${logs.map(l => `<tr><td class="num">${fmtDate(l.created_at, true)}</td><td>${esc(EVENTS[l.type] || l.type)}</td><td>${esc(logDetail(l))}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Kayıt yok</td></tr>`}</tbody></table></div>
    <div class="row">
      <button class="btn btn-danger left" data-reset="${esc(p.code)}" type="button">Kodu sıfırla</button>
      <button class="btn" data-xls-one="${esc(p.code)}" type="button">Excel indir</button>
      <button class="btn" data-edit="${esc(p.code)}" type="button">Düzenle</button>
      <button class="btn btn-primary" data-close type="button">Kapat</button>
    </div></div>`, true);
}

function participantForm(code){
  const p = code ? D.participants.find(p => p.code === code) : null;
  const batches = [...new Set(D.participants.map(p => p.batch).filter(Boolean))];
  openDlg(`<form class="dlg" id="ptForm" novalidate>
    <h2>${p ? `Kodu düzenle: ${esc(p.code)}` : "Tek kod ekle"}</h2>
    <p>${p ? "Bölüm ve etiketi değiştirebilir, durumu elle düzeltebilirsiniz." : "Kodu boş bırakırsanız sistem eşsiz bir kod üretir."}</p>
    ${p ? "" : `<label class="f"><span>Kod (isteğe bağlı)</span><input type="text" id="ptCode" maxlength="12" autocomplete="off" style="text-transform:uppercase" placeholder="Otomatik"><small>3–12 karakter; yalnızca A–Z harfleri ve rakamlar.</small></label>`}
    <div class="row2">
      <label class="f"><span>Bölüm</span><select id="ptDept"><option value="">Belirtilmemiş</option>${D.departments.map(d => `<option value="${esc(d.id)}" ${p && p.department === d.id ? "selected" : ""}>${esc(d.label)}</option>`).join("")}</select></label>
      <label class="f"><span>Etiket</span><input type="text" id="ptBatch" list="batchList" maxlength="60" value="${esc(p ? p.batch : "")}" placeholder="ör. Pilot"><datalist id="batchList">${batches.map(b => `<option value="${esc(b)}">`).join("")}</datalist></label>
    </div>
    ${p ? `<label class="f"><span>Durum</span><select id="ptStatus">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${l}</option>`).join("")}</select><small>Yanıtları silip kodu havuza döndürmek için “Kodu sıfırla”yı kullanın.</small></label>` : ""}
    <p class="muted" style="font-size:13.5px">Etikete ad, e-posta gibi kimlik bilgisi yazmayın.</p>
    <div class="err" id="ptErr"></div>
    <div class="row">
      ${p ? `<button class="btn btn-danger left" data-delete-code="${esc(p.code)}" type="button">Kodu sil</button>` : ""}
      <button class="btn" data-close type="button">Vazgeç</button>
      <button class="btn btn-primary" type="submit">Kaydet</button>
    </div>
  </form>`);
  $("#ptForm").onsubmit = async e => {
    e.preventDefault();
    const dept = $("#ptDept").value || null, batch = $("#ptBatch").value.trim() || null;
    try {
      if (p) {
        const { error } = await sb.from("participants").update({ department: dept, batch, status: $("#ptStatus").value }).eq("code", p.code);
        if (error) throw error;
        toast("Kaydedildi.");
      } else {
        let code = $("#ptCode").value.trim().toLocaleUpperCase("en");
        if (code && !/^[A-Z0-9]{3,12}$/.test(code)) { $("#ptErr").textContent = "Kod 3–12 karakter olmalı ve yalnızca A–Z harfleri ile rakamlardan oluşmalı."; return; }
        if (code) {
          const { error } = await sb.from("participants").insert({ code, department: dept, batch });
          if (error) { $("#ptErr").textContent = error.code === "23505" ? "Bu kod zaten var." : errMsg(error); return; }
        } else {
          const { data, error } = await sb.rpc("admin_generate_codes", { n: 1, p_batch: batch });
          if (error) throw error;
          code = data[0];
          if (dept) await sb.from("participants").update({ department: dept }).eq("code", code);
        }
        toast(`${code} kodu eklendi.`);
      }
      closeDlg(); reload("data");
    } catch (err) { $("#ptErr").textContent = errMsg(err); }
  };
}

function generateForm(){
  openDlg(`<form class="dlg" id="genForm" novalidate>
    <h2>Toplu kod üret</h2>
    <p>Kodlar harf-rakam-harf-rakam düzenindedir (ör. K7M3). Karışabilecek 0/O ve 1/I/L kullanılmaz, kodlar anlamlı kelime oluşturmaz.</p>
    <div class="row2">
      <label class="f"><span>Kaç kod?</span><input type="number" id="genN" min="1" max="1000" value="100"></label>
      <label class="f"><span>Etiket (isteğe bağlı)</span><input type="text" id="genBatch" maxlength="60" placeholder="ör. Ana uygulama"></label>
    </div>
    <div class="err" id="genErr"></div>
    <div id="genOut"></div>
    <div class="row"><button class="btn" data-close type="button">Kapat</button><button class="btn btn-primary" type="submit" id="genBtn">Üret</button></div>
  </form>`);
  $("#genForm").onsubmit = async e => {
    e.preventDefault();
    const n = parseInt($("#genN").value, 10), batch = $("#genBatch").value.trim();
    if (!(n >= 1 && n <= 1000)) { $("#genErr").textContent = "1 ile 1000 arasında bir sayı girin."; return; }
    $("#genBtn").disabled = true;
    const { data, error } = await sb.rpc("admin_generate_codes", { n, p_batch: batch || null });
    $("#genBtn").disabled = false;
    if (error) { $("#genErr").textContent = errMsg(error); return; }
    $("#genErr").textContent = "";
    $("#genOut").innerHTML = `<p><b>${data.length} kod üretildi.</b></p><div class="codes-out">${data.map(esc).join(" ")}</div>
      <div class="row" style="justify-content:flex-start"><button class="btn" id="genXls" type="button">Bu kodları Excel’e indir</button></div>`;
    $("#genXls").onclick = () => downloadBook(`kodlar-${stamp()}`, [["Kodlar", data.map(c => ({ "Kod": c, "Etiket": batch }))]]);
    reload("data");
  };
}

function importForm(){
  openDlg(`<form class="dlg" id="impForm" novalidate>
    <h2>Listeden kod yükle</h2>
    <p>Excel (.xlsx) ya da CSV dosyası seçin. İlk satır başlık olmalı: <b>kod</b> sütunu zorunlu, <b>bölüm</b> (ör. YM, BOTE) ve <b>etiket</b> sütunları isteğe bağlı. Ad, e-posta, telefon gibi başka sütunlar okunmaz ve kaydedilmez. Var olan kodlar atlanır.</p>
    <label class="f"><span>Dosya</span><input type="file" id="impFile" accept=".xlsx,.xls,.csv"></label>
    <div class="err" id="impErr"></div>
    <div id="impOut"></div>
    <div class="row"><button class="btn" id="impTpl" type="button">Örnek şablon indir</button><button class="btn" data-close type="button">Kapat</button><button class="btn btn-primary" type="submit" id="impBtn">Yükle</button></div>
  </form>`);
  $("#impTpl").onclick = () => downloadBook("kod-sablonu", [["Kodlar", [{ kod: "K7M3", "bölüm": "YM", etiket: "Pilot" }, { kod: "", "bölüm": "", etiket: "" }]]]);
  $("#impForm").onsubmit = async e => {
    e.preventDefault();
    const file = $("#impFile").files[0];
    if (!file) { $("#impErr").textContent = "Bir dosya seçin."; return; }
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const norm = k => k.toString().trim().toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
      const pick = (row, names) => { for (const k of Object.keys(row)) if (names.includes(norm(k))) return String(row[k]).trim(); return ""; };
      const deptIds = new Map(D.departments.flatMap(d => [[norm(d.id), d.id], [norm(d.label), d.id]]));
      const bad = [], rows = [], seen = new Set();
      raw.forEach((r, i) => {
        const code = pick(r, ["kod", "code", "katilimci kodu"]).toLocaleUpperCase("en");
        if (!code) return;
        if (!/^[A-Z0-9]{3,12}$/.test(code) || seen.has(code)) { bad.push(`${i + 2}. satır: ${code}`); return; }
        seen.add(code);
        const d = pick(r, ["bolum", "department"]);
        rows.push({ code, department: d ? (deptIds.get(norm(d)) || null) : null, batch: pick(r, ["etiket", "batch", "grup"]) || null });
      });
      if (!rows.length) { $("#impErr").textContent = "Dosyada geçerli kod bulunamadı. İlk satırda “kod” başlığı olduğundan emin olun."; return; }
      $("#impBtn").disabled = true;
      let added = 0;
      for (let k = 0; k < rows.length; k += 500) {
        const { data, error } = await sb.from("participants").upsert(rows.slice(k, k + 500), { onConflict: "code", ignoreDuplicates: true }).select("code");
        if (error) throw error;
        added += data.length;
      }
      $("#impBtn").disabled = false; $("#impErr").textContent = "";
      $("#impOut").innerHTML = `<div class="notice"><b>${added} kod eklendi.</b> ${rows.length - added ? `${rows.length - added} kod zaten vardı, atlandı.` : ""} ${bad.length ? `<br>${bad.length} satır geçersiz ya da dosyada tekrarlanıyor: ${esc(bad.slice(0, 8).join(", "))}${bad.length > 8 ? "…" : ""}` : ""}</div>`;
      reload("data");
    } catch (err) { $("#impBtn").disabled = false; $("#impErr").textContent = "Dosya okunamadı: " + errMsg(err); }
  };
}

/* ===== Loglar ===== */
function logDetail(l){
  const parts = [];
  if (l.card_id) parts.push(l.card_id);
  if (l.from_group || l.to_group) parts.push(`${l.from_group ? groupLabel(l.from_group) : "deste"} → ${l.to_group ? groupLabel(l.to_group) : "deste"}`);
  const d = l.data || {};
  if (d.text) parts.push(`“${d.text}”`);
  if (d.answered != null) parts.push(`${d.answered}/${d.total} soru yanıtlandı`);
  if (d.stage) parts.push(`aşama: ${({ survey: "bilgi formu", intro: "tanıtım", sort: "kart sıralama" })[d.stage] || d.stage}`);
  if (l.client_t != null && ["place", "move", "undo", "add_blank", "remove_blank", "complete"].includes(l.type)) parts.push(`+${fmtDur(Math.round(l.client_t / 1000))}`);
  return parts.join(" · ");
}
function filteredLogs(){
  const f = F.lg, q = f.q.trim().toUpperCase();
  const from = f.from ? Date.parse(f.from + "T00:00:00") : null, to = f.to ? Date.parse(f.to + "T23:59:59") : null;
  return D.logs.filter(l => (!q || (l.code || "").includes(q)) && (!f.type || l.type === f.type) &&
    (from == null || Date.parse(l.created_at) >= from) && (to == null || Date.parse(l.created_at) <= to)).reverse();
}
function viewLogs(){
  const f = F.lg, rows = filteredLogs();
  const types = [...new Set(D.logs.map(l => l.type))];
  return `
  <div class="sec-head"><div><h2>Log kayıtları</h2><p>Sunucu saatine göre en yeni kayıt üstte. “+süre” kart sıralamanın başından itibaren geçen süredir.</p></div>
    <button class="btn btn-primary" id="btnXlsL" type="button">Excel indir (${rows.length})</button></div>
  <div class="toolbar">
    <label class="grow">Kod<input type="search" data-f="lg.q" value="${esc(f.q)}" placeholder="ör. K7M3"></label>
    <label>Olay<select data-f="lg.type"><option value="">Tümü</option>${types.map(t => `<option value="${esc(t)}" ${f.type === t ? "selected" : ""}>${esc(EVENTS[t] || t)}</option>`).join("")}</select></label>
    <label>Başlangıç<input type="date" data-f="lg.from" value="${esc(f.from)}"></label>
    <label>Bitiş<input type="date" data-f="lg.to" value="${esc(f.to)}"></label>
  </div>
  <div class="tbl-wrap"><table><thead><tr><th>Zaman</th><th>Kod</th><th>Olay</th><th>Ayrıntı</th></tr></thead>
    <tbody>${rows.slice(0, f.limit).map(l => `<tr><td class="num">${fmtDate(l.created_at, true)}</td><td class="code">${l.code ? `<button class="link" data-detail="${esc(l.code)}" type="button">${esc(l.code)}</button>` : "–"}</td><td>${esc(EVENTS[l.type] || l.type)}</td><td>${esc(logDetail(l))}</td></tr>`).join("") || `<tr><td colspan="4" class="muted" style="padding:20px">Bu filtrede kayıt yok.</td></tr>`}</tbody>
  </table>${rows.length > f.limit ? `<div class="more-row"><button class="btn" data-more="lg" type="button">Daha fazla göster (${rows.length - f.limit} kaldı)</button></div>` : ""}</div>`;
}

/* ===== İçerik (CRUD) ===== */
const CT = {
  cards: { table: "cards", title: "Kartlar", one: "kart" },
  survey: { table: "survey_questions", title: "Bilgi formu", one: "soru" },
  groups: { table: "groups", title: "Gruplar", one: "grup" },
  departments: { table: "departments", title: "Bölümler", one: "bölüm" },
};
const listOf = k => k === "survey" ? D.survey : D[k];
function contentHead(){
  const tabs = [...Object.entries(CT).map(([id, c]) => [id, c.title, listOf(id).length])];
  tabs.splice(1, 0, ["categories", "Uygulama grupları", categories().length]);
  return `<div class="sec-head"><div><h2>İçerik</h2><p>Öğrenci ekranı bu içerikleri her açılışta veri tabanından okur. Değişiklikler yeni başlayan oturumlara yansır; başlamış oturumlar kendi kartlarıyla devam eder. Yanıtlarda kart ve grup metinlerinin o anki kopyası saklandığı için silme ve düzenleme eski verileri bozmaz.</p></div></div>
  <div class="subtabs" role="tablist">${tabs.map(([id, t, n]) => `<button type="button" role="tab" data-ctab="${id}" aria-selected="${ctab === id}">${t} (${n})</button>`).join("")}</div>`;
}

function viewCategories(){
  const cats = categories();
  const unset = D.cards.filter(c => !c.level);
  return `<div class="notice">Uygulama grubu öğrenciye gösterilmez; analizlerde ve Excel çıktılarında kullanılır. Yeni grup, kart eklerken ya da düzenlerken “+ Yeni uygulama grubu…” seçilerek oluşturulur. Yeniden adlandırma o gruptaki bütün kartları günceller; var olan bir grubun adını yazarsanız iki grup birleşir. Analizler her zaman kartın güncel uygulama grubunu kullanır.</div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>Uygulama grubu</th><th>Kart sayısı</th><th>Kartlar</th><th><span class="sr">İşlemler</span></th></tr></thead>
    <tbody>${cats.map(c => { const list = D.cards.filter(x => x.level === c); return `<tr>
      <td><b>${esc(c)}</b></td><td class="num">${list.length}</td>
      <td>${list.map(x => `<span class="muted">${esc(x.id)}</span> ${esc(x.text)}`).join("<br>")}</td>
      <td class="acts"><button class="btn btn-sm" data-cat-rename="${esc(c)}" type="button">Yeniden adlandır</button></td></tr>`; }).join("")}
    ${unset.length ? `<tr><td><b>Belirtilmemiş</b></td><td class="num">${unset.length}</td><td>${unset.map(x => `<span class="muted">${esc(x.id)}</span> ${esc(x.text)}`).join("<br>")}</td><td></td></tr>` : ""}</tbody>
  </table></div>`;
}
function renameCategory(old){
  const n = D.cards.filter(c => c.level === old).length;
  openDlg(`<form class="dlg" id="catForm" novalidate>
    <h2>Uygulama grubunu yeniden adlandır</h2>
    <p>“${esc(old)}” grubundaki ${n} kartın tamamı güncellenir.</p>
    <label class="f"><span>Yeni ad</span><input type="text" id="catName" maxlength="80" value="${esc(old)}" list="catList"><datalist id="catList">${categories().filter(c => c !== old).map(c => `<option value="${esc(c)}">`).join("")}</datalist></label>
    <div class="err" id="catErr"></div>
    <div class="row"><button class="btn" data-close type="button">Vazgeç</button><button class="btn btn-primary" type="submit">Kaydet</button></div>
  </form>`);
  $("#catForm").onsubmit = async e => {
    e.preventDefault();
    const name = $("#catName").value.trim().replace(/\s+/g, " ");
    if (!name) { $("#catErr").textContent = "Bir ad yazın."; return; }
    if (name === old) { closeDlg(); return; }
    const { error } = await sb.from("cards").update({ level: name }).eq("level", old);
    if (error) { $("#catErr").textContent = errMsg(error); return; }
    closeDlg(); toast(categories().includes(name) ? `“${old}”, “${name}” ile birleştirildi.` : "Yeniden adlandırıldı."); reload("content");
  };
}

function viewContent(){
  if (ctab === "categories") return contentHead() + viewCategories();
  const k = ctab, list = listOf(k);
  const head = { cards: ["Kod", "Kart metni", "Uygulama grubu", "Bölüm"], survey: ["Anahtar", "Soru", "Tür", "Seçenekler"], groups: ["Kod", "Grup", "Açıklama", "Renk"], departments: ["Kod", "Bölüm adı", "Kart sayısı"] }[k];
  const cells = r => k === "cards" ? [r.id, r.text, r.level, deptLabel(r.dept)]
    : k === "survey" ? [r.id, r.question + (r.required && r.type !== "dept" ? " *" : ""), QTYPES[r.type], (r.options || []).join(" · ") + (r.follow ? ` → takip: “${r.follow.q}”` : "")]
    : k === "groups" ? [r.id, r.label, r.description, `<span class="swatch" style="--c:var(--${r.color})"></span>`]
    : [r.id, r.label, D.cards.filter(c => c.dept === r.id).length];
  return `${contentHead()}
  ${k === "groups" ? `<div class="notice">Veri toplanmaya başladıktan sonra grup eklemek, silmek ya da anlamını değiştirmek analizleri karşılaştırılamaz hale getirir. Gerekirse yalnızca yazım düzeltmesi yapın. Öğrenci ekranında grup kısayolları (1, 2, 3…) buradaki sıraya göre verilir.</div>` : ""}
  ${k === "survey" ? `<div class="notice">“Bölüm” türündeki soru öğrencinin göreceği kart destesini belirler ve her zaman zorunludur. Formda yalnızca bir tane olmalı.</div>` : ""}
  <div class="toolbar"><button class="btn btn-primary" data-new="${k}" type="button">Yeni ${CT[k].one} ekle</button></div>
  <div class="tbl-wrap"><table>
    <thead><tr><th>Sıra</th>${head.map(h => `<th>${h}</th>`).join("")}<th>Durum</th><th><span class="sr">İşlemler</span></th></tr></thead>
    <tbody>${list.map((r, i) => `<tr>
      <td class="acts" style="text-align:left"><button class="btn btn-sm" data-move="${k}|${esc(r.id)}|-1" ${i === 0 ? "disabled" : ""} aria-label="Yukarı taşı" type="button">↑</button><button class="btn btn-sm" data-move="${k}|${esc(r.id)}|1" ${i === list.length - 1 ? "disabled" : ""} aria-label="Aşağı taşı" type="button">↓</button></td>
      ${cells(r).map((c, j) => `<td>${k === "groups" && j === 3 ? c : esc(c)}</td>`).join("")}
      <td><button class="chip ${r.active ? "completed" : "off"}" data-toggle-active="${k}|${esc(r.id)}" type="button" title="Durumu değiştir">${r.active ? "Aktif" : "Pasif"}</button></td>
      <td class="acts"><button class="btn btn-sm" data-cedit="${k}|${esc(r.id)}" type="button">Düzenle</button><button class="btn btn-sm btn-danger" data-cdel="${k}|${esc(r.id)}" type="button">Sil</button></td>
    </tr>`).join("") || `<tr><td colspan="8" class="muted" style="padding:20px">Kayıt yok.</td></tr>`}</tbody>
  </table></div>`;
}

function nextCardId(){
  const nums = D.cards.map(c => /^K(\d+)$/.exec(c.id)).filter(Boolean).map(m => +m[1]);
  return "K" + pad((nums.length ? Math.max(...nums) : 0) + 1);
}
function contentForm(k, id){
  const r = id ? listOf(k).find(x => x.id === id) : null;
  const deptOpts = sel => `<option value="all" ${sel === "all" ? "selected" : ""}>Tüm bölümler</option>${D.departments.map(d => `<option value="${esc(d.id)}" ${sel === d.id ? "selected" : ""}>${esc(d.label)}</option>`).join("")}`;
  const idField = (label, val, hint, pattern) => `<label class="f"><span>${label}</span><input type="text" id="cId" value="${esc(val)}" ${r ? "readonly" : ""} maxlength="40" autocomplete="off" data-pattern="${pattern}"><small>${r ? "Kod yanıtlarla eşleştiği için değiştirilemez." : hint}</small></label>`;
  let fields = "";
  if (k === "cards") {
    const cats = categories(), cur = r ? r.level : "";
    fields = `${idField("Kart kodu", r ? r.id : nextCardId(), "ör. K29 ya da B03", "^[A-Za-z0-9_-]{1,20}$")}
      <label class="f"><span>Kart metni</span><textarea id="cText" maxlength="200" required>${esc(r ? r.text : "")}</textarea></label>
      <div class="row2">
        <label class="f"><span>Uygulama grubu</span><select id="cLevel">
          <option value="">Seçin…</option>
          ${cats.map(c => `<option value="${esc(c)}" ${cur === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
          <option value="__new">+ Yeni uygulama grubu…</option>
        </select><small>Öğrenciye gösterilmez; analizlerde kullanılır.</small></label>
        <label class="f"><span>Hangi bölüme gösterilsin?</span><select id="cDept">${deptOpts(r ? r.dept : "all")}</select></label>
      </div>
      <label class="f" id="cNewCatWrap" hidden><span>Yeni uygulama grubunun adı</span><input type="text" id="cNewCat" maxlength="80" placeholder="ör. Öz düzenleme: kaynak yönetimi"></label>`;
  } else if (k === "survey") {
    const t = r ? r.type : "single";
    fields = `${idField("Anahtar", r ? r.id : "", "Küçük harf, rakam ve alt çizgi; ör. ai_usage. Excel sütun adı olarak kullanılır.", "^[a-z][a-z0-9_]{0,39}$")}
      <label class="f"><span>Soru</span><textarea id="cQ" maxlength="300" required style="min-height:60px">${esc(r ? r.question : "")}</textarea></label>
      <div class="row2">
        <label class="f"><span>Tür</span><select id="cType">${Object.entries(QTYPES).map(([v, l]) => `<option value="${v}" ${t === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="chk" style="margin-top:28px"><input type="checkbox" id="cReq" ${r && r.required ? "checked" : ""}> Zorunlu soru</label>
      </div>
      <label class="f" data-show="single multi"><span>Seçenekler</span><textarea id="cOpts" placeholder="Her satıra bir seçenek">${esc(r ? (r.options || []).join("\n") : "")}</textarea></label>
      <label class="f"><span>Açıklama (isteğe bağlı)</span><input type="text" id="cHint" maxlength="200" value="${esc(r ? r.hint : "")}"></label>
      <label class="f" data-show="multi"><span>“Diğer” kutusunun etiketi</span><input type="text" id="cOther" maxlength="60" value="${esc(r ? r.other_label : "")}" placeholder="ör. Diğer araçlar (boş bırakılırsa “Diğer”)"></label>
      <fieldset data-show="single" style="border:1px solid var(--line);border-radius:10px;padding:10px 12px 0;margin:0 0 12px">
        <legend style="font-weight:700;font-size:14.5px;padding:0 4px">Takip sorusu (isteğe bağlı)</legend>
        <div class="row2">
          <label class="f"><span>Hangi seçenekte gösterilsin?</span><input type="text" id="cFWhen" value="${esc(r && r.follow ? r.follow.when : "")}" placeholder="ör. Aldım"></label>
          <label class="f"><span>Anahtar</span><input type="text" id="cFId" value="${esc(r && r.follow ? r.follow.id : "")}" placeholder="ör. ai_training_detail"></label>
        </div>
        <label class="f"><span>Takip sorusu metni</span><input type="text" id="cFQ" value="${esc(r && r.follow ? r.follow.q : "")}"></label>
      </fieldset>`;
  } else if (k === "groups") {
    const used = COLORS.filter(c => D.groups.some(g => g.color === c && g.id !== id));
    const col = r ? r.color : (COLORS.find(c => !used.includes(c)) || "g4");
    fields = `${idField("Grup kodu", r ? r.id : "", "Küçük harf ve rakam; ör. half", "^[a-z0-9_-]{1,20}$")}
      <label class="f"><span>Grup adı</span><input type="text" id="cLabel" maxlength="120" value="${esc(r ? r.label : "")}"></label>
      <label class="f"><span>Açıklama</span><textarea id="cDesc" maxlength="300" style="min-height:60px">${esc(r ? r.description : "")}</textarea></label>
      <fieldset class="f" style="border:0;padding:0;margin:0 0 12px"><legend style="font-weight:700;font-size:14.5px;margin-bottom:4px">Öğrenci ekranındaki renk</legend>
        <div class="colors">${COLORS.map(c => `<label title="${c}"><input type="radio" name="cColor" value="${c}" ${col === c ? "checked" : ""}><i style="--c:var(--${c})"></i><span class="sr">Renk ${c}${used.includes(c) ? " (kullanımda)" : ""}</span></label>`).join("")}</div></fieldset>`;
  } else {
    fields = `${idField("Bölüm kodu", r ? r.id : "", "ör. YM; kartlar bu kodla eşleşir", "^[A-Za-z0-9_-]{1,20}$")}
      <label class="f"><span>Bölüm adı</span><input type="text" id="cLabel" maxlength="120" value="${esc(r ? r.label : "")}"></label>`;
  }
  openDlg(`<form class="dlg" id="cForm" novalidate>
    <h2>${r ? "Düzenle" : "Yeni " + CT[k].one}</h2>
    ${fields}
    <label class="chk"><input type="checkbox" id="cActive" ${!r || r.active ? "checked" : ""}> Aktif (öğrenci ekranında görünür)</label>
    <div class="err" id="cErr"></div>
    <div class="row"><button class="btn" data-close type="button">Vazgeç</button><button class="btn btn-primary" type="submit">Kaydet</button></div>
  </form>`);
  const syncType = () => { const t = $("#cType"); if (!t) return; document.querySelectorAll("[data-show]").forEach(el => el.hidden = !el.dataset.show.split(" ").includes(t.value)); };
  if ($("#cType")) { $("#cType").onchange = syncType; syncType(); }
  if ($("#cLevel")) $("#cLevel").onchange = () => { const nw = $("#cLevel").value === "__new"; $("#cNewCatWrap").hidden = !nw; if (nw) $("#cNewCat").focus(); };
  $("#cForm").onsubmit = async e => {
    e.preventDefault();
    const err = m => { $("#cErr").textContent = m; };
    const idEl = $("#cId"), newId = idEl.value.trim();
    if (!new RegExp(idEl.dataset.pattern).test(newId)) return err("Kod/anahtar biçimi geçersiz.");
    if (!r && listOf(k).some(x => x.id === newId)) return err("Bu kod zaten kullanılıyor.");
    const row = { active: $("#cActive").checked };
    if (k === "cards") {
      const lv = $("#cLevel").value === "__new" ? $("#cNewCat").value.trim().replace(/\s+/g, " ") : $("#cLevel").value;
      Object.assign(row, { text: $("#cText").value.trim().replace(/\s+/g, " "), level: lv, dept: $("#cDept").value });
      if (row.text.length < 2) return err("Kart metnini yazın.");
      if (!lv) return err($("#cLevel").value === "__new" ? "Yeni uygulama grubunun adını yazın." : "Bir uygulama grubu seçin.");
    } else if (k === "survey") {
      const type = $("#cType").value;
      const opts = $("#cOpts").value.split("\n").map(s => s.trim()).filter(Boolean);
      Object.assign(row, { question: $("#cQ").value.trim(), type, required: type === "dept" || $("#cReq").checked, hint: $("#cHint").value.trim() || null,
        options: type === "single" || type === "multi" ? opts : [], other_label: type === "multi" ? ($("#cOther").value.trim() || null) : null, follow: null });
      if (!row.question) return err("Soru metnini yazın.");
      if ((type === "single" || type === "multi") && opts.length < 2) return err("En az iki seçenek yazın.");
      if (type === "dept" && D.survey.some(q => q.type === "dept" && q.id !== (r && r.id))) return err("Formda zaten bir “Bölüm” sorusu var.");
      const fw = $("#cFWhen").value.trim(), fid = $("#cFId").value.trim(), fq = $("#cFQ").value.trim();
      if (type === "single" && (fw || fid || fq)) {
        if (!fw || !fid || !fq) return err("Takip sorusu için üç alanı da doldurun ya da hepsini boş bırakın.");
        if (!opts.includes(fw)) return err("Takip sorusunun gösterileceği seçenek, seçeneklerden biriyle aynı yazılmalı.");
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(fid) || fid === newId) return err("Takip sorusu anahtarı geçersiz.");
        row.follow = { when: fw, id: fid, q: fq };
      }
    } else if (k === "groups") {
      Object.assign(row, { label: $("#cLabel").value.trim(), description: $("#cDesc").value.trim(), color: (document.querySelector('input[name="cColor"]:checked') || {}).value || "g4" });
      if (!row.label) return err("Grup adını yazın.");
    } else {
      row.label = $("#cLabel").value.trim();
      if (!row.label) return err("Bölüm adını yazın.");
    }
    let res;
    if (r) res = await sb.from(CT[k].table).update(row).eq("id", r.id);
    else res = await sb.from(CT[k].table).insert({ ...row, id: newId, sort_order: Math.max(0, ...listOf(k).map(x => x.sort_order)) + 1 });
    if (res.error) return err(errMsg(res.error));
    closeDlg(); toast("Kaydedildi."); reload("content");
  };
}

async function moveItem(k, id, dir){
  const list = listOf(k).slice(), i = list.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const upd = list.map((x, n) => ({ id: x.id, sort_order: n + 1 })).filter((x, n) => list[n].sort_order !== x.sort_order);
  const results = await Promise.all(upd.map(u => sb.from(CT[k].table).update({ sort_order: u.sort_order }).eq("id", u.id)));
  const bad = results.find(r => r.error); if (bad) toast(errMsg(bad.error));
  reload("content");
}
async function toggleActive(k, id){
  const r = listOf(k).find(x => x.id === id); if (!r) return;
  const { error } = await sb.from(CT[k].table).update({ active: !r.active }).eq("id", id);
  if (error) toast(errMsg(error)); else reload("content");
}
function deleteItem(k, id){
  const r = listOf(k).find(x => x.id === id); if (!r) return;
  let warn = "";
  if (k === "groups") { const n = D.participants.filter(p => Object.values(p.placements || {}).includes(id)).length; if (n) warn = `${n} katılımcı bu gruba kart koymuş. Yanıtlarındaki grup adı korunur, ancak bu grup analizlerde “silinmiş grup” olarak kalır. Silmek yerine pasif yapmayı düşünün.`; }
  if (k === "departments") { const n = D.cards.filter(c => c.dept === id).length; if (n) warn = `${n} kart bu bölüme bağlı; bölüm silinirse bu kartlar hiçbir öğrenciye gösterilmez.`; }
  if (k === "survey" && r.type === "dept") warn = "Bölüm sorusu silinirse öğrenciler yalnızca “Tüm bölümler” kartlarını görür.";
  confirmDlg(`Bu ${CT[k].one} silinsin mi?`, `“${r.label || r.text || r.question}” kalıcı olarak silinecek. ${warn}`, "Sil", async () => {
    const { error } = await sb.from(CT[k].table).delete().eq("id", id);
    if (error) toast(errMsg(error)); else { toast("Silindi."); reload("content"); }
  });
}

/* ===== Dışa aktarma ===== */
function stamp(){ const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; }
function downloadBook(name, sheets){
  const wb = XLSX.utils.book_new();
  sheets.forEach(([title, rows]) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "Kayıt yok": "" }]);
    const keys = Object.keys(rows[0] || { "Kayıt yok": "" });
    ws["!cols"] = keys.map(k => ({ wch: Math.min(60, Math.max(k.length + 2, ...rows.slice(0, 200).map(r => String(r[k] ?? "").length + 1))) }));
    XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  });
  XLSX.writeFile(wb, `${name}.xlsx`);
}
function rowsParticipants(list){
  return list.map(p => { const i = info(p); return {
    "Kod": p.code, "Durum": STATUS[p.status], "Bölüm": deptLabel(p.department), "Etiket": p.batch || "",
    "Kod gösterildi": xlDate(p.reserved_at), "Giriş (onam)": xlDate(p.started_at), "Bilgi formu bitti": xlDate(p.survey_completed_at),
    "Sıralama başladı": xlDate(p.sort_started_at), "Tamamlandı": xlDate(p.completed_at), "Sonlandırıldı": xlDate(p.withdrawn_at),
    "Bilgi formu süresi (sn)": i.surveySec ?? "", "Sıralama süresi (sn)": i.sortSec ?? "", "Toplam süre (sn)": i.totalSec ?? "",
    "Yanıtlanan soru": p.started_at ? i.answered : "", "Toplam soru": p.started_at ? i.totalQ : "",
    "Yerleştirilen kart": i.totalCards ? i.placed : "", "Toplam kart": i.totalCards || "", "Boş kart": i.custom || "",
    "Taşıma sayısı": Object.values(p.changes || {}).reduce((a, b) => a + b, 0) || "",
    "Son etkinlik": xlDate(p.last_seen_at),
  }; });
}
function rowsSurvey(list){
  const qs = D.survey.filter(q => q.active || list.some(p => (p.survey || {})[q.id] !== undefined));
  return list.filter(p => p.started_at).map(p => {
    const r = { "Kod": p.code, "Durum": STATUS[p.status] };
    qs.forEach(q => {
      if (q.type === "dept") { r[q.id] = deptLabel(p.department); return; }
      const v = (p.survey || {})[q.id];
      if (q.type === "multi") {
        (q.options || []).forEach(o => { r[`${q.id}: ${o}`] = v && (v.selected || []).includes(o) ? 1 : 0; });
        r[`${q.id}: ${q.other_label || "Diğer"}`] = (v && v.other) || "";
      } else r[q.id] = v ?? "";
      if (q.follow && q.follow.id) r[q.follow.id] = (p.survey || {})[q.follow.id] || "";
    });
    return r;
  });
}
function rowsSorts(list){
  const out = [];
  list.forEach(p => (p.sorts || []).forEach(s => out.push({
    "Kod": p.code, "Bölüm": deptLabel(p.department), "Durum": STATUS[p.status],
    "Kart kodu": s.is_custom ? "" : s.card_id, "Kart metni": s.card_text, "Uygulama grubu": s.is_custom ? CUSTOM_CAT : catOf(s.card_id, s.card_level), "Boş kart": s.is_custom ? 1 : 0,
    "Grup kodu": s.group || "", "Grup": s.group ? groupLabel(s.group, s.group_label) : "", "Taşıma sayısı": s.changes || 0,
    "Sunuluş sırası": s.is_custom ? "" : ((p.deck_order || []).indexOf(s.card_id) + 1 || ""),
  })));
  return out;
}
function rowsMatrix(list){
  const gids = groupIdsIn(list);
  const map = new Map();
  list.forEach(p => (p.sorts || []).forEach(s => {
    if (s.is_custom) return;
    if (!map.has(s.card_id)) map.set(s.card_id, { id: s.card_id, text: s.card_text, level: catOf(s.card_id, s.card_level), c: {}, n: 0 });
    const r = map.get(s.card_id); if (s.group) { r.c[s.group] = (r.c[s.group] || 0) + 1; r.n++; }
  }));
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id, "tr", { numeric: true })).map(r => {
    const o = { "Kart kodu": r.id, "Kart metni": r.text, "Uygulama grubu": r.level };
    gids.forEach(g => { o[groupLabel(g)] = r.c[g] || 0; });
    gids.forEach(g => { o[`% ${groupLabel(g)}`] = pct(r.c[g] || 0, r.n); });
    o["n"] = r.n; return o;
  });
}
function rowsCats(list){
  const gids = groupIdsIn(list);
  return catRows(list).map(r => {
    const o = { "Uygulama grubu": r.cat, "Kart sayısı": r.cat === CUSTOM_CAT ? "" : r.cards.size };
    gids.forEach(g => { o[groupLabel(g)] = r.counts[g] || 0; });
    gids.forEach(g => { o[`% ${groupLabel(g)}`] = pct(r.counts[g] || 0, r.n); });
    o["Yerleştirme"] = r.n; return o;
  });
}
function rowsLogs(list){
  return list.map(l => ({
    "Zaman (sunucu)": xlDate(l.created_at), "Zaman (cihaz)": xlDate(l.client_at), "Kod": l.code || "", "Olay kodu": l.type, "Olay": EVENTS[l.type] || l.type,
    "Kart": l.card_id || "", "Önceki grup": l.from_group || "", "Yeni grup": l.to_group || "",
    "Sıralamadan beri (sn)": l.client_t != null ? Math.round(l.client_t / 1000) : "", "Ayrıntı": l.data ? JSON.stringify(l.data) : "",
  }));
}
function viewExport(){
  const done = D.participants.filter(p => p.status === "completed").length;
  return `
  <div class="sec-head"><div><h2>Dışa aktar</h2><p>Excel dosyaları tarayıcıda oluşturulur; veriler başka bir yere gönderilmez. Dosyalarda kimlik bilgisi yoktur, yalnızca katılımcı kodları bulunur.</p></div></div>
  <div class="multi">
    <div class="panel"><h3>Tüm veriler</h3><p class="sub">Tek dosyada: Katılımcılar, Bilgi formu, Kart sıralamaları (uzun biçim), Kart × grup özeti, Uygulama grubu × grup özeti, Loglar.</p>
      <label class="chk"><input type="checkbox" id="xOnlyDone"> Yalnızca tamamlayanlar (${done})</label>
      <button class="btn btn-primary" id="btnXlsAll" type="button">Tümünü Excel’e indir</button></div>
    <div class="panel"><h3>Tek tek</h3><p class="sub">İhtiyaç duyduğunuz sayfayı ayrı dosya olarak indirin.</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button class="btn" data-xls="participants" type="button">Katılımcılar</button>
        <button class="btn" data-xls="survey" type="button">Bilgi formu</button>
        <button class="btn" data-xls="sorts" type="button">Kart sıralamaları</button>
        <button class="btn" data-xls="matrix" type="button">Kart ve uygulama grubu özetleri</button>
        <button class="btn" data-xls="logs" type="button">Loglar</button>
        <button class="btn" data-xls="codes" type="button">Boştaki kodlar</button>
      </div></div>
    <div class="panel"><h3>İçerik yedeği</h3><p class="sub">Kartlar, bilgi formu soruları, gruplar ve bölümler.</p>
      <button class="btn" data-xls="content" type="button">İçeriği Excel’e indir</button></div>
  </div>`;
}
function exportKind(kind){
  const only = $("#xOnlyDone") && $("#xOnlyDone").checked;
  const used = D.participants.filter(p => only ? p.status === "completed" : p.started_at);
  const s = stamp();
  if (kind === "all") return downloadBook(`kart-siralama-${s}`, [["Katılımcılar", rowsParticipants(used)], ["Bilgi formu", rowsSurvey(used)], ["Kart sıralamaları", rowsSorts(used)], ["Kart × grup", rowsMatrix(used.filter(p => p.status === "completed"))], ["Uygulama grubu × grup", rowsCats(used.filter(p => p.status === "completed"))], ["Loglar", rowsLogs(D.logs.filter(l => !only || used.some(p => p.code === l.code)))]]);
  if (kind === "participants") return downloadBook(`katilimcilar-${s}`, [["Katılımcılar", rowsParticipants(used)]]);
  if (kind === "survey") return downloadBook(`bilgi-formu-${s}`, [["Bilgi formu", rowsSurvey(used)]]);
  if (kind === "sorts") return downloadBook(`kart-siralamalari-${s}`, [["Kart sıralamaları", rowsSorts(used)]]);
  if (kind === "matrix") return downloadBook(`kart-grup-ozeti-${s}`, [["Kart × grup", rowsMatrix(D.participants.filter(p => p.status === "completed"))], ["Uygulama grubu × grup", rowsCats(D.participants.filter(p => p.status === "completed"))]]);
  if (kind === "logs") return downloadBook(`loglar-${s}`, [["Loglar", rowsLogs(D.logs)]]);
  if (kind === "codes") return downloadBook(`bos-kodlar-${s}`, [["Kodlar", D.participants.filter(p => p.status === "available").map(p => ({ "Kod": p.code, "Etiket": p.batch || "", "Oluşturuldu": xlDate(p.created_at) }))]]);
  if (kind === "content") return downloadBook(`icerik-${s}`, [
    ["Kartlar", D.cards.map(c => ({ "Sıra": c.sort_order, "Kod": c.id, "Metin": c.text, "Uygulama grubu": c.level, "Bölüm": deptLabel(c.dept), "Aktif": c.active ? 1 : 0 }))],
    ["Bilgi formu", D.survey.map(q => ({ "Sıra": q.sort_order, "Anahtar": q.id, "Soru": q.question, "Tür": QTYPES[q.type], "Seçenekler": (q.options || []).join(" | "), "Zorunlu": q.required ? 1 : 0, "Takip": q.follow ? `${q.follow.when} → ${q.follow.id}: ${q.follow.q}` : "", "Aktif": q.active ? 1 : 0 }))],
    ["Gruplar", D.groups.map(g => ({ "Sıra": g.sort_order, "Kod": g.id, "Ad": g.label, "Açıklama": g.description, "Renk": g.color, "Aktif": g.active ? 1 : 0 }))],
    ["Bölümler", D.departments.map(d => ({ "Sıra": d.sort_order, "Kod": d.id, "Ad": d.label, "Aktif": d.active ? 1 : 0 }))],
  ]);
}

/* ===== Pencereler ===== */
function openDlg(html, wide = false){
  const d = $("#dlg"); $("#dlgBody").innerHTML = html; d.classList.toggle("wide", wide);
  if (!d.open) d.showModal();
  const first = d.querySelector("input:not([readonly]):not([type=hidden]),select,textarea");
  if (first) first.focus(); else { const h = d.querySelector("h2"); h.tabIndex = -1; h.focus({ preventScroll: true }); }
  d.scrollTop = 0;
}
function closeDlg(){ const d = $("#dlg"); if (d.open) d.close(); }
function confirmDlg(title, text, okLabel, action){
  openDlg(`<div class="dlg"><h2>${esc(title)}</h2><p>${esc(text)}</p>
    <div class="row"><button class="btn" data-close type="button">Vazgeç</button><button class="btn btn-danger" id="cfOk" type="button">${esc(okLabel)}</button></div></div>`);
  $("#cfOk").onclick = () => { closeDlg(); action(); };
}

/* ===== Olaylar ===== */
document.addEventListener("submit", async e => {
  if (e.target.id !== "loginForm") return;
  e.preventDefault();
  const email = $("#lgEmail").value.trim(), password = $("#lgPass").value;
  if (!email || !password) { $("#lgErr").textContent = "E-posta ve şifreyi yazın."; return; }
  $("#lgErr").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) $("#lgErr").textContent = error.message === "Invalid login credentials" ? "E-posta ya da şifre hatalı." : errMsg(error);
});

document.addEventListener("click", e => {
  const t = e.target;
  const on = sel => t.closest(sel);
  let el;
  if (on("[data-close]")) return closeDlg();
  if ((el = on("[data-tab]"))) { tab = el.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if ((el = on("[data-ctab]"))) { ctab = el.dataset.ctab; render(); return; }
  if (on("#btnLogout")) { sb.auth.signOut(); return; }
  if (on("#btnRefresh")) { reload("all").then(() => toast("Veriler yenilendi.")); return; }
  if ((el = on("[data-detail]"))) return participantDetail(el.dataset.detail);
  if ((el = on("[data-edit]"))) return participantForm(el.dataset.edit);
  if (on("#btnAddOne")) return participantForm(null);
  if (on("#btnGen")) return generateForm();
  if (on("#btnImport")) return importForm();
  if (on("#btnXlsP")) return downloadBook(`katilimcilar-${stamp()}`, [["Katılımcılar", rowsParticipants(filteredParticipants())]]);
  if (on("#btnXlsL")) return downloadBook(`loglar-${stamp()}`, [["Loglar", rowsLogs(filteredLogs())]]);
  if (on("#btnXlsAll")) return exportKind("all");
  if ((el = on("[data-xls]"))) return exportKind(el.dataset.xls);
  if ((el = on("[data-xls-one]"))) { const p = D.participants.filter(p => p.code === el.dataset.xlsOne); return downloadBook(`katilimci-${el.dataset.xlsOne}`, [["Özet", rowsParticipants(p)], ["Bilgi formu", rowsSurvey(p)], ["Kart sıralaması", rowsSorts(p)], ["Loglar", rowsLogs(D.logs.filter(l => l.code === el.dataset.xlsOne))]]); }
  if ((el = on("[data-more]"))) { F[el.dataset.more].limit += 300; render(); return; }
  if ((el = on("[data-reset]"))) {
    const code = el.dataset.reset;
    return confirmDlg(`${code} sıfırlansın mı?`, "Bu koda ait bilgi formu yanıtları, kart sıralaması ve log kayıtları kalıcı olarak silinir; kod boşta duruma döner ve yeni bir katılımcıya verilebilir. Öğrencinin açık ekranı varsa oturumu kapanır.", "Sıfırla", async () => {
      const { error } = await sb.rpc("admin_reset_code", { p_code: code });
      if (error) toast(errMsg(error)); else { toast(`${code} sıfırlandı.`); reload("data"); }
    });
  }
  if ((el = on("[data-delete-code]"))) {
    const code = el.dataset.deleteCode;
    return confirmDlg(`${code} silinsin mi?`, "Kod, varsa yanıtları ve log kayıtlarıyla birlikte kalıcı olarak silinir.", "Kodu sil", async () => {
      const { error } = await sb.from("participants").delete().eq("code", code);
      if (error) toast(errMsg(error)); else { toast(`${code} silindi.`); reload("data"); }
    });
  }
  if ((el = on("[data-new]"))) return contentForm(el.dataset.new, null);
  if ((el = on("[data-cat-rename]"))) return renameCategory(el.dataset.catRename);
  if ((el = on("[data-cedit]"))) { const [k, id] = el.dataset.cedit.split("|"); return contentForm(k, id); }
  if ((el = on("[data-cdel]"))) { const [k, id] = el.dataset.cdel.split("|"); return deleteItem(k, id); }
  if ((el = on("[data-move]"))) { const [k, id, d] = el.dataset.move.split("|"); return moveItem(k, id, +d); }
  if ((el = on("[data-toggle-active]"))) { const [k, id] = el.dataset.toggleActive.split("|"); return toggleActive(k, id); }
});

// Filtreler: data-f="bölüm.alan"
document.addEventListener("input", e => {
  const el = e.target.closest("[data-f]"); if (!el) return;
  const [sec, key] = el.dataset.f.split(".");
  F[sec][key] = el.value;
  if (F[sec].limit) F[sec].limit = sec === "pt" ? 200 : 300;
  const pos = el.selectionStart, sel = `[data-f="${el.dataset.f}"]`;
  render();
  const again = $(sel); if (again) { again.focus(); if (pos != null && again.setSelectionRange && again.type === "search") again.setSelectionRange(pos, pos); }
});

// Grafik ipuçları
const tip = $("#tip");
document.addEventListener("mouseover", e => { const el = e.target.closest("[data-tip]"); if (!el) return; tip.textContent = el.dataset.tip; tip.hidden = false; });
document.addEventListener("mousemove", e => {
  if (tip.hidden) return;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 14) + "px";
  tip.style.top = (e.clientY - h - 12 < 4 ? e.clientY + 16 : e.clientY - h - 12) + "px";
});
document.addEventListener("mouseout", e => { if (e.target.closest("[data-tip]")) tip.hidden = true; });

/* ===== Oturum ===== */
async function enter(session){
  if (!session) { user = null; render(); return; }
  const { data: ok, error } = await sb.rpc("is_admin");
  if (error || !ok) {
    await sb.auth.signOut();
    $("#app").innerHTML = viewLogin(error ? errMsg(error) : "Bu hesabın yönetici yetkisi yok.");
    return;
  }
  const first = !user;
  user = session.user;
  if (first) { $("#app").innerHTML = `<div class="loading">Veriler yükleniyor…</div>`; await reload("all"); }
}
sb.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT") { user = null; D.participants = []; D.logs = []; render(); return; }
  if (event === "SIGNED_IN" || event === "INITIAL_SESSION") setTimeout(() => enter(session), 0);
});
})();
