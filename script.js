/* ==========================================================================
   NXTsavings — Frontend Application Controller
   Connected to Nextglobal's real Supabase tables:
     - semanas (numero=0 for Global Saldo Disponible; numero>=41 for each week)
     - gastos (id, semana_numero, producto, precio, precio_usdt, factura, fecha)
     - pending_purchases (id, item, priority, notes, date_added)
     - Storage bucket: recibos
   ========================================================================== */

const NG_SUPABASE_URL = "https://aswdqhmityjxyerblsfo.supabase.co";
const NG_SUPABASE_KEY = "sb_publishable_zOQEgkqE7PcpsqTOFUWN2w_Om3JjrxJ";
const STORAGE_BUCKET = "recibos";
const DEFAULT_PASS = "Ng90071";

const appState = {
  authenticated: localStorage.getItem("nxt_authenticated") === "true",
  backendMode: "detecting", // 'fastapi' or 'supabase-direct'
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
// UTILITY HELPERS & AUTOMATIC IMAGE COMPRESSION
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

function todayDateStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowFormatted() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

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
// DIRECT SUPABASE REST & STORAGE CLIENT (FOR GITHUB PAGES & FALLBACK)
// ==========================================================================
function sbHeaders(extra = {}) {
  return {
    apikey: NG_SUPABASE_KEY,
    Authorization: `Bearer ${NG_SUPABASE_KEY}`,
    ...extra,
  };
}

async function sbGetGlobalRow() {
  const res = await fetch(
    `${NG_SUPABASE_URL}/rest/v1/semanas?numero=eq.0&select=*`,
    { headers: sbHeaders() }
  );
  if (res.ok) {
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }
  const initPayload = {
    numero: 0,
    presupuesto_base: 25.0,
    remanente_anterior: 60.0,
    budget_funded: false,
    presupuesto_disponible: 60.0,
    total_gastado: 0.0,
  };
  await sbUpsertWeekRow(initPayload);
  return initPayload;
}

async function sbSetGlobalBalance(newBalanceUsdt, defaultBudget = null) {
  const row = await sbGetGlobalRow();
  const bal = Number(Number(newBalanceUsdt).toFixed(2));
  const baseB =
    defaultBudget !== null
      ? Number(Number(defaultBudget).toFixed(2))
      : Number(row.presupuesto_base || 25.0);
  return await sbUpsertWeekRow({
    numero: 0,
    presupuesto_base: baseB,
    remanente_anterior: bal,
    budget_funded: false,
    presupuesto_disponible: bal,
    total_gastado: 0.0,
  });
}

async function sbAdjustGlobalBalance(deltaUsdt) {
  const row = await sbGetGlobalRow();
  const currentBal = Number(row.presupuesto_disponible ?? 60.0);
  const newBal = Number((currentBal + Number(deltaUsdt)).toFixed(2));
  await sbSetGlobalBalance(newBal);
  return newBal;
}

async function sbGetWeekRow(weekNum) {
  const res = await fetch(
    `${NG_SUPABASE_URL}/rest/v1/semanas?numero=eq.${Number(weekNum)}&select=*`,
    { headers: sbHeaders() }
  );
  if (res.ok) {
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }
  return null;
}

async function sbUpsertWeekRow(weekPayload) {
  const clean = {
    numero: Number(weekPayload.numero),
    presupuesto_base: Number(Number(weekPayload.presupuesto_base ?? 25.0).toFixed(2)),
    remanente_anterior: Number(Number(weekPayload.remanente_anterior ?? 0.0).toFixed(2)),
    budget_funded: Boolean(weekPayload.budget_funded),
    presupuesto_disponible: Number(Number(weekPayload.presupuesto_disponible ?? 0.0).toFixed(2)),
    total_gastado: Number(Number(weekPayload.total_gastado ?? 0.0).toFixed(2)),
  };
  const res = await fetch(
    `${NG_SUPABASE_URL}/rest/v1/semanas?on_conflict=numero`,
    {
      method: "POST",
      headers: sbHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation,resolution=merge-duplicates",
      }),
      body: JSON.stringify(clean),
    }
  );
  if (res.ok) {
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }
  return clean;
}

async function sbGetExpensesForWeek(weekNum) {
  const res = await fetch(
    `${NG_SUPABASE_URL}/rest/v1/gastos?semana_numero=eq.${Number(weekNum)}&select=*&order=id.asc`,
    { headers: sbHeaders() }
  );
  if (res.ok) {
    const rows = await res.json();
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

async function sbInsertExpense(weekNum, producto, precio, precioUsdt, facturaStr) {
  const payload = {
    semana_numero: Number(weekNum),
    producto,
    precio: Number(Number(precio).toFixed(2)),
    precio_usdt: Number(Number(precioUsdt).toFixed(2)),
    factura: facturaStr || null,
    fecha: todayDateStr(),
  };
  const res = await fetch(`${NG_SUPABASE_URL}/rest/v1/gastos`, {
    method: "POST",
    headers: sbHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error("No se pudo guardar el gasto en Supabase.");
  }
  const rows = await res.json();
  return rows[0];
}

async function sbUpdateExpense(expenseId, producto, precio, precioUsdt, facturaStr) {
  const payload = {
    producto,
    precio: Number(Number(precio).toFixed(2)),
    precio_usdt: Number(Number(precioUsdt).toFixed(2)),
    factura: facturaStr || null,
  };
  const res = await fetch(
    `${NG_SUPABASE_URL}/rest/v1/gastos?id=eq.${Number(expenseId)}`,
    {
      method: "PATCH",
      headers: sbHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    throw new Error("No se pudo actualizar el gasto en Supabase.");
  }
  const rows = await res.json();
  return rows[0];
}

async function sbDeleteExpense(expenseId) {
  const res = await fetch(
    `${NG_SUPABASE_URL}/rest/v1/gastos?id=eq.${Number(expenseId)}`,
    {
      method: "DELETE",
      headers: sbHeaders(),
    }
  );
  if (!res.ok) {
    throw new Error("No se pudo eliminar el gasto en Supabase.");
  }
}

async function sbUploadReceiptFile(weekNum, fileObj) {
  const ext = (fileObj.name.split(".").pop() || "jpg").toLowerCase();
  const rName = `receipt_wk${weekNum}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
  const url = `${NG_SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${rName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: sbHeaders({
      "Content-Type": fileObj.type || "image/jpeg",
      "x-upsert": "true",
    }),
    body: fileObj,
  });
  if (!res.ok) {
    throw new Error("Error subiendo comprobante al bucket recibos en Supabase.");
  }
  return `${NG_SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${rName}`;
}

async function sbListPending() {
  const res = await fetch(
    `${NG_SUPABASE_URL}/rest/v1/pending_purchases?select=*&order=id.asc`,
    { headers: sbHeaders() }
  );
  if (res.ok) {
    const rows = await res.json();
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

async function sbInsertPending(item, priority) {
  const res = await fetch(`${NG_SUPABASE_URL}/rest/v1/pending_purchases`, {
    method: "POST",
    headers: sbHeaders({
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify({
      item,
      priority,
      notes: "",
      date_added: todayDateStr(),
    }),
  });
  if (!res.ok) throw new Error("Error guardando pendiente en Supabase.");
}

async function sbDeletePending(id) {
  await fetch(
    `${NG_SUPABASE_URL}/rest/v1/pending_purchases?id=eq.${Number(id)}`,
    {
      method: "DELETE",
      headers: sbHeaders(),
    }
  );
}

async function fetchLiveRateClient() {
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

// ==========================================================================
// STATE LOADING (FASTAPI OR DIRECT SUPABASE)
// ==========================================================================
async function loadState(weekNum = null) {
  const targetWeek = weekNum || appState.selectedWeek || getISOWeekNumber();

  // 1. Try FastAPI backend if available
  if (appState.backendMode !== "supabase-direct") {
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
      appState.backendMode = "supabase-direct";
    }
  }

  // 2. Direct Supabase mode (GitHub Pages / Static Browser Mode)
  appState.backendMode = "supabase-direct";
  if (!appState.logoBase64) {
    try {
      const lRes = await fetch("logo.txt");
      if (lRes.ok) appState.logoBase64 = (await lRes.text()).trim();
    } catch (_) {}
  }
  if (!appState.rateUpdatedAt) {
    await fetchLiveRateClient();
  }

  appState.realCurrentWeek = getISOWeekNumber();
  appState.selectedWeek = Number(targetWeek) || appState.realCurrentWeek;
  const rate = appState.rate || 100.0;

  const globalRow = await sbGetGlobalRow();
  const globalAvailableUsdt = Number(
    Number(globalRow.presupuesto_disponible ?? 60.0).toFixed(2)
  );
  const defaultBaseBudget = Number(
    Number(globalRow.presupuesto_base ?? 25.0).toFixed(2)
  );

  let weekRow = await sbGetWeekRow(appState.selectedWeek);
  if (!weekRow) {
    weekRow = await sbUpsertWeekRow({
      numero: appState.selectedWeek,
      presupuesto_base: defaultBaseBudget,
      remanente_anterior: globalAvailableUsdt,
      budget_funded: false,
      presupuesto_disponible: globalAvailableUsdt,
      total_gastado: 0.0,
    });
  }

  const rawExpenses = await sbGetExpensesForWeek(appState.selectedWeek);
  let totalVes = 0;
  const gastos = rawExpenses.map((g) => {
    const pVes = Number(Number(g.precio || 0).toFixed(2));
    const pUsdt = Number(
      Number(g.precio_usdt || (rate > 0 ? pVes / rate : 0)).toFixed(2)
    );
    totalVes += pVes;
    const facturasList = g.factura
      ? String(g.factura)
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    return {
      id: g.id,
      semana_numero: appState.selectedWeek,
      producto: g.producto || "",
      precio: pVes,
      precio_usdt: pUsdt,
      factura: facturasList[0] || null,
      facturas: facturasList,
      fecha: g.fecha || "",
    };
  });

  totalVes = Number(totalVes.toFixed(2));
  if (Math.abs(Number(weekRow.total_gastado || 0) - totalVes) > 0.01) {
    weekRow.total_gastado = totalVes;
    weekRow.presupuesto_disponible = globalAvailableUsdt;
    await sbUpsertWeekRow(weekRow);
  }

  const weeklyBudgetUsdt = Number(
    Number(weekRow.presupuesto_base ?? defaultBaseBudget).toFixed(2)
  );
  const totalSpentUsdt =
    rate > 0 ? Number((totalVes / rate).toFixed(2)) : 0.0;
  const weeklyRemainingUsdt = Number(
    (weeklyBudgetUsdt - totalSpentUsdt).toFixed(2)
  );

  appState.weekData = {
    id: weekRow.id,
    numero: appState.selectedWeek,
    presupuesto_base: weeklyBudgetUsdt,
    remanente_anterior: globalAvailableUsdt,
    budget_funded: Boolean(weekRow.budget_funded),
    presupuesto_disponible: globalAvailableUsdt,
    total_gastado: totalVes,
    gastos,
  };

  appState.metrics = {
    weekly_budget_usdt: weeklyBudgetUsdt,
    weekly_budget_ves: Number((weeklyBudgetUsdt * rate).toFixed(2)),
    total_spent_ves: totalVes,
    total_spent_usdt: totalSpentUsdt,
    weekly_remaining_usdt: weeklyRemainingUsdt,
    weekly_remaining_ves: Number((weeklyRemainingUsdt * rate).toFixed(2)),
    global_available_usdt: globalAvailableUsdt,
    global_available_ves: Number((globalAvailableUsdt * rate).toFixed(2)),
  };

  appState.pendingPurchases = await sbListPending();
  renderAll();
}

// ==========================================================================
// UI RENDERING
// ==========================================================================
function renderAll() {
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

  const pubContainer = document.getElementById("pub-pending-list");
  if (pubContainer) {
    if (items.length === 0) {
      pubContainer.innerHTML = `<div class="card-subtitle" style="padding:12px 0;">No hay insumos pendientes registrados.</div>`;
    } else {
      pubContainer.innerHTML = items
        .map(
          (it) => `
        <div class="pending-row">
          <div>
            <div style="font-weight: 600; font-size: 0.9rem;">${escapeHtml(it.item)}</div>
            <div style="font-size: 0.74rem; color: var(--text-secondary);">${it.date_added || ""}</div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            ${buildBadge(it.priority)}
            <button type="button" class="btn btn-danger btn-sm" onclick="handleDeletePending(${it.id})" title="Eliminar pendiente">🗑️</button>
          </div>
        </div>
      `
        )
        .join("");
    }
  }

  const sbContainer = document.getElementById("sb-pending-list");
  if (sbContainer) {
    if (items.length === 0) {
      sbContainer.innerHTML = `<div class="card-subtitle">Sin insumos pendientes.</div>`;
    } else {
      sbContainer.innerHTML = items
        .map(
          (it) => `
        <div class="pending-row">
          <div style="min-width: 0; flex: 1;">
            <div style="font-weight: 600; font-size: 0.85rem; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(it.item)}</div>
            <div style="margin-top: 2px;">${buildBadge(it.priority)}</div>
          </div>
          <div style="display:flex; align-items:center; gap:5px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="prefillExpenseFromPending(${it.id})" title="Cargar en Registrar Gasto">⚡</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="handleDeletePending(${it.id})" title="Quitar de pendientes">🗑️</button>
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

  const banner = document.getElementById("funding-banner");
  const icon = document.getElementById("funding-icon");
  const title = document.getElementById("funding-title");
  const subtitle = document.getElementById("funding-subtitle");
  const btn = document.getElementById("btn-toggle-fund");

  if (w.budget_funded) {
    banner.className = "funding-banner is-funded";
    icon.textContent = "✅";
    title.textContent = `Semana ${w.numero} fondeada (+$${formatNum(w.presupuesto_base)} USDT sumados al Saldo Disponible)`;
    subtitle.textContent =
      "El presupuesto semanal aprobado ya fue transferido y sumado al saldo disponible en caja.";
    btn.className = "btn btn-secondary";
    btn.textContent = `➖ Revertir Fondeo (-$${formatNum(w.presupuesto_base)} USDT)`;
  } else {
    banner.className = "funding-banner is-unfunded";
    icon.textContent = "ℹ️";
    title.textContent = `Presupuesto de Semana ${w.numero} pendiente por transferir`;
    subtitle.textContent =
      "Haz clic en el botón cuando recibas la transferencia semanal para sumarla al saldo disponible.";
    btn.className = "btn btn-primary";
    btn.textContent = `➕ Fondear Semana (+$${formatNum(w.presupuesto_base)} USDT)`;
  }

  // Recuadro 1: Presupuesto Semanal + Saldo Disponible Global (dentro del mismo recuadro)
  document.getElementById("kpi-budget-usdt").textContent = `$${formatNum(m.weekly_budget_usdt)} USDT`;
  document.getElementById("kpi-budget-ves").textContent = `VES ${formatNum(m.weekly_budget_ves)}`;

  const availEl = document.getElementById("kpi-avail-usdt");
  availEl.textContent = `$${formatNum(m.global_available_usdt)} USDT`;
  availEl.classList.toggle("negative", m.global_available_usdt < 0);
  document.getElementById("kpi-avail-ves").textContent = `VES ${formatNum(m.global_available_ves)}`;

  // Recuadro 2: Total Gastado + abajo/pequeño el Total Disponible DE LA SEMANA
  document.getElementById("kpi-spent-usdt").textContent = `$${formatNum(m.total_spent_usdt)} USDT`;
  document.getElementById("kpi-spent-ves").textContent = `VES ${formatNum(m.total_spent_ves)}`;

  const remLabel = document.getElementById("kpi-weekly-rem-label");
  const remVal = document.getElementById("kpi-weekly-rem-val");
  const remNote = document.getElementById("kpi-weekly-rem-note");
  const isFunded = Boolean(w.budget_funded);
  remLabel.textContent = `Disponible de la semana (de $${formatNum(m.weekly_budget_usdt)}):`;
  remVal.textContent = `$${formatNum(m.weekly_remaining_usdt)} USDT (VES ${formatNum(m.weekly_remaining_ves)})`;
  remVal.classList.toggle("unfunded", !isFunded);
  remVal.classList.toggle("negative", isFunded && m.weekly_remaining_usdt < 0);
  if (remNote) {
    if (!isFunded) {
      remNote.textContent = "⏳ Sin fondear aún — no han llegado los fondos de esta semana";
      remNote.classList.remove("funded");
    } else {
      remNote.textContent = "✅ Presupuesto semanal fondeado y activo";
      remNote.classList.add("funded");
    }
  }
}

function getReceiptUrl(fileRef) {
  if (!fileRef) return "";
  if (fileRef.startsWith("http")) return fileRef;
  const safeName = fileRef.split("/").pop();
  return `${NG_SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURIComponent(safeName)}`;
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
            <button type="button" class="btn btn-secondary btn-sm" onclick="jumpToEditExpense(${g.id})" title="Editar este gasto">✏️</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="handleDeleteExpense(${g.id})" title="Eliminar este gasto">🗑️</button>
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

  const prevId = Number(selectEl.value);
  selectEl.innerHTML = gastos
    .map(
      (g, idx) =>
        `<option value="${g.id}">${idx + 1}. ${escapeHtml(g.producto)} — VES ${formatNum(g.precio)}</option>`
    )
    .join("");

  const exists = gastos.some((g) => Number(g.id) === prevId);
  const activeId = exists ? prevId : gastos[0].id;
  selectEl.value = String(activeId);
  populateEditFormForId(activeId);
}

function populateEditFormForId(expenseId) {
  const gastos = (appState.weekData && appState.weekData.gastos) || [];
  const target = gastos.find((g) => Number(g.id) === Number(expenseId));
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
      .map((rFile, i) => {
        const shortName = rFile.split("/").pop();
        return `<button type="button" class="receipt-chip" onclick="openReceiptModal('${escapeAttr(rFile)}', '${escapeAttr(target.producto)}')">📎 Ver comprobante actual #${i + 1} (${escapeHtml(shortName)})</button>`;
      })
      .join("");
  }
  updateLiveConversions();
}

function renderSettingsInputs() {
  if (!appState.weekData || !appState.metrics) return;
  const bInput = document.getElementById("setting-base-budget");
  const gInput = document.getElementById("setting-global-balance");
  const mInput = document.getElementById("setting-manual-rate");

  if (bInput && document.activeElement !== bInput) {
    bInput.value = Number(appState.metrics.weekly_budget_usdt).toFixed(2);
  }
  if (gInput && document.activeElement !== gInput) {
    gInput.value = Number(appState.metrics.global_available_usdt).toFixed(2);
  }
  if (mInput && document.activeElement !== mInput) {
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
// INTERACTIVE ACTIONS & CRUD HANDLERS
// ==========================================================================
window.openReceiptModal = function (fileRef, itemTitle) {
  const modal = document.getElementById("receipt-modal");
  const title = document.getElementById("modal-title");
  const subtitle = document.getElementById("modal-subtitle");
  const body = document.getElementById("modal-body");

  const shortName = fileRef.split("/").pop();
  title.textContent = `📎 ${itemTitle || "Comprobante"}`;
  subtitle.textContent = shortName;

  const url = getReceiptUrl(fileRef);
  const ext = (shortName.split(".").pop() || "").toLowerCase();

  if (ext === "pdf") {
    body.innerHTML = `
      <div style="padding: 24px;">
        <p style="margin-bottom: 14px;">Este comprobante es un documento PDF.</p>
        <a href="${url}" target="_blank" download="${escapeAttr(shortName)}" class="btn btn-primary">
          📄 Abrir / Descargar Comprobante PDF
        </a>
      </div>
    `;
  } else {
    body.innerHTML = `
      <img src="${url}" alt="Comprobante" class="modal-receipt-img" />
      <div style="margin-top: 14px;">
        <a href="${url}" target="_blank" download="${escapeAttr(shortName)}" class="btn btn-secondary btn-sm">
          ⬇️ Abrir / Descargar Imagen Original
        </a>
      </div>
    `;
  }
  modal.classList.remove("hidden");
};

window.prefillExpenseFromPending = function (pendingId) {
  const item = appState.pendingPurchases.find((p) => Number(p.id) === Number(pendingId));
  if (!item) return;
  document.getElementById("record-resolve-pending-idx").value = String(item.id);
  document.getElementById("resolving-pending-label").textContent = item.item;
  document.getElementById("resolving-pending-banner").classList.remove("hidden");
  document.getElementById("expense-name").value = item.item;
  switchTab("tab-record");
  document.getElementById("expense-price-ves").focus();
  showToast(`Cargado "${item.item}" en el formulario de gasto.`);
};

window.jumpToEditExpense = function (expenseId) {
  const selectEl = document.getElementById("edit-select-expense");
  if (selectEl) {
    selectEl.value = String(expenseId);
    populateEditFormForId(expenseId);
  }
  switchTab("tab-edit");
};

window.handleDeletePending = async function (pendingId) {
  try {
    if (appState.backendMode === "fastapi") {
      const res = await fetch(`/api/pending/${pendingId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Error al eliminar pendiente.");
    } else {
      await sbDeletePending(pendingId);
    }
    showToast("Insumo pendiente eliminado.");
    await loadState(appState.selectedWeek);
  } catch (err) {
    showToast(err.message || "Error al eliminar pendiente.", "error");
  }
};

window.handleDeleteExpense = async function (expenseId) {
  const gastos = (appState.weekData && appState.weekData.gastos) || [];
  const target = gastos.find((g) => Number(g.id) === Number(expenseId));
  if (!target) return;
  if (
    !confirm(
      `¿Seguro que deseas eliminar el gasto "${target.producto}" (VES ${formatNum(target.precio)})? El monto se reintegrará al Saldo Disponible.`
    )
  ) {
    return;
  }

  try {
    if (appState.backendMode === "fastapi") {
      const res = await fetch(
        `/api/week/${appState.selectedWeek}/expenses/${expenseId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("No se pudo eliminar el gasto.");
    } else {
      const oldUsdt = Number(target.precio_usdt || 0);
      await sbDeleteExpense(expenseId);
      await sbAdjustGlobalBalance(oldUsdt);
    }
    showToast(`🗑️ Gasto "${target.producto}" eliminado y saldo reintegrado.`);
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
    showToast("Máximo 3 comprobantes por gasto. Se tomarán los primeros 3.", "error");
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
// CLIENT-SIDE PDF GENERATOR WITH EMBEDDED RECEIPT PHOTOS (FOR GITHUB PAGES)
// ==========================================================================
async function fetchImageAsDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (_) {
    return null;
  }
}

async function generateClientSidePdf() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast("Generador PDF cargando, intenta en un segundo.", "error");
    return;
  }
  showToast("📄 Generando reporte PDF con comprobantes...");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const w = appState.weekData;
  const m = appState.metrics;
  const r = appState.rate;

  let y = 36;
  if (appState.logoBase64) {
    try {
      doc.addImage(
        `data:image/png;base64,${appState.logoBase64}`,
        "PNG",
        36,
        y,
        115,
        36
      );
      y += 46;
    } catch (_) {}
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("NEXXTGLOBAL — WEEKLY EXPENSE REPORT", 36, y);
  y += 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(
    `Week ${w.numero}   |   Generated: ${nowFormatted()}   |   USDT Exchange Rate: VES ${formatNum(r)}`,
    36,
    y
  );
  y += 14;

  doc.autoTable({
    startY: y,
    head: [
      [
        "Presupuesto Semanal",
        "Total Gastado (Semana)",
        "Disponible de la Semana",
        "Ahorro Disponible Actualizado",
      ],
    ],
    body: [
      [
        `$${formatNum(m.weekly_budget_usdt)} USDT\n(VES ${formatNum(m.weekly_budget_ves)})`,
        `$${formatNum(m.total_spent_usdt)} USDT\n(VES ${formatNum(m.total_spent_ves)})`,
        `$${formatNum(m.weekly_remaining_usdt)} USDT\n(VES ${formatNum(m.weekly_remaining_ves)})`,
        `$${formatNum(m.global_available_usdt)} USDT\n(VES ${formatNum(m.global_available_ves)})`,
      ],
    ],
    theme: "grid",
    headStyles: { fillColor: [17, 24, 39], textColor: 255, halign: "center" },
    bodyStyles: { halign: "center", fontSize: 9, fontStyle: "bold" },
  });

  y = doc.lastAutoTable.finalY + 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(17, 24, 39);
  doc.text("Expenses Breakdown (Desglose de Gastos)", 36, y);
  y += 12;

  const gastos = w.gastos || [];
  if (gastos.length === 0) {
    doc.setDrawColor(209, 213, 219);
    doc.setFillColor(249, 250, 251);
    doc.roundedRect(36, y, 540, 42, 6, 6, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128);
    doc.text("Sin gastos registrados en esta semana.", 50, y + 25);
  } else {
    for (let i = 0; i < gastos.length; i++) {
      const g = gastos[i];
      const pVes = Number(g.precio) || 0;
      const pUsdt = Number(g.precio_usdt) || (r > 0 ? pVes / r : 0);
      const recs = Array.isArray(g.facturas) ? g.facturas.filter(Boolean) : [];

      // Fetch first image attachment if present so we can embed it on the right side of the card
      let receiptDataUrl = null;
      for (const rFile of recs) {
        const ext = (rFile.split(".").pop() || "").toLowerCase();
        if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
          receiptDataUrl = await fetchImageAsDataUrl(getReceiptUrl(rFile));
          if (receiptDataUrl) break;
        }
      }

      const cardHeight = 116;
      if (y + cardHeight > 745) {
        doc.addPage();
        y = 40;
      }

      // Draw outer expense card (recuadro individual por gasto)
      doc.setDrawColor(209, 213, 219);
      doc.setLineWidth(0.9);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(36, y, 540, cardHeight, 6, 6, "FD");

      // Subtle right-hand panel for the receipt preview
      const splitX = 360;
      doc.setFillColor(249, 250, 251);
      doc.rect(splitX, y + 1, 215, cardHeight - 2, "F");
      doc.setDrawColor(229, 231, 235);
      doc.line(splitX, y, splitX, y + cardHeight);

      // Left side: synchronized expense details (Insumo/Servicio, Monto VES, Monto USDT, Fecha)
      const leftX = 50;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(107, 114, 128);
      doc.text(`GASTO #${i + 1} · INSUMO / SERVICIO`, leftX, y + 20);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(17, 24, 39);
      const prodLines = doc.splitTextToSize(String(g.producto || "Sin descripción"), 295);
      doc.text(prodLines.slice(0, 2), leftX, y + 35);

      const detailsY = y + 64;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(55, 65, 81);
      doc.text("Monto (VES):", leftX, detailsY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(17, 24, 39);
      doc.text(`VES ${formatNum(pVes)}`, leftX + 75, detailsY);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(55, 65, 81);
      doc.text("Monto (USDT):", leftX, detailsY + 18);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(4, 120, 87);
      doc.text(`$${formatNum(pUsdt)} USDT`, leftX + 75, detailsY + 18);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(55, 65, 81);
      doc.text("Fecha:", leftX, detailsY + 36);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(75, 85, 99);
      doc.text(String(g.fecha || "—"), leftX + 75, detailsY + 36);

      // Right side: subtle receipt thumbnail or status label
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(107, 114, 128);
      doc.text("COMPROBANTE ADJUNTO", splitX + 107.5, y + 14, { align: "center" });

      if (receiptDataUrl) {
        try {
          doc.addImage(receiptDataUrl, "JPEG", splitX + 42, y + 20, 130, 86);
        } catch (_) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8.5);
          doc.text("Adjunto registrado", splitX + 107.5, y + 64, { align: "center" });
        }
      } else if (recs.length > 0) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(75, 85, 99);
        doc.text(`Documento adjunto (${recs.length})`, splitX + 107.5, y + 64, { align: "center" });
      } else {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8.5);
        doc.setTextColor(156, 163, 175);
        doc.text("Sin comprobante adjunto", splitX + 107.5, y + 64, { align: "center" });
      }

      y += cardHeight + 12;
    }
  }

  doc.save(`Nextglobal_Expense_Report_Week_${w.numero}.pdf`);
}

// ==========================================================================
// EVENT LISTENERS INITIALIZATION
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab-btn, .mobile-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

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
        if (!res.ok) throw new Error("Contraseña incorrecta. Intenta de nuevo.");
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

  // Add Pending Purchase
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
        await sbInsertPending(item, priority);
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
        if (!res.ok) throw new Error("No se pudo actualizar el fondeo.");
      } else {
        const baseB = Number(appState.weekData.presupuesto_base || 25.0);
        const delta = newFunded ? baseB : -baseB;
        const newGlobalAvail = await sbAdjustGlobalBalance(delta);
        appState.weekData.budget_funded = newFunded;
        appState.weekData.presupuesto_disponible = newGlobalAvail;
        await sbUpsertWeekRow(appState.weekData);
      }
      showToast(
        newFunded
          ? "✅ Presupuesto semanal sumado al Saldo Disponible."
          : "ℹ️ Fondeo semanal revertido del Saldo Disponible."
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
      const resolvePendingId = document.getElementById(
        "record-resolve-pending-idx"
      ).value;

      if (!name || priceVes <= 0) {
        showToast("Verifica el nombre y un monto mayor a 0 VES.", "error");
        return;
      }

      btn.disabled = true;
      btn.textContent = "⏳ Guardando en Supabase y subiendo comprobante...";

      try {
        if (appState.backendMode === "fastapi") {
          const fd = new FormData();
          fd.append("producto", name);
          fd.append("precio", String(priceVes));
          if (resolvePendingId !== "") {
            fd.append("resolve_pending_id", resolvePendingId);
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
          const uploadedUrls = [];
          for (const item of appState.recordCompressedFiles) {
            const pubUrl = await sbUploadReceiptFile(
              appState.selectedWeek,
              item.file
            );
            uploadedUrls.push(pubUrl);
          }
          const pUsdt =
            appState.rate > 0
              ? Number((priceVes / appState.rate).toFixed(2))
              : 0;
          const facturaStr =
            uploadedUrls.length > 0 ? uploadedUrls.join("|") : null;

          await sbInsertExpense(
            appState.selectedWeek,
            name,
            priceVes,
            pUsdt,
            facturaStr
          );
          await sbAdjustGlobalBalance(-pUsdt);

          if (resolvePendingId !== "") {
            await sbDeletePending(Number(resolvePendingId));
          }
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

        showToast(`✅ Guardado "${name}" en Supabase (VES ${formatNum(priceVes)})`);
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
      populateEditFormForId(Number(e.target.value));
    });

  // Edit Expense Submit
  document
    .getElementById("form-edit-expense")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const expenseId = Number(
        document.getElementById("edit-select-expense").value
      );
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
      btn.textContent = "⏳ Actualizando en Supabase...";

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
            `/api/week/${appState.selectedWeek}/expenses/${expenseId}`,
            {
              method: "PUT",
              body: fd,
            }
          );
          if (!res.ok) throw new Error("No se pudo actualizar el gasto.");
        } else {
          const gastos = (appState.weekData && appState.weekData.gastos) || [];
          const target = gastos.find((g) => Number(g.id) === expenseId);
          if (!target) throw new Error("Gasto no encontrado.");

          const oldUsdt = Number(target.precio_usdt || 0);
          let finalUrls = Array.isArray(target.facturas) ? target.facturas : [];

          if (appState.editCompressedFiles.length > 0) {
            finalUrls = [];
            for (const item of appState.editCompressedFiles) {
              const pubUrl = await sbUploadReceiptFile(
                appState.selectedWeek,
                item.file
              );
              finalUrls.push(pubUrl);
            }
          }

          const newUsdt =
            appState.rate > 0
              ? Number((priceVes / appState.rate).toFixed(2))
              : 0;
          const facturaStr = finalUrls.length > 0 ? finalUrls.join("|") : null;

          await sbUpdateExpense(expenseId, name, priceVes, newUsdt, facturaStr);
          const deltaUsdt = Number((oldUsdt - newUsdt).toFixed(2));
          await sbAdjustGlobalBalance(deltaUsdt);
        }

        appState.editCompressedFiles = [];
        document.getElementById("edit-file-previews").innerHTML = "";
        showToast(`✅ Gasto "${name}" actualizado en Supabase.`);
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
      const expenseId = Number(
        document.getElementById("edit-select-expense").value
      );
      window.handleDeleteExpense(expenseId);
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
    const lines = ["#,Item / Service,Price (VES),Price (USDT),Date"];
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

  // Financial Settings Save (Weekly Budget + Global Saldo Disponible)
  document
    .getElementById("form-week-settings")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const base = Number(document.getElementById("setting-base-budget").value);
      const globalBal = Number(
        document.getElementById("setting-global-balance").value
      );

      try {
        if (appState.backendMode === "fastapi") {
          const res = await fetch(
            `/api/week/${appState.selectedWeek}/settings`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                presupuesto_base: base,
                saldo_disponible: globalBal,
              }),
            }
          );
          if (!res.ok) throw new Error("Error guardando configuración.");
        } else {
          await sbSetGlobalBalance(globalBal, base);
          appState.weekData.presupuesto_base = base;
          appState.weekData.presupuesto_disponible = globalBal;
          appState.weekData.remanente_anterior = globalBal;
          await sbUpsertWeekRow(appState.weekData);
        }
        showToast("✅ Presupuesto Semanal y Saldo Disponible Global actualizados.");
        await loadState(appState.selectedWeek);
      } catch (err) {
        showToast(err.message || "Error al actualizar ajustes.", "error");
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
        await fetchLiveRateClient();
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
