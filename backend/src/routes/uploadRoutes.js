const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// Two storage back-ends:
// - "blob":   Vercel Blob, used whenever BLOB_READ_WRITE_TOKEN is set (production
//             on Vercel, where the filesystem is read-only).
// - "server": files on local disk under /uploads, served statically by app.js
//             (local development).
const BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const DISK_OK = !BLOB && !process.env.VERCEL;
if (DISK_OK) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];
const MODEL_TYPES = ['model/gltf-binary', 'application/octet-stream'];
const MB = 1024 * 1024;

// What each kind of upload may contain. Shared by the multer routes and the
// Vercel Blob client-upload token route so both enforce the same rules.
const KINDS = {
  image: { types: IMAGE_TYPES, maxBytes: 5 * MB },
  media: { types: [...IMAGE_TYPES, ...VIDEO_TYPES], maxBytes: 30 * MB },
  model: { types: MODEL_TYPES, maxBytes: 30 * MB },
};

function randomName(originalname, fallbackExt = '.jpg') {
  const ext = path.extname(originalname || '').toLowerCase() || fallbackExt;
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

const storage = DISK_OK
  ? multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_DIR),
      // Random name so two artisans uploading "saree.jpg" don't overwrite each other.
      filename: (req, file, cb) => cb(null, randomName(file.originalname)),
    })
  : multer.memoryStorage();

// Saves the multer file and returns its public URL.
async function store(req, kind) {
  if (BLOB) {
    const { put } = require('@vercel/blob');
    const blob = await put(`artisoul/${kind}/${randomName(req.file.originalname)}`, req.file.buffer, {
      access: 'public',
      contentType: req.file.mimetype,
    });
    return blob.url;
  }
  return `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
}

function requireStorage(req, res, next) {
  if (BLOB || DISK_OK) return next();
  res.status(503).json({
    success: false,
    message: 'File uploads are not configured. Connect a Vercel Blob store to this project.',
  });
}

const upload = multer({
  storage,
  limits: { fileSize: KINDS.image.maxBytes },
  fileFilter: (req, file, cb) => {
    if (!IMAGE_TYPES.includes(file.mimetype)) {
      return cb(Object.assign(new Error('Only JPG, PNG, WEBP or GIF images are allowed'), { status: 400 }));
    }
    cb(null, true);
  },
});

const mediaUpload = multer({
  storage,
  limits: { fileSize: KINDS.media.maxBytes }, // short clips
  fileFilter: (req, file, cb) => {
    if (!KINDS.media.types.includes(file.mimetype)) {
      return cb(Object.assign(new Error('Only images or MP4/WEBM videos are allowed'), { status: 400 }));
    }
    cb(null, true);
  },
});

const modelUpload = multer({
  storage,
  limits: { fileSize: KINDS.model.maxBytes },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.glb') {
      return cb(Object.assign(new Error('Only .glb 3D models are allowed'), { status: 400 }));
    }
    cb(null, true);
  },
});

// GET /api/uploads/config — tells the frontend how to upload.
// "blob" means: upload straight from the browser to Vercel Blob (bypasses the
// 4.5 MB request-body limit of Vercel functions), using /api/uploads/blob-token.
router.get('/config', (req, res) => {
  res.json({ success: true, data: { mode: BLOB ? 'blob' : 'server' } });
});

// POST /api/uploads/blob-token — Vercel Blob client-upload handshake.
// Auth: artisan only. clientPayload is the upload kind: "image" | "media" | "model".
router.post('/blob-token', verifyToken, requireRole('artisan'), async (req, res, next) => {
  if (!BLOB) {
    return res.status(503).json({ success: false, message: 'Vercel Blob is not configured' });
  }
  try {
    const { handleUpload } = require('@vercel/blob/client');
    const result = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const kind = KINDS[clientPayload];
        if (!kind) throw Object.assign(new Error('Unknown upload kind'), { status: 400 });
        if (clientPayload === 'model' && path.extname(pathname).toLowerCase() !== '.glb') {
          throw Object.assign(new Error('Only .glb 3D models are allowed'), { status: 400 });
        }
        return {
          allowedContentTypes: kind.types,
          maximumSizeInBytes: kind.maxBytes,
          addRandomSuffix: true,
        };
      },
    });
    res.json(result);
  } catch (err) {
    next(Object.assign(err, { status: err.status || 400 }));
  }
});

// POST /api/uploads/image  (multipart/form-data, field name: "image")
// Auth: artisan only. Returns an absolute URL the artisan can save as image_url.
router.post('/image', verifyToken, requireRole('artisan'), requireStorage, upload.single('image'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No image file received (expected field "image")' });
  }
  try {
    res.status(201).json({
      success: true,
      message: 'Image uploaded',
      data: { image_url: await store(req, 'image'), filename: req.file.filename, size: req.file.size },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/uploads/media  (multipart/form-data, field name: "media")
router.post('/media', verifyToken, requireRole('artisan'), requireStorage, mediaUpload.single('media'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file received (expected field "media")' });
  }
  try {
    res.status(201).json({
      success: true,
      data: {
        url: await store(req, 'media'),
        media_type: req.file.mimetype.startsWith('video/') ? 'video' : 'image',
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/uploads/model  (multipart/form-data, field name: "model")
router.post('/model', verifyToken, requireRole('artisan'), requireStorage, modelUpload.single('model'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file received (expected field "model")' });
  }
  try {
    res.status(201).json({ success: true, data: { model_url: await store(req, 'model') } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
