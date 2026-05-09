import sql from '../config/db.js';
import { parseExpenseText } from '../services/gemini.js';
import { sendTelegramMessage } from '../services/telegram.js';

export async function handleVoiceInput(req, res) {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ message: 'Текст не получен' });

        const user_id = req.auth?.userId;
        if (!user_id) return res.status(401).json({ message: 'Не авторизован' });

        const { title, amount, category, type } = await parseExpenseText(text);
        const normalizedAmount = type === 'income' ? Math.abs(amount) : -Math.abs(amount);

        await sql`
            INSERT INTO transactions(user_id, title, amount, category)
            VALUES (${user_id}, ${title}, ${normalizedAmount}, ${category})
        `;

        const msg = `✅ <b>Расход записан!</b>\n\n📝 <b>Что:</b> ${title}\n💰 <b>Сумма:</b> -${Math.abs(normalizedAmount)} руб.\n📂 <b>Категория:</b> ${category}`;
        await sendTelegramMessage(msg);

        res.status(201).json({ title, amount: normalizedAmount, category });
    } catch (err) {
        console.error('Voice handler error:', err);
        await sendTelegramMessage(`❌ <b>Ошибка системы:</b>\n${err.message}`);
        res.status(500).json({ message: err.message });
    }
}
