import express from 'express';
import { handleVoiceInput } from '../controllers/voiceController.js';

const router = express.Router();

router.post('/', handleVoiceInput);

export default router;
