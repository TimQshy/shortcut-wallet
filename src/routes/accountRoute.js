import express from 'express';
import { getAccounts, createAccount, deleteAccount, updateAccount } from '../controllers/accountController.js';
const router = express.Router();

router.get('/:userId', getAccounts);
router.post('/', createAccount);
router.delete('/:id', deleteAccount);
router.put('/:id', updateAccount);

export default router;
