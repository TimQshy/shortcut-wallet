import sql from '../config/db.js';
import { parseExpenseText } from '../services/gemini.js';
import { sendTelegramMessage } from '../services/telegram.js';

export async function handleBotUpdate(req, res) {
    // Telegram требует 200 быстро, отвечаем сразу
    res.sendStatus(200);

    try {
        const { message } = req.body;
        if (!message?.text) return;

        const chatId = String(message.chat.id);
        const text = message.text.trim();
        const userId = process.env.MY_CLERK_USER_ID;

        // Защита: только сообщения от владельца
        if (chatId !== process.env.TELEGRAM_CHAT_ID) return;

        if (text === '/start') {
            await sendTelegramMessage(
                '👋 <b>Привет!</b> Записываю твои расходы.\n\nПросто напиши что потратил:\n<i>Кофе 150</i>\n<i>Такси 450 рублей</i>\n\nКоманды:\n/balance — сводка по счёту',
                chatId
            );
            return;
        }

        if (text === '/balance') {
            const [row] = await sql`
                SELECT
                    COALESCE(SUM(amount) FILTER (WHERE amount < 0), 0) AS expenses,
                    COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS income,
                    COALESCE(SUM(amount), 0) AS balance
                FROM transactions WHERE user_id = ${userId}
            `;
            await sendTelegramMessage(
                `📊 <b>Сводка:</b>\n\n💰 Баланс: ${row.balance} руб.\n📈 Доходы: +${row.income} руб.\n📉 Расходы: -${Math.abs(row.expenses)} руб.`,
                chatId
            );
            return;
        }

        const { title, amount, category } = await parseExpenseText(text);
        const normalizedAmount = amount > 0 ? -Math.abs(amount) : amount;

        await sql`
            INSERT INTO transactions(user_id, title, amount, category)
            VALUES (${userId}, ${title}, ${normalizedAmount}, ${category})
        `;

        await sendTelegramMessage(
            `✅ <b>Записано!</b>\n\n📝 ${title}\n💰 -${Math.abs(normalizedAmount)} руб.\n📂 ${category}`,
            chatId
        );
    } catch (err) {
        console.error('Bot handler error:', err);
    }
}
