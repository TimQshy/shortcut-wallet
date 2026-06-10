import express from 'express';
import { getNotesByAccount, createNote, deleteNote, updateNote } from '../controllers/notesController.js';
const router = express.Router();

router.get('/account/:accountId', getNotesByAccount);
router.post('/', createNote);
router.delete('/:id', deleteNote);
router.put('/:id', updateNote);

export default router;
