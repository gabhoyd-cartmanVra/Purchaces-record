# NXTsavings — Nextglobal Weekly Budget Record

Sistema de registro de caja chica semanal, control de remanente/ahorro en USDT y Bolívares (VES), carga de comprobantes con compresión inteligente para celular y generación de reportes ejecutivos en PDF.

## 🚀 Características Principales

- **Motor Principal (`NXTsavings.py`)**: Backend en **FastAPI (Python)** con sincronización en tiempo real de la tasa **USDT/VES** desde **Binance P2P** (y respaldo automático en *AlCambio*).
- **Interfaz Web Moderna y Móvil (PWA)**: Funciona de forma fluida desde cualquier teléfono o computadora sin recargas de página lentas.
- **Compresión Automática de Comprobantes**: Al tomar foto de una factura desde el teléfono, la aplicación la optimiza automáticamente antes de subirla a **Supabase Storage** (`receipts`).
- **Reportes Ejecutivos PDF y CSV**: Genera el reporte semanal en PDF con el logo de **Nextglobal**, tabla de métricas y fotos de los comprobantes incrustadas.
- **Conexión Directa a Supabase**: Sincronizado con la base de datos de Nextglobal (`app_data` y bucket `receipts`) sin bloqueos por archivos `secrets.toml` locales.

## 💻 ¿Cómo abrirlo en tu computadora sin usar la terminal de VS Code?

- **En Windows**: Haz doble clic sobre el archivo **`iniciar_NXTsavings.bat`**. Automáticamente abrirá tu navegador en `http://localhost:8000`.
- **En Mac / Linux**: Haz doble clic sobre **`iniciar_NXTsavings.command`** (o ejecuta `python3 NXTsavings.py`).

## 📱 ¿Cómo usarlo desde el teléfono o enlace web?

1. **Vía GitHub Pages (Acceso Web Directo)**:
   - Ve a **Settings → Pages** en este repositorio de GitHub y en **Branch** selecciona `main` (`/root`) y guarda.
   - Tu enlace web público quedará activo en: `https://gabhoyd-cartmanvra.github.io/Purchaces-record/`
2. **Vía Render o Vercel (con servidor Python `NXTsavings.py`)**:
   - El proyecto incluye `render.yaml`, `Procfile` y `vercel.json` preconfigurados apuntando a `NXTsavings.py`.
3. **Instalar como App en el teléfono**:
   - Abre el enlace desde Chrome (Android) o Safari (iPhone) y selecciona **"Agregar a la pantalla de inicio"**.
