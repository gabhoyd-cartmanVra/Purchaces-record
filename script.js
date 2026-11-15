/* ==========================================================================
   NXTsavings — Frontend Application Controller (FastAPI + Direct Supabase Hybrid)
   ========================================================================== */

const NG_SUPABASE_URL = "https://aswdqhmityjxyerblsfo.supabase.co";
const NG_SUPABASE_KEY = "sb_publishable_zOQEgkqE7PcpsqTOFUWN2w_Om3JjrxJ";
const DEFAULT_PASS = "Ng90071";

const appState = {
  authenticated: localStorage.getItem("nxt_authenticated") === "true",
  backendMode: "fastapi", // 'fastapi' or 'static-supabase'
  supabaseClient: null,
  rawStore: { semanas: [], pending_purchases: [] },
  realCurrentWeek: 41,
  selectedWeek: 41,
  rate: 100.0,
  rateSource: "Binance P2P",
  rateUpdatedAt: "",
  logoBase64: "",
  weekData: null,
  metrics: null,
  pendingPurchases: [],
  recordCompressedFiles: [],
  editCompressedFiles: [],
};

// ==========================================================================
// UTILITY HELPERS & IMAGE COMPRESSION
// ==========================================================================
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 250);
  }, 3400);
}

function formatNum(num, decimals = 2) {
  const n = Number(num) || 0;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "0 KB";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function getISOWeekNumber() {
  const d = new Date();
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return Math.max(41, weekNo);
}

function nowFormatted() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Automatically compresses phone camera photos in the browser using Canvas
 * so users never need external tools like iloveimg.com.
 */
async function compressImageFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf" || file.type === "application/pdf") {
    return {
      file,
      originalSize: file.size,
      compressedSize: file.size,
      previewUrl: null,
      isPdf: true,
    };
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1400;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve({
                file,
                originalSize: file.size,
                compressedSize: file.size,
                previewUrl: e.target.result,
                isPdf: false,
              });
              return;
            }
            const cleanBase = file.name.replace(/\.[^/.]+$/, "");
            const compressedFile = new File([blob], `${cleanBase}.jpg`, {
              type: "image/jpeg",
            });
            resolve({
              file: compressedFile,
              originalSize: file.size,
              compressedSize: compressedFile.size,
              previewUrl: URL.createObjectURL(blob),
              isPdf: false,
            });
          },
          "image/jpeg",
          0.82
        );
      };
      img.onerror = () => {
        resolve({
          file,
          originalSize: file.size,
          compressedSize: file.size,
          previewUrl: null,
          isPdf: false,
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ==========================================================================
// DUAL-MODE DATA ENGINE (FASTAPI BACKEND + STATIC SUPABASE FALLBACK)
// ==========================================================================
async function initSupabaseFallback() {
  if (!appState.supabaseClient && window.supabase) {
    appState.supabaseClient = window.supabase.createClient(
      NG_SUPABASE_URL,
      NG_SUPABASE_KEY
    );
  }
  if (!appState.logoBase64) {
    try {
      const res = await fetch("logo.txt");
      if (res.ok) {
        appState.logoBase64 = (await res.text()).trim();
      }
    } catch (_) {}
  }
}

async function fetchLiveRateStatic() {
  try {
    const res = await fetch("https://ve.dolarapi.com/v1/dolares/paralelo");
    if (res.ok) {
      const data = await res.json();
      if (data && data.promedio > 0) {
        appState.rate = Number(Number(data.promedio).toFixed(2));
        appState.rateSource = "Binance P2P / Paralelo";
        appState.rateUpdatedAt = nowFormatted();
        return;
      }
    }
  } catch (_) {}
}

function normalizeWeekLocal(sem, rate) {
  if (typeof sem.presupuesto_base !== "number") sem.presupuesto_base = 25.0;
  if (typeof sem.remanente_anterior !== "number") sem.remanente_anterior = 60.0;
  if (typeof sem.budget_funded !== "boolean") sem.budget_funded = false;
  if (!Array.isArray(sem.gastos)) sem.gastos = [];

  let totalVes = 0;
  sem.gastos.forEach((g) => {
    const p = Number(g.precio) || 0;
    totalVes += p;
    let list = Array.isArray(g.facturas)
      ? g.facturas
      : g.factura
      ? [g.factura]
      : [];
    list = list.filter(Boolean);
    g.facturas = list;
    g.factura = list[0] || null;
    if (!g.precio_usdt) {
      g.precio_usdt = rate > 0 ? Number((p / rate).toFixed(2)) : 0;
    }
  });

  sem.total_gastado = Number(totalVes.toFixed(2));
  const base = sem.budget_funded ? Number(sem.presupuesto_base) : 0;
  sem.presupuesto_disponible = Number(
    (base + Number(sem.remanente_anterior)).toFixed(2)
  );
  return sem;
}

function getOrCreateWeekLocal(store, weekNum, rate) {
  let found = store.semanas.find((s) => Number(s.numero) === Number(weekNum));
  if (found) return normalizeWeekLocal(found, rate);

  const valid = store.semanas
    .filter((s) => Number(s.numero) >= 41)
    .sort((a, b) => Number(a.numero) - Number(b.numero));
  const prevList = valid.filter((s) => Number(s.numero) < Number(weekNum));

  let rollover = 60.0;
  if (prevList.length > 0 || valid.length > 0) {
    const prev = normalizeWeekLocal(
      prevList[prevList.length - 1] || valid[valid.length - 1],
      rate
    );
    const spentUsdt = rate > 0 ? prev.total_gastado / rate : 0;
    const prevBase = prev.budget_funded ? Number(prev.presupuesto_base) : 0;
    const prevAvail = prevBase + Number(prev.remanente_anterior);
    rollover = Number((prevAvail - spentUsdt).toFixed(2));
  }

  const newWeek = {
    numero: Number(weekNum),
    presupuesto_base: 25.0,
    remanente_anterior: rollover,
    budget_funded: false,
    presupuesto_disponible: rollover,
    gastos: [],
    total_gastado: 0.0,
  };
  store.semanas.push(newWeek);
  return normalizeWeekLocal(newWeek, rate);
}

async function saveStoreStatic() {
  localStorage.setItem("nxt_backup_store", JSON.stringify(appState.rawStore));
  if (appState.supabaseClient) {
    await appState.supabaseClient
      .from("app_data")
      .upsert({ id: 1, content: appState.rawStore });
  }
}

async function loadState(weekNum = null) {
  const targetWeek = weekNum || appState.selectedWeek || getISOWeekNumber();
  try {
    const res = await fetch(`/api/state?week=${targetWeek}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok && (res.headers.get("content-type") || "").includes("json")) {
      const payload = await res.json();
      appState.backendMode = "fastapi";
      appState.realCurrentWeek = payload.real_current_week;
      appState.selectedWeek = payload.selected_week;
      appState.rate = payload.rate;
      appState.rateSource = payload.rate_source;
      appState.rateUpdatedAt = payload.rate_updated_at;
      appState.logoBase64 = payload.logo_base64 || appState.logoBase64;
      appState.weekData = payload.week;
      appState.metrics = payload.metrics;
      appState.pendingPurchases = payload.pending_purchases || [];
      renderAll();
      return;
    }
  } catch (_) {
    // Fallback to static-supabase mode (e.g., GitHub Pages)
  }

  appState.backendMode = "static-supabase";
  await initSupabaseFallback();
  if (!appState.rateUpdatedAt) {
    await fetchLiveRateStatic();
  }

  if (appState.supabaseClient) {
    try {
      const { data } = await appState.supabaseClient
        .from("app_data")
        .select("content")
        .eq("id", 1)
        .single();
      if (data && data.content) {
        appState.rawStore = data.content;
      }
    } catch (_) {}
  }

  if (!appState.rawStore.semanas) appState.rawStore.semanas = [];
  if (!appState.rawStore.pending_purchases)
    appState.rawStore.pending_purchases = [];

  appState.realCurrentWeek = getISOWeekNumber();
  appState.selectedWeek = targetWeek || appState.realCurrentWeek;
  const currentWeek = getOrCreateWeekLocal(
    appState.rawStore,
    appState.selectedWeek,
    appState.rate
  );
  await saveStoreStatic();

  const totalSpentVes = Number(currentWeek.total_gastado) || 0;
  const totalSpentUsdt =
    appState.rate > 0 ? Number((totalSpentVes / appState.rate).toFixed(2)) : 0;
  const availUsdt = Number(currentWeek.presupuesto_disponible) || 0;
  const remUsdt = Number((availUsdt - totalSpentUsdt).toFixed(2));
  const remVes = Number((remUsdt * appState.rate).toFixed(2));

  appState.weekData = currentWeek;
  appState.pendingPurchases = appState.rawStore.pending_purchases;
  appState.metrics = {
    weekly_budget_usdt: Number(currentWeek.presupuesto_base),
    rollover_usdt: Number(currentWeek.remanente_anterior),
    available_budget_usdt: availUsdt,
    total_spent_ves: totalSpentVes,
    total_spent_usdt: totalSpentUsdt,
    remaining_balance_usdt: remUsdt,
    remaining_balance_ves: remVes,
  };
  renderAll();
}

// ==========================================================================
// UI RENDERING
// ==========================================================================
function renderAll() {
  // Logos
  if (appState.logoBase64) {
    const src = `data:image/png;base64,${appState.logoBase64}`;
    const hLogo = document.getElementById("header-logo");
    const lLogo = document.getElementById("login-logo");
    if (hLogo) {
      hLogo.src = src;
      hLogo.classList.remove("hidden");
    }
    if (lLogo) {
      lLogo.src = src;
      lLogo.classList.remove("hidden");
    }
  }

  // Header Rate
  const rateValEl = document.getElementById("header-rate-value");
  if (rateValEl) rateValEl.textContent = `VES ${formatNum(appState.rate)}`;
  const rateSourceEl = document.getElementById("rate-source-label");
  if (rateSourceEl)
    rateSourceEl.textContent = `USDT (${appState.rateSource || "Binance"}):`;

  const lastUpdEl = document.getElementById("rate-last-updated");
  if (lastUpdEl) {
    lastUpdEl.textContent = appState.rateUpdatedAt
      ? `Última sincronización: ${appState.rateUpdatedAt} (${appState.rateSource})`
      : "";
  }

  // Auth vs Workspace visibility
  const authView = document.getElementById("auth-view");
  const appView = document.getElementById("app-view");
  const logoutBtn = document.getElementById("btn-logout");
  const mobileNav = document.getElementById("mobile-bottom-nav");

  if (!appState.authenticated) {
    authView.classList.remove("hidden");
    appView.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    mobileNav.classList.add("hidden");
    renderPendingLists();
    return;
  }

  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  mobileNav.classList.remove("hidden");

  // Week Controls
  document.getElementById("real-week-caption").textContent =
    `Semana calendario actual: Semana ${appState.realCurrentWeek}`;
  const weekInput = document.getElementById("input-week-num");
  if (document.activeElement !== weekInput) {
    weekInput.value = appState.selectedWeek;
  }

  document.querySelectorAll(".week-label-inline").forEach((el) => {
    el.textContent = `Semana ${appState.selectedWeek}`;
  });

  renderPendingLists();
  renderFundingAndMetrics();
  renderSummaryTable();
  renderEditSection();
  renderSettingsInputs();
  updateLiveConversions();
}

function renderPendingLists() {
  const items = appState.pendingPurchases || [];
  const pubCount = document.getElementById("pub-pending-count");
  const sbCount = document.getElementById("sb-pending-count");
  if (pubCount) pubCount.textContent = `${items.length} pendiente(s)`;
  if (sbCount) sbCount.textContent = String(items.length);

  const buildBadge = (prio) => {
    if (prio === "High") return `<span class="badge badge-high">🔴 Alta</span>`;
    if (prio === "Low") return `<span class="badge badge-low">🟢 Baja</span>`;
    return `<span class="badge badge-medium">🟡 Media</span>`;
  };

  // Public list
  const pubContainer = document.getElementById("pub-pending-list");
  if (pubContainer) {
    if (items.length === 0) {
      pubContainer.innerHTML = `<div class="card-subtitle" style="padding:12px 0;">No hay insumos pendientes registrados.</div>`;
    } else {
      pubContainer.innerHTML = items
        .map(
          (it, idx) => `
        <div class="pending-row">
          <div>
            <div style="font-weight: 600; font-size: 0.9rem;">${escapeHtml(it.item)}</div>
            <div style="font-size: 0.74rem; color: var(--text-secondary);">${it.date_added || ""}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${buildBadge(it.priority)}
            <button type="button" class="btn btn-danger btn-sm" onclick="handleDeletePending(${idx})" title="Eliminar pendiente">🗑️</button>
          </div>
        </div>
      `
        )
        .join("");
    }
  }

  // Sidebar list
  const sbContainer = document.getElementById("sb-pending-list");
  if (sbContainer) {
    if (items.length === 0) {
      sbContainer.innerHTML = `<div class="card-subtitle">Sin insumos pendientes.</div>`;
    } else {
      sbContainer.innerHTML = items
        .map(
          (it, idx) => `
        <div class="pending-row">
          <div style="min-width: 0; flex: 1;">
            <div style="font-weight: 600; font-size: 0.85rem; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(it.item)}</div>
            <div style="margin-top: 2px;">${buildBadge(it.priority)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:5px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="prefillExpenseFromPending(${idx})" title="Cargar en Registrar Gasto">⚡</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="handleDeletePending(${idx})" title="Quitar de pendientes">🗑️</button>
          </div>
        </div>
      `
        )
        .join("");
    }
  }
}

function renderFundingAndMetrics() {
  if (!appState.weekData || !appState.metrics) return;
  const w = appState.weekData;
  const m = appState.metrics;
  const r = appState.rate || 100;

  const banner = document.getElementById("funding-banner");
  const icon = document.getElementById("funding-icon");
  const title = document.getElementById("funding-title");
  const subtitle = document.getElementById("funding-subtitle");
  const btn = document.getElementById("btn-toggle-fund");

  if (w.budget_funded) {
    banner.className = "funding-banner is-funded";
    icon.textContent = "✅";
    title.textContent = `Semana ${w.numero} fondeada (+${formatNum(w.presupuesto_base)} USDT sumados al disponible)`;
    subtitle.textContent =
      "El presupuesto semanal aprobado ya fue transferido e incluido en el saldo disponible.";
    btn.className = "btn btn-secondary";
    btn.textContent = `➖ Revertir Fondeo (-${formatNum(w.presupuesto_base)} USDT)`;
  } else {
    banner.className = "funding-banner is-unfunded";
    icon.textContent = "ℹ️";
    title.textContent = `Presupuesto de Semana ${w.numero} pendiente por transferir`;
    subtitle.textContent =
      "Haz clic en el botón cuando recibas la transferencia semanal para sumarla al saldo disponible.";
    btn.className = "btn btn-primary";
    btn.textContent = `➕ Fondear Semana (+${formatNum(w.presupuesto_base)} USDT)`;
  }

  document.getElementById("kpi-budget-usdt").textContent = `$${formatNum(m.weekly_budget_usdt)} USDT`;
  document.getElementById("kpi-budget-ves").textContent = `VES ${formatNum(m.weekly_budget_usdt * r)}`;

  document.getElementById("kpi-rollover-usdt").textContent = `$${formatNum(m.rollover_usdt)} USDT`;
  document.getElementById("kpi-rollover-ves").textContent = `VES ${formatNum(m.rollover_usdt * r)}`;

  document.getElementById("kpi-spent-usdt").textContent = `$${formatNum(m.total_spent_usdt)} USDT`;
  document.getElementById("kpi-spent-ves").textContent = `VES ${formatNum(m.total_spent_ves)}`;

  const availEl = document.getElementById("kpi-avail-usdt");
  availEl.textContent = `$${formatNum(m.remaining_balance_usdt)} USDT`;
  availEl.classList.toggle("negative", m.remaining_balance_usdt < 0);
  document.getElementById("kpi-avail-ves").textContent = `VES ${formatNum(m.remaining_balance_ves)}`;
}

function getReceiptUrl(filename) {
  if (!filename) return "";
  if (appState.backendMode === "fastapi") {
    return `/api/receipts/${encodeURIComponent(filename)}`;
  }
  return `${NG_SUPABASE_URL}/storage/v1/object/public/receipts/${encodeURIComponent(filename)}`;
}

function renderSummaryTable() {
  const gastos = (appState.weekData && appState.weekData.gastos) || [];
  document.getElementById("tab-count-badge").textContent = String(gastos.length);

  const emptyEl = document.getElementById("summary-empty-state");
  const tableWrap = document.getElementById("summary-table-container");
  const tbody = document.getElementById("summary-tbody");

  if (gastos.length === 0) {
    emptyEl.classList.remove("hidden");
    tableWrap.classList.add("hidden");
    tbody.innerHTML = "";
    return;
  }

  emptyEl.classList.add("hidden");
  tableWrap.classList.remove("hidden");

  tbody.innerHTML = gastos
    .map((g, idx) => {
      const pVes = Number(g.precio) || 0;
      const pUsdt =
        Number(g.precio_usdt) ||
        (appState.rate > 0 ? pVes / appState.rate : 0);
      const receipts = Array.isArray(g.facturas)
        ? g.facturas.filter(Boolean)
        : g.factura
        ? [g.factura]
        : [];

      const receiptsHtml =
        receipts.length === 0
          ? `<span style="color:var(--text-muted); font-size:0.78rem;">Sin adjunto</span>`
          : receipts
              .map((rFile, rIdx) => {
                const ext = (rFile.split(".").pop() || "").toLowerCase();
                const icon = ext === "pdf" ? "📄" : "🖼️";
                return `<button type="button" class="receipt-chip" onclick="openReceiptModal('${escapeAttr(rFile)}', '${escapeAttr(g.producto)}')">${icon} Ver #${rIdx + 1}</button>`;
              })
              .join("");

      return `
      <tr>
        <td class="mono">${idx + 1}</td>
        <td style="font-weight: 600;">${escapeHtml(g.producto)}</td>
        <td class="mono">VES ${formatNum(pVes)}</td>
        <td class="mono" style="color: var(--accent-primary); font-weight: 600;">$${formatNum(pUsdt)} USDT</td>
        <td>${receiptsHtml}</td>
        <td style="font-size: 0.78rem; color: var(--text-secondary);">${escapeHtml(g.fecha || "")}</td>
        <td>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="jumpToEditExpense(${idx})" title="Editar este gasto">✏️</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="handleDeleteExpense(${idx})" title="Eliminar este gasto">🗑️</button>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");
}

function renderEditSection() {
  const gastos = (appState.weekData && appState.weekData.gastos) || [];
  const emptyEl = document.getElementById("edit-empty-state");
  const wrapper = document.getElementById("edit-form-wrapper");
  const selectEl = document.getElementById("edit-select-expense");

  if (gastos.length === 0) {
    emptyEl.classList.remove("hidden");
    wrapper.classList.add("hidden");
    return;
  }

  emptyEl.classList.add("hidden");
  wrapper.classList.remove("hidden");

  const prevVal = Number(selectEl.value) || 0;
  selectEl.innerHTML = gastos
    .map(
      (g, idx) =>
        `<option value="${idx}">${idx + 1}. ${escapeHtml(g.producto)} — VES ${formatNum(g.precio)}</option>`
    )
    .join("");

  const activeIdx = prevVal >= 0 && prevVal < gastos.length ? prevVal : 0;
  selectEl.value = String(activeIdx);
  populateEditFormForIndex(activeIdx);
}

function populateEditFormForIndex(idx) {
  const gastos = (appState.weekData && appState.weekData.gastos) || [];
  const target = gastos[idx];
  if (!target) return;

  document.getElementById("edit-expense-name").value = target.producto || "";
  document.getElementById("edit-expense-price").value = target.precio || 0;
  appState.editCompressedFiles = [];
  document.getElementById("edit-file-previews").innerHTML = "";
  document.getElementById("edit-expense-files").value = "";

  const receipts = Array.isArray(target.facturas)
    ? target.facturas.filter(Boolean)
    : target.factura
    ? [target.factura]
    : [];

  const currContainer = document.getElementById("edit-current-receipts");
  if (receipts.length === 0) {
    currContainer.innerHTML = `<span class="card-subtitle">Este gasto no tiene comprobantes adjuntos actualmente.</span>`;
  } else {
    currContainer.innerHTML = receipts
      .map(
        (rFile, i) =>
          `<button type="button" class="receipt-chip" onclick="openReceiptModal('${escapeAttr(rFile)}', '${escapeAttr(target.producto)}')">📎 Ver comprobante actual #${i + 1} (${escapeHtml(rFile)})</button>`
      )
      .join("");
  }
  updateLiveConversions();
}

function renderSettingsInputs() {
  if (!appState.weekData) return;
  const bInput = document.getElementById("setting-base-budget");
  const rInput = document.getElementById("setting-rollover");
  const mInput = document.getElementById("setting-manual-rate");

  if (document.activeElement !== bInput) {
    bInput.value = Number(appState.weekData.presupuesto_base).toFixed(2);
  }
  if (document.activeElement !== rInput) {
    rInput.value = Number(appState.weekData.remanente_anterior).toFixed(2);
  }
  if (document.activeElement !== mInput) {
    mInput.value = Number(appState.rate).toFixed(2);
  }
}

function updateLiveConversions() {
  const rate = appState.rate || 100;
  const recVes = Number(document.getElementById("expense-price-ves").value) || 0;
  const recUsdt = rate > 0 ? recVes / rate : 0;
  document.getElementById("expense-live-usdt").textContent = `$${formatNum(recUsdt)} USDT`;

  const editVesEl = document.getElementById("edit-expense-price");
  if (editVesEl) {
    const editVes = Number(editVesEl.value) || 0;
    const editUsdt = rate > 0 ? editVes / rate : 0;
    document.getElementById("edit-live-usdt").textContent = `$${formatNum(editUsdt)} USDT`;
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return String(str || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

// ==========================================================================
// INTERACTIVE ACTIONS & API CALLS
// ==========================================================================
window.openReceiptModal = function (filename, itemTitle) {
  const modal = document.getElementById("receipt-modal");
  const title = document.getElementById("modal-title");
  const subtitle = document.getElementById("modal-subtitle");
  const body = document.getElementById("modal-body");

  title.textContent = `📎 ${itemTitle || "Comprobante"}`;
  subtitle.textContent = filename;

  const url = getReceiptUrl(filename);
  const ext = (filename.split(".").pop() || "").toLowerCase();

  if (ext === "pdf") {
    body.innerHTML = `
      <div style="padding: 24px;">
        <p style="margin-bottom: 14px;">Este comprobante es un documento PDF.</p>
        <a href="${url}" target="_blank" download="${escapeAttr(filename)}" class="btn btn-primary">
          📄 Abrir / Descargar Comprobante PDF
        </a>
      </div>
    `;
  } else {
    body.innerHTML = `
      <img src="${url}" alt="Comprobante" class="modal-receipt-img" />
      <div style="margin-top: 14px;">
        <a href="${url}" target="_blank" download="${escapeAttr(filename)}" class="btn btn-secondary btn-sm">
          ⬇️ Descargar Imagen Original
        </a>
      </div>
    `;
  }
  modal.classList.remove("hidden");
};

window.prefillExpenseFromPending = function (idx) {
  const item = appState.pendingPurchases[idx];
  if (!item) return;
  document.getElementById("record-resolve-pending-idx").value = String(idx);
  document.getElementById("resolving-pending-label").textContent = item.item;
  document.getElementById("resolving-pending-banner").classList.remove("hidden");
  document.getElementById("expense-name").value = item.item;
  switchTab("tab-record");
  document.getElementById("expense-price-ves").focus();
  showToast(`Cargado "${item.item}" en el formulario de gasto.`);
};

window.jumpToEditExpense = function (idx) {
  const selectEl = document.getElementById("edit-select-expense");
  if (selectEl) {
    selectEl.value = String(idx);
    populateEditFormForIndex(idx);
  }
  switchTab("tab-edit");
};

window.handleDeletePending = async function (idx) {
  try {
    if (appState.backendMode === "fastapi") {
      const res = await fetch(`/api/pending/${idx}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar pendiente.");
    } else {
      appState.rawStore.pending_purchases.splice(idx, 1);
      await saveStoreStatic();
    }
    showToast("Insumo pendiente eliminado.");
    await loadState(appState.selectedWeek);
  } catch (err) {
    showToast(err.message || "Error al eliminar pendiente.", "error");
  }
};

window.handleDeleteExpense = async function (idx) {
  const gastos = (appState.weekData && appState.weekData.gastos) || [];
  const target = gastos[idx];
  if (!target) return;
  if (!confirm(`¿Seguro que deseas eliminar el gasto "${target.producto}" (VES ${formatNum(target.precio)})?`)) {
    return;
  }

  try {
    if (appState.backendMode === "fastapi") {
      const res = await fetch(
        `/api/week/${appState.selectedWeek}/expenses/${idx}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("No se pudo eliminar el gasto.");
    } else {
      appState.weekData.gastos.splice(idx, 1);
      normalizeWeekLocal(appState.weekData, appState.rate);
      await saveStoreStatic();
    }
    showToast(`Gasto "${target.producto}" eliminado.`);
    await loadState(appState.selectedWeek);
  } catch (err) {
    showToast(err.message || "Error al eliminar gasto.", "error");
  }
};

function switchTab(tabId) {
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== tabId);
  });
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
}

async function handleFileSelection(inputEl, previewContainerId, targetKey) {
  const rawFiles = Array.from(inputEl.files || []);
  if (rawFiles.length === 0) return;

  if (rawFiles.length > 3) {
    showToast("Máximo 3 comprobantes permitidos por gasto. Se tomarán los primeros 3.", "error");
  }
  const slice = rawFiles.slice(0, 3);
  const container = document.getElementById(previewContainerId);
  container.innerHTML = `<div class="card-subtitle">Comprimiendo y optimizando comprobantes...</div>`;

  const processed = [];
  for (const f of slice) {
    const item = await compressImageFile(f);
    processed.push(item);
  }
  appState[targetKey] = processed;

  container.innerHTML = processed
    .map((p, idx) => {
      if (p.isPdf) {
        return `
          <div class="preview-item">
            <div style="height:86px; display:flex; align-items:center; justify-content:center; font-size:2rem;">📄</div>
            <div class="preview-meta">${escapeHtml(p.file.name)} (${formatBytes(p.compressedSize)})</div>
          </div>
        `;
      }
      const savedRatio =
        p.originalSize > p.compressedSize
          ? `${formatBytes(p.originalSize)} → ${formatBytes(p.compressedSize)}`
          : formatBytes(p.compressedSize);
      return `
        <div class="preview-item">
          <img src="${p.previewUrl}" alt="Vista previa ${idx + 1}" />
          <div class="preview-meta">✅ ${savedRatio}</div>
        </div>
      `;
    })
    .join("");
}

// ==========================================================================
// CLIENT-SIDE FALLBACK PDF GENERATOR (WHEN RUNNING ON GITHUB PAGES)
// ==========================================================================
async function generateClientSidePdf() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast("Generador PDF cargando, intenta en un segundo.", "error");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const w = appState.weekData;
  const m = appState.metrics;
  const r = appState.rate;

  let y = 40;
  if (appState.logoBase64) {
    try {
      doc.addImage(`data:image/png;base64,${appState.logoBase64}`, "PNG", 40, y, 110, 36);
      y += 46;
    } catch (_) {}
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("NEXTGLOBAL - WEEKLY EXPENSE REPORT", 40, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(
    `Week ${w.numero}  |  Generated: ${nowFormatted()}  |  USDT Exchange Rate: VES ${formatNum(r)}`,
    40,
    y
  );
  y += 16;

  doc.autoTable({
    startY: y,
    head: [
      [
        "Weekly Budget",
        "Rollover / Savings",
        "Status",
        "Total Spent (Gastado)",
        "Available Balance (Disponible)",
      ],
    ],
    body: [
      [
        `$${formatNum(m.weekly_budget_usdt)} USDT`,
        `$${formatNum(m.rollover_usdt)} USDT`,
        w.budget_funded ? "Funded" : "Not Funded",
        `$${formatNum(m.total_spent_usdt)} USDT\n(VES ${formatNum(m.total_spent_ves)})`,
        `$${formatNum(m.remaining_balance_usdt)} USDT\n(VES ${formatNum(m.remaining_balance_ves)})`,
      ],
    ],
    theme: "grid",
    headStyles: { fillColor: [17, 24, 39], textColor: 255, halign: "center" },
    bodyStyles: { halign: "center", fontSize: 9 },
  });

  y = doc.lastAutoTable.finalY + 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Expenses Breakdown (Desglose de Gastos)", 40, y);
  y += 10;

  const rows = (w.gastos || []).map((g, idx) => {
    const pVes = Number(g.precio) || 0;
    const pUsdt = Number(g.precio_usdt) || (r > 0 ? pVes / r : 0);
    const recs = Array.isArray(g.facturas)
      ? g.facturas.filter(Boolean)
      : g.factura
      ? [g.factura]
      : [];
    return [
      String(idx + 1),
      g.producto || "",
      `VES ${formatNum(pVes)}`,
      `$${formatNum(pUsdt)} USDT`,
      recs.length > 0 ? `${recs.length} file(s)` : "None",
      g.fecha || "",
    ];
  });

  doc.autoTable({
    startY: y,
    head: [["#", "Item / Service Name", "Price (VES)", "Price (USDT)", "Receipts", "Date & Time"]],
    body: rows.length > 0 ? rows : [["—", "No expenses recorded", "—", "—", "—", "—"]],
    theme: "striped",
    headStyles: { fillColor: [31, 41, 55], textColor: 255 },
    bodyStyles: { fontSize: 8.5 },
  });

  doc.save(`Nextglobal_Expense_Report_Week_${w.numero}.pdf`);
}

// ==========================================================================
// EVENT LISTENERS INITIALIZATION
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Tabs navigation
  document.querySelectorAll(".tab-btn, .mobile-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Modal close
  document.getElementById("btn-close-modal").addEventListener("click", () => {
    document.getElementById("receipt-modal").classList.add("hidden");
  });
  document.getElementById("receipt-modal").addEventListener("click", (e) => {
    if (e.target.id === "receipt-modal") {
      document.getElementById("receipt-modal").classList.add("hidden");
    }
  });

  // Login Form
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = document.getElementById("login-password").value;
    const remember = document.getElementById("login-remember").checked;

    try {
      if (appState.backendMode === "fastapi") {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pass }),
        });
        if (!res.ok) {
          throw new Error("Contraseña incorrecta. Intenta de nuevo.");
        }
      } else if (pass !== DEFAULT_PASS) {
        throw new Error("Contraseña incorrecta. Intenta de nuevo.");
      }

      appState.authenticated = true;
      if (remember) {
        localStorage.setItem("nxt_authenticated", "true");
      }
      document.getElementById("login-password").value = "";
      showToast("✅ Bienvenido al portal Nextglobal.");
      renderAll();
    } catch (err) {
      showToast(err.message || "Error de autenticación", "error");
    }
  });

  // Logout
  document.getElementById("btn-logout").addEventListener("click", () => {
    appState.authenticated = false;
    localStorage.removeItem("nxt_authenticated");
    showToast("Sesión cerrada.");
    renderAll();
  });

  // Public & Sidebar Add Pending Purchase
  async function submitPendingItem(nameInputId, prioSelectId) {
    const nameEl = document.getElementById(nameInputId);
    const prioEl = document.getElementById(prioSelectId);
    const item = nameEl.value.trim();
    const priority = prioEl.value;
    if (!item) return;

    try {
      if (appState.backendMode === "fastapi") {
        const res = await fetch("/api/pending", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item, priority, notes: "" }),
        });
        if (!res.ok) throw new Error("Error al guardar pendiente.");
      } else {
        appState.rawStore.pending_purchases.push({
          item,
          priority,
          notes: "",
          date_added: nowFormatted(),
        });
        await saveStoreStatic();
      }
      nameEl.value = "";
      showToast(`"${item}" añadido a compras pendientes.`);
      await loadState(appState.selectedWeek);
    } catch (err) {
      showToast(err.message || "Error al guardar pendiente.", "error");
    }
  }

  document.getElementById("pub-pending-form").addEventListener("submit", (e) => {
    e.preventDefault();
    submitPendingItem("pub-pending-name", "pub-pending-prio");
  });

  document.getElementById("sb-pending-form").addEventListener("submit", (e) => {
    e.preventDefault();
    submitPendingItem("sb-pending-name", "sb-pending-prio");
  });

  // Week Stepper & Sync
  document.getElementById("btn-prev-week").addEventListener("click", () => {
    const next = Math.max(41, Number(appState.selectedWeek) - 1);
    loadState(next);
  });
  document.getElementById("btn-next-week").addEventListener("click", () => {
    const next = Number(appState.selectedWeek) + 1;
    loadState(next);
  });
  document.getElementById("input-week-num").addEventListener("change", (e) => {
    const val = Math.max(41, Number(e.target.value) || appState.realCurrentWeek);
    loadState(val);
  });
  document.getElementById("btn-sync-real-week").addEventListener("click", () => {
    loadState(appState.realCurrentWeek);
    showToast(`Sincronizado con Semana ${appState.realCurrentWeek}`);
  });

  // Fund / Unfund Week Toggle
  document.getElementById("btn-toggle-fund").addEventListener("click", async () => {
    if (!appState.weekData) return;
    const newFunded = !appState.weekData.budget_funded;
    try {
      if (appState.backendMode === "fastapi") {
        const res = await fetch(`/api/week/${appState.selectedWeek}/fund`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ funded: newFunded }),
        });
        if (!res.ok) throw new Error("No se pudo actualizar el estado de fondeo.");
      } else {
        appState.weekData.budget_funded = newFunded;
        normalizeWeekLocal(appState.weekData, appState.rate);
        await saveStoreStatic();
      }
      showToast(
        newFunded
          ? "✅ Presupuesto semanal sumado al disponible."
          : "ℹ️ Fondeo semanal revertido."
      );
      await loadState(appState.selectedWeek);
    } catch (err) {
      showToast(err.message || "Error al actualizar fondeo.", "error");
    }
  });

  // Live conversion on price input
  document
    .getElementById("expense-price-ves")
    .addEventListener("input", updateLiveConversions);
  document
    .getElementById("edit-expense-price")
    .addEventListener("input", updateLiveConversions);

  // Dropzones & File Inputs
  document.getElementById("record-dropzone").addEventListener("click", () => {
    document.getElementById("expense-files").click();
  });
  document.getElementById("expense-files").addEventListener("change", (e) => {
    handleFileSelection(e.target, "record-file-previews", "recordCompressedFiles");
  });

  document.getElementById("edit-dropzone").addEventListener("click", () => {
    document.getElementById("edit-expense-files").click();
  });
  document.getElementById("edit-expense-files").addEventListener("change", (e) => {
    handleFileSelection(e.target, "edit-file-previews", "editCompressedFiles");
  });

  document
    .getElementById("btn-clear-resolve-pending")
    .addEventListener("click", () => {
      document.getElementById("record-resolve-pending-idx").value = "";
      document.getElementById("resolving-pending-banner").classList.add("hidden");
    });

  // Record Expense Submit
  document
    .getElementById("form-record-expense")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = document.getElementById("btn-save-expense");
      const name = document.getElementById("expense-name").value.trim();
      const priceVes = Number(
        document.getElementById("expense-price-ves").value
      );
      const resolveIdxRaw = document.getElementById(
        "record-resolve-pending-idx"
      ).value;

      if (!name || priceVes <= 0) {
        showToast("Verifica el nombre y un monto mayor a 0 VES.", "error");
        return;
      }

      btn.disabled = true;
      btn.textContent = "⏳ Guardando gasto y subiendo comprobantes...";

      try {
        if (appState.backendMode === "fastapi") {
          const fd = new FormData();
          fd.append("producto", name);
          fd.append("precio", String(priceVes));
          if (resolveIdxRaw !== "") {
            fd.append("resolve_pending_index", resolveIdxRaw);
          }
          for (const item of appState.recordCompressedFiles) {
            fd.append("receipts", item.file, item.file.name);
          }
          const res = await fetch(
            `/api/week/${appState.selectedWeek}/expenses`,
            {
              method: "POST",
              body: fd,
            }
          );
          if (!res.ok) throw new Error("Error guardando gasto en el servidor.");
        } else {
          const uploadedNames = [];
          for (const item of appState.recordCompressedFiles) {
            const ext = (item.file.name.split(".").pop() || "jpg").toLowerCase();
            const rName = `receipt_wk${appState.selectedWeek}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
            if (appState.supabaseClient) {
              await appState.supabaseClient.storage
                .from("receipts")
                .upload(rName, item.file, { upsert: true });
            }
            uploadedNames.push(rName);
          }
          const pUsdt =
            appState.rate > 0
              ? Number((priceVes / appState.rate).toFixed(2))
              : 0;
          appState.weekData.gastos.push({
            producto: name,
            precio: priceVes,
            precio_usdt: pUsdt,
            factura: uploadedNames[0] || null,
            facturas: uploadedNames,
            fecha: nowFormatted(),
          });
          if (resolveIdxRaw !== "") {
            const rIdx = Number(resolveIdxRaw);
            if (rIdx >= 0 && rIdx < appState.rawStore.pending_purchases.length) {
              appState.rawStore.pending_purchases.splice(rIdx, 1);
            }
          }
          normalizeWeekLocal(appState.weekData, appState.rate);
          await saveStoreStatic();
        }

        // Reset form
        document.getElementById("expense-name").value = "";
        document.getElementById("expense-price-ves").value = "";
        document.getElementById("expense-files").value = "";
        document.getElementById("record-file-previews").innerHTML = "";
        document.getElementById("record-resolve-pending-idx").value = "";
        document
          .getElementById("resolving-pending-banner")
          .classList.add("hidden");
        appState.recordCompressedFiles = [];

        showToast(`✅ Registrado "${name}" por VES ${formatNum(priceVes)}`);
        await loadState(appState.selectedWeek);
      } catch (err) {
        showToast(err.message || "Error al guardar gasto.", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "💾 Guardar Gasto en Semana";
      }
    });

  // Edit Select Change
  document
    .getElementById("edit-select-expense")
    .addEventListener("change", (e) => {
      populateEditFormForIndex(Number(e.target.value) || 0);
    });

  // Edit Expense Submit
  document
    .getElementById("form-edit-expense")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const idx = Number(document.getElementById("edit-select-expense").value);
      const name = document.getElementById("edit-expense-name").value.trim();
      const priceVes = Number(
        document.getElementById("edit-expense-price").value
      );
      const btn = document.getElementById("btn-update-expense");

      if (!name || priceVes <= 0) {
        showToast("Verifica el nombre y el precio en VES.", "error");
        return;
      }

      btn.disabled = true;
      btn.textContent = "⏳ Actualizando...";

      try {
        if (appState.backendMode === "fastapi") {
          const fd = new FormData();
          fd.append("producto", name);
          fd.append("precio", String(priceVes));
          fd.append("keep_existing_receipts", "true");
          for (const item of appState.editCompressedFiles) {
            fd.append("receipts", item.file, item.file.name);
          }
          const res = await fetch(
            `/api/week/${appState.selectedWeek}/expenses/${idx}`,
            {
              method: "PUT",
              body: fd,
            }
          );
          if (!res.ok) throw new Error("No se pudo actualizar el gasto.");
        } else {
          const target = appState.weekData.gastos[idx];
          if (appState.editCompressedFiles.length > 0) {
            const uploadedNames = [];
            for (const item of appState.editCompressedFiles) {
              const ext = (
                item.file.name.split(".").pop() || "jpg"
              ).toLowerCase();
              const rName = `receipt_wk${appState.selectedWeek}_${Date.now()}.${ext}`;
              if (appState.supabaseClient) {
                await appState.supabaseClient.storage
                  .from("receipts")
                  .upload(rName, item.file, { upsert: true });
              }
              uploadedNames.push(rName);
            }
            target.facturas = uploadedNames;
            target.factura = uploadedNames[0] || null;
          }
          target.producto = name;
          target.precio = priceVes;
          target.precio_usdt =
            appState.rate > 0
              ? Number((priceVes / appState.rate).toFixed(2))
              : 0;
          normalizeWeekLocal(appState.weekData, appState.rate);
          await saveStoreStatic();
        }

        appState.editCompressedFiles = [];
        document.getElementById("edit-file-previews").innerHTML = "";
        showToast(`✅ Gasto "${name}" actualizado.`);
        await loadState(appState.selectedWeek);
      } catch (err) {
        showToast(err.message || "Error al actualizar gasto.", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "💾 Guardar Cambios";
      }
    });

  // Delete from Edit Tab
  document
    .getElementById("btn-delete-selected-expense")
    .addEventListener("click", () => {
      const idx = Number(document.getElementById("edit-select-expense").value);
      window.handleDeleteExpense(idx);
    });

  // Download PDF & CSV
  document.getElementById("btn-download-pdf").addEventListener("click", () => {
    if (appState.backendMode === "fastapi") {
      window.open(`/api/week/${appState.selectedWeek}/report.pdf`, "_blank");
    } else {
      generateClientSidePdf();
    }
  });

  document.getElementById("btn-download-csv").addEventListener("click", () => {
    if (appState.backendMode === "fastapi") {
      window.open(`/api/week/${appState.selectedWeek}/report.csv`, "_blank");
      return;
    }
    const w = appState.weekData;
    const lines = ["#,Item / Service,Price (VES),Price (USDT),Date & Time"];
    (w.gastos || []).forEach((g, idx) => {
      const pVes = Number(g.precio) || 0;
      const pUsdt =
        Number(g.precio_usdt) || (appState.rate > 0 ? pVes / appState.rate : 0);
      lines.push(
        `${idx + 1},"${String(g.producto || "").replace(/"/g, '""')}",${pVes.toFixed(2)},${pUsdt.toFixed(2)},"${g.fecha || ""}"`
      );
    });
    const blob = new Blob(["\ufeff" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Nextglobal_Expenses_Week_${w.numero}.csv`;
    a.click();
  });

  // Financial Settings Save
  document
    .getElementById("form-week-settings")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const base = Number(document.getElementById("setting-base-budget").value);
      const roll = Number(document.getElementById("setting-rollover").value);

      try {
        if (appState.backendMode === "fastapi") {
          const res = await fetch(
            `/api/week/${appState.selectedWeek}/settings`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                presupuesto_base: base,
                remanente_anterior: roll,
              }),
            }
          );
          if (!res.ok) throw new Error("Error guardando configuración.");
        } else {
          appState.weekData.presupuesto_base = base;
          appState.weekData.remanente_anterior = roll;
          normalizeWeekLocal(appState.weekData, appState.rate);
          await saveStoreStatic();
        }
        showToast("✅ Presupuesto y Remanente actualizados.");
        await loadState(appState.selectedWeek);
      } catch (err) {
        showToast(err.message || "Error al actualizar ajustes.", "error");
      }
    });

  // Recalculate Rollover from Previous Week
  document
    .getElementById("btn-recalc-rollover")
    .addEventListener("click", async () => {
      try {
        if (appState.backendMode === "fastapi") {
          const res = await fetch(
            `/api/week/${appState.selectedWeek}/recalculate-rollover`,
            { method: "POST" }
          );
          if (!res.ok) throw new Error("No se pudo recalcular el remanente.");
        }
        showToast("🔄 Remanente recalculado desde la semana anterior.");
        await loadState(appState.selectedWeek);
      } catch (err) {
        showToast(err.message || "Error al recalcular remanente.", "error");
      }
    });

  // Manual Rate & Live Sync with Binance P2P
  document
    .getElementById("form-manual-rate")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const manualVal = Number(
        document.getElementById("setting-manual-rate").value
      );
      if (manualVal <= 0) return;

      try {
        if (appState.backendMode === "fastapi") {
          const res = await fetch("/api/rate/manual", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rate: manualVal }),
          });
          if (!res.ok) throw new Error("Error aplicando tasa manual.");
        } else {
          appState.rate = manualVal;
          appState.rateSource = "Manual";
          appState.rateUpdatedAt = nowFormatted();
        }
        showToast(`✅ Tasa establecida en VES ${formatNum(manualVal)}`);
        await loadState(appState.selectedWeek);
      } catch (err) {
        showToast(err.message || "Error al fijar tasa.", "error");
      }
    });

  async function triggerLiveRateSync() {
    try {
      showToast("🔄 Sincronizando tasa USDT con Binance P2P...");
      if (appState.backendMode === "fastapi") {
        const res = await fetch("/api/rate/sync", { method: "POST" });
        if (!res.ok) throw new Error("Error sincronizando tasa.");
      } else {
        await fetchLiveRateStatic();
      }
      await loadState(appState.selectedWeek);
      showToast(`✅ Tasa actualizada: VES ${formatNum(appState.rate)}`);
    } catch (err) {
      showToast(err.message || "No se pudo sincronizar la tasa.", "error");
    }
  }

  document
    .getElementById("btn-quick-sync-rate")
    .addEventListener("click", triggerLiveRateSync);
  document
    .getElementById("btn-settings-sync-binance")
    .addEventListener("click", triggerLiveRateSync);

  // Initial Load
  loadState();
});
