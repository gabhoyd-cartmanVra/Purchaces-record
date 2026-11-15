import base64
import copy
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
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
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
LOCAL_BACKUP_FILE = CARPETA_ADJUNTOS / "local_backup.json"

NG_SUPABASE_URL = os.environ.get(
    "SUPABASE_URL", "https://aswdqhmityjxyerblsfo.supabase.co"
).rstrip("/")
NG_SUPABASE_KEY = os.environ.get(
    "SUPABASE_KEY", "sb_publishable_zOQEgkqE7PcpsqTOFUWN2w_Om3JjrxJ"
)
NXT_ACCESS_PASSWORD = os.environ.get("NXT_PASSWORD", "Ng90071")


class SupabaseGateway:
    """Direct HTTP client for Supabase PostgREST and Storage compatible with both sb_publishable and JWT keys."""

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

    def fetch_app_data(self) -> Optional[dict]:
        url = f"{self.base_url}/rest/v1/app_data?id=eq.1&select=content"
        res = requests.get(url, headers=self._headers(), timeout=5)
        if res.status_code == 200:
            rows = res.json()
            if isinstance(rows, list) and len(rows) > 0:
                return rows[0].get("content")
        return None

    def upsert_app_data(self, content: dict) -> bool:
        url = f"{self.base_url}/rest/v1/app_data"
        headers = self._headers(
            {
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates",
            }
        )
        res = requests.post(
            url, json={"id": 1, "content": content}, headers=headers, timeout=5
        )
        return res.status_code in (200, 201, 204)

    def upload_receipt(self, filename: str, raw_bytes: bytes) -> bool:
        mime_type, _ = mimetypes.guess_type(filename)
        url = f"{self.base_url}/storage/v1/object/receipts/{filename}"
        headers = self._headers(
            {
                "Content-Type": mime_type or "application/octet-stream",
                "x-upsert": "true",
            }
        )
        res = requests.post(url, data=raw_bytes, headers=headers, timeout=10)
        return res.status_code in (200, 201)

    def download_receipt(self, filename: str) -> Optional[bytes]:
        for path in [
            f"{self.base_url}/storage/v1/object/public/receipts/{filename}",
            f"{self.base_url}/storage/v1/object/receipts/{filename}",
        ]:
            res = requests.get(path, headers=self._headers(), timeout=8)
            if res.status_code == 200 and res.content:
                return res.content
        return None

    def get_public_url(self, filename: str) -> str:
        return f"{self.base_url}/storage/v1/object/public/receipts/{filename}"


supabase_gw = SupabaseGateway(NG_SUPABASE_URL, NG_SUPABASE_KEY)

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
    title="NXTsavings — Nextglobal Petty Cash & Weekly Budget Record",
    description="Sistema ágil de registro de caja chica, control semanal en USDT/VES y reportes PDF.",
    version="2.0.0",
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


# ==============================================================================
# DATA PERSISTENCE LAYER (SUPABASE + LOCAL FALLBACK)
# ==============================================================================
_MEMORY_STORE = {"semanas": [], "pending_purchases": []}


def get_current_real_week() -> int:
    current_iso_week = datetime.now().isocalendar()[1]
    return max(41, current_iso_week)


def load_data() -> dict:
    global _MEMORY_STORE
    try:
        content = supabase_gw.fetch_app_data()
        if isinstance(content, dict):
            content.setdefault("semanas", [])
            content.setdefault("pending_purchases", [])
            _MEMORY_STORE = content
            try:
                LOCAL_BACKUP_FILE.write_text(
                    json.dumps(content, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            except Exception:
                pass
            return content
    except Exception:
        pass

    if LOCAL_BACKUP_FILE.exists():
        try:
            local_content = json.loads(
                LOCAL_BACKUP_FILE.read_text(encoding="utf-8")
            )
            if isinstance(local_content, dict):
                local_content.setdefault("semanas", [])
                local_content.setdefault("pending_purchases", [])
                _MEMORY_STORE = local_content
                return local_content
        except Exception:
            pass

    return _MEMORY_STORE


def save_data(data: dict) -> bool:
    global _MEMORY_STORE
    _MEMORY_STORE = data
    try:
        LOCAL_BACKUP_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception:
        pass

    try:
        return supabase_gw.upsert_app_data(data)
    except Exception:
        return False


def normalize_week(sem: dict, rate: float) -> dict:
    """Ensures a week record has consistent fields and calculated metrics."""
    sem.setdefault("presupuesto_base", 25.0)
    sem.setdefault("remanente_anterior", 60.0)
    sem.setdefault("budget_funded", False)
    sem.setdefault("gastos", [])

    # Normalize each expense to always have both 'factura' and 'facturas'
    total_ves = 0.0
    for idx, g in enumerate(sem["gastos"]):
        precio_val = float(g.get("precio", 0.0))
        total_ves += precio_val
        facturas_list = g.get("facturas")
        if not isinstance(facturas_list, list):
            facturas_list = [g["factura"]] if g.get("factura") else []
        facturas_list = [f for f in facturas_list if f]
        g["facturas"] = facturas_list
        g["factura"] = facturas_list[0] if facturas_list else None
        if "precio_usdt" not in g or g["precio_usdt"] is None:
            g["precio_usdt"] = round(precio_val / rate, 2) if rate > 0 else 0.0

    sem["total_gastado"] = round(total_ves, 2)
    base_amount = float(sem["presupuesto_base"]) if sem.get("budget_funded") else 0.0
    sem["presupuesto_disponible"] = round(
        base_amount + float(sem["remanente_anterior"]), 2
    )
    return sem


def get_or_create_week(
    data: dict, week_num: int, rate: float, base_budget: float = 25.0, initial_savings: float = 60.0
) -> dict:
    for sem in data["semanas"]:
        if int(sem.get("numero", 0)) == int(week_num):
            return normalize_week(sem, rate)

    valid_weeks = sorted(
        [s for s in data["semanas"] if int(s.get("numero", 0)) >= 41],
        key=lambda x: int(x.get("numero", 0)),
    )

    # Find the closest preceding week to compute rollover
    prev_weeks = [s for s in valid_weeks if int(s.get("numero", 0)) < int(week_num)]
    if not prev_weeks and not valid_weeks:
        rollover = initial_savings
    else:
        prev = prev_weeks[-1] if prev_weeks else valid_weeks[-1]
        prev = normalize_week(prev, rate)
        spent_usdt = prev["total_gastado"] / rate if rate > 0 else 0.0
        prev_is_funded = prev.get("budget_funded", False)
        prev_base = float(prev["presupuesto_base"]) if prev_is_funded else 0.0
        prev_available = prev_base + float(prev["remanente_anterior"])
        rollover = round(prev_available - spent_usdt, 2)

    new_week = {
        "numero": int(week_num),
        "presupuesto_base": base_budget,
        "remanente_anterior": rollover,
        "budget_funded": False,
        "presupuesto_disponible": rollover,
        "gastos": [],
        "total_gastado": 0.0,
    }
    data["semanas"].append(new_week)
    save_data(data)
    return normalize_week(new_week, rate)


def ensure_receipt_cached_locally(filename: str) -> Optional[Path]:
    """Ensures a receipt exists in CARPETA_ADJUNTOS, downloading from Supabase if needed."""
    if not filename:
        return None
    safe_name = Path(filename).name
    local_path = CARPETA_ADJUNTOS / safe_name
    if local_path.exists() and local_path.stat().st_size > 0:
        return local_path

    try:
        file_bytes = supabase_gw.download_receipt(safe_name)
        if file_bytes:
            local_path.write_bytes(file_bytes)
            return local_path
    except Exception:
        pass
    return None


# ==============================================================================
# PDF REPORT GENERATOR (REPORTLAB WITH EMBEDDED RECEIPTS & LOGO)
# ==============================================================================
def generate_pdf_report(week_data: dict, rate: float) -> bytes:
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

    # Optional Nextglobal Logo Header
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

    story.append(Paragraph("NEXTGLOBAL — WEEKLY EXPENSE REPORT", title_style))
    story.append(
        Paragraph(
            f"<b>Week {week_data['numero']}</b> &nbsp;|&nbsp; Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} &nbsp;|&nbsp; USDT Exchange Rate: <b>VES {rate:.2f}</b>",
            sub_style,
        )
    )
    story.append(Spacer(1, 14))

    is_funded = week_data.get("budget_funded", False)
    funded_text = "Funded (Transferido)" if is_funded else "Not Funded (Pendiente)"

    total_spent_ves = float(week_data.get("total_gastado", 0.0))
    total_spent_usdt = total_spent_ves / rate if rate > 0 else 0.0

    base_amount = float(week_data["presupuesto_base"]) if is_funded else 0.0
    available_budget = base_amount + float(week_data["remanente_anterior"])

    rem_usdt = available_budget - total_spent_usdt
    rem_ves = rem_usdt * rate

    summary_data = [
        [
            "Weekly Budget",
            "Rollover / Savings",
            "Status",
            "Total Spent (Gastado)",
            "Available Balance (Disponible)",
        ],
        [
            f"${float(week_data['presupuesto_base']):.2f} USDT",
            f"${float(week_data['remanente_anterior']):.2f} USDT",
            funded_text,
            f"${total_spent_usdt:.2f} USDT\n(VES {total_spent_ves:,.2f})",
            f"${rem_usdt:.2f} USDT\n(VES {rem_ves:,.2f})",
        ],
    ]

    summary_table = Table(summary_data, colWidths=[95, 100, 95, 125, 125])
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
                ("TEXTCOLOR", (3, 1), (3, 1), colors.HexColor("#DC2626")),
                ("TEXTCOLOR", (4, 1), (4, 1), colors.HexColor("#059669")),
                ("FONTNAME", (3, 1), (4, 1), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.75, colors.HexColor("#D1D5DB")),
            ]
        )
    )
    story.append(summary_table)
    story.append(Spacer(1, 18))

    story.append(Paragraph("<b>Expenses Breakdown (Desglose de Gastos)</b>", styles["Heading3"]))
    story.append(Spacer(1, 6))

    expenses = week_data.get("gastos", [])
    annex_images = []

    if not expenses:
        story.append(
            Paragraph("No expenses recorded for this week.", styles["Normal"])
        )
    else:
        item_table_data = [
            [
                "#",
                "Item / Service Name",
                "Price (VES)",
                "Price (USDT)",
                "Receipts",
                "Date & Time",
            ]
        ]
        for idx, g in enumerate(expenses, 1):
            p_ves = float(g.get("precio", 0.0))
            p_usdt = float(
                g.get("precio_usdt", p_ves / rate if rate > 0 else 0.0)
            )
            receipts = g.get(
                "facturas", [g.get("factura")] if g.get("factura") else []
            )
            receipts = [r for r in receipts if r]

            img_elements = []
            for r_file in receipts:
                local_path = ensure_receipt_cached_locally(r_file)
                ext_file = Path(r_file).suffix.lower()

                if local_path and local_path.exists() and ext_file in [".png", ".jpg", ".jpeg", ".webp"]:
                    try:
                        with PILImage.open(local_path) as pil_im:
                            pil_rgb = pil_im.convert("RGB")
                            thumb_io = io.BytesIO()
                            pil_rgb.save(thumb_io, format="JPEG", quality=82)
                            thumb_io.seek(0)
                            rl_img = RLImage(thumb_io, width=42, height=42)
                            img_elements.append(rl_img)

                            annex_io = io.BytesIO()
                            pil_rgb.save(annex_io, format="JPEG", quality=88)
                            annex_io.seek(0)
                            w_orig, h_orig = pil_rgb.size
                            max_w, max_h = 440.0, 290.0
                            scale = min(max_w / max(w_orig, 1), max_h / max(h_orig, 1), 1.0)
                            annex_images.append(
                                (
                                    f"#{idx} — {g.get('producto', '')} (VES {p_ves:,.2f} / ${p_usdt:.2f} USDT)",
                                    r_file,
                                    annex_io,
                                    w_orig * scale,
                                    h_orig * scale,
                                )
                            )
                    except Exception:
                        img_elements.append(Paragraph("📎 Image", cell_style))
                elif ext_file == ".pdf":
                    img_elements.append(Paragraph("📄 PDF Receipt", cell_style))
                else:
                    img_elements.append(Paragraph("📎 Attached", cell_style))

            receipt_cell = img_elements if img_elements else Paragraph("—", cell_style)

            item_table_data.append(
                [
                    str(idx),
                    Paragraph(str(g.get("producto", "")), cell_style),
                    f"VES {p_ves:,.2f}",
                    f"${p_usdt:.2f}",
                    receipt_cell,
                    str(g.get("fecha", "")),
                ]
            )

        expense_table = Table(
            item_table_data, colWidths=[24, 176, 85, 65, 95, 95]
        )
        expense_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F2937")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                    ("ALIGN", (0, 0), (0, -1), "CENTER"),
                    ("ALIGN", (2, 0), (3, -1), "RIGHT"),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
                ]
            )
        )
        story.append(expense_table)

    # Append high-clarity Receipt Annex so receipts are easy to inspect in the PDF
    if annex_images:
        story.append(PageBreak())
        story.append(
            Paragraph(
                f"<b>Receipt Annex — Week {week_data['numero']} (Comprobantes de Pago)</b>",
                styles["Heading2"],
            )
        )
        story.append(Spacer(1, 10))
        for caption_text, r_file, annex_io, draw_w, draw_h in annex_images:
            block = [
                Paragraph(f"<b>{caption_text}</b> <font color='#6B7280'>({r_file})</font>", sub_style),
                Spacer(1, 4),
                RLImage(annex_io, width=draw_w, height=draw_h),
                Spacer(1, 14),
            ]
            story.append(KeepTogether(block))

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
    remanente_anterior: float


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

    data = load_data()
    current_week = get_or_create_week(data, selected_week_num, rate)

    total_spent_ves = float(current_week.get("total_gastado", 0.0))
    total_spent_usdt = round(total_spent_ves / rate, 2) if rate > 0 else 0.0
    available_usdt = float(current_week.get("presupuesto_disponible", 0.0))
    remaining_usdt = round(available_usdt - total_spent_usdt, 2)
    remaining_ves = round(remaining_usdt * rate, 2)

    all_week_nums = sorted(
        list(
            {
                int(s.get("numero", real_week))
                for s in data.get("semanas", [])
                if int(s.get("numero", 0)) >= 41
            }
            | {real_week, selected_week_num}
        )
    )

    return {
        "real_current_week": real_week,
        "selected_week": selected_week_num,
        "available_weeks": all_week_nums,
        "rate": rate,
        "rate_source": rate_info["source"],
        "rate_updated_at": rate_info["updated_at"],
        "rate_is_manual": rate_info["is_manual"],
        "supabase_connected": True,
        "logo_base64": NG_LOGO_BASE64,
        "week": current_week,
        "metrics": {
            "weekly_budget_usdt": round(float(current_week["presupuesto_base"]), 2),
            "rollover_usdt": round(float(current_week["remanente_anterior"]), 2),
            "available_budget_usdt": round(available_usdt, 2),
            "total_spent_ves": round(total_spent_ves, 2),
            "total_spent_usdt": total_spent_usdt,
            "remaining_balance_usdt": remaining_usdt,
            "remaining_balance_ves": remaining_ves,
        },
        "pending_purchases": data.get("pending_purchases", []),
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
    data = load_data()
    data.setdefault("pending_purchases", [])
    new_item = {
        "item": name,
        "priority": prio,
        "notes": payload.notes.strip(),
        "date_added": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    data["pending_purchases"].append(new_item)
    save_data(data)
    return {"ok": True, "pending_purchases": data["pending_purchases"]}


@app.delete("/api/pending/{idx}")
def api_delete_pending(idx: int):
    data = load_data()
    pending = data.get("pending_purchases", [])
    if idx < 0 or idx >= len(pending):
        raise HTTPException(status_code=404, detail="Elemento no encontrado.")
    removed = pending.pop(idx)
    save_data(data)
    return {
        "ok": True,
        "removed": removed,
        "pending_purchases": pending,
    }


@app.post("/api/week/{week_num}/fund")
def api_fund_week(week_num: int, payload: FundWeekRequest):
    rate = float(get_active_rate()["rate"])
    data = load_data()
    current_week = get_or_create_week(data, week_num, rate)
    current_week["budget_funded"] = bool(payload.funded)
    normalize_week(current_week, rate)
    save_data(data)
    return {"ok": True, "week": current_week}


@app.post("/api/week/{week_num}/settings")
def api_update_week_settings(week_num: int, payload: WeekSettingsRequest):
    if payload.presupuesto_base < 0 or payload.remanente_anterior < 0:
        raise HTTPException(
            status_code=400, detail="Los montos no pueden ser negativos."
        )
    rate = float(get_active_rate()["rate"])
    data = load_data()
    current_week = get_or_create_week(data, week_num, rate)
    current_week["presupuesto_base"] = round(float(payload.presupuesto_base), 2)
    current_week["remanente_anterior"] = round(float(payload.remanente_anterior), 2)
    normalize_week(current_week, rate)
    save_data(data)
    return {"ok": True, "week": current_week}


@app.post("/api/week/{week_num}/recalculate-rollover")
def api_recalculate_rollover(week_num: int):
    """Recalculates the rollover/savings of week_num based on the previous week's closing balance."""
    rate = float(get_active_rate()["rate"])
    data = load_data()
    current_week = get_or_create_week(data, week_num, rate)

    prev_weeks = sorted(
        [
            s
            for s in data.get("semanas", [])
            if 41 <= int(s.get("numero", 0)) < int(week_num)
        ],
        key=lambda x: int(x.get("numero", 0)),
    )
    if not prev_weeks:
        return {"ok": True, "week": current_week, "message": "Primera semana registrada."}

    prev = normalize_week(prev_weeks[-1], rate)
    spent_usdt = prev["total_gastado"] / rate if rate > 0 else 0.0
    prev_base = float(prev["presupuesto_base"]) if prev.get("budget_funded") else 0.0
    prev_available = prev_base + float(prev["remanente_anterior"])
    current_week["remanente_anterior"] = round(prev_available - spent_usdt, 2)
    normalize_week(current_week, rate)
    save_data(data)
    return {"ok": True, "week": current_week}


def _store_uploaded_receipts(week_num: int, files: List[UploadFile]) -> List[str]:
    saved_names: List[str] = []
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

        try:
            supabase_gw.upload_receipt(r_name, raw_bytes)
        except Exception:
            pass

        saved_names.append(r_name)
    return saved_names


@app.post("/api/week/{week_num}/expenses")
def api_add_expense(
    week_num: int,
    producto: str = Form(...),
    precio: float = Form(...),
    resolve_pending_index: Optional[int] = Form(default=None),
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
    data = load_data()
    current_week = get_or_create_week(data, week_num, rate)

    receipt_filenames = _store_uploaded_receipts(week_num, receipts)
    p_usdt = round(float(precio) / rate, 2) if rate > 0 else 0.0

    expense = {
        "producto": clean_name,
        "precio": round(float(precio), 2),
        "precio_usdt": p_usdt,
        "factura": receipt_filenames[0] if receipt_filenames else None,
        "facturas": receipt_filenames,
        "fecha": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    current_week["gastos"].append(expense)
    normalize_week(current_week, rate)

    # Optionally resolve a pending purchase item if selected
    if (
        resolve_pending_index is not None
        and 0 <= resolve_pending_index < len(data.get("pending_purchases", []))
    ):
        data["pending_purchases"].pop(resolve_pending_index)

    save_data(data)
    return {"ok": True, "expense": expense, "week": current_week}


@app.put("/api/week/{week_num}/expenses/{idx}")
def api_edit_expense(
    week_num: int,
    idx: int,
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
    data = load_data()
    current_week = get_or_create_week(data, week_num, rate)

    gastos = current_week.get("gastos", [])
    if idx < 0 or idx >= len(gastos):
        raise HTTPException(status_code=404, detail="Gasto no encontrado.")

    target = gastos[idx]
    existing_files = target.get(
        "facturas", [target.get("factura")] if target.get("factura") else []
    )
    existing_files = [f for f in existing_files if f]

    new_uploaded = _store_uploaded_receipts(week_num, receipts)
    if new_uploaded:
        final_receipts = new_uploaded
    elif keep_existing_receipts:
        final_receipts = existing_files
    else:
        final_receipts = []

    p_usdt = round(float(precio) / rate, 2) if rate > 0 else 0.0
    target["producto"] = clean_name
    target["precio"] = round(float(precio), 2)
    target["precio_usdt"] = p_usdt
    target["factura"] = final_receipts[0] if final_receipts else None
    target["facturas"] = final_receipts

    normalize_week(current_week, rate)
    save_data(data)
    return {"ok": True, "expense": target, "week": current_week}


@app.delete("/api/week/{week_num}/expenses/{idx}")
def api_delete_expense(week_num: int, idx: int):
    rate = float(get_active_rate()["rate"])
    data = load_data()
    current_week = get_or_create_week(data, week_num, rate)

    gastos = current_week.get("gastos", [])
    if idx < 0 or idx >= len(gastos):
        raise HTTPException(status_code=404, detail="Gasto no encontrado.")

    deleted = gastos.pop(idx)
    normalize_week(current_week, rate)
    save_data(data)
    return {"ok": True, "deleted": deleted, "week": current_week}


@app.get("/api/receipts/{filename}")
def api_get_receipt(filename: str):
    safe_name = Path(filename).name
    local_path = ensure_receipt_cached_locally(safe_name)
    if local_path and local_path.exists():
        mime_type, _ = mimetypes.guess_type(str(local_path))
        return FileResponse(
            local_path, media_type=mime_type or "application/octet-stream"
        )

    try:
        public_url = supabase_gw.get_public_url(safe_name)
        if public_url:
            return RedirectResponse(public_url)
    except Exception:
        pass

    raise HTTPException(status_code=404, detail="Comprobante no encontrado.")


@app.get("/api/week/{week_num}/report.pdf")
def api_download_pdf(week_num: int):
    rate = float(get_active_rate()["rate"])
    data = load_data()
    current_week = get_or_create_week(data, week_num, rate)
    pdf_bytes = generate_pdf_report(current_week, rate)
    filename = f"Nextglobal_Expense_Report_Week_{week_num}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/week/{week_num}/report.csv")
def api_download_csv(week_num: int):
    rate = float(get_active_rate()["rate"])
    data = load_data()
    current_week = get_or_create_week(data, week_num, rate)

    lines = [
        "\ufeff#,Item / Service,Price (VES),Price (USDT),Receipts Count,Date & Time"
    ]
    for idx, g in enumerate(current_week.get("gastos", []), 1):
        p_ves = float(g.get("precio", 0.0))
        p_usdt = float(g.get("precio_usdt", p_ves / rate if rate > 0 else 0.0))
        recs = g.get("facturas", [g.get("factura")] if g.get("factura") else [])
        recs = [r for r in recs if r]
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
