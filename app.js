import { SITE_CONFIG, API_BASE } from "./config.js?v=14";

const TOKEN_KEY = "geracao-tour-token";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const signupForm = $("#signup-form");
let registrations = [];
let waitlist = [];
let visible = [];
let tourCapacity = SITE_CONFIG.capacity;
let waitlistMode = Boolean(SITE_CONFIG.waitlistOpen);
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

const journey = $("#journey");
const bus = $("#bus");
const busHint = $("#bus-hint");
const fireworksCanvas = $("#fireworks");
let busProgress = 0.02;
let busDragging = false;
let busArrived = false;
let dragOriginX = 0;
let dragOriginProgress = 0;
let fireworksRaf = 0;

function setBusProgress(value) {
  busProgress = Math.min(1, Math.max(0, value));
  bus.style.setProperty("--bus", busProgress.toFixed(4));
  if (!busArrived && busProgress >= 0.92) arriveInRio();
}
function progressFromClientX(clientX) {
  const rect = journey.getBoundingClientRect();
  const busW = bus.offsetWidth || 150;
  const travel = Math.max(rect.width - busW, 1);
  return (clientX - rect.left - busW / 2) / travel;
}
function onBusPointerDown(event) {
  if (busArrived || event.button > 0) return;
  busDragging = true;
  journey.classList.add("is-dragging");
  dragOriginX = event.clientX;
  dragOriginProgress = busProgress;
  bus.setPointerCapture(event.pointerId);
  event.preventDefault();
}
function onBusPointerMove(event) {
  if (!busDragging) return;
  const rect = journey.getBoundingClientRect();
  const busW = bus.offsetWidth || 150;
  const travel = Math.max(rect.width - busW, 1);
  const delta = (event.clientX - dragOriginX) / travel;
  setBusProgress(dragOriginProgress + delta);
}
function onBusPointerUp(event) {
  if (!busDragging) return;
  busDragging = false;
  journey.classList.remove("is-dragging");
  try { bus.releasePointerCapture(event.pointerId); } catch { /* already released */ }
}
bus.addEventListener("pointerdown", onBusPointerDown);
bus.addEventListener("pointermove", onBusPointerMove);
bus.addEventListener("pointerup", onBusPointerUp);
bus.addEventListener("pointercancel", onBusPointerUp);
setBusProgress(0.02);

function launchFireworks() {
  if (!fireworksCanvas || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    showToast("Chegou no Rio!");
    return;
  }
  const ctx = fireworksCanvas.getContext("2d");
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const resize = () => {
    fireworksCanvas.width = Math.floor(innerWidth * dpr);
    fireworksCanvas.height = Math.floor(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  fireworksCanvas.classList.add("is-on");
  const colors = ["#1E4FD8", "#4d7ef0", "#E8C468", "#fff", "#7ec8ff", "#ffd76a"];
  const bursts = [];
  const spawnBurst = (x, y) => {
    const particles = [];
    for (let i = 0; i < 42; i++) {
      const angle = (Math.PI * 2 * i) / 42 + Math.random() * 0.2;
      const speed = 2.2 + Math.random() * 4.8;
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color: colors[(Math.random() * colors.length) | 0],
        size: 1.6 + Math.random() * 2.4
      });
    }
    bursts.push({ particles });
  };
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      spawnBurst(innerWidth * (0.18 + Math.random() * 0.64), innerHeight * (0.18 + Math.random() * 0.35));
    }, i * 280);
  }
  const started = performance.now();
  const tick = now => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    bursts.forEach(burst => {
      burst.particles.forEach(p => {
        p.vy += 0.045;
        p.vx *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.012;
        if (p.life <= 0) return;
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
    });
    ctx.globalAlpha = 1;
    if (now - started < 4200) fireworksRaf = requestAnimationFrame(tick);
    else {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      fireworksCanvas.classList.remove("is-on");
      cancelAnimationFrame(fireworksRaf);
    }
  };
  fireworksRaf = requestAnimationFrame(tick);
  addEventListener("resize", resize, { once: true });
}
function arriveInRio() {
  busArrived = true;
  setBusProgress(1);
  journey.classList.add("arrived");
  if (busHint) busHint.hidden = true;
  bus.setAttribute("aria-label", "Ônibus chegou ao Rio de Janeiro");
  launchFireworks();
  showToast("Chegou no Rio!");
}

function onScroll() {
  document.body.classList.toggle("scrolled", scrollY > innerHeight * .75);
}
addEventListener("scroll", onScroll, { passive: true });
onScroll();

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
function syncWaitlistFormUi() {
  const msg = $("#waitlist-message");
  if (msg && SITE_CONFIG.waitlistMessage) msg.textContent = SITE_CONFIG.waitlistMessage;
  const label = $(".submit-label", signupForm);
  if (label) label.textContent = waitlistMode ? "Entrar na lista de espera" : "Inscrever-se";
  const mobileText = $("#mobile-cta-text");
  const mobileLink = $("#mobile-cta-link");
  if (mobileText) mobileText.innerHTML = waitlistMode ? "<b>Lista de espera</b>" : "<b>05/12</b> · R$ 30";
  if (mobileLink) {
    mobileLink.textContent = waitlistMode ? "Entrar na espera" : "Inscrever-se";
    mobileLink.hidden = false;
    mobileLink.setAttribute("aria-hidden", "false");
  }
}
function setCapacity(count, capacity = tourCapacity) {
  tourCapacity = Number(capacity) || SITE_CONFIG.capacity;
  const registered = Math.min(Number(count) || 0, tourCapacity);
  const remaining = Math.max(tourCapacity - registered, 0);
  waitlistMode = Boolean(SITE_CONFIG.waitlistOpen) || remaining === 0;
  $("#seats-lead").textContent = waitlistMode
    ? "Entre na lista de espera pela ficha ao lado."
    : "A ficha reserva o seu lugar. O PIX de R$ 30 confirma.";
  $("#closed-banner").hidden = !waitlistMode;
  syncWaitlistFormUi();
  // Keep the form hidden after a successful signup (success panel is showing).
  const successShown = !$("#success-panel").hidden;
  signupForm.hidden = successShown;
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
    body{margin:0;background:#d9e4f4;color:#163a9c;font:15px/1.7 Sora,system-ui,sans-serif}
    .sheet{max-width:920px;margin:28px auto;padding:48px 52px 40px;background:#fff;border:1px solid #c9d7ee;box-shadow:0 18px 40px rgba(22,58,156,.12)}
    .letterhead{display:flex;align-items:center;gap:20px;padding-bottom:24px;border-bottom:3px solid var(--blue);margin-bottom:32px}
    .letterhead img{width:76px;height:76px;object-fit:contain;border-radius:50%;flex:none}
    .letterhead p{margin:0;letter-spacing:.16em;text-transform:uppercase;font-size:11px;font-weight:700;color:var(--blue)}
    .letterhead h1{margin:8px 0 0;font:italic 700 30px/1.15 "Libre Baskerville",Georgia,serif;color:var(--ink);letter-spacing:0;text-transform:none}
    .letterhead small{display:block;margin-top:8px;color:var(--muted);font-size:13px;letter-spacing:0;text-transform:none;font-weight:400}
    h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--blue);margin:36px 0 14px}
    p{margin:0 0 16px;line-height:1.75}
    .lead{font-size:15px;line-height:1.85;margin-bottom:8px}
    .meta{display:flex;flex-wrap:wrap;gap:10px 20px;margin:0 0 22px;padding:16px 18px;background:var(--paper);border-left:4px solid var(--blue)}
    .meta b{color:var(--ink)}
    .details{background:var(--paper);padding:22px 24px;border-radius:8px;line-height:1.75}
    .details p{margin:0 0 12px}
    .details p:last-child{margin-bottom:0}
    .details .row{margin:0 0 10px}
    .details .note{margin:14px 0 0;padding-top:12px;border-top:1px solid #d5e0f2}
    .details ol{margin:16px 0 0;padding-left:22px;display:grid;gap:8px}
    .details li{padding:2px 0}
    .blank{display:inline-block;min-width:260px;min-height:1.35em;border-bottom:2px solid #8aa0c8;line-height:1.6;padding:0 6px 4px;vertical-align:baseline}
    .place-date{margin-top:22px}
    .signature{margin-top:64px;display:flex;gap:36px}
    .signature div{flex:1;text-align:center;border-top:1px solid #8aa0c8;padding-top:12px;font-size:12px;color:var(--muted);line-height:1.6;min-height:72px}
    .small{font-size:12px;color:var(--muted);line-height:1.65;margin-top:28px}
    .print-button{position:fixed;top:16px;right:16px;background:var(--blue);color:#fff;border:0;border-radius:999px;padding:12px 18px;font:700 13px Sora,sans-serif;cursor:pointer;box-shadow:0 8px 20px rgba(30,79,216,.3)}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{text-align:left;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#fff;background:var(--blue);padding:12px 10px}
    td{padding:12px 10px;border-bottom:1px solid #d5e0f2;vertical-align:top;line-height:1.55}
    tr:nth-child(even) td{background:#f7faff}
    .tag{display:inline-block;padding:3px 8px;border-radius:99px;font-size:10px;font-weight:700;letter-spacing:.04em}
    .tag-ok{background:#d9f5e5;color:#0f6b3c}
    .tag-wait{background:#fff3d6;color:#8a5a00}
    .foot{margin-top:36px;padding-top:16px;border-top:1px solid #d5e0f2;display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--muted)}
    ${extraCss}
    @media print{body{background:#fff}.sheet{margin:0;max-width:none;border:0;box-shadow:none;padding:28px 24px}.print-button{display:none}}
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
  const born = dateOnly(p.birth_date) ? formatBirth(p.birth_date) : "";
  const fill = v => v ? `<b>${escapeHtml(v)}</b>` : '<span class="blank"></span>';
  const stops = SITE_CONFIG.itinerary.slice(2).map(s => `<li>${escapeHtml(s)}</li>`).join("");
  return `${letterhead("Autorização de menor", SITE_CONFIG.tourName)}
  <p class="lead">Eu, ${fill(p.guardian_name)}, documento ${fill(p.guardian_document)}, telefone ${fill(p.guardian_phone)}, responsável legal, <b>autorizo</b> ${fill(p.full_name)}, nascido(a) em ${fill(born)}, a participar da Peregrinação Jovem em <b>${escapeHtml(SITE_CONFIG.tourDate)}</b>.</p>
  <h2>Roteiro e pagamento</h2>
  <div class="details">
    <p class="row"><b>06h00</b> Concentração — ${escapeHtml(SITE_CONFIG.meetingPoint)}</p>
    <p class="row"><b>06h30</b> Saída do ônibus</p>
    <p class="row"><b>Valor</b> R$ 30,00 via PIX para ${escapeHtml(SITE_CONFIG.pixLabel)}, ${escapeHtml(SITE_CONFIG.pixName)}</p>
    <p class="row"><b>Envie o comprovante no WhatsApp de ${escapeHtml(SITE_CONFIG.pixName)}:</b> ${escapeHtml(SITE_CONFIG.pixLabel)}.</p>
    <p class="note"><b>A vaga só é confirmada depois do pagamento.</b> A autorização assinada deve ser entregue no dia do passeio.</p>
    <ol>${stops}</ol>
  </div>
  <h2>Declaração</h2>
  <p>Conheço o roteiro, os horários e o valor. Autorizo a ida do menor, confirmo que os dados são verdadeiros e permaneço disponível em caso de emergência.</p>
  <p class="place-date">Local e data: <span class="blank"></span>, ____/____/________.</p>
  <div class="signature"><div>Assinatura do(a) responsável<br><span>${escapeHtml(p.guardian_name || "")}</span></div><div>Telefone<br><span>${escapeHtml(p.guardian_phone || "")}</span></div></div>
  <p class="small">Entregar este documento assinado à coordenação <b>no dia do passeio</b>, na concentração (6h). Comprovante do PIX: WhatsApp de ${escapeHtml(SITE_CONFIG.pixName)}, ${escapeHtml(SITE_CONFIG.pixLabel)}.</p>
  ${printFoot()}`;
}
const downloadAuthorization = person => printShell("Autorização — Peregrinação Jovem", "", authorizationMarkup(person));
$("#blank-authorization").addEventListener("click", () => downloadAuthorization({}));

const pixWhatsapp = SITE_CONFIG.pixWhatsapp || `55${SITE_CONFIG.pixKey}`;
const receiptText = encodeURIComponent(`Olá, Welerson! Segue o comprovante do PIX de R$ 30 da Peregrinação Jovem.`);
$("#send-receipt")?.setAttribute("href", `https://wa.me/${pixWhatsapp}?text=${receiptText}`);

/* ---------- Envio da inscrição / lista de espera ---------- */
function showSignupSuccess({ waitlist = false, minor = false, participant } = {}) {
  signupForm.hidden = true;
  $("#success-panel").hidden = false;
  const title = $("#success-title");
  const body = $("#success-body");
  const paidActions = $("#success-actions-paid");
  const waitActions = $("#success-actions-waitlist");
  const authNote = $("#success-auth-note");
  if (waitlist) {
    if (title) title.textContent = "Você entrou na lista de espera.";
    if (body) {
      body.innerHTML = "Se surgir vaga, a coordenação libera sua ficha por ordem e avisa no WhatsApp.";
    }
    if (paidActions) paidActions.hidden = true;
    if (waitActions) waitActions.hidden = false;
    if (authNote) authNote.hidden = true;
    $("#authorization-button").hidden = true;
  } else {
    if (title) title.textContent = "Ficha recebida. Falta o PIX.";
    if (body) {
      body.innerHTML = "Mande <b>R$ 30</b> no PIX para <b>(22) 99875-0491</b>, Welerson. Depois envie o comprovante no WhatsApp dele: <b>(22) 99875-0491</b>. Aí o lugar é seu.";
    }
    if (paidActions) paidActions.hidden = false;
    if (waitActions) waitActions.hidden = true;
    if (minor) {
      $("#authorization-button").hidden = false;
      $("#authorization-button").onclick = () => downloadAuthorization(participant);
      if (authNote) authNote.hidden = false;
    } else {
      $("#authorization-button").hidden = true;
      if (authNote) authNote.hidden = true;
    }
  }
  $("#success-panel").scrollIntoView({ behavior: "smooth", block: "center" });
}
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
    dietary_notes: (v.dietary_notes || "").trim() || null, observations: null, consent: true
  };
  const submit = signupForm.querySelector('[type="submit"]');
  const label = $(".submit-label", submit);
  const joiningWaitlist = waitlistMode;
  submit.disabled = true;
  label.textContent = joiningWaitlist ? "Entrando na lista de espera…" : "Enviando sua inscrição…";
  try {
    if (joiningWaitlist) {
      const result = await api("/waitlist", { method: "POST", body: { participant } });
      showSignupSuccess({ waitlist: true, participant, minor });
    } else {
      try {
        await api("/register", { method: "POST", body: { participant } });
        showSignupSuccess({ waitlist: false, minor, participant });
      } catch (error) {
        if (error.code !== "CAPACITY_REACHED") throw error;
        await api("/waitlist", { method: "POST", body: { participant } });
        waitlistMode = true;
        syncWaitlistFormUi();
        $("#closed-banner").hidden = false;
        showSignupSuccess({ waitlist: true, participant, minor });
      }
    }
    await loadCapacity();
  } catch (error) {
    console.error("Falha na inscrição:", error);
    let message = joiningWaitlist
      ? "Não foi possível entrar na lista de espera. Tente novamente."
      : "Não foi possível concluir a inscrição. Tente novamente.";
    if (error.code === "DUPLICATE_REGISTRATION") {
      message = joiningWaitlist
        ? "Você já está na lista de espera ou já tem inscrição com este documento/nome."
        : "Já existe inscrição com este documento ou com este nome e data de nascimento.";
    } else if (error.code === "INVALID_PARTICIPANT") message = "Confira os campos obrigatórios e os dados do responsável.";
    else if (error.message && !error.message.startsWith("HTTP_")) message = error.message;
    $("#form-error").textContent = message;
    submit.disabled = false;
    label.textContent = joiningWaitlist ? "Entrar na lista de espera" : "Inscrever-se";
  }
});
$("#share-after-waitlist")?.addEventListener("click", () => $("#share-after")?.click());

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
function whatsappNumber(person) {
  const phone = digits(person?.phone || "");
  return phone.length >= 10 && !phone.startsWith("55") ? `55${phone}` : phone;
}
function whatsappContactLink(person) {
  return `https://wa.me/${whatsappNumber(person)}`;
}
function whatsappPromoteLink(person) {
  const text = encodeURIComponent(SITE_CONFIG.waitlistPromoteWhatsappText
    || "Oi! Liberamos uma vaga na Peregrinação Jovem. Sua ficha já virou inscrição — mande o PIX de R$ 30 para confirmar.");
  return `https://wa.me/${whatsappNumber(person)}?text=${text}`;
}
function notifyPromoted(person) {
  if (!person?.phone) return;
  showToast(`${person.full_name} saiu da espera e entrou nas inscritos. Avisar no WhatsApp?`);
  window.open(whatsappPromoteLink(person), "_blank", "noopener");
}
async function loadWaitlist() {
  const data = await api("/waitlist", { auth: true });
  waitlist = data?.data || [];
}
async function loadRegistrations() {
  $("#registrations-body").innerHTML = '<tr><td colspan="8" class="empty-table">Carregando fichas…</td></tr>';
  const [regData] = await Promise.all([
    api("/registrations", { auth: true }),
    loadWaitlist().catch(error => { console.error(error); waitlist = []; })
  ]);
  registrations = regData?.data || [];
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
  registrations = []; waitlist = []; visible = [];
  $("#dashboard-dialog").close();
  showToast("Sessão encerrada.");
}
function renderWaitlistPanel() {
  const panel = $("#waitlist-panel");
  const body = $("#waitlist-body");
  if (!panel || !body) return;
  const show = waitlist.length > 0 || Boolean(SITE_CONFIG.waitlistOpen);
  panel.hidden = !show;
  $("#stat-waitlist").textContent = waitlist.length;
  const ordered = [...waitlist].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  body.innerHTML = ordered.length ? ordered.map((p, index) => {
    const when = p.created_at ? new Date(p.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
    return `<tr>
      <td data-label="#">${index + 1}</td>
      <td data-label="Participante"><b>${escapeHtml(p.full_name)}</b><small>${ageLabel(p.birth_date)} · ${escapeHtml(formatBirth(p.birth_date))}</small></td>
      <td data-label="Contato"><span class="dash-cell-stack">${escapeHtml(p.phone)}<small>${escapeHtml(p.email)}</small></span></td>
      <td data-label="Entrou">${escapeHtml(when)}</td>
      <td data-label="Ações" class="waitlist-actions">
        <button class="btn btn-gold sm" type="button" data-waitlist-action="promote" data-id="${p.id}">Virar inscrição</button>
        <a class="btn btn-ghost sm" href="${whatsappContactLink(p)}" target="_blank" rel="noreferrer">WhatsApp</a>
        <button class="table-icon danger-icon" type="button" title="Remover da espera" aria-label="Remover ${escapeHtml(p.full_name)} da espera" data-waitlist-action="remove" data-id="${p.id}">×</button>
      </td>
    </tr>`;
  }).join("") : `<tr class="dash-empty-row"><td colspan="5" class="empty-table">Ninguém na lista de espera ainda.</td></tr>`;
  waitlist = ordered;
}
function renderDashboard() {
  const paidCount = registrations.filter(isPaid).length;
  const remaining = Math.max(tourCapacity - registrations.length, 0);
  const waitlistOpen = Boolean(SITE_CONFIG.waitlistOpen) || remaining === 0;
  $("#stat-total").textContent = registrations.length;
  $("#stat-paid").textContent = paidCount;
  $("#stat-unpaid").textContent = registrations.length - paidCount;
  $("#stat-remaining").textContent = remaining;
  const remainingLabel = $("#stat-remaining-label");
  const remainingCard = $("#stat-remaining-card");
  if (remainingLabel) remainingLabel.textContent = "Vagas livres";
  if (remainingCard) remainingCard.classList.toggle("stat-waitlist", waitlistOpen && remaining === 0);
  const dashWaitlist = $("#dash-waitlist");
  if (dashWaitlist) dashWaitlist.hidden = !waitlistOpen;
  const dashSub = $("#dash-sub");
  if (dashSub) {
    dashSub.textContent = waitlistOpen
      ? "Site em lista de espera · vaga confirmada somente com PIX pago."
      : "Vaga confirmada somente com PIX pago.";
  }
  renderWaitlistPanel();
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
  const waitlistNote = waitlist.length ? ` · ${waitlist.length} na espera` : (waitlistOpen ? " · lista de espera aberta" : "");
  $("#dash-count").textContent = visible.length === registrations.length
    ? `${registrations.length} ficha(s) · ${paidCount} confirmada(s) com PIX${waitlistNote}.`
    : `Exibindo ${visible.length} de ${registrations.length} ficha(s)${waitlistNote}.`;
  $("#registrations-body").innerHTML = visible.length ? visible.map(p => {
    const minor = ageAt(p.birth_date) < 18;
    const done = p.authorization_status === "delivered";
    const paid = isPaid(p);
    const note = (p.dietary_notes || "").trim();
    const auth = minor
      ? `<button class="status-pill ${done ? "status-done" : "status-pending"}" data-action="authorization" data-id="${p.id}">${done ? "Entregue" : "Pendente"}</button><button class="table-icon" title="Reemitir autorização" aria-label="Reemitir autorização de ${escapeHtml(p.full_name)}" data-action="reissue" data-id="${p.id}">⤓</button>`
      : '<span class="muted">—</span>';
    return `<tr class="${paid ? "row-paid" : "row-unpaid"}">
      <td class="dash-cell-name" data-label="Participante">
        <b>${escapeHtml(p.full_name)}</b>${minor ? ' <span class="minor-tag">menor</span>' : ""}
        <small>${ageLabel(p.birth_date)} · ${escapeHtml(formatBirth(p.birth_date))} · ${escapeHtml(p.document_number)}</small>
        ${note ? `<small class="dash-note-line">${escapeHtml(note)}</small>` : ""}
        <span class="dash-mobile-meta">
          <span>${escapeHtml(p.phone)}</span>
          <span>${escapeHtml(p.email)}</span>
          <span>Emerg.: ${escapeHtml(p.emergency_name)} · ${escapeHtml(p.emergency_phone)}</span>
          ${minor && p.guardian_name ? `<span>Resp.: ${escapeHtml(p.guardian_name)} · ${escapeHtml(p.guardian_phone || "")}</span>` : ""}
        </span>
      </td>
      <td class="dash-cell-pix" data-label="PIX"><button class="status-pill ${paid ? "status-done" : "status-pending"}" data-action="payment" data-id="${p.id}">${paid ? "Pago" : "Aguardando"}</button></td>
      <td class="dash-cell-contact" data-label="Contato"><span class="dash-cell-stack">${escapeHtml(p.phone)}<small>${escapeHtml(p.email)}</small></span></td>
      <td class="dash-cell-emergency" data-label="Emergência"><span class="dash-cell-stack">${escapeHtml(p.emergency_name)}<small>${escapeHtml(p.emergency_phone)}</small></span></td>
      <td class="dash-cell-guardian${minor ? "" : " is-empty"}" data-label="Responsável"><span class="dash-cell-stack">${escapeHtml(p.guardian_name || "—")}<small>${escapeHtml(p.guardian_phone || "")}</small></span></td>
      <td class="dash-cell-auth dash-cell-actions${minor ? "" : " is-empty"}" data-label="Autorização">${auth}</td>
      <td class="dash-cell-attend" data-label="Presença"><label class="checkin"><input type="checkbox" data-action="attendance" data-id="${p.id}" ${p.attended ? "checked" : ""}><span>${p.attended ? "Presente" : "Check-in"}</span></label></td>
      <td class="dash-cell-actions" data-label="Ações"><button class="table-icon" title="Editar" aria-label="Editar ${escapeHtml(p.full_name)}" data-action="edit" data-id="${p.id}">✎</button><button class="table-icon danger-icon" title="Remover" aria-label="Remover ${escapeHtml(p.full_name)}" data-action="remove" data-id="${p.id}">×</button></td>
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
    if (!confirm(`Remover a inscrição de ${person.full_name}? Se houver lista de espera, o 1º da fila vira inscrição automaticamente.`)) return;
    try {
      const result = await api(`/registrations/${person.id}`, { method: "DELETE", auth: true });
      registrations = registrations.filter(p => p.id !== person.id);
      if (result?.promoted) {
        await loadRegistrations();
        await loadCapacity();
        notifyPromoted(result.promoted);
      } else {
        renderDashboard();
        showToast("Inscrição removida.");
        await loadCapacity();
      }
    } catch (error) { console.error(error); showToast("Não foi possível remover a inscrição.", true); }
  }
});
async function promoteWaitlistEntry(id) {
  const result = await api(`/waitlist/${id}/promote`, { method: "POST", auth: true });
  await loadRegistrations();
  await loadCapacity();
  if (result?.promoted) notifyPromoted(result.promoted);
  else showToast("Participante promovido para inscritos.");
}
$("#waitlist-body")?.addEventListener("click", async event => {
  const control = event.target.closest("[data-waitlist-action]");
  if (!control) return;
  const person = waitlist.find(p => p.id === control.dataset.id);
  if (!person) return;
  const action = control.dataset.waitlistAction;
  if (action === "promote") {
    if (!confirm(`Passar ${person.full_name} da espera para inscritos?`)) return;
    try { await promoteWaitlistEntry(person.id); }
    catch (error) {
      console.error(error);
      showToast(error.code === "CAPACITY_REACHED" ? "Não há vaga livre para promover." : "Não foi possível promover.", true);
    }
  } else if (action === "remove") {
    if (!confirm(`Remover ${person.full_name} da lista de espera?`)) return;
    try {
      await api(`/waitlist/${person.id}`, { method: "DELETE", auth: true });
      waitlist = waitlist.filter(p => p.id !== person.id);
      renderDashboard();
      showToast("Removido da lista de espera.");
    } catch (error) {
      console.error(error);
      showToast("Não foi possível remover da espera.", true);
    }
  }
});
$("#promote-next-waitlist")?.addEventListener("click", async () => {
  if (!waitlist.length) { showToast("Lista de espera vazia.", true); return; }
  const first = waitlist[0];
  if (!confirm(`Promover o 1º da fila (${first.full_name})?`)) return;
  try { await promoteWaitlistEntry(first.id); }
  catch (error) {
    console.error(error);
    showToast(error.code === "CAPACITY_REACHED" ? "Não há vaga livre para promover." : "Não foi possível promover.", true);
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
