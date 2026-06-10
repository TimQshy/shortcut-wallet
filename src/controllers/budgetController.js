import { parseBudgetText } from '../services/gemini.js';

export async function handleBudgetParse(req, res) {
    try {
        const { text } = req.body;
        if (!text || typeof text !== 'string' || text.trim().length < 10) {
            return res.status(400).json({ message: 'Текст слишком короткий или не передан' });
        }

        const months = await parseBudgetText(text);
        res.status(200).json({ months });
    } catch (err) {
        console.error('Budget parse error:', err);
        res.status(500).json({ message: err.message });
    }
}
