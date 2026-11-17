import base64
import io
import json
import mimetypes
import os
import time
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import requests
import urllib3
from bs4 import BeautifulSoup
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response
from PIL import Image as PILImage
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import (
    Image as RLImage,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ==============================================================================
# NEXTGLOBAL CONFIGURATION & STORAGE SETUP
# ==============================================================================
BASE_DIR = Path(__file__).resolve().parent
CARPETA_ADJUNTOS = BASE_DIR / "adjuntos"
CARPETA_ADJUNTOS.mkdir(parents=True, exist_ok=True)

NG_SUPABASE_URL = os.environ.get(
    "SUPABASE_URL", "https://aswdqhmityjxyerblsfo.supabase.co"
).rstrip("/")
NG_SUPABASE_KEY = os.environ.get(
    "SUPABASE_KEY", "sb_publishable_zOQEgkqE7PcpsqTOFUWN2w_Om3JjrxJ"
)
NXT_ACCESS_PASSWORD = os.environ.get("NXT_PASSWORD", "Ng90071")
STORAGE_BUCKET = "recibos"


class SupabaseRelationalGateway:
    """
    Direct HTTP client for Nextglobal's real Supabase schema:
      - Table 'semanas' (numero=0 stores global Saldo Disponible state; numero>=41 stores each week)
      - Table 'gastos' (id, semana_numero, producto, precio, precio_usdt, factura, fecha)
      - Table 'pending_purchases' (id, item, priority, notes, date_added)
      - Storage bucket 'recibos'
    """

    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def _headers(self, extra: Optional[dict] = None) -> dict:
        h = {
            "apikey": self.api_key,
            "Authorization": f"Bearer {self.api_key}",
        }
        if extra:
            h.update(extra)
        return h

    # --- GLOBAL BALANCE (ROW numero = 0 IN semanas) ---
    def get_global_row(self, default_budget: float = 25.0, default_balance: float = 60.0) -> dict:
        url = f"{self.base_url}/rest/v1/semanas?numero=eq.0&select=*"
        res = requests.get(url, headers=self._headers(), timeout=6)
        if res.status_code == 200:
            rows = res.json()
            if isinstance(rows, list) and len(rows) > 0:
                return rows[0]

        payload = {
            "numero": 0,
            "presupuesto_base": default_budget,
            "remanente_anterior": default_balance,
            "budget_funded": False,
            "presupuesto_disponible": default_balance,
            "total_gastado": 0.0,
        }
        self.upsert_week_row(payload)
        return payload

    def set_global_available_balance(self, new_balance_usdt: float, default_budget: Optional[float] = None) -> dict:
        row = self.get_global_row()
        bal = round(float(new_balance_usdt), 2)
        base_b = round(float(default_budget), 2) if default_budget is not None else float(row.get("presupuesto_base", 25.0))
        payload = {
            "numero": 0,
            "presupuesto_base": base_b,
            "remanente_anterior": bal,
            "budget_funded": False,
            "presupuesto_disponible": bal,
            "total_gastado": 0.0,
        }
        return self.upsert_week_row(payload)

    def adjust_global_available_balance(self, delta_usdt: float) -> float:
        row = self.get_global_row()
        current_bal = float(row.get("presupuesto_disponible", 60.0))
        new_bal = round(current_bal + float(delta_usdt), 2)
        self.set_global_available_balance(new_bal)
        return new_bal

    # --- WEEKS (TABLE semanas) ---
    def list_weeks(self) -> List[dict]:
        url = f"{self.base_url}/rest/v1/semanas?numero=eq.{int(week_num)}&select=*"
        res = requests.get(url, headers=self._headers(), timeout=6)
        if res.status_code == 200 and isinstance(res.json(), list):
            return res.json()
        return []

    def get_week_row(self, week_num: int) -> Optional[dict]:
        url = f"{self.base_url}/rest/v1/semanas?numero=eq.{int(week_num)}&select=*"
        res = requests.get(url, headers=self._headers(), timeout=6)
        if res.status_code == 200:
            rows = res.json()
            if isinstance(rows, list) and len(rows) > 0:
                return rows[0]
        return None

    def upsert_week_row(self, week_payload: dict) -> dict:
        url = f"{self.base_url}/rest/v1/semanas?on_conflict=numero"
        headers = self._headers(
            {
                "Content-Type": "application/json",
                "Prefer": "return=representation,resolution=merge-duplicates",
            }
        )
        clean = {
            "numero": int(week_payload["numero"]),
            "presupuesto_base": round(float(week_payload.get("presupuesto_base", 25.0)), 2),
            "remanente_anterior": round(float(week_payload.get("remanente_anterior", 0.0)), 2),
            "budget_funded": bool(week_payload.get("budget_funded", False)),
            "presupuesto_disponible": round(float(week_payload.get("presupuesto_disponible", 0.0)), 2),
            "total_gastado": round(float(week_payload.get("total_gastado", 0.0)), 2),
        }
        res = requests.post(url, json=clean, headers=headers, timeout=6)
        if res.status_code in (200, 201):
            rows = res.json()
            if isinstance(rows, list) and len(rows) > 0:
                return rows[0]
        return clean

    # --- EXPENSES (TABLE gastos) ---
    def get_expenses_for_week(self, week_num: int) -> List[dict]:
        url = f"{self.base_url}/rest/v1/gastos?semana_numero=eq.{int(week_num)}&select=*&order=id.asc"
        res = requests.get(url, headers=self._headers(), timeout=6)
        if res.status_code == 200 and isinstance(res.json(), list):
            return res.json()
        return []

    def insert_expense(self, week_num: int, producto: str, precio: float, precio_usdt: float, factura_str: Optional[str], fecha_str: str) -> dict:
        url = f"{self.base_url}/rest/v1/gastos"
        headers = self._headers(
            {
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            }
        )
        payload = {
            "semana_numero": int(week_num),
            "producto": producto,
            "precio": round(float(precio), 2),
            "precio_usdt": round(float(precio_usdt), 2),
            "factura": factura_str,
            "fecha": fecha_str,
        }
        res = requests.post(url, json=payload, headers=headers, timeout=6)
        if res.status_code in (200, 201) and isinstance(res.json(), list) and res.json():
            return res.json()[0]
        raise HTTPException(status_code=500, detail=f"Error guardando gasto en Supabase: {res.text}")

    def update_expense_by_id(self, expense_id: int, producto: str, precio: float, precio_usdt: float, factura_str: Optional[str]) -> dict:
        url = f"{self.base_url}/rest/v1/gastos?id=eq.{int(expense_id)}"
        headers = self._headers(
            {
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            }
        )
        payload = {
            "producto": producto,
            "precio": round(float(precio), 2),
            "precio_usdt": round(float(precio_usdt), 2),
            "factura": factura_str,
        }
        res = requests.patch(url, json=payload, headers=headers, timeout=6)
        if res.status_code in (200, 201) and isinstance(res.json(), list) and res.json():
            return res.json()[0]
        raise HTTPException(status_code=500, detail=f"Error actualizando gasto en Supabase: {res.text}")

    def delete_expense_by_id(self, expense_id: int) -> bool:
        url = f"{self.base_url}/rest/v1/gastos?id=eq.{int(expense_id)}"
        res = requests.delete(url, headers=self._headers(), timeout=6)
        return res.status_code in (200, 204)

    # --- PENDING PURCHASES (TABLE pending_purchases) ---
    def list_pending(self) -> List[dict]:
        url = f"{self.base_url}/rest/v1/pending_purchases?select=*&order=id.asc"
        res = requests.get(url, headers=self._headers(), timeout=6)
        if res.status_code == 200 and isinstance(res.json(), list):
            return res.json()
        return []

    def insert_pending(self, item: str, priority: str, notes: str = "") -> dict:
        url = f"{self.base_url}/rest/v1/pending_purchases"
        headers = self._headers(
            {
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            }
        )
        payload = {
            "item": item,
            "priority": priority,
            "notes": notes,
            "date_added": datetime.now().strftime("%Y-%m-%d"),
        }
        res = requests.post(url, json=payload, headers=headers, timeout=6)
        if res.status_code in (200, 201) and isinstance(res.json(), list) and res.json():
            return res.json()[0]
        raise HTTPException(status_code=500, detail="No se pudo guardar en pending_purchases.")

    def delete_pending_by_id(self, pending_id: int) -> bool:
        url = f"{self.base_url}/rest/v1/pending_purchases?id=eq.{int(pending_id)}"
        res = requests.delete(url, headers=self._headers(), timeout=6)
        return res.status_code in (200, 204)

    # --- RECEIPT STORAGE (BUCKET recibos) ---
    def upload_receipt(self, filename: str, raw_bytes: bytes) -> str:
        mime_type, _ = mimetypes.guess_type(filename)
        url = f"{self.base_url}/storage/v1/object/{STORAGE_BUCKET}/{filename}"
        headers = self._headers(
            {
                "Content-Type": mime_type or "image/jpeg",
                "x-upsert": "true",
            }
        )
        res = requests.post(url, data=raw_bytes, headers=headers, timeout=12)
        if res.status_code not in (200, 201):
            raise HTTPException(status_code=500, detail=f"Error subiendo comprobante a Supabase Storage: {res.text}")
        return self.get_public_url(filename)

    def download_receipt(self, file_ref: str) -> Optional[bytes]:
        safe_name = Path(file_ref.split("?")[0]).name
        candidates = [
            f"{self.base_url}/storage/v1/object/public/{STORAGE_BUCKET}/{safe_name}",
            f"{self.base_url}/storage/v1/object/{STORAGE_BUCKET}/{safe_name}",
        ]
        if file_ref.startswith("http"):
            candidates.insert(0, file_ref)
        for url in candidates:
            try:
                res = requests.get(url, headers=self._headers(), timeout=8)
                if res.status_code == 200 and res.content:
                    return res.content
            except Exception:
                pass
        return None

    def get_public_url(self, file_ref: str) -> str:
        if file_ref.startswith("http"):
            return file_ref
        safe_name = Path(file_ref).name
        return f"{self.base_url}/storage/v1/object/public/{STORAGE_BUCKET}/{safe_name}"


supabase_gw = SupabaseRelationalGateway(NG_SUPABASE_URL, NG_SUPABASE_KEY)

LOGO_FILE = BASE_DIR / "logo.txt"
NG_LOGO_BASE64 = ""
if LOGO_FILE.exists():
    try:
        NG_LOGO_BASE64 = LOGO_FILE.read_text(encoding="utf-8").strip()
    except Exception:
        NG_LOGO_BASE64 = ""

# ==============================================================================
# FASTAPI APPLICATION INITIALIZATION
# ==============================================================================
app = FastAPI(
    title="NXTsavings — Nextglobal Weekly Budget Record",
    description="Sistema ágil de registro de caja chica, control semanal en USDT/VES y reportes PDF.",
    version="---" #ejemplo 2.0.1,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==============================================================================
# LIVE EXCHANGE RATE ENGINE (BINANCE P2P + ALCAMBIO FALLBACK)
# ==============================================================================
_RATE_STATE = {
    "rate": 100.00,
    "source": "Binance P2P",
    "updated_at": None,
    "last_fetch_ts": 0.0,
    "is_manual": False,
}


def fetch_online_usdt_rate() -> tuple[float, str]:
    """Fetches live USDT/VES exchange rate from Binance P2P with AlCambio fallback."""
    try:
        url = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Content-Type": "application/json",
        }
        payload = {
            "asset": "USDT",
            "fiat": "VES",
            "merchantCheck": False,
            "page": 1,
            "payTypes": [],
            "publisherType": None,
            "rows": 5,
            "tradeType": "BUY",
        }
        res = requests.post(url, json=payload, headers=headers, timeout=5)
        if res.status_code == 200:
            payload_data = res.json()
            if payload_data.get("data"):
                prices = [
                    float(adv["adv"]["price"])
                    for adv in payload_data["data"]
                    if adv.get("adv") and adv["adv"].get("price")
                ]
                if prices:
                    return round(sum(prices) / len(prices), 2), "Binance P2P"
    except Exception:
        pass

    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        res = requests.get("https://alcambio.app/", headers=headers, timeout=5)
        if res.status_code == 200:
            soup = BeautifulSoup(res.content, "html.parser")
            next_data = soup.find("script", id="__NEXT_DATA__")
            if next_data and next_data.string:
                parsed = json.loads(next_data.string)
                rates = (
                    parsed.get("props", {})
                    .get("pageProps", {})
                    .get("rates", [])
                )
                for rate_item in rates:
                    name = str(rate_item.get("source", "")).lower()
                    if "binance" in name or "usdt" in name:
                        val = float(rate_item.get("rate", 0))
                        if val > 0:
                            return round(val, 2), "AlCambio (Binance)"
    except Exception:
        pass

    return _RATE_STATE["rate"] or 100.00, "Fallback / Cache"


def get_active_rate(force_refresh: bool = False) -> dict:
    now = time.time()
    if force_refresh or (
        not _RATE_STATE["is_manual"]
        and (now - _RATE_STATE["last_fetch_ts"] > 600 or _RATE_STATE["updated_at"] is None)
    ):
        rate_val, source = fetch_online_usdt_rate()
        _RATE_STATE["rate"] = rate_val
        _RATE_STATE["source"] = source
        _RATE_STATE["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        _RATE_STATE["last_fetch_ts"] = now
        if force_refresh:
            _RATE_STATE["is_manual"] = False
    return _RATE_STATE


def get_current_real_week() -> int:
    current_iso_week = datetime.now().isocalendar()[1]
    return max(current_iso_week)


def parse_facturas_field(raw_factura: Optional[str]) -> List[str]:
    if not raw_factura:
        return []
    parts = [p.strip() for p in str(raw_factura).split("|") if p.strip()]
    return parts


def build_week_state(week_num: int, rate: float) -> tuple[dict, float]:
    """
    Loads (or initializes) week `week_num` from Supabase `semanas` and its expenses from `gastos`,
    plus the global `Saldo Disponible` from `semanas` (numero=0).
    """
    global_row = supabase_gw.get_global_row(default_budget=25.0, default_balance=60.0)
    global_available_usdt = round(float(global_row.get("presupuesto_disponible", 60.0)), 2)
    default_base_budget = round(float(global_row.get("presupuesto_base", 25.0)), 2)

    week_row = supabase_gw.get_week_row(week_num)
    if week_row is None:
        week_row = supabase_gw.upsert_week_row(
            {
                "numero": int(week_num),
                "presupuesto_base": default_base_budget,
                "remanente_anterior": global_available_usdt,
                "budget_funded": False,
                "presupuesto_disponible": global_available_usdt,
                "total_gastado": 0.0,
            }
        )

    raw_expenses = supabase_gw.get_expenses_for_week(week_num)
    gastos = []
    total_ves = 0.0
    total_usdt = 0.0

    for g in raw_expenses:
        p_ves = round(float(g.get("precio", 0.0)), 2)
        p_usdt = round(float(g.get("precio_usdt") or (p_ves / rate if rate > 0 else 0.0)), 2)
        total_ves += p_ves
        total_usdt += p_usdt
        facturas_list = parse_facturas_field(g.get("factura"))
        gastos.append(
            {
                "id": g.get("id"),
                "semana_numero": int(week_num),
                "producto": g.get("producto", ""),
                "precio": p_ves,
                "precio_usdt": p_usdt,
                "factura": facturas_list[0] if facturas_list else None,
                "facturas": facturas_list,
                "fecha": g.get("fecha", ""),
            }
        )

    total_ves = round(total_ves, 2)
    if abs(float(week_row.get("total_gastado", 0.0)) - total_ves) > 0.01:
        week_row["total_gastado"] = total_ves
        week_row["presupuesto_disponible"] = global_available_usdt
        supabase_gw.upsert_week_row(week_row)

    week_dict = {
        "id": week_row.get("id"),
        "numero": int(week_num),
        "presupuesto_base": round(float(week_row.get("presupuesto_base", default_base_budget)), 2),
        "remanente_anterior": global_available_usdt,
        "budget_funded": bool(week_row.get("budget_funded", False)),
        "presupuesto_disponible": global_available_usdt,
        "total_gastado": total_ves,
        "total_gastado_usdt": round(total_usdt, 2),
        "gastos": gastos,
    }
    return week_dict, global_available_usdt


def ensure_receipt_cached_locally(file_ref: str) -> Optional[Path]:
    """Ensures a receipt exists in CARPETA_ADJUNTOS, downloading from Supabase 'recibos' if needed."""
    if not file_ref:
        return None
    safe_name = Path(file_ref.split("?")[0]).name
    local_path = CARPETA_ADJUNTOS / safe_name
    if local_path.exists() and local_path.stat().st_size > 0:
        return local_path

    try:
        file_bytes = supabase_gw.download_receipt(file_ref)
        if file_bytes:
            local_path.write_bytes(file_bytes)
            return local_path
    except Exception:
        pass
    return None


# ==============================================================================
# PDF REPORT GENERATOR (REPORTLAB WITH EMBEDDED RECEIPTS & LOGO)
# ==============================================================================
def generate_pdf_report(week_data: dict, global_available_usdt: float, rate: float) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36,
    )
    styles = getSampleStyleSheet()
    story = []

    if NG_LOGO_BASE64:
        try:
            raw_logo = base64.b64decode(NG_LOGO_BASE64)
            logo_io = io.BytesIO(raw_logo)
            pil_logo = PILImage.open(logo_io)
            w, h = pil_logo.size
            aspect = h / float(w) if w > 0 else 0.35
            target_w = 130
            target_h = max(24, min(70, target_w * aspect))
            logo_io.seek(0)
            rl_logo = RLImage(logo_io, width=target_w, height=target_h)
            rl_logo.hAlign = "LEFT"
            story.append(rl_logo)
            story.append(Spacer(1, 8))
        except Exception:
            pass

    title_style = ParagraphStyle(
        "DocTitle",
        parent=styles["Title"],
        fontSize=17,
        leading=21,
        alignment=0,
        textColor=colors.HexColor("#111827"),
    )
    sub_style = ParagraphStyle(
        "DocSub",
        parent=styles["Normal"],
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#4B5563"),
    )
    cell_style = ParagraphStyle(
        "CellText",
        parent=styles["Normal"],
        fontSize=8.5,
        leading=11,
        textColor=colors.HexColor("#1F2937"),
    )

    story.append(Paragraph("NEXXTGLOBAL — WEEKLY EXPENSE REPORT", title_style))
    story.append(
        Paragraph(
            f"<b>Week {week_data['numero']}</b> &nbsp;|&nbsp; Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} &nbsp;|&nbsp; USDT Exchange Rate: <b>VES {rate:.2f}</b>",
            sub_style,
        )
    )
    story.append(Spacer(1, 14))

    weekly_budget_usdt = float(week_data["presupuesto_base"])
    total_spent_ves = float(week_data.get("total_gastado", 0.0))
    total_spent_usdt = round(total_spent_ves / rate, 2) if rate > 0 else 0.0
    weekly_remaining_usdt = round(weekly_budget_usdt - total_spent_usdt, 2)
    weekly_remaining_ves = round(weekly_remaining_usdt * rate, 2)
    global_available_ves = round(global_available_usdt * rate, 2)

    summary_data = [
        [
            "Presupuesto Semanal",
            "Total Gastado (Semana)",
            "Disponible de la Semana",
            "Ahorro Disponible Actualizado",
        ],
        [
            f"${weekly_budget_usdt:.2f} USDT\n(VES {weekly_budget_usdt * rate:,.2f})",
            f"${total_spent_usdt:.2f} USDT\n(VES {total_spent_ves:,.2f})",
            f"${weekly_remaining_usdt:.2f} USDT\n(VES {weekly_remaining_ves:,.2f})",
            f"${global_available_usdt:.2f} USDT\n(VES {global_available_ves:,.2f})",
        ],
    ]

    summary_table = Table(summary_data, colWidths=[130, 135, 135, 140])
    summary_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#F3F4F6")),
                ("TEXTCOLOR", (1, 1), (1, 1), colors.HexColor("#DC2626")),
                ("TEXTCOLOR", (3, 1), (3, 1), colors.HexColor("#059669")),
                ("FONTNAME", (1, 1), (3, 1), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.75, colors.HexColor("#D1D5DB")),
            ]
        )
    )
    story.append(summary_table)
    story.append(Spacer(1, 18))

    story.append(Paragraph("<b>Desglose de Gastos (Expenses Breakdown)</b>", styles["Heading3"]))
    story.append(Spacer(1, 8))

    card_title_style = ParagraphStyle(
        "CardItemTitle",
        parent=styles["Normal"],
        fontSize=11,
        leading=14,
        textColor=colors.HexColor("#111827"),
    )
    card_meta_style = ParagraphStyle(
        "CardItemMeta",
        parent=styles["Normal"],
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#374151"),
    )
    card_empty_att_style = ParagraphStyle(
        "CardEmptyAtt",
        parent=styles["Normal"],
        fontSize=8,
        leading=11,
        alignment=1,
        textColor=colors.HexColor("#9CA3AF"),
    )

    expenses = week_data.get("gastos", [])

    if not expenses:
        story.append(
            Paragraph("No hay gastos registrados en esta semana.", styles["Normal"])
        )
    else:
        for idx, g in enumerate(expenses, 1):
            p_ves = float(g.get("precio", 0.0))
            p_usdt = float(
                g.get("precio_usdt", p_ves / rate if rate > 0 else 0.0)
            )
            fecha_txt = str(g.get("fecha", "—"))
            prod_txt = str(g.get("producto", "Sin descripción"))
            receipts = g.get("facturas", [])

            # Left side content: Insumo/Servicio, Monto VES, Monto USDT, Fecha
            left_flowables = [
                Paragraph(
                    f"<font color='#6B7280'><b>#{idx}</b></font> &nbsp; <b>{prod_txt}</b>",
                    card_title_style,
                ),
                Spacer(1, 6),
                Paragraph(
                    f"<b>Monto (VES):</b> VES {p_ves:,.2f}",
                    card_meta_style,
                ),
                Paragraph(
                    f"<b>Monto (USDT):</b> <font color='#0284C7'><b>${p_usdt:.2f} USDT</b></font>",
                    card_meta_style,
                ),
                Paragraph(
                    f"<b>Fecha:</b> <font color='#6B7280'>{fecha_txt}</font>",
                    card_meta_style,
                ),
            ]

            # Right side content: Subtle receipt preview(s) inside the same box
            right_flowables = []
            max_box_w = 185.0 / max(len(receipts), 1)
            max_box_h = 95.0

            for r_file in receipts:
                local_path = ensure_receipt_cached_locally(r_file)
                safe_name = Path(r_file.split("?")[0]).name
                ext_file = Path(safe_name).suffix.lower()

                if local_path and local_path.exists() and ext_file in [".png", ".jpg", ".jpeg", ".webp"]:
                    try:
                        with PILImage.open(local_path) as pil_im:
                            pil_rgb = pil_im.convert("RGB")
                            w_orig, h_orig = pil_rgb.size
                            scale = min(
                                max_box_w / max(w_orig, 1),
                                max_box_h / max(h_orig, 1),
                                1.0,
                            )
                            draw_w = max(36.0, w_orig * scale)
                            draw_h = max(36.0, h_orig * scale)

                            thumb_io = io.BytesIO()
                            pil_rgb.save(thumb_io, format="JPEG", quality=85)
                            thumb_io.seek(0)
                            rl_img = RLImage(thumb_io, width=draw_w, height=draw_h)
                            rl_img.hAlign = "CENTER"
                            right_flowables.append(rl_img)
                    except Exception:
                        right_flowables.append(
                            Paragraph("📎 Comprobante adjunto", card_empty_att_style)
                        )
                elif ext_file == ".pdf":
                    right_flowables.append(
                        Paragraph(f"📄 Comprobante PDF<br/>({safe_name})", card_empty_att_style)
                    )
                else:
                    right_flowables.append(
                        Paragraph("📎 Adjunto", card_empty_att_style)
                    )

            if not right_flowables:
                right_cell = Paragraph("Sin comprobante adjunto", card_empty_att_style)
            elif len(right_flowables) == 1:
                right_cell = right_flowables[0]
            else:
                # Arrange multiple receipts side-by-side neatly inside the right half
                sub_tbl = Table([right_flowables])
                sub_tbl.setStyle(
                    TableStyle(
                        [
                            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 2),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                        ]
                    )
                )
                right_cell = sub_tbl

            card_table = Table(
                [[left_flowables, right_cell]],
                colWidths=[325, 215],
            )
            card_table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (0, 0), colors.white),
                        ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#F9FAFB")),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("ALIGN", (0, 0), (0, 0), "LEFT"),
                        ("ALIGN", (1, 0), (1, 0), "CENTER"),
                        ("TOPPADDING", (0, 0), (-1, -1), 10),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                        ("LEFTPADDING", (0, 0), (0, 0), 12),
                        ("RIGHTPADDING", (0, 0), (0, 0), 12),
                        ("LEFTPADDING", (1, 0), (1, 0), 8),
                        ("RIGHTPADDING", (1, 0), (1, 0), 8),
                        ("BOX", (0, 0), (-1, -1), 0.85, colors.HexColor("#D1D5DB")),
                        ("LINEBEFORE", (1, 0), (1, 0), 0.6, colors.HexColor("#E5E7EB")),
                    ]
                )
            )
            story.append(KeepTogether([card_table, Spacer(1, 9)]))

    doc.build(story)
    buffer.seek(0)
    return buffer.getvalue()

# ==============================================================================
# PYDANTIC REQUEST SCHEMAS
# ==============================================================================
class LoginRequest(BaseModel):
    password: str

class PendingItemRequest(BaseModel):
    item: str
    priority: str = "Medium"
    notes: str = ""

class FundWeekRequest(BaseModel):
    funded: bool

class WeekSettingsRequest(BaseModel):
    presupuesto_base: float
    saldo_disponible: float


class ManualRateRequest(BaseModel):
    rate: float


# ==============================================================================
# API ROUTES
# ==============================================================================
@app.get("/api/state")
def api_get_state(week: Optional[int] = Query(default=None)):
    rate_info = get_active_rate(force_refresh=False)
    rate = float(rate_info["rate"])
    real_week = get_current_real_week()
    selected_week_num = int(week) if week and int(week) >= 41 else real_week

    current_week, global_available_usdt = build_week_state(selected_week_num, rate)
    pending_list = supabase_gw.list_pending()

    weekly_budget_usdt = round(float(current_week["presupuesto_base"]), 2)
    total_spent_ves = round(float(current_week.get("total_gastado", 0.0)), 2)
    total_spent_usdt = round(total_spent_ves / rate, 2) if rate > 0 else 0.0

    # Disponible DE LA SEMANA = Presupuesto Semanal Aprobado - Total Gastado de esa semana
    weekly_remaining_usdt = round(weekly_budget_usdt - total_spent_usdt, 2)
    weekly_remaining_ves = round(weekly_remaining_usdt * rate, 2)

    # Saldo Disponible GLOBAL = El dinero actualizado en caja hoy (no cambia al ver semanas pasadas)
    global_available_ves = round(global_available_usdt * rate, 2)

    return {
        "real_current_week": real_week,
        "selected_week": selected_week_num,
        "rate": rate,
        "rate_source": rate_info["source"],
        "rate_updated_at": rate_info["updated_at"],
        "rate_is_manual": rate_info["is_manual"],
        "supabase_connected": True,
        "logo_base64": NG_LOGO_BASE64,
        "week": current_week,
        "metrics": {
            "weekly_budget_usdt": weekly_budget_usdt,
            "weekly_budget_ves": round(weekly_budget_usdt * rate, 2),
            "total_spent_ves": total_spent_ves,
            "total_spent_usdt": total_spent_usdt,
            "weekly_remaining_usdt": weekly_remaining_usdt,
            "weekly_remaining_ves": weekly_remaining_ves,
            "global_available_usdt": global_available_usdt,
            "global_available_ves": global_available_ves,
        },
        "pending_purchases": pending_list,
    }


@app.post("/api/auth/login")
def api_login(payload: LoginRequest):
    if payload.password == NXT_ACCESS_PASSWORD:
        return {"authenticated": True, "username": "Nextglobal"}
    raise HTTPException(
        status_code=401, detail="Contraseña incorrecta. Intenta nuevamente."
    )


@app.post("/api/rate/sync")
def api_sync_rate():
    rate_info = get_active_rate(force_refresh=True)
    return {
        "rate": rate_info["rate"],
        "source": rate_info["source"],
        "updated_at": rate_info["updated_at"],
        "is_manual": rate_info["is_manual"],
    }


@app.post("/api/rate/manual")
def api_manual_rate(payload: ManualRateRequest):
    if payload.rate <= 0:
        raise HTTPException(status_code=400, detail="La tasa debe ser mayor a 0.")
    _RATE_STATE["rate"] = round(float(payload.rate), 2)
    _RATE_STATE["source"] = "Manual"
    _RATE_STATE["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    _RATE_STATE["last_fetch_ts"] = time.time()
    _RATE_STATE["is_manual"] = True
    return {
        "rate": _RATE_STATE["rate"],
        "source": _RATE_STATE["source"],
        "updated_at": _RATE_STATE["updated_at"],
        "is_manual": True,
    }


@app.post("/api/pending")
def api_add_pending(payload: PendingItemRequest):
    name = payload.item.strip()
    if not name:
        raise HTTPException(
            status_code=400, detail="Por favor ingresa el nombre del insumo o necesidad."
        )
    prio = payload.priority if payload.priority in ["High", "Medium", "Low"] else "Medium"
    supabase_gw.insert_pending(name, prio, payload.notes.strip())
    return {"ok": True, "pending_purchases": supabase_gw.list_pending()}


@app.delete("/api/pending/{item_id}")
def api_delete_pending(item_id: int):
    supabase_gw.delete_pending_by_id(item_id)
    return {"ok": True, "pending_purchases": supabase_gw.list_pending()}


@app.post("/api/week/{week_num}/fund")
def api_fund_week(week_num: int, payload: FundWeekRequest):
    rate = float(get_active_rate()["rate"])
    current_week, global_avail = build_week_state(week_num, rate)
    was_funded = bool(current_week.get("budget_funded", False))
    target_funded = bool(payload.funded)

    if was_funded != target_funded:
        base_b = float(current_week.get("presupuesto_base", 25.0))
        delta = base_b if target_funded else -base_b
        global_avail = supabase_gw.adjust_global_available_balance(delta)
        current_week["budget_funded"] = target_funded
        current_week["presupuesto_disponible"] = global_avail
        supabase_gw.upsert_week_row(current_week)

    return {"ok": True, "global_available_usdt": global_avail}


@app.post("/api/week/{week_num}/settings")
def api_update_week_settings(week_num: int, payload: WeekSettingsRequest):
    if payload.presupuesto_base < 0:
        raise HTTPException(
            status_code=400, detail="El presupuesto semanal no puede ser negativo."
        )
    rate = float(get_active_rate()["rate"])
    current_week, _ = build_week_state(week_num, rate)

    # Update global available balance (applies across all weeks immediately)
    supabase_gw.set_global_available_balance(
        new_balance_usdt=payload.saldo_disponible,
        default_budget=payload.presupuesto_base,
    )

    # Update selected week's base budget
    current_week["presupuesto_base"] = round(float(payload.presupuesto_base), 2)
    current_week["presupuesto_disponible"] = round(float(payload.saldo_disponible), 2)
    current_week["remanente_anterior"] = round(float(payload.saldo_disponible), 2)
    supabase_gw.upsert_week_row(current_week)

    return {"ok": True}


def _store_uploaded_receipts(week_num: int, files: List[UploadFile]) -> List[str]:
    saved_urls: List[str] = []
    valid_files = [f for f in (files or []) if f and f.filename]
    for rf in valid_files[:3]:
        ext = Path(rf.filename).suffix.lower()
        if ext not in [".png", ".jpg", ".jpeg", ".pdf", ".webp"]:
            ext = ".jpg"
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        r_name = f"receipt_wk{week_num}_{timestamp}{ext}"
        raw_bytes = rf.file.read()
        if not raw_bytes:
            continue

        local_path = CARPETA_ADJUNTOS / r_name
        try:
            local_path.write_bytes(raw_bytes)
        except Exception:
            pass

        public_url = supabase_gw.upload_receipt(r_name, raw_bytes)
        saved_urls.append(public_url)
    return saved_urls


@app.post("/api/week/{week_num}/expenses")
def api_add_expense(
    week_num: int,
    producto: str = Form(...),
    precio: float = Form(...),
    resolve_pending_id: Optional[int] = Form(default=None),
    receipts: List[UploadFile] = File(default=[]),
):
    clean_name = producto.strip()
    if not clean_name:
        raise HTTPException(
            status_code=400, detail="Ingresa el nombre del producto o servicio."
        )
    if precio <= 0:
        raise HTTPException(
            status_code=400, detail="El precio en Bolívares (VES) debe ser mayor a 0."
        )

    rate = float(get_active_rate()["rate"])
    current_week, _ = build_week_state(week_num, rate)

    receipt_urls = _store_uploaded_receipts(week_num, receipts)
    factura_str = "|".join(receipt_urls) if receipt_urls else None
    p_usdt = round(float(precio) / rate, 2) if rate > 0 else 0.0
    fecha_str = datetime.now().strftime("%Y-%m-%d")

    inserted = supabase_gw.insert_expense(
        week_num=week_num,
        producto=clean_name,
        precio=round(float(precio), 2),
        precio_usdt=p_usdt,
        factura_str=factura_str,
        fecha_str=fecha_str,
    )

    # Subtract expense from Global Saldo Disponible
    new_global_avail = supabase_gw.adjust_global_available_balance(-p_usdt)

    # Update week total_gastado in Supabase
    current_week["total_gastado"] = round(float(current_week["total_gastado"]) + float(precio), 2)
    current_week["presupuesto_disponible"] = new_global_avail
    supabase_gw.upsert_week_row(current_week)

    if resolve_pending_id is not None:
        try:
            supabase_gw.delete_pending_by_id(int(resolve_pending_id))
        except Exception:
            pass

    return {"ok": True, "expense": inserted, "global_available_usdt": new_global_avail}


@app.put("/api/week/{week_num}/expenses/{expense_id}")
def api_edit_expense(
    week_num: int,
    expense_id: int,
    producto: str = Form(...),
    precio: float = Form(...),
    keep_existing_receipts: bool = Form(default=True),
    receipts: List[UploadFile] = File(default=[]),
):
    clean_name = producto.strip()
    if not clean_name:
        raise HTTPException(
            status_code=400, detail="Ingresa el nombre del producto o servicio."
        )
    if precio <= 0:
        raise HTTPException(
            status_code=400, detail="El precio en Bolívares (VES) debe ser mayor a 0."
        )

    rate = float(get_active_rate()["rate"])
    current_week, _ = build_week_state(week_num, rate)

    target = next(
        (g for g in current_week["gastos"] if int(g.get("id", -1)) == int(expense_id)),
        None,
    )
    if target is None:
        raise HTTPException(status_code=404, detail="Gasto no encontrado en esta semana.")

    old_usdt = float(target.get("precio_usdt", 0.0))
    existing_files = target.get("facturas", [])

    new_uploaded = _store_uploaded_receipts(week_num, receipts)
    if new_uploaded:
        final_receipts = new_uploaded
    elif keep_existing_receipts:
        final_receipts = existing_files
    else:
        final_receipts = []

    factura_str = "|".join(final_receipts) if final_receipts else None
    new_usdt = round(float(precio) / rate, 2) if rate > 0 else 0.0

    updated = supabase_gw.update_expense_by_id(
        expense_id=expense_id,
        producto=clean_name,
        precio=round(float(precio), 2),
        precio_usdt=new_usdt,
        factura_str=factura_str,
    )

    # Adjust Global Saldo Disponible by the difference (refund old_usdt, subtract new_usdt)
    delta_usdt = round(old_usdt - new_usdt, 2)
    new_global_avail = supabase_gw.adjust_global_available_balance(delta_usdt)

    # Refresh week total in Supabase
    build_week_state(week_num, rate)
    return {"ok": True, "expense": updated, "global_available_usdt": new_global_avail}


@app.delete("/api/week/{week_num}/expenses/{expense_id}")
def api_delete_expense(week_num: int, expense_id: int):
    rate = float(get_active_rate()["rate"])
    current_week, _ = build_week_state(week_num, rate)

    target = next(
        (g for g in current_week["gastos"] if int(g.get("id", -1)) == int(expense_id)),
        None,
    )
    if target is None:
        raise HTTPException(status_code=404, detail="Gasto no encontrado.")

    old_usdt = float(target.get("precio_usdt", 0.0))
    supabase_gw.delete_expense_by_id(expense_id)

    # Refund the deleted expense back to Global Saldo Disponible
    new_global_avail = supabase_gw.adjust_global_available_balance(old_usdt)

    build_week_state(week_num, rate)
    return {"ok": True, "deleted": target, "global_available_usdt": new_global_avail}


@app.get("/api/receipts/{filename:path}")
def api_get_receipt(filename: str):
    if filename.startswith("http"):
        return RedirectResponse(filename)
    safe_name = Path(filename).name
    local_path = ensure_receipt_cached_locally(safe_name)
    if local_path and local_path.exists():
        mime_type, _ = mimetypes.guess_type(str(local_path))
        return FileResponse(
            local_path, media_type=mime_type or "application/octet-stream"
        )

    public_url = supabase_gw.get_public_url(safe_name)
    return RedirectResponse(public_url)


@app.get("/api/week/{week_num}/report.pdf")
def api_download_pdf(week_num: int):
    rate = float(get_active_rate()["rate"])
    current_week, global_avail = build_week_state(week_num, rate)
    pdf_bytes = generate_pdf_report(current_week, global_avail, rate)
    filename = f"Nextglobal_Expense_Report_Week_{week_num}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/week/{week_num}/report.csv")
def api_download_csv(week_num: int):
    rate = float(get_active_rate()["rate"])
    current_week, _ = build_week_state(week_num, rate)

    lines = [
        "\ufeff#,Item / Service,Price (VES),Price (USDT),Receipts Count,Date"
    ]
    for idx, g in enumerate(current_week.get("gastos", []), 1):
        p_ves = float(g.get("precio", 0.0))
        p_usdt = float(g.get("precio_usdt", p_ves / rate if rate > 0 else 0.0))
        recs = g.get("facturas", [])
        prod_escaped = str(g.get("producto", "")).replace('"', '""')
        lines.append(
            f'{idx},"{prod_escaped}",{p_ves:.2f},{p_usdt:.2f},{len(recs)},"{g.get("fecha", "")}"'
        )

    csv_bytes = "\n".join(lines).encode("utf-8")
    filename = f"Nextglobal_Expenses_Week_{week_num}.csv"
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ==============================================================================
# FRONTEND STATIC FILES ROUTES
# ==============================================================================
@app.get("/")
def serve_index():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/styles.css")
def serve_css():
    return FileResponse(BASE_DIR / "styles.css", media_type="text/css")


@app.get("/script.js")
def serve_js():
    return FileResponse(BASE_DIR / "script.js", media_type="application/javascript")


@app.get("/manifest.json")
def serve_manifest():
    return FileResponse(
        BASE_DIR / "manifest.json", media_type="application/manifest+json"
    )


@app.get("/logo.txt")
def serve_logo_txt():
    if LOGO_FILE.exists():
        return FileResponse(LOGO_FILE, media_type="text/plain")
    return Response(content="", media_type="text/plain")

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("NXTsavings:app", host="0.0.0.0", port=port, reload=False)
