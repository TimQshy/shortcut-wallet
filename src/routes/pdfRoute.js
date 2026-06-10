import express from 'express';
import multer from 'multer';
import { parsePdf, importTransactions } from '../controllers/pdfController.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post('/parse', upload.single('file'), parsePdf);
router.post('/import', importTransactions);

export default router;
