import express from 'express';
import { getTransactions, createTransaction, updateTransaction, deleteTransaction, getSummary } from '../controllers/transactionControllers.js';
const router = express.Router();


router.get("/:userId", getTransactions);
router.post('/', createTransaction);
router.put("/:id", updateTransaction);
router.delete("/:id", deleteTransaction);
router.get("/summary/:userId", getSummary);

export default router;
