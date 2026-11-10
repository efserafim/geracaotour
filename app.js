import { SITE_CONFIG, API_BASE } from "./config.js?v=9";

const TOKEN_KEY = "geracao-tour-token";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const signupForm = $("#signup-form");
let registrations = [];
let visible = [];
let tourCapacity = SITE_CONFIG.capacity;
let toastTimer;
let authToken = localStorage.getItem(TOKEN_KEY) || "";

async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    if (!authToken) {
      const error = new Error("UNAUTHORIZED");
      error.status = 401;
      throw error;
    }
    headers.Authorization = `Bearer ${authToken}`;
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  const text = await response.text();
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { error: text }; }
  }
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || `HTTP_${response.status}`);
    error.status = response.status;
    error.code = data?.error || "";
    error.data = data;
    if (response.status === 401 && auth) clearSession();
    throw error;
  }
  return data;
}
function clearSession() {
  authToken = "";
  localStorage.removeItem(TOKEN_KEY);
  setSignedIn(false);
}
function saveSession(token) {
  authToken = token;
  localStorage.setItem(TOKEN_KEY, token);
  setSignedIn(true);
}

$("#yt").src = SITE_CONFIG.videoUrl;

/* ---------- Utilidades ---------- */
function digits(value) { return (value || "").replace(/\D/g, ""); }
/** Neon/JSON may send "YYYY-MM-DD" or "YYYY-MM-DDT00:00:00.000Z". */
function dateOnly(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}
function ageAt(dateString) {
  const day = dateOnly(dateString);
  if (!day) return NaN;
  const birth = new Date(`${day}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return NaN;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() ||
    (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
  return age;
}
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function validDocument(value) { const n = digits(value).length; return value.trim().length >= 5 && n >= 5 && n <= 14; }
function validPhone(value) { const n = digits(value).length; return n >= 10 && n <= 13; }
function escapeHtml(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}
function setError(input, message) {
  input.setAttribute("aria-invalid", message ? "true" : "false");
  const error = input.closest(".field")?.querySelector(".field-error");
  if (error) error.textContent = message || "";
}
function showToast(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("toast-error", isError);
  toast.classList.add("toast-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("toast-visible"), 3600);
}
function debounce(fn, wait) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}

/* ---------- Animações: reveal ao rolar e ônibus acompanhando o scroll ---------- */
const observer = new IntersectionObserver(entries => entries.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add("in"); observer.unobserve(e.target); }
}), { threshold: .12 });
$$(".reveal").forEach(el => observer.observe(el));

const bus = $("#bus");
function onScroll() {
  const max = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
  bus.style.setProperty("--bus", Math.min(scrollY / (max * 0.6), 1).toFixed(3));
  document.body.classList.toggle("scrolled", scrollY > innerHeight * .75);
}
addEventListener("scroll", onScroll, { passive: true });
onScroll();
setTimeout(() => bus.style.setProperty("--bus", "0.02"), 50);

new IntersectionObserver(([entry]) => {
  document.body.classList.toggle("form-in-view", entry.isIntersecting);
}, { threshold: .08 }).observe($("#inscricao"));

/* ---------- Menu no celular, voltar ao topo ---------- */
const siteNav = $("#site-nav");
const navToggle = $("#nav-toggle");
function setNav(open) {
  siteNav.classList.toggle("is-open", open);
  navToggle.setAttribute("aria-expanded", String(open));
}
navToggle.addEventListener("click", () => setNav(!siteNav.classList.contains("is-open")));
siteNav.addEventListener("click", event => { if (event.target.closest("a")) setNav(false); });
addEventListener("keydown", event => { if (event.key === "Escape") setNav(false); });
addEventListener("resize", () => { if (innerWidth > 860) setNav(false); });
$("#to-top").addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));

/* ---------- Contagem regressiva ---------- */
const tourStart = new Date(`${SITE_CONFIG.tourDateISO}T${SITE_CONFIG.departureTime || "06:30"}:00-03:00`);
function tickCountdown() {
  const ms = tourStart.getTime() - Date.now();
  if (Number.isNaN(ms)) { $("#countdown").hidden = true; return; }
  if (ms <= 0) {
    $("#cd-days").textContent = "0";
    $("#cd-hours").textContent = "0";
    $("#cd-mins").textContent = "0";
    $("#countdown").setAttribute("aria-label", "O ônibus já partiu");
    return;
  }
  const minutes = Math.floor(ms / 60000);
  $("#cd-days").textContent = Math.floor(minutes / 1440);
  $("#cd-hours").textContent = String(Math.floor(minutes / 60) % 24).padStart(2, "0");
  $("#cd-mins").textContent = String(minutes % 60).padStart(2, "0");
}
tickCountdown();
setInterval(tickCountdown, 30000);

/* ---------- Vagas ---------- */
function setCapacity(count, capacity = tourCapacity) {
  tourCapacity = Number(capacity) || SITE_CONFIG.capacity;
  const registered = Math.min(Number(count) || 0, tourCapacity);
  const remaining = Math.max(tourCapacity - registered, 0);
  const full = remaining === 0;
  $("#seats-lead").textContent = full
    ? "As vagas desta saída acabaram."
    : "A ficha reserva o seu lugar. O PIX de R$ 30 confirma.";
  $("#closed-banner").hidden = !full;
  // Keep the form hidden after a successful signup (success panel is showing).
  const successShown = !$("#success-panel").hidden;
  signupForm.hidden = full || successShown;
  const mobileText = $("#mobile-cta-text");
  const mobileLink = $("#mobile-cta-link");
  if (mobileText) mobileText.innerHTML = full ? "<b>Vagas encerradas</b>" : "<b>05/12</b> · R$ 30";
  if (mobileLink) {
    mobileLink.hidden = full;
    mobileLink.setAttribute("aria-hidden", full ? "true" : "false");
  }
}
async function loadCapacity() {
  try {
    const data = await api("/capacity");
    setCapacity(data?.registered ?? 0, data?.capacity);
  } catch (error) {
    console.error("Falha ao carregar vagas:", error);
    $("#form-error").textContent = error.code === "DATABASE_URL_MISSING"
      ? "Banco ainda não configurado no Netlify (DATABASE_URL)."
      : "Não foi possível verificar as vagas. Atualize a página para tentar novamente.";
    signupForm.querySelector('[type="submit"]').disabled = true;
  }
  getLogoSrc();
}

/* ---------- Informações do passeio ---------- */
function renderInfo() {
  const info = SITE_CONFIG.info || {};
  const departureLabel = (SITE_CONFIG.departureTime || "06:30").replace(/^0/, "").replace(":", "h");
  if (info.price) $("#info-price").textContent = info.price;
  if (info.returnTime) $("#info-return").textContent = info.returnTime;
  $("#info-meeting").textContent = `${SITE_CONFIG.meetingPoint}. Às 6h a gente se encontra. Às ${departureLabel} o ônibus sai.`;
  $("#info-bring").innerHTML = (info.bring || []).map(item => `<li>${escapeHtml(item)}</li>`).join("");
  if (info.deadline) {
    const note = $("#info-deadline");
    note.textContent = `Inscrições até ${info.deadline}.`;
    note.hidden = false;
  }
}
renderInfo();
async function copyPix() {
  const key = SITE_CONFIG.pixKey || "22998750491";
  try {
    await navigator.clipboard.writeText(key);
    showToast(`Chave PIX copiada: ${SITE_CONFIG.pixLabel} (${SITE_CONFIG.pixName}).`);
  } catch {
    showToast(`PIX: ${SITE_CONFIG.pixLabel} · ${SITE_CONFIG.pixName}`, true);
  }
}
$("#copy-pix")?.addEventListener("click", copyPix);
$("#copy-pix-success")?.addEventListener("click", copyPix);

/* ---------- Divulgação ---------- */
const shareText = `${SITE_CONFIG.shareText} ${SITE_CONFIG.siteUrl}`;
$("#share-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
$("#share-after").addEventListener("click", async () => {
  if (navigator.share) {
    try { await navigator.share({ title: SITE_CONFIG.tourName, text: SITE_CONFIG.shareText, url: SITE_CONFIG.siteUrl }); return; }
    catch (error) { if (error.name !== "AbortError") console.error(error); }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener");
});
$("#copy-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(SITE_CONFIG.siteUrl);
    showToast("Link copiado. Manda no grupo.");
  } catch (error) {
    console.error(error);
    showToast("Copie o endereço da barra do navegador.", true);
  }
});

/* ---------- Máscaras e formulário ---------- */
function maskPhone(input) {
  const v = digits(input.value).slice(0, 11);
  if (v.length > 10) input.value = v.replace(/^(\d{2})(\d{5})(\d{4}).*/, "($1) $2-$3");
  else if (v.length > 6) input.value = v.replace(/^(\d{2})(\d{4})(\d{0,4}).*/, "($1) $2-$3");
  else if (v.length > 2) input.value = v.replace(/^(\d{2})(\d{0,5})/, "($1) $2");
  else input.value = v;
}
$$('input[name="phone"], input[name="emergency_phone"], input[name="guardian_phone"]').forEach(i => i.addEventListener("input", () => maskPhone(i)));
signupForm.elements.birth_date.max = new Date().toISOString().slice(0, 10);
signupForm.elements.birth_date.addEventListener("change", () => {
  const value = signupForm.elements.birth_date.value;
  const minor = Boolean(value) && ageAt(value) < 18;
  $("#guardian-fields").hidden = !minor;
  ["guardian_name", "guardian_phone", "guardian_document"].forEach(name => {
    const input = signupForm.elements[name];
    input.required = minor;
    if (!minor) { input.value = ""; setError(input, ""); }
  });
  signupForm.elements.guardian_consent.required = minor;
  if (!minor) signupForm.elements.guardian_consent.checked = false;
});

function validateSignup() {
  const data = Object.fromEntries(new FormData(signupForm).entries());
  const birth = new Date(`${data.birth_date}T00:00:00`);
  const minor = Boolean(data.birth_date) && ageAt(data.birth_date) < 18;
  const errors = {
    full_name: data.full_name.trim().length < 3 ? "Digite seu nome completo." : "",
    birth_date: !data.birth_date || Number.isNaN(birth.getTime()) || birth > new Date() ? "Escolha uma data válida." : "",
    document: !validDocument(data.document) ? "Confira seu CPF ou RG." : "",
    phone: !validPhone(data.phone) ? "Informe um telefone com DDD." : "",
    email: !validEmail(data.email) ? "Confira o formato do e-mail." : "",
    emergency_name: data.emergency_name.trim().length < 3 ? "Informe o nome do contato." : "",
    emergency_phone: !validPhone(data.emergency_phone) ? "Informe um telefone com DDD." : "",
    guardian_name: minor && data.guardian_name.trim().length < 3 ? "Informe o nome do responsável." : "",
    guardian_phone: minor && !validPhone(data.guardian_phone) ? "Informe o telefone do responsável." : "",
    guardian_document: minor && !validDocument(data.guardian_document) ? "Informe o CPF ou RG do responsável." : ""
  };
  let valid = true;
  for (const [name, message] of Object.entries(errors)) {
    setError(signupForm.elements[name], message);
    if (message) valid = false;
  }
  const consent = signupForm.elements.consent;
  $(".consent-error").textContent = consent.checked ? "" : "É necessário aceitar o aviso de privacidade.";
  if (!consent.checked) valid = false;
  const gc = signupForm.elements.guardian_consent;
  gc.closest(".consent").classList.toggle("consent-invalid", minor && !gc.checked);
  if (minor && !gc.checked) valid = false;
  return { valid, minor };
}

/* ---------- Documentos para impressão / PDF ---------- */
let logoDataUrl = "";
async function getLogoSrc() {
  if (logoDataUrl) return logoDataUrl;
  try {
    const response = await fetch("./image/geracao-eucaristica.png");
    if (!response.ok) throw new Error("Logo não encontrada");
    const blob = await response.blob();
    logoDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error(error);
    logoDataUrl = "./image/geracao-eucaristica.png";
  }
  return logoDataUrl;
}
async function printShell(title, extraCss, body) {
  const popup = window.open("", "_blank");
  if (!popup) { showToast("Permita pop-ups para abrir o documento.", true); return; }
  popup.document.write("<p style='font:16px Sora,sans-serif;padding:24px;color:#163a9c'>Preparando documento…</p>");
  const logo = await getLogoSrc();
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Sora:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root{--blue:#1E4FD8;--ink:#163a9c;--muted:#4d6494;--paper:#f4f7fb}
    *{box-sizing:border-box}
    body{margin:0;background:#d9e4f4;color:#163a9c;font:14px/1.55 Sora,system-ui,sans-serif}
    .sheet{max-width:920px;margin:28px auto;padding:36px 40px 32px;background:#fff;border:1px solid #c9d7ee;box-shadow:0 18px 40px rgba(22,58,156,.12)}
    .letterhead{display:flex;align-items:center;gap:16px;padding-bottom:18px;border-bottom:3px solid var(--blue);margin-bottom:22px}
    .letterhead img{width:72px;height:72px;object-fit:contain;border-radius:50%;flex:none}
    .letterhead p{margin:0;letter-spacing:.16em;text-transform:uppercase;font-size:11px;font-weight:700;color:var(--blue)}
    .letterhead h1{margin:4px 0 0;font:italic 700 28px/1.1 "Libre Baskerville",Georgia,serif;color:var(--ink);letter-spacing:0;text-transform:none}
    .letterhead small{display:block;margin-top:4px;color:var(--muted);font-size:12px;letter-spacing:0;text-transform:none;font-weight:400}
    h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--blue);margin:26px 0 10px}
    p{margin:0 0 10px}
    .meta{display:flex;flex-wrap:wrap;gap:8px 18px;margin:0 0 18px;padding:12px 16px;background:var(--paper);border-left:4px solid var(--blue)}
    .meta b{color:var(--ink)}
    .details{background:var(--paper);padding:16px 18px;border-radius:4px}
    .details ol{margin:10px 0 0;padding-left:18px}
    .blank{display:inline-block;min-width:200px;border-bottom:1px solid #8aa0c8}
    .signature{margin-top:52px;display:flex;gap:28px}
    .signature div{flex:1;text-align:center;border-top:1px solid #8aa0c8;padding-top:8px;font-size:12px;color:var(--muted)}
    .small{font-size:11px;color:var(--muted)}
    .print-button{position:fixed;top:16px;right:16px;background:var(--blue);color:#fff;border:0;border-radius:999px;padding:12px 18px;font:700 13px Sora,sans-serif;cursor:pointer;box-shadow:0 8px 20px rgba(30,79,216,.3)}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{text-align:left;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#fff;background:var(--blue);padding:10px 8px}
    td{padding:10px 8px;border-bottom:1px solid #d5e0f2;vertical-align:top}
    tr:nth-child(even) td{background:#f7faff}
    .tag{display:inline-block;padding:3px 8px;border-radius:99px;font-size:10px;font-weight:700;letter-spacing:.04em}
    .tag-ok{background:#d9f5e5;color:#0f6b3c}
    .tag-wait{background:#fff3d6;color:#8a5a00}
    .foot{margin-top:28px;padding-top:12px;border-top:1px solid #d5e0f2;display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--muted)}
    ${extraCss}
    @media print{body{background:#fff}.sheet{margin:0;max-width:none;border:0;box-shadow:none;padding:12px 8px}.print-button{display:none}}
  </style></head><body>
  <button class="print-button" onclick="window.print()">Imprimir / Salvar como PDF</button>
  <article class="sheet">${body}</article>
  </body></html>`;
  popup.document.open();
  popup.document.write(html.replaceAll("{{LOGO}}", logo));
  popup.document.close();
}
function letterhead(title, subtitle) {
  return `<header class="letterhead"><img src="{{LOGO}}" alt="Geração Eucarística" width="72" height="72">
    <div><p>Geração Eucarística · Paróquia Santo Antônio</p>
    <h1>${escapeHtml(title)}</h1>
    <small>${escapeHtml(subtitle)}</small></div></header>`;
}
function printFoot() {
  return `<footer class="foot"><span>Peregrinação Jovem · ${escapeHtml(SITE_CONFIG.tourDate)}</span><span>Vaga confirmada mediante PIX de R$ 30</span></footer>`;
}
function isPaid(p) { return p.payment_status === "paid"; }
function pixLabel(p) { return isPaid(p) ? '<span class="tag tag-ok">PIX pago</span>' : '<span class="tag tag-wait">Aguardando PIX</span>'; }
function formatBirth(dateString) {
  const day = dateOnly(dateString);
  if (!day) return "—";
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}
function ageLabel(dateString) {
  const age = ageAt(dateString);
  return Number.isFinite(age) ? `${age} anos` : "—";
}
function authorizationMarkup(p) {
  const born = formatBirth(p.birth_date);
  const fill = v => v ? `<b>${escapeHtml(v)}</b>` : '<span class="blank"></span>';
  const stops = SITE_CONFIG.itinerary.slice(2).map(s => `<li>${escapeHtml(s)}</li>`).join("");
  return `${letterhead("Autorização de menor", SITE_CONFIG.tourName)}
  <p>Eu, ${fill(p.guardian_name)}, documento ${fill(p.guardian_document)}, telefone ${fill(p.guardian_phone)}, responsável legal, <b>autorizo</b> ${fill(p.full_name)}, nascido(a) em ${fill(born)}, a participar da Peregrinação Jovem em <b>${escapeHtml(SITE_CONFIG.tourDate)}</b>.</p>
  <h2>Roteiro e pagamento</h2>
  <div class="details"><p><b>06h00</b> Concentração — ${escapeHtml(SITE_CONFIG.meetingPoint)}<br><b>06h30</b> Saída do ônibus<br><b>Valor</b> R$ 30,00 via PIX para ${escapeHtml(SITE_CONFIG.pixLabel)}, ${escapeHtml(SITE_CONFIG.pixName)}<br><b>Envie o comprovante no WhatsApp de ${escapeHtml(SITE_CONFIG.pixName)}: ${escapeHtml(SITE_CONFIG.pixLabel)}.</b><br><b>A vaga só é confirmada depois do pagamento. A autorização assinada deve ser entregue no dia do passeio.</b></p><ol>${stops}</ol></div>
  <h2>Declaração</h2>
  <p>Conheço o roteiro, os horários e o valor. Autorizo a ida do menor, confirmo que os dados são verdadeiros e permaneço disponível em caso de emergência.</p>
  <p>Local e data: <span class="blank"></span>, ____/____/________.</p>
  <div class="signature"><div>Assinatura do(a) responsável<br><span>${escapeHtml(p.guardian_name || "")}</span></div><div>Telefone<br><span>${escapeHtml(p.guardian_phone || "")}</span></div></div>
  <p class="small">Entregar este documento assinado à coordenação <b>no dia do passeio</b>, na concentração (6h). Comprovante do PIX: WhatsApp de ${escapeHtml(SITE_CONFIG.pixName)}, ${escapeHtml(SITE_CONFIG.pixLabel)}.</p>
  ${printFoot()}`;
}
const downloadAuthorization = person => printShell("Autorização — Peregrinação Jovem", "", authorizationMarkup(person));
$("#blank-authorization").addEventListener("click", () => downloadAuthorization({}));

const pixWhatsapp = SITE_CONFIG.pixWhatsapp || `55${SITE_CONFIG.pixKey}`;
const receiptText = encodeURIComponent(`Olá, Welerson! Segue o comprovante do PIX de R$ 30 da Peregrinação Jovem.`);
$("#send-receipt")?.setAttribute("href", `https://wa.me/${pixWhatsapp}?text=${receiptText}`);

/* ---------- Envio da inscrição ---------- */
signupForm.addEventListener("submit", async event => {
  event.preventDefault();
  $("#form-error").textContent = "";
  const { valid, minor } = validateSignup();
  if (!valid) { signupForm.querySelector('[aria-invalid="true"]')?.focus(); return; }
  const v = Object.fromEntries(new FormData(signupForm).entries());
  const participant = {
    full_name: v.full_name.trim(), birth_date: v.birth_date, document_number: v.document.trim(),
    phone: v.phone.trim(), email: v.email.trim().toLowerCase(),
    emergency_name: v.emergency_name.trim(), emergency_phone: v.emergency_phone.trim(),
    guardian_name: minor ? v.guardian_name.trim() : null,
    guardian_phone: minor ? v.guardian_phone.trim() : null,
    guardian_document: minor ? v.guardian_document.trim() : null,
    guardian_consent: minor && v.guardian_consent === "on",
    dietary_notes: v.dietary_notes.trim() || null, observations: v.observations.trim() || null, consent: true
  };
  const submit = signupForm.querySelector('[type="submit"]');
  const label = $(".submit-label", submit);
  submit.disabled = true; label.textContent = "Enviando sua inscrição…";
  try {
    await api("/register", { method: "POST", body: { participant } });
    signupForm.hidden = true;
    $("#success-panel").hidden = false;
    if (minor) {
      $("#authorization-button").hidden = false;
      $("#authorization-button").onclick = () => downloadAuthorization(participant);
      const authNote = $("#success-auth-note");
      if (authNote) authNote.hidden = false;
    }
    await loadCapacity();
    $("#success-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    console.error("Falha na inscrição:", error);
    let message = "Não foi possível concluir a inscrição. Tente novamente.";
    if (error.code === "DUPLICATE_REGISTRATION") message = "Já existe inscrição com este documento ou com este nome e data de nascimento.";
    else if (error.code === "CAPACITY_REACHED") { await loadCapacity(); message = "Vagas encerradas."; }
    else if (error.code === "INVALID_PARTICIPANT") message = "Confira os campos obrigatórios e os dados do responsável.";
    else if (error.message && !error.message.startsWith("HTTP_")) message = error.message;
    $("#form-error").textContent = message;
    submit.disabled = false; label.textContent = "Inscrever-se";
  }
});

/* ---------- Modais ---------- */
$("#privacy-open").addEventListener("click", () => $("#privacy-dialog").showModal());
$("#admin-open").addEventListener("click", () => $("#admin-dialog").showModal());

/* ---------- Sessão da coordenação ---------- */
function setSignedIn(signedIn) {
  $("#admin-open").hidden = signedIn;
  $("#admin-panel").hidden = !signedIn;
  $("#admin-signout").hidden = !signedIn;
}
$("#admin-panel").addEventListener("click", openDashboard);
$("#admin-signout").addEventListener("click", signOut);
setSignedIn(Boolean(authToken));

/* ---------- Dashboard ---------- */
$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("#login-error").textContent = "";
  const form = new FormData(event.currentTarget);
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const data = await api("/login", {
      method: "POST",
      body: { email: form.get("email"), password: form.get("password") }
    });
    saveSession(data.token);
    $("#admin-dialog").close();
    await openDashboard();
  } catch (error) {
    console.error("Falha no login:", error);
    $("#login-error").textContent = "Não foi possível entrar. Confira o e-mail e a senha.";
  } finally {
    button.disabled = false;
  }
});
async function loadRegistrations() {
  $("#registrations-body").innerHTML = '<tr><td colspan="8" class="empty-table">Carregando fichas…</td></tr>';
  const data = await api("/registrations", { auth: true });
  registrations = data?.data || [];
  renderDashboard();
}
async function openDashboard() {
  if (!authToken) { showToast("Entre com a conta da coordenação.", true); return; }
  $("#dashboard-error").textContent = "";
  $("#dashboard-dialog").showModal();
  try { await loadRegistrations(); }
  catch (error) {
    console.error(error);
    $("#dashboard-error").textContent = error.status === 401
      ? "Sessão expirada. Entre de novo."
      : "Não foi possível carregar os inscritos.";
    if (error.status === 401) { clearSession(); $("#dashboard-dialog").close(); }
  }
}
async function signOut() {
  clearSession();
  registrations = []; visible = [];
  $("#dashboard-dialog").close();
  showToast("Sessão encerrada.");
}
function renderDashboard() {
  const paidCount = registrations.filter(isPaid).length;
  $("#stat-total").textContent = registrations.length;
  $("#stat-paid").textContent = paidCount;
  $("#stat-unpaid").textContent = registrations.length - paidCount;
  $("#stat-remaining").textContent = Math.max(tourCapacity - registrations.length, 0);
  const query = normalize($("#search-input").value.trim());
  const filter = $("#filter-select").value;
  visible = registrations.filter(p => {
    const minor = ageAt(p.birth_date) < 18;
    const haystack = normalize([p.full_name, p.phone, digits(p.phone), p.email, p.guardian_name, p.emergency_name].join(" "));
    const found = !query || haystack.includes(query);
    return found && (filter === "all" || (filter === "paid" && isPaid(p)) || (filter === "unpaid" && !isPaid(p)) ||
      (filter === "minors" && minor) ||
      (filter === "pending" && minor && p.authorization_status !== "delivered") ||
      (filter === "present" && p.attended) || (filter === "absent" && !p.attended));
  });
  const sort = $("#sort-select").value;
  visible.sort((a, b) => sort === "newest" ? new Date(b.created_at) - new Date(a.created_at) :
    sort === "oldest" ? new Date(a.created_at) - new Date(b.created_at) :
    sort === "birth" ? a.birth_date.localeCompare(b.birth_date) : a.full_name.localeCompare(b.full_name, "pt-BR"));
  $("#dash-count").textContent = visible.length === registrations.length
    ? `${registrations.length} ficha(s) · ${paidCount} confirmada(s) com PIX.`
    : `Exibindo ${visible.length} de ${registrations.length} ficha(s).`;
  $("#registrations-body").innerHTML = visible.length ? visible.map(p => {
    const minor = ageAt(p.birth_date) < 18;
    const done = p.authorization_status === "delivered";
    const paid = isPaid(p);
    const auth = minor ? `<button class="status-pill ${done ? "status-done" : "status-pending"}" data-action="authorization" data-id="${p.id}">${done ? "Entregue" : "Pendente"}</button><button class="table-icon" title="Reemitir autorização" aria-label="Reemitir autorização de ${escapeHtml(p.full_name)}" data-action="reissue" data-id="${p.id}">⤓</button>` : '<span class="muted">—</span>';
    return `<tr class="${paid ? "row-paid" : "row-unpaid"}">
      <td class="dash-cell-name" data-label="Participante"><b>${escapeHtml(p.full_name)}</b>${minor ? ' <span class="minor-tag">menor</span>' : ""}<small>${ageLabel(p.birth_date)} · ${escapeHtml(formatBirth(p.birth_date))} · ${escapeHtml(p.document_number)}</small><small>${escapeHtml(p.dietary_notes || p.observations ? `Obs.: ${p.dietary_notes || "—"} · ${p.observations || "—"}` : "")}</small></td>
      <td data-label="PIX"><button class="status-pill ${paid ? "status-done" : "status-pending"}" data-action="payment" data-id="${p.id}">${paid ? "Pago" : "Aguardando"}</button></td>
      <td data-label="Contato"><span class="dash-cell-stack">${escapeHtml(p.phone)}<small>${escapeHtml(p.email)}</small></span></td>
      <td data-label="Emergência"><span class="dash-cell-stack">${escapeHtml(p.emergency_name)}<small>${escapeHtml(p.emergency_phone)}</small></span></td>
      <td data-label="Responsável"><span class="dash-cell-stack">${escapeHtml(p.guardian_name || "—")}<small>${escapeHtml(p.guardian_phone || "")}</small></span></td>
      <td data-label="Autorização" class="dash-cell-actions">${auth}</td>
      <td data-label="Presença"><label class="checkin"><input type="checkbox" data-action="attendance" data-id="${p.id}" ${p.attended ? "checked" : ""}><span>${p.attended ? "Presente" : "Check-in"}</span></label></td>
      <td data-label="Ações" class="dash-cell-actions"><button class="table-icon" title="Editar" aria-label="Editar ${escapeHtml(p.full_name)}" data-action="edit" data-id="${p.id}">✎</button><button class="table-icon danger-icon" title="Remover" aria-label="Remover ${escapeHtml(p.full_name)}" data-action="remove" data-id="${p.id}">×</button></td>
    </tr>`;
  }).join("") : `<tr class="dash-empty-row"><td colspan="8" class="empty-table">${registrations.length ? "Nenhuma ficha neste filtro." : "Nenhuma ficha ainda."}</td></tr>`;
}
const rerender = debounce(renderDashboard, 120);
$("#search-input").addEventListener("input", rerender);
["search-input", "filter-select", "sort-select"].forEach(id => {
  $(`#${id}`).addEventListener("change", renderDashboard);
});
$("#search-input").addEventListener("keydown", event => { if (event.key === "Escape") { event.target.value = ""; renderDashboard(); } });
addEventListener("keydown", event => {
  if (event.key === "/" && $("#dashboard-dialog").open && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
    event.preventDefault();
    $("#search-input").focus();
  }
});
$("#refresh-list").addEventListener("click", async () => {
  try { await loadRegistrations(); await loadCapacity(); showToast("Lista atualizada."); }
  catch (error) { console.error(error); showToast("Não foi possível atualizar.", true); }
});
$("#registrations-body").addEventListener("click", async event => {
  const control = event.target.closest("[data-action]");
  if (!control || control.dataset.action === "attendance") return;
  const person = registrations.find(p => p.id === control.dataset.id);
  if (!person) return;
  const action = control.dataset.action;
  if (action === "payment") {
    const next = isPaid(person) ? "pending" : "paid";
    try {
      const result = await api(`/registrations/${person.id}`, {
        method: "PATCH",
        auth: true,
        body: { payment_status: next, paid_at: next === "paid" ? new Date().toISOString() : null }
      });
      Object.assign(person, result.data || { payment_status: next, paid_at: next === "paid" ? new Date().toISOString() : null });
      renderDashboard();
      showToast(next === "paid" ? "Vaga confirmada: PIX marcado como pago." : "PIX desmarcado. Vaga volta a aguardar pagamento.");
    } catch (error) {
      console.error(error);
      showToast("Não foi possível atualizar o PIX.", true);
    }
  } else if (action === "authorization") {
    const next = person.authorization_status === "delivered" ? "pending" : "delivered";
    try {
      const result = await api(`/registrations/${person.id}`, {
        method: "PATCH",
        auth: true,
        body: { authorization_status: next }
      });
      Object.assign(person, result.data || { authorization_status: next });
      renderDashboard();
      showToast(`Autorização marcada como ${next === "delivered" ? "entregue" : "pendente"}.`);
    } catch (error) { console.error(error); showToast("Não foi possível atualizar a autorização.", true); }
  } else if (action === "reissue") downloadAuthorization(person);
  else if (action === "edit") openEdit(person);
  else if (action === "remove") {
    if (!confirm(`Remover a inscrição de ${person.full_name}? Esta ação não pode ser desfeita.`)) return;
    try {
      await api(`/registrations/${person.id}`, { method: "DELETE", auth: true });
      registrations = registrations.filter(p => p.id !== person.id);
      renderDashboard(); showToast("Inscrição removida.");
      await loadCapacity();
    } catch (error) { console.error(error); showToast("Não foi possível remover a inscrição.", true); }
  }
});
$("#registrations-body").addEventListener("change", async event => {
  const control = event.target.closest('[data-action="attendance"]');
  if (!control) return;
  const person = registrations.find(p => p.id === control.dataset.id);
  const previous = !control.checked;
  try {
    const result = await api(`/registrations/${person.id}`, {
      method: "PATCH",
      auth: true,
      body: { attended: control.checked }
    });
    Object.assign(person, result.data || { attended: control.checked });
    renderDashboard();
    showToast(control.checked ? "Presença confirmada." : "Presença desmarcada.");
  } catch (error) { console.error(error); control.checked = previous; showToast("Não foi possível atualizar a presença.", true); }
});

const EDIT_KEYS = ["full_name", "birth_date", "document_number", "phone", "email", "emergency_name", "emergency_phone", "guardian_name", "guardian_phone", "guardian_document", "dietary_notes", "observations"];
function openEdit(person) {
  const form = $("#edit-form");
  form.elements.id.value = person.id;
  EDIT_KEYS.forEach(k => {
    const raw = person[k] || "";
    form.elements[k].value = k === "birth_date" ? dateOnly(raw) : raw;
  });
  $("#edit-error").textContent = "";
  $("#edit-dialog").showModal();
}
$("#cancel-edit").addEventListener("click", () => $("#edit-dialog").close());
$("#edit-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const person = registrations.find(p => p.id === form.get("id"));
  const minor = ageAt(form.get("birth_date")) < 18;
  const updates = Object.fromEntries(EDIT_KEYS.map(k => [k, (form.get(k) || "").trim() || null]));
  if ((updates.full_name || "").length < 3 || !validDocument(updates.document_number || "") || !validPhone(updates.phone || "") ||
    !validEmail(updates.email || "") || !validPhone(updates.emergency_phone || "") ||
    (minor && (!updates.guardian_name || !validDocument(updates.guardian_document || "") || !validPhone(updates.guardian_phone || "")))) {
    $("#edit-error").textContent = "Confira nome, documento, e-mail, telefones e os dados do responsável (menores).";
    return;
  }
  if (!minor) { updates.guardian_name = null; updates.guardian_phone = null; updates.guardian_document = null; }
  try {
    const result = await api(`/registrations/${person.id}`, { method: "PATCH", auth: true, body: updates });
    Object.assign(person, result.data || updates);
    $("#edit-dialog").close(); renderDashboard(); showToast("Inscrição atualizada.");
  } catch (error) {
    console.error(error);
    $("#edit-error").textContent = error.code === "DUPLICATE_REGISTRATION"
      ? "Já existe inscrição com esse documento ou nome e data de nascimento."
      : "Não foi possível salvar. Tente novamente.";
  }
});

/* ---------- Exportações (seguem a busca e o filtro ativos) ---------- */
function csvEscape(value) {
  const text = String(value ?? "");
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
function exportLabel() {
  return visible.length === registrations.length ? "" : " (filtrado)";
}
$("#export-csv").addEventListener("click", () => {
  const headers = ["Nome completo", "Nascimento", "Documento", "Telefone", "E-mail", "Contato de emergência", "Telefone de emergência", "Responsável", "Telefone do responsável", "Documento do responsável", "Restrições/alergias", "Observações", "PIX", "Autorização", "Presença"];
  const rows = visible.map(p => [
    p.full_name, p.birth_date, p.document_number, p.phone, p.email, p.emergency_name, p.emergency_phone,
    p.guardian_name, p.guardian_phone, p.guardian_document, p.dietary_notes, p.observations,
    isPaid(p) ? "Pago" : "Aguardando", p.authorization_status, p.attended ? "Presente" : "Ausente"
  ].map(csvEscape).join(","));
  const blob = new Blob(["\ufeff", [headers.map(csvEscape).join(","), ...rows].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob); link.download = "peregrinacao-jovem-inscritos.csv"; link.click(); URL.revokeObjectURL(link.href);
  showToast(`${visible.length} linha(s) exportada(s)${exportLabel()}.`);
});
$("#export-pdf").addEventListener("click", () => {
  const paidCount = visible.filter(isPaid).length;
  const rows = visible.map((p, i) => {
    const minor = ageAt(p.birth_date) < 18;
    return `<tr><td>${i + 1}</td><td><b>${escapeHtml(p.full_name)}</b><br><span class="small">${escapeHtml(formatBirth(p.birth_date))} · ${ageLabel(p.birth_date)}</span></td><td>${escapeHtml(p.phone)}<br><span class="small">${escapeHtml(p.email)}</span></td><td>${pixLabel(p)}</td><td>${minor ? `${escapeHtml(p.guardian_name || "—")}<br><span class="small">${escapeHtml(p.guardian_phone || "")}</span>` : "—"}</td><td>${p.attended ? "Presente" : "—"}</td></tr>`;
  }).join("");
  printShell("Lista de inscritos — Peregrinação Jovem", "@page{size:landscape}",
    `${letterhead("Lista de inscritos", SITE_CONFIG.tourName)}
    <div class="meta"><span><b>Data</b> ${escapeHtml(SITE_CONFIG.tourDate)}</span><span><b>Fichas</b> ${visible.length}${exportLabel()}</span><span><b>PIX pagos</b> ${paidCount}</span><span><b>Saída</b> 06h30 · Bacaxá</span></div>
    <table><thead><tr><th>Nº</th><th>Participante</th><th>Contato</th><th>PIX</th><th>Responsável</th><th>Presença</th></tr></thead><tbody>${rows}</tbody></table>
    ${printFoot()}`);
});
$("#print-list").addEventListener("click", () => {
  const rows = visible.map((p, i) => `<tr><td>${i + 1}</td><td><b>${escapeHtml(p.full_name)}</b> ${pixLabel(p)}</td><td>${escapeHtml(p.phone)}</td><td>${escapeHtml(p.emergency_name)}<br><span class="small">${escapeHtml(p.emergency_phone)}</span></td><td style="min-width:140px"></td></tr>`).join("");
  printShell("Lista de presença — Peregrinação Jovem", "",
    `${letterhead("Lista de presença", "Sábado · ônibus Bacaxá → Rio")}
    <div class="meta"><span><b>Data</b> ${escapeHtml(SITE_CONFIG.tourDate)}</span><span><b>Concentração</b> 6h · saída 6h30</span><span><b>Nomes</b> ${visible.length}${exportLabel()}</span><span><b>PIX</b> R$ 30, ${escapeHtml(SITE_CONFIG.pixName)}</span></div>
    <table><thead><tr><th>Nº</th><th>Nome / PIX</th><th>Telefone</th><th>Emergência</th><th>Assinatura</th></tr></thead><tbody>${rows}</tbody></table>
    ${printFoot()}`);
});
$("#dashboard-close").addEventListener("click", () => $("#dashboard-dialog").close());
$("#logout-button")?.addEventListener("click", signOut);

loadCapacity();
