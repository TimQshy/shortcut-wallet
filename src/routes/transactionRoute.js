import express from 'express';
import { getTransactions, createTransaction, updateTransaction, deleteTransaction, getSummary } from '../controllers/transactionControllers.js';
const router = express.Router();

router.get('/summary/:userId/:accountId', getSummary);
router.get('/:userId/:accountId', getTransactions);
router.post('/', createTransaction);
router.put('/:id', updateTransaction);
router.delete('/:id', deleteTransaction);

export default router;
