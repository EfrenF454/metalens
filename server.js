import express from 'express';
import multer from 'multer';
import { exiftool } from 'exiftool-vendored';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB
const UPLOAD_DIR = path.join(os.tmpdir(), 'metalens-uploads');

await mkdir(UPLOAD_DIR, { recursive: true });

// Los archivos suben con nombre aleatorio: nunca se usa el nombre original en disco.
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10).replace(/[^.\w]/g, '');
    cb(null, `${randomBytes(16).toString('hex')}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

function ffprobe(filePath) {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(null);
        }
      }
    );
  });
}

function buildSummary(tags, probe, file, preciseGps) {
  const s = {
    fileName: file.originalname,
    fileSize: file.size,
    mimeType: tags.MIMEType || file.mimetype,
    fileType: tags.FileType,
    width: tags.ImageWidth,
    height: tags.ImageHeight,
    createDate: tags.SubSecDateTimeOriginal?.toString()
      || tags.DateTimeOriginal?.toString()
      || tags.CreateDate?.toString()
      || tags.MediaCreateDate?.toString()
      || null,
    make: tags.Make || null,
    model: tags.Model || null,
    lens: tags.LensModel || tags.LensID || null,
    iso: tags.ISO || null,
    aperture: tags.FNumber ? `f/${tags.FNumber}` : null,
    shutter: tags.ShutterSpeedValue || tags.ExposureTime || null,
    focalLength: tags.FocalLength || null,
    software: tags.Software || tags.EncodingTool || null,
    // Offset UTC del momento de captura y, si se puede inferir (GPS/offsets), la zona IANA.
    timezone: [
      tags.OffsetTimeOriginal || tags.OffsetTime || null,
      tags.tz && tags.tz !== 'UTC' ? tags.tz : null,
    ].filter(Boolean).join(' · ') || null,
    gps: null,
    video: null,
  };

  // preciseGps viene de una lectura con -n: decimales completos y signo aplicado.
  const lat = preciseGps?.GPSLatitude ?? tags.GPSLatitude;
  const lon = preciseGps?.GPSLongitude ?? tags.GPSLongitude;
  if (typeof lat === 'number' && typeof lon === 'number') {
    s.gps = {
      latitude: lat,
      longitude: lon,
      altitude: preciseGps?.GPSAltitude ?? tags.GPSAltitude ?? null,
    };
  }

  if (probe) {
    const v = probe.streams?.find((st) => st.codec_type === 'video');
    const a = probe.streams?.find((st) => st.codec_type === 'audio');
    s.video = {
      duration: probe.format?.duration ? Number(probe.format.duration) : null,
      bitRate: probe.format?.bit_rate ? Number(probe.format.bit_rate) : null,
      container: probe.format?.format_long_name || null,
      videoCodec: v ? `${v.codec_name}${v.profile ? ` (${v.profile})` : ''}` : null,
      resolution: v ? `${v.width}×${v.height}` : null,
      frameRate: v?.avg_frame_rate && v.avg_frame_rate !== '0/0'
        ? Math.round((parseFraction(v.avg_frame_rate) + Number.EPSILON) * 100) / 100
        : null,
      pixelFormat: v?.pix_fmt || null,
      audioCodec: a?.codec_name || null,
      audioChannels: a?.channels || null,
      sampleRate: a?.sample_rate ? Number(a.sample_rate) : null,
    };
    if (!s.width && v) { s.width = v.width; s.height = v.height; }
  }
  return s;
}

// Convierte fracciones tipo "30000/1001" de ffprobe a número.
function parseFraction(frac) {
  const [num, den] = frac.split('/').map(Number);
  return den ? num / den : num || 0;
}

app.post('/api/extract', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo (campo "file").' });
  }
  const filePath = req.file.path;
  try {
    const [tags, grouped, preciseGps] = await Promise.all([
      exiftool.read(filePath),
      exiftool.readRaw(filePath, ['-G1', '-a']),
      exiftool.readRaw(filePath, ['-n', '-Composite:GPSLatitude', '-Composite:GPSLongitude', '-Composite:GPSAltitude']),
    ]);

    if (tags.Error) {
      return res.status(422).json({ error: `ExifTool no pudo leer el archivo: ${tags.Error}` });
    }

    const isVideo = /^video\//.test(tags.MIMEType || req.file.mimetype || '');
    const probe = isVideo ? await ffprobe(filePath) : null;

    // Agrupa los tags "Grupo:Tag" en { Grupo: { Tag: valor } } para la UI.
    const groups = {};
    for (const [key, value] of Object.entries(grouped)) {
      if (key === 'SourceFile' || key === 'errors' || key === 'warnings') continue;
      const idx = key.indexOf(':');
      const group = idx > 0 ? key.slice(0, idx) : 'General';
      const tag = idx > 0 ? key.slice(idx + 1) : key;
      (groups[group] ??= {})[tag] = value;
    }
    // El archivo se guarda con nombre aleatorio: restaura el nombre original
    // y oculta la ruta temporal del servidor.
    if (groups.System) {
      if (groups.System.FileName) groups.System.FileName = req.file.originalname;
      delete groups.System.Directory;
    }

    res.json({
      summary: buildSummary(tags, probe, req.file, preciseGps),
      groups,
      ffprobe: probe,
    });
  } catch (err) {
    console.error('Error al extraer metadatos:', err);
    res.status(500).json({ error: 'Error interno al procesar el archivo.' });
  } finally {
    unlink(filePath).catch(() => {});
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo supera el límite de 1 GB.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error inesperado en el servidor.' });
});

const server = app.listen(PORT, () => {
  console.log(`MetaLens escuchando en http://localhost:${PORT}`);
});

async function shutdown() {
  await exiftool.end();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
