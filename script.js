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
  lang: localStorage.getItem("nxt_lang") || "es",
  realCurrentWeek: null,
  selectedWeek: null,
  rate: 100.0,
  rateSource: "Binance P2P",
  rateUpdatedAt: "",
  logoBase64: "",
  logoPdfBase64: "",
  weekData: null,
  metrics: null,
  pendingPurchases: [],
  recordCompressedFiles: [],
  editCompressedFiles: [],
};

// ==========================================================================
// INTERNATIONALIZATION (i18n): EN & ES
// ==========================================================================
const TRANSLATIONS = {
  es: {
    brand_sub: "Nexxtglobal Weekly Budget Record",
    nav_logout: "Salir",
    rate_tooltip: "Tasa activa USDT / VES",
    sync_btn_title: "Sincronizar con Binance P2P",
    login_title: "🔒 Acceso al Sistema",
    login_subtitle: "Portal de Caja Chica y Presupuesto Semanal Nexxtglobal",
    login_user_lbl: "Usuario",
    login_pass_lbl: "Contraseña",
    login_pass_ph: "Ingresa la clave de acceso...",
    login_remember: "Recordar sesión en este dispositivo (móvil / PC)",
    login_btn: "Iniciar Sesión",
    pub_pending_title: "🛒 Lista de Compras Pendientes",
    pub_pending_sub: "Registra insumos o necesidades antes de entrar al sistema completo.",
    pub_pending_ph: "Insumo o necesidad (ej. Café, Papel, Marcadores)...",
    prio_high: "🔴 Alta",
    prio_med: "🟡 Media",
    prio_low: "🟢 Baja",
    prio_high_full: "🔴 Prioridad Alta",
    prio_med_full: "🟡 Prioridad Media",
    prio_low_full: "🟢 Prioridad Baja",
    btn_add: "Agregar",
    btn_add_short: "Añadir",
    week_ctrl_title: "📅 Control de Semana",
    week_caption_prefix: "Semana calendario actual: Semana",
    btn_sync_week: "Ir a Semana Actual",
    sb_pending_title: "🛒 Compras Pendientes",
    sb_pending_sub: "Toca ⚡ para cargar al formulario de gasto",
    sb_pending_ph: "Nuevo insumo pendiente...",
    funding_title_funded: (w, base) => `Semana ${w} fondeada (+$${formatNum(base)} USDT sumados al Saldo Disponible)`,
    funding_sub_funded: "El presupuesto semanal aprobado ya fue transferido y sumado al saldo disponible en caja.",
    btn_unfund: (base) => `➖ Revertir Fondeo (-$${formatNum(base)} USDT)`,
    funding_title_unfunded: (w) => `Presupuesto de Semana ${w} pendiente por transferir`,
    funding_sub_unfunded: "Haz clic en el botón cuando recibas la transferencia semanal para sumarla al saldo disponible.",
    btn_fund_week: "Fondear Semana",
    btn_fund_week_amt: (base) => `➕ Fondear Semana (+$${formatNum(base)} USDT)`,
    kpi_weekly_budget: "Presupuesto Semanal",
    kpi_global_avail: "Ahorro Disponible (Actual)",
    kpi_total_spent: "Total Gastado",
    kpi_rem_label: (b) => `Disponible de la semana (de $${formatNum(b)}):`,
    kpi_rem_unfunded: "⏳ Sin fondear aún — no han llegado los fondos de esta semana",
    kpi_rem_funded: "✅ Presupuesto semanal fondeado y activo",
    tab_record: "📝 Registrar Gasto",
    tab_summary: "📊 Historial y PDF",
    tab_edit: "✏️ Editar Gasto",
    tab_settings: "⚙️ Ajustes y Tasa",
    nav_m_record: "Registrar",
    nav_m_summary: "Historial/PDF",
    nav_m_edit: "Editar",
    nav_m_settings: "Ajustes",
    record_title: "📝 Registrar Compra / Gasto",
    record_sub: "Las fotos tomadas desde el celular se comprimen automáticamente antes de subir.",
    resolving_pending_msg: "🛒 Completando compra pendiente:",
    btn_cancel_link: "✕ Cancelar vínculo",
    lbl_product_name: "Insumo, Producto o Servicio",
    ph_product_name: "Ej. Botellones de agua, Café, Artículos de limpieza...",
    lbl_price_ves: "Precio Pagado en Bolívares (VES)",
    lbl_est_usdt: "Equivalente estimado en USDT (a tasa actual)",
    lbl_receipts_dropzone: "Comprobantes de Pago / Facturas (Hasta 2 fotos PNG, JPG o PDF)",
    dropzone_prompt: "Toca aquí para tomar foto de la factura o elegir archivos (máx. 2)",
    dropzone_help: "Compresión inteligente integrada — se ajustan automáticamente de forma elegante en el PDF.",
    btn_save_expense: "Guardar Gasto en Semana",
    btn_saving_expense: "⏳ Guardando en Supabase y subiendo comprobantes...",
    summary_title: "📊 Historial de Gastos y Reportes",
    summary_sub: "Descarga o previsualiza el reporte PDF con las fotos de facturas incrustadas.",
    btn_preview_pdf: "Vista Previa PDF",
    btn_download_pdf: "Descargar PDF",
    empty_summary: "No hay gastos registrados en esta semana todavía.",
    tbl_col_item: "Insumo / Servicio",
    tbl_col_ves: "Monto (VES)",
    tbl_col_usdt: "Monto (USDT)",
    tbl_col_receipts: "Comprobantes",
    tbl_col_date: "Fecha",
    tbl_col_actions: "Acciones",
    no_receipt: "Sin adjunto",
    view_receipt_chip: (idx) => `Ver #${idx}`,
    edit_title: "✏️ Editar o Eliminar Gasto",
    edit_sub: "Corrige el nombre, el monto en VES o reemplaza los comprobantes adjuntos.",
    empty_edit: "No hay gastos registrados en esta semana para editar.",
    lbl_select_edit: "Selecciona el gasto a modificar",
    lbl_edit_price_ves: "Precio en Bolívares (VES)",
    lbl_new_est_usdt: "Nuevo equivalente en USDT",
    lbl_curr_receipts: "Comprobantes Actuales",
    no_curr_receipts: "Este gasto no tiene comprobantes adjuntos actualmente.",
    view_curr_chip: (idx, name) => `📎 Ver comprobante #${idx} (${name})`,
    edit_dropzone_prompt: "📎 Reemplazar comprobantes (opcional — hasta 2 fotos)",
    edit_dropzone_help: "Si no subes archivos nuevos, se conservarán los comprobantes actuales.",
    btn_save_changes: "Guardar Cambios",
    btn_updating_expense: "⏳ Actualizando en Supabase...",
    btn_delete_expense: "Eliminar Gasto",
    settings_title: "⚙️ Ajustes Financieros y Tasa USDT",
    settings_sub: "Configura el presupuesto aprobado por gerencia, el remanente acumulado y la tasa USDT/VES.",
    settings_budget_title: "💵 Presupuesto Semanal y Saldo Disponible",
    lbl_base_budget: "Presupuesto Semanal Aprobado ($ USDT)",
    lbl_global_bal: "Saldo Disponible Actual en Caja ($ USDT)",
    help_global_bal: "Este saldo es global y se mantiene actualizado sin importar qué semana consultes.",
    btn_save_settings: "Guardar Presupuesto y Saldo Disponible",
    settings_rate_title: "🪙 Tasa de Cambio USDT / VES",
    lbl_manual_rate: "Tasa Manual USDT (VES)",
    btn_apply_rate: "Aplicar Tasa Manual",
    btn_sync_binance: "Sincronizar en Vivo con Binance P2P",
    rate_last_sync_prefix: "Última sincronización:",
    btn_close_modal: "✕ Cerrar",
    pdf_modal_heading: "Vista Previa del Reporte PDF",
    toast_login_ok: "✅ Bienvenido al portal Nextglobal.",
    toast_logout: "Sesión cerrada.",
    toast_auth_err: "Contraseña incorrecta. Intenta de nuevo.",
    toast_max_photos: "Máximo 2 comprobantes por gasto. Se tomarán los primeros 2.",
    toast_optimizing: "Comprimiendo y optimizando comprobantes...",
    toast_pdf_generating: "📄 Generando reporte PDF...",
    toast_sync_week: (w) => `Sincronizado con Semana ${w}`,
    toast_rate_synced: (r) => `✅ Tasa actualizada: VES ${formatNum(r)}`,
    toast_rate_manual: (r) => `✅ Tasa establecida en VES ${formatNum(r)}`,
    toast_item_saved: (name, p) => `✅ Guardado "${name}" en Supabase (VES ${formatNum(p)})`,
    toast_item_updated: (name) => `✅ Gasto "${name}" actualizado en Supabase.`,
    toast_settings_saved: "✅ Presupuesto Semanal y Saldo Disponible Global actualizados.",
    confirm_delete: (name, p) => `¿Seguro que deseas eliminar el gasto "${name}" (VES ${formatNum(p)})? El monto se reintegrará al Saldo Disponible.`
  },
  en: {
    brand_sub: "Nexxtglobal Weekly Budget Record",
    nav_logout: "Log Out",
    rate_tooltip: "Active USDT / VES Rate",
    sync_btn_title: "Sync with Binance P2P",
    login_title: "🔒 System Access",
    login_subtitle: "Nexxtglobal Petty Cash & Weekly Budget Portal",
    login_user_lbl: "Username",
    login_pass_lbl: "Password",
    login_pass_ph: "Enter access password...",
    login_remember: "Remember session on this device (mobile / PC)",
    login_btn: "Log In",
    pub_pending_title: "🛒 Pending Purchases List",
    pub_pending_sub: "Log items or needs before entering the full system.",
    pub_pending_ph: "Item or supply needed (e.g. Coffee, Paper, Markers)...",
    prio_high: "🔴 High",
    prio_med: "🟡 Medium",
    prio_low: "🟢 Low",
    prio_high_full: "🔴 High Priority",
    prio_med_full: "🟡 Medium Priority",
    prio_low_full: "🟢 Low Priority",
    btn_add: "Add",
    btn_add_short: "Add",
    week_ctrl_title: "📅 Week Control",
    week_caption_prefix: "Current Calendar Week: Week",
    btn_sync_week: "Go to Current Week",
    sb_pending_title: "🛒 Pending Purchases",
    sb_pending_sub: "Tap ⚡ to load into expense form",
    sb_pending_ph: "New pending item...",
    funding_title_funded: (w, base) => `Week ${w} funded (+$${formatNum(base)} USDT added to Available Savings)`,
    funding_sub_funded: "The approved weekly budget has been transferred and credited to available cash.",
    btn_unfund: (base) => `➖ Revert Funding (-$${formatNum(base)} USDT)`,
    funding_title_unfunded: (w) => `Week ${w} budget pending transfer`,
    funding_sub_unfunded: "Click this button once weekly funds arrive to add them to your available balance.",
    btn_fund_week: "Fund Week",
    btn_fund_week_amt: (base) => `➕ Fund Week (+$${formatNum(base)} USDT)`,
    kpi_weekly_budget: "Weekly Budget",
    kpi_global_avail: "Available Savings (Current)",
    kpi_total_spent: "Total Spent",
    kpi_rem_label: (b) => `Weekly Available (from $${formatNum(b)}):`,
    kpi_rem_unfunded: "⏳ Unfunded yet — weekly funds have not arrived",
    kpi_rem_funded: "✅ Weekly budget funded and active",
    tab_record: "📝 Record Expense",
    tab_summary: "📊 History & PDF",
    tab_edit: "✏️ Edit Expense",
    tab_settings: "⚙️ Settings & Rate",
    nav_m_record: "Record",
    nav_m_summary: "History/PDF",
    nav_m_edit: "Edit",
    nav_m_settings: "Settings",
    record_title: "📝 Record Expense / Purchase",
    record_sub: "Photos taken from your smartphone are automatically compressed before upload.",
    resolving_pending_msg: "🛒 Resolving pending item:",
    btn_cancel_link: "✕ Cancel link",
    lbl_product_name: "Item, Product or Service",
    ph_product_name: "E.g. Bottled water, Coffee, Cleaning supplies...",
    lbl_price_ves: "Price Paid in Bolivars (VES)",
    lbl_est_usdt: "Estimated USDT Equivalent (at current rate)",
    lbl_receipts_dropzone: "Payment Receipts / Invoices (Up to 2 photos PNG, JPG or PDF)",
    dropzone_prompt: "Tap here to take photo or choose files (max 2)",
    dropzone_help: "Built-in smart compression — photos fit automatically and elegantly in the PDF.",
    btn_save_expense: "Save Expense in Week",
    btn_saving_expense: "⏳ Saving to Supabase & uploading receipts...",
    summary_title: "📊 Expense History & Reports",
    summary_sub: "Download or preview the PDF report with embedded invoice photos.",
    btn_preview_pdf: "PDF Preview",
    btn_download_pdf: "Download PDF",
    empty_summary: "No expenses recorded for this week yet.",
    tbl_col_item: "Item / Service",
    tbl_col_ves: "Amount (VES)",
    tbl_col_usdt: "Amount (USDT)",
    tbl_col_receipts: "Receipts",
    tbl_col_date: "Date",
    tbl_col_actions: "Actions",
    no_receipt: "No attachment",
    view_receipt_chip: (idx) => `View #${idx}`,
    edit_title: "✏️ Edit or Delete Expense",
    edit_sub: "Fix item name, price in VES or replace attached receipts.",
    empty_edit: "No expenses recorded for this week to edit.",
    lbl_select_edit: "Select expense to edit",
    lbl_edit_price_ves: "Price in Bolivars (VES)",
    lbl_new_est_usdt: "New USDT equivalent",
    lbl_curr_receipts: "Current Receipts",
    no_curr_receipts: "This expense currently has no receipts attached.",
    view_curr_chip: (idx, name) => `📎 View receipt #${idx} (${name})`,
    edit_dropzone_prompt: "📎 Replace receipts (optional — up to 2 photos)",
    edit_dropzone_help: "If you don't upload new files, existing receipts will be preserved.",
    btn_save_changes: "Save Changes",
    btn_updating_expense: "⏳ Updating in Supabase...",
    btn_delete_expense: "Delete Expense",
    settings_title: "⚙️ Financial Settings & USDT Rate",
    settings_sub: "Configure the approved budget from management, cumulative savings, and USDT/VES exchange rate.",
    settings_budget_title: "💵 Weekly Budget & Available Savings",
    lbl_base_budget: "Approved Weekly Budget ($ USDT)",
    lbl_global_bal: "Current Available Savings in Cash ($ USDT)",
    help_global_bal: "This balance is global and stays updated regardless of which week you view.",
    btn_save_settings: "Save Budget & Available Balance",
    settings_rate_title: "🪙 USDT / VES Exchange Rate",
    lbl_manual_rate: "Manual USDT Rate (VES)",
    btn_apply_rate: "Apply Manual Rate",
    btn_sync_binance: "Sync Live with Binance P2P",
    rate_last_sync_prefix: "Last sync:",
    btn_close_modal: "✕ Close",
    pdf_modal_heading: "PDF Report Preview",
    toast_login_ok: "✅ Welcome to the Nextglobal portal.",
    toast_logout: "Session closed.",
    toast_auth_err: "Incorrect password. Please try again.",
    toast_max_photos: "Maximum 2 receipts per expense. The first 2 will be processed.",
    toast_optimizing: "Compressing and optimizing receipts...",
    toast_pdf_generating: "📄 Generating PDF report...",
    toast_sync_week: (w) => `Synced to Week ${w}`,
    toast_rate_synced: (r) => `✅ Rate updated: VES ${formatNum(r)}`,
    toast_rate_manual: (r) => `✅ Rate set to VES ${formatNum(r)}`,
    toast_item_saved: (name, p) => `✅ Saved "${name}" to Supabase (VES ${formatNum(p)})`,
    toast_item_updated: (name) => `✅ Expense "${name}" updated in Supabase.`,
    toast_settings_saved: "✅ Weekly Budget and Global Available Savings updated.",
    confirm_delete: (name, p) => `Are you sure you want to delete expense "${name}" (VES ${formatNum(p)})? The amount will be refunded to Available Balance.`
  }
};

function t(key, ...args) {
  const dict = TRANSLATIONS[appState.lang] || TRANSLATIONS.es;
  const val = dict[key] !== undefined ? dict[key] : (TRANSLATIONS.es[key] || key);
  if (typeof val === "function") {
    return val(...args);
  }
  return val;
}

function applyTranslations() {
  document.documentElement.lang = appState.lang;
  const btnEs = document.getElementById("btn-lang-es");
  const btnEn = document.getElementById("btn-lang-en");
  if (btnEs) btnEs.classList.toggle("active", appState.lang === "es");
  if (btnEn) btnEn.classList.toggle("active", appState.lang === "en");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const k = el.getAttribute("data-i18n");
    el.textContent = t(k);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const k = el.getAttribute("data-i18n-placeholder");
    el.setAttribute("placeholder", t(k));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const k = el.getAttribute("data-i18n-title");
    el.setAttribute("title", t(k));
  });
}

function setLanguage(lang) {
  appState.lang = lang === "en" ? "en" : "es";
  localStorage.setItem("nxt_lang", appState.lang);
  applyTranslations();
  renderAll();
}

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
  return weekNo;
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
        appState.logoPdfBase64 = payload.logo_pdf_base64 || appState.logoPdfBase64;
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
  if (!appState.logoPdfBase64) {
    try {
      const lpRes = await fetch("logo_pdf.txt");
      if (lpRes.ok) appState.logoPdfBase64 = (await lpRes.text()).trim();
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
    const isJpeg = appState.logoBase64.startsWith("/9j/");
    const mime = isJpeg ? "image/jpeg" : "image/png";
    const src = `data:${mime};base64,${appState.logoBase64}`;
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
      ? `${t("rate_last_sync_prefix")} ${appState.rateUpdatedAt} (${appState.rateSource})`
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
    `${t("week_caption_prefix")} ${appState.realCurrentWeek}`;
  const weekInput = document.getElementById("input-week-num");
  if (document.activeElement !== weekInput) {
    weekInput.value = appState.selectedWeek;
  }

  const wkWord = appState.lang === "en" ? "Week" : "Semana";
  document.querySelectorAll(".week-label-inline").forEach((el) => {
    el.textContent = `${wkWord} ${appState.selectedWeek}`;
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
  const pWord = appState.lang === "en" ? "pending" : "pendiente(s)";
  if (pubCount) pubCount.textContent = `${items.length} ${pWord}`;
  if (sbCount) sbCount.textContent = String(items.length);

  const buildBadge = (prio) => {
    if (prio === "High") return `<span class="badge badge-high">${t("prio_high")}</span>`;
    if (prio === "Low") return `<span class="badge badge-low">${t("prio_low")}</span>`;
    return `<span class="badge badge-medium">${t("prio_med")}</span>`;
  };

  const pubContainer = document.getElementById("pub-pending-list");
  if (pubContainer) {
    if (items.length === 0) {
      pubContainer.innerHTML = `<div class="card-subtitle" style="padding:12px 0;">${appState.lang === "en" ? "No pending items logged." : "No hay insumos pendientes registrados."}</div>`;
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
            <button type="button" class="btn btn-danger btn-sm" onclick="handleDeletePending(${it.id})" title="${t("btn_delete_expense")}">🗑️</button>
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
      sbContainer.innerHTML = `<div class="card-subtitle">${appState.lang === "en" ? "No pending items." : "Sin insumos pendientes."}</div>`;
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
            <button type="button" class="btn btn-secondary btn-sm" onclick="prefillExpenseFromPending(${it.id})" title="⚡">⚡</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="handleDeletePending(${it.id})" title="🗑️">🗑️</button>
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
    title.textContent = t("funding_title_funded", w.numero, w.presupuesto_base);
    subtitle.textContent = t("funding_sub_funded");
    btn.className = "btn btn-secondary";
    btn.textContent = t("btn_unfund", w.presupuesto_base);
  } else {
    banner.className = "funding-banner is-unfunded";
    icon.textContent = "ℹ️";
    title.textContent = t("funding_title_unfunded", w.numero);
    subtitle.textContent = t("funding_sub_unfunded");
    btn.className = "btn btn-primary";
    btn.textContent = t("btn_fund_week_amt", w.presupuesto_base);
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
  remLabel.textContent = t("kpi_rem_label", m.weekly_budget_usdt);
  remVal.textContent = `$${formatNum(m.weekly_remaining_usdt)} USDT (VES ${formatNum(m.weekly_remaining_ves)})`;
  remVal.classList.toggle("unfunded", !isFunded);
  remVal.classList.toggle("negative", isFunded && m.weekly_remaining_usdt < 0);
  if (remNote) {
    if (!isFunded) {
      remNote.textContent = t("kpi_rem_unfunded");
      remNote.classList.remove("funded");
    } else {
      remNote.textContent = t("kpi_rem_funded");
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
          ? `<span style="color:var(--text-muted); font-size:0.78rem;">${t("no_receipt")}</span>`
          : receipts
              .map((rFile, rIdx) => {
                const ext = (rFile.split(".").pop() || "").toLowerCase();
                const icon = ext === "pdf" ? "📄" : "🖼️";
                return `<button type="button" class="receipt-chip" onclick="openReceiptModal('${escapeAttr(rFile)}', '${escapeAttr(g.producto)}')">${icon} ${t("view_receipt_chip", rIdx + 1)}</button>`;
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
            <button type="button" class="btn btn-secondary btn-sm" onclick="jumpToEditExpense(${g.id})" title="${t("tab_edit")}">✏️</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="handleDeleteExpense(${g.id})" title="${t("btn_delete_expense")}">🗑️</button>
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
    currContainer.innerHTML = `<span class="card-subtitle">${t("no_curr_receipts")}</span>`;
  } else {
    currContainer.innerHTML = receipts
      .map((rFile, i) => {
        const shortName = rFile.split("/").pop();
        return `<button type="button" class="receipt-chip" onclick="openReceiptModal('${escapeAttr(rFile)}', '${escapeAttr(target.producto)}')">${t("view_curr_chip", i + 1, escapeHtml(shortName))}</button>`;
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
      t("confirm_delete", target.producto, target.precio)
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
    showToast(
      appState.lang === "en"
        ? `🗑️ Expense "${target.producto}" deleted and balance refunded.`
        : `🗑️ Gasto "${target.producto}" eliminado y saldo reintegrado.`
    );
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

  if (rawFiles.length > 2) {
    showToast(t("toast_max_photos"), "error");
  }
  const slice = rawFiles.slice(0, 2);
  const container = document.getElementById(previewContainerId);
  container.innerHTML = `<div class="card-subtitle">${t("toast_optimizing")}</div>`;

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

async function buildClientSidePdfDoc() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    showToast(t("toast_pdf_generating"), "error");
    return null;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const w = appState.weekData;
  const m = appState.metrics;
  const r = appState.rate;
  const isEn = appState.lang === "en";

  let y = 36;
  const pdfLogo = appState.logoPdfBase64 || appState.logoBase64;
  if (pdfLogo) {
    try {
      // 165 pt width x 26 pt height matches the ~6.4:1 aspect ratio of the transparent NexxtGlobal logo
      doc.addImage(
        `data:image/png;base64,${pdfLogo}`,
        "PNG",
        36,
        y,
        165,
        26
      );
      y += 36;
    } catch (_) {
      y += 10;
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(17, 24, 39);
  doc.text("NEXXTGLOBAL — WEEKLY EXPENSE REPORT", 36, y);
  y += 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(75, 85, 99);
  const genLbl = isEn ? "Generated" : "Generado";
  const rateLbl = isEn ? "USDT Exchange Rate" : "Tasa de Cambio USDT";
  const wkLbl = isEn ? "Week" : "Semana";
  doc.text(
    `${wkLbl} ${w.numero}   |   ${genLbl}: ${nowFormatted()}   |   ${rateLbl}: VES ${formatNum(r)}`,
    36,
    y
  );
  y += 14;

  const hdrBudget = isEn ? "Weekly Budget" : "Presupuesto Semanal";
  const hdrSpent = isEn ? "Total Spent (Week)" : "Total Gastado (Semana)";
  const hdrRem = isEn ? "Available (Week)" : "Disponible de la Semana";
  const hdrGlobal = isEn ? "Updated Total Savings" : "Ahorro Disponible Actualizado";

  doc.autoTable({
    startY: y,
    head: [[hdrBudget, hdrSpent, hdrRem, hdrGlobal]],
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
  const bTitle = isEn ? "Expenses Breakdown" : "Desglose de Gastos (Expenses Breakdown)";
  doc.text(bTitle, 36, y);
  y += 12;

  const gastos = w.gastos || [];
  if (gastos.length === 0) {
    doc.setDrawColor(209, 213, 219);
    doc.setFillColor(249, 250, 251);
    doc.roundedRect(36, y, 540, 42, 6, 6, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(107, 114, 128);
    const noExpMsg = isEn ? "No expenses recorded for this week." : "Sin gastos registrados en esta semana.";
    doc.text(noExpMsg, 50, y + 25);
  } else {
    for (let i = 0; i < gastos.length; i++) {
      const g = gastos[i];
      const pVes = Number(g.precio) || 0;
      const pUsdt = Number(g.precio_usdt) || (r > 0 ? pVes / r : 0);
      const rawRecs = Array.isArray(g.facturas) ? g.facturas.filter(Boolean) : (g.factura ? [g.factura] : []);
      const recs = rawRecs.slice(0, 2);

      // Fetch up to 2 image attachments
      const fetchedImages = [];
      for (const rFile of recs) {
        const ext = (rFile.split(".").pop() || "").toLowerCase();
        if (["jpg", "jpeg", "png", "webp"].includes(ext)) {
          const dataUrl = await fetchImageAsDataUrl(getReceiptUrl(rFile));
          if (dataUrl) fetchedImages.push(dataUrl);
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

      // Right-hand container for up to 2 photos
      const splitX = 350;
      const rightW = 226;
      doc.setFillColor(249, 250, 251);
      doc.rect(splitX, y + 1, rightW, cardHeight - 2, "F");
      doc.setDrawColor(229, 231, 235);
      doc.line(splitX, y, splitX, y + cardHeight);

      // Left side: expense details
      const leftX = 50;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(107, 114, 128);
      const cardHeaderTxt = isEn ? `EXPENSE #${i + 1} · ITEM / SERVICE` : `GASTO #${i + 1} · INSUMO / SERVICIO`;
      doc.text(cardHeaderTxt, leftX, y + 20);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(17, 24, 39);
      const prodLines = doc.splitTextToSize(String(g.producto || (isEn ? "No description" : "Sin descripción")), 285);
      doc.text(prodLines.slice(0, 2), leftX, y + 35);

      const detailsY = y + 64;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(55, 65, 81);
      doc.text(isEn ? "Amount (VES):" : "Monto (VES):", leftX, detailsY);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(17, 24, 39);
      doc.text(`VES ${formatNum(pVes)}`, leftX + 80, detailsY);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(55, 65, 81);
      doc.text(isEn ? "Amount (USDT):" : "Monto (USDT):", leftX, detailsY + 18);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(4, 120, 87);
      doc.text(`$${formatNum(pUsdt)} USDT`, leftX + 80, detailsY + 18);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(55, 65, 81);
      doc.text(isEn ? "Date:" : "Fecha:", leftX, detailsY + 36);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(75, 85, 99);
      doc.text(String(g.fecha || "—"), leftX + 80, detailsY + 36);

      // Right side: render 1 or 2 photos cleanly side-by-side
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(107, 114, 128);
      const attHeaderTxt = isEn ? "ATTACHED RECEIPTS" : "COMPROBANTES ADJUNTOS";
      doc.text(attHeaderTxt, splitX + (rightW / 2), y + 14, { align: "center" });

      if (fetchedImages.length === 2) {
        try {
          doc.addImage(fetchedImages[0], "JPEG", splitX + 10, y + 20, 98, 86);
        } catch (_) {}
        try {
          doc.addImage(fetchedImages[1], "JPEG", splitX + 118, y + 20, 98, 86);
        } catch (_) {}
      } else if (fetchedImages.length === 1) {
        try {
          doc.addImage(fetchedImages[0], "JPEG", splitX + 46, y + 20, 134, 86);
        } catch (_) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8.5);
          doc.text(isEn ? "Receipt attached" : "Adjunto registrado", splitX + (rightW / 2), y + 64, { align: "center" });
        }
      } else if (recs.length > 0) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(75, 85, 99);
        const docMsg = isEn ? `Document attached (${recs.length})` : `Documento adjunto (${recs.length})`;
        doc.text(docMsg, splitX + (rightW / 2), y + 64, { align: "center" });
      } else {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8.5);
        doc.setTextColor(156, 163, 175);
        const noAttMsg = isEn ? "No receipt attached" : "Sin comprobante adjunto";
        doc.text(noAttMsg, splitX + (rightW / 2), y + 64, { align: "center" });
      }

      y += cardHeight + 12;
    }
  }

  return doc;
}

async function generateClientSidePdf() {
  showToast(t("toast_pdf_generating"));
  const doc = await buildClientSidePdfDoc();
  if (doc) {
    const wNum = (appState.weekData && appState.weekData.numero) || "report";
    doc.save(`Nextglobal_Expense_Report_Week_${wNum}.pdf`);
  }
}

async function openPdfPreviewModal() {
  const modal = document.getElementById("pdf-preview-modal");
  const iframe = document.getElementById("pdf-preview-iframe");
  const sub = document.getElementById("pdf-modal-subtitle");
  const wNum = (appState.weekData && appState.weekData.numero) || "—";
  sub.textContent = `${t("week_caption_prefix")} ${wNum}`;

  showToast(t("toast_pdf_generating"));

  if (appState.backendMode === "fastapi") {
    iframe.src = `/api/week/${appState.selectedWeek}/report.pdf?lang=${appState.lang}#toolbar=0`;
  } else {
    const doc = await buildClientSidePdfDoc();
    if (!doc) return;
    const blob = doc.output("blob");
    const blobUrl = URL.createObjectURL(blob);
    iframe.src = blobUrl;
  }
  modal.classList.remove("hidden");
}

// ==========================================================================
// EVENT LISTENERS INITIALIZATION
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Initialize language & translations
  applyTranslations();

  const btnLangEs = document.getElementById("btn-lang-es");
  const btnLangEn = document.getElementById("btn-lang-en");
  if (btnLangEs) btnLangEs.addEventListener("click", () => setLanguage("es"));
  if (btnLangEn) btnLangEn.addEventListener("click", () => setLanguage("en"));

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
    const next = Math.max(1, Number(appState.selectedWeek) - 1);
    loadState(next);
  });
  document.getElementById("btn-next-week").addEventListener("click", () => {
    const next = Number(appState.selectedWeek) + 1;
    loadState(next);
  });
  document.getElementById("input-week-num").addEventListener("change", (e) => {
    const val = Math.max(1, Number(e.target.value) || appState.realCurrentWeek);
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

  // Download PDF & Preview PDF
  const btnDownloadPdf = document.getElementById("btn-download-pdf");
  if (btnDownloadPdf) {
    btnDownloadPdf.addEventListener("click", () => {
      if (appState.backendMode === "fastapi") {
        window.open(
          `/api/week/${appState.selectedWeek}/report.pdf?lang=${appState.lang}`,
          "_blank"
        );
      } else {
        generateClientSidePdf();
      }
    });
  }

  const btnPreviewPdf = document.getElementById("btn-preview-pdf");
  if (btnPreviewPdf) {
    btnPreviewPdf.addEventListener("click", () => {
      openPdfPreviewModal();
    });
  }

  // PDF Preview Modal listeners
  const btnClosePdfModal = document.getElementById("btn-close-pdf-modal");
  if (btnClosePdfModal) {
    btnClosePdfModal.addEventListener("click", () => {
      document.getElementById("pdf-preview-modal").classList.add("hidden");
    });
  }
  const pdfModal = document.getElementById("pdf-preview-modal");
  if (pdfModal) {
    pdfModal.addEventListener("click", (e) => {
      if (e.target.id === "pdf-preview-modal") {
        pdfModal.classList.add("hidden");
      }
    });
  }
  const btnModalDownloadPdf = document.getElementById("btn-modal-download-pdf");
  if (btnModalDownloadPdf) {
    btnModalDownloadPdf.addEventListener("click", () => {
      if (appState.backendMode === "fastapi") {
        window.open(
          `/api/week/${appState.selectedWeek}/report.pdf?lang=${appState.lang}`,
          "_blank"
        );
      } else {
        generateClientSidePdf();
      }
    });
  }

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
