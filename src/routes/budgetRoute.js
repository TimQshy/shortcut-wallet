import express from 'express';
import { handleBudgetParse } from '../controllers/budgetController.js';

const router = express.Router();

router.post('/parse', handleBudgetParse);

export default router;
