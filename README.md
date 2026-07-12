# MetaLens

Herramienta web para extraer metadatos de fotografías y videos. Motor principal: **ExifTool** (vía `exiftool-vendored`), complementado con **ffprobe** para los detalles técnicos de video.

## Requisitos

- Node.js 18+
- `ffprobe` en el PATH (parte de FFmpeg) — solo necesario para el detalle técnico de videos; sin él, los videos igual se analizan con ExifTool.

El binario de ExifTool viene incluido con `exiftool-vendored`, no hay que instalarlo aparte.

## Uso

```bash
npm install
npm start
# abre http://localhost:3000
```

## API

`POST /api/extract` — multipart/form-data con el campo `file` (imagen o video, máx. 1 GB).

```bash
curl -F "file=@foto.jpg" http://localhost:3000/api/extract
```

Respuesta:

```json
{
  "summary": { "fileName": "...", "make": "...", "gps": { "latitude": 0, "longitude": 0 }, "video": { "duration": 0, "videoCodec": "..." } },
  "groups":  { "ExifIFD": { "ISO": 200 }, "GPS": { } },
  "ffprobe": { "format": { }, "streams": [ ] }
}
```

- `summary` — campos clave normalizados (cámara, exposición, fecha, GPS, códecs).
- `groups` — todos los tags de ExifTool agrupados por familia (`-G1`).
- `ffprobe` — salida cruda de ffprobe (solo videos).

## Despliegue

Esta app necesita un **servidor persistente** — no funciona en plataformas serverless como Vercel (límite de 4.5 MB por petición, sin ffprobe ni Perl en el runtime).

El `Dockerfile` incluido trae Node + ffmpeg + Perl y funciona tal cual en:

- **Render**: "New → Web Service", conecta el repo y detecta `render.yaml` automáticamente. El proxy de Render admite subidas grandes (~100 MB por petición).
- **Railway**: "New Project → Deploy from GitHub repo"; detecta el Dockerfile solo.
- **Cualquier VPS**: `docker build -t metalens . && docker run -d -p 3000:3000 metalens`

El servidor lee el puerto de la variable `PORT` (por defecto 3000), como esperan ambas plataformas.

## Seguridad

- Los archivos se guardan con nombre aleatorio en un directorio temporal y se **eliminan inmediatamente** tras la extracción.
- ExifTool y ffprobe se invocan sin shell (sin riesgo de inyección por nombre de archivo).
- Límite de subida de 1 GB y timeout de 30 s para ffprobe.

## Formatos soportados

Fotos: JPEG, PNG, HEIC/HEIF, TIFF, WebP, RAW (CR2, CR3, NEF, ARW, DNG, ORF, RW2…). Videos: MP4, MOV, AVI, MKV, WebM y cualquier formato que lea ExifTool/ffprobe.
