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

## Seguridad

- Los archivos se guardan con nombre aleatorio en un directorio temporal y se **eliminan inmediatamente** tras la extracción.
- ExifTool y ffprobe se invocan sin shell (sin riesgo de inyección por nombre de archivo).
- Límite de subida de 1 GB y timeout de 30 s para ffprobe.

## Formatos soportados

Fotos: JPEG, PNG, HEIC/HEIF, TIFF, WebP, RAW (CR2, CR3, NEF, ARW, DNG, ORF, RW2…). Videos: MP4, MOV, AVI, MKV, WebM y cualquier formato que lea ExifTool/ffprobe.
