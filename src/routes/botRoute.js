import express from 'express';
import { handleBotUpdate } from '../controllers/botController.js';

const router = express.Router();

router.post('/', handleBotUpdate);

export default router;
