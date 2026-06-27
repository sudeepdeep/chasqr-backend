import multer from 'multer';

const storage = multer.memoryStorage();

export const uploadZip = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only zip files are accepted for this upload type'));
    }
  },
}).single('file');

export const uploadFiles = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 50 },
}).array('files', 50);
