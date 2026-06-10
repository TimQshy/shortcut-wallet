import sql from '../config/db.js';
import { runBotAgent } from '../services/gemini.js';
import { sendTelegramMessage, editMessage, deleteMessage, answerCallback } from '../services/telegram.js';

// Активный счёт для сессии (сбрасывается при рестарте сервера)
let activeAccountId = null;
let activeAccountName = null;

async function downloadVoice(fileId) {
    const token = process.env.TELEGRAM_TOKEN;
    const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const { result } = await res.json();
    const audio = await fetch(`https://api.telegram.org/file/bot${token}/${result.file_path}`);
    const buffer = await audio.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
}

export async function handleBotUpdate(req, res) {
    res.sendStatus(200);

    try {
        const { message, callback_query } = req.body;
        const userId = process.env.MY_CLERK_USER_ID;
        const ownChatId = process.env.TELEGRAM_CHAT_ID;

        // ── Callback: выбор счёта ─────────────────────────────────────────
        if (callback_query) {
            const chatId = String(callback_query.message.chat.id);
            await answerCallback(callback_query.id);
            if (chatId !== ownChatId) return;

            if (callback_query.data.startsWith('setacc:')) {
                const [, id, ...nameParts] = callback_query.data.split(':');
                activeAccountId = Number(id);
                activeAccountName = nameParts.join(':');
                await editMessage(chatId, callback_query.message.message_id,
                    `✅ Активный счёт: <b>${activeAccountName}</b>\n\nПиши или говори голосом что записать.`
                );
            }
            return;
        }

        if (!message) return;
        const chatId = String(message.chat.id);
        if (chatId !== ownChatId) return;

        const text = message.text?.trim();

        // ── /start ────────────────────────────────────────────────────────
        if (text === '/start') {
            await sendTelegramMessage(
                '👋 <b>Привет!</b> Я твой финансовый помощник.\n\n' +
                'Просто пиши или отправь голосовое:\n' +
                '<i>"потратил 300 на кофе"</i>\n' +
                '<i>"добавь доход 50000 зарплата"</i>\n' +
                '<i>"покажи баланс"</i>\n' +
                '<i>"последние 5 транзакций"</i>\n\n' +
                'Выбери счёт: /accounts',
                chatId
            );
            return;
        }

        // ── /accounts ─────────────────────────────────────────────────────
        if (text === '/accounts') {
            const accounts = await sql`SELECT id, name FROM accounts WHERE user_id = ${userId} ORDER BY created_at DESC`;
            if (accounts.length === 0) {
                await sendTelegramMessage('Нет счетов. Создай счёт в приложении.', chatId);
                return;
            }
            await sendTelegramMessage('Выбери активный счёт:', chatId, {
                inline_keyboard: accounts.map(a => [{
                    text: `${a.id === activeAccountId ? '✅ ' : ''}${a.name}`,
                    callback_data: `setacc:${a.id}:${a.name}`,
                }]),
            });
            return;
        }

        // ── Проверка активного счёта ──────────────────────────────────────
        if (!activeAccountId) {
            const accounts = await sql`SELECT id, name FROM accounts WHERE user_id = ${userId} ORDER BY created_at DESC`;
            if (accounts.length === 0) {
                await sendTelegramMessage('Сначала создай счёт в приложении 👍', chatId);
                return;
            }
            await sendTelegramMessage('Выбери счёт для работы:', chatId, {
                inline_keyboard: accounts.map(a => [{
                    text: a.name,
                    callback_data: `setacc:${a.id}:${a.name}`,
                }]),
            });
            return;
        }

        // ── Голос или текст → агент ───────────────────────────────────────
        let inputText = null;
        let audioBase64 = null;

        if (message.voice) {
            audioBase64 = await downloadVoice(message.voice.file_id);
        } else if (text && !text.startsWith('/')) {
            inputText = text;
        } else {
            return;
        }

        // Показываем индикатор
        const thinking = await sendTelegramMessage('⏳', chatId);

        const accounts = await sql`SELECT id, name FROM accounts WHERE user_id = ${userId}`;

        const reply = await runBotAgent({
            text: inputText,
            audioBase64,
            accounts,
            activeAccountId,
            activeAccountName,
            userId,
            sql,
        });

        // Заменяем ⏳ на ответ
        if (thinking?.message_id) {
            await editMessage(chatId, thinking.message_id, reply);
        } else {
            await sendTelegramMessage(reply, chatId);
        }

    } catch (err) {
        console.error('Bot handler error:', err);
        await sendTelegramMessage(`❌ Ошибка: ${err.message}`, process.env.TELEGRAM_CHAT_ID);
    }
}
