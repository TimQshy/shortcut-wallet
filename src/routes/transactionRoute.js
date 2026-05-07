import express from 'express';
import { getTransactions, createTransaction, deleteTransaction, getSummary } from '../controllers/transactionControllers.js';
const router = express.Router();


router.get("/:userId", getTransactions);
router.post('/', createTransaction);
router.delete("/:id", deleteTransaction);
router.get("/summary/:userId", getSummary);

export default router;
