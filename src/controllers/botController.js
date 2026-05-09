import sql from '../config/db.js';
import { parseExpenseText } from '../services/gemini.js';
import { sendTelegramMessage, editMessage, answerCallback } from '../services/telegram.js';

const CATEGORIES = [
    { id: 'food',          label: '🍔 Еда' },
    { id: 'transport',     label: '🚗 Транспорт' },
    { id: 'shopping',      label: '🛍 Покупки' },
    { id: 'health',        label: '❤️ Здоровье' },
    { id: 'entertainment', label: '🎬 Развлечения' },
    { id: 'utilities',     label: '⚡ ЖКХ' },
    { id: 'salary',        label: '💵 Зарплата' },
    { id: 'freelance',     label: '💻 Фриланс' },
    { id: 'investment',    label: '📈 Инвестиции' },
    { id: 'other',         label: '⭕ Другое' },
];

const CATEGORY_KEYBOARD = {
    inline_keyboard: [
        CATEGORIES.slice(0, 5).map(c => ({ text: c.label, callback_data: `cat:${c.id}` })),
        CATEGORIES.slice(5).map(c => ({ text: c.label, callback_data: `cat:${c.id}` })),
    ],
};

// Простое хранилище состояния для мультишагового /add (один пользователь)
let pendingTx = null;

function catLabel(id) {
    return CATEGORIES.find(c => c.id === id)?.label ?? id;
}

function fmt(amount) {
    return Math.abs(Number(amount)).toFixed(2);
}

function fmtDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export async function handleBotUpdate(req, res) {
    res.sendStatus(200);

    try {
        const { message, callback_query } = req.body;
        const userId = process.env.MY_CLERK_USER_ID;

        // ── Обработка нажатий inline-кнопок ──────────────────────────────
        if (callback_query) {
            const chatId = String(callback_query.message.chat.id);
            const msgId  = callback_query.message.message_id;
            const data   = callback_query.data;

            if (chatId !== process.env.TELEGRAM_CHAT_ID) {
                await answerCallback(callback_query.id);
                return;
            }

            await answerCallback(callback_query.id);

            if (data.startsWith('type:')) {
                const type = data.split(':')[1];
                pendingTx = { step: 'awaiting_amount', type };
                await editMessage(chatId, msgId,
                    `${type === 'expense' ? '📉 <b>Расход</b>' : '📈 <b>Доход</b>'}\n\nВведи сумму:`
                );
                return;
            }

            if (data.startsWith('cat:') && pendingTx?.step === 'awaiting_category') {
                const category = data.split(':')[1];
                const { type, amount, title } = pendingTx;
                const normalizedAmount = type === 'income' ? Math.abs(amount) : -Math.abs(amount);

                await sql`
                    INSERT INTO transactions(user_id, title, amount, category)
                    VALUES (${userId}, ${title}, ${normalizedAmount}, ${category})
                `;

                const sign = type === 'income' ? '+' : '-';
                await editMessage(chatId, msgId,
                    `✅ <b>Записано!</b>\n\n📝 ${title}\n💰 ${sign}${fmt(normalizedAmount)} руб.\n📂 ${catLabel(category)}`
                );
                pendingTx = null;
                return;
            }

            if (data.startsWith('del:')) {
                const txId = Number(data.split(':')[1]);
                await sql`DELETE FROM transactions WHERE id = ${txId}`;
                await editMessage(chatId, msgId, '🗑 Удалено.');
                return;
            }

            return;
        }

        // ── Обработка текстовых сообщений ────────────────────────────────
        if (!message?.text) return;

        const chatId = String(message.chat.id);
        const text   = message.text.trim();

        if (chatId !== process.env.TELEGRAM_CHAT_ID) return;

        // Мультишаговый /add — ожидаем ввод
        if (pendingTx) {
            if (pendingTx.step === 'awaiting_amount') {
                const amount = parseFloat(text.replace(',', '.'));
                if (isNaN(amount) || amount <= 0) {
                    await sendTelegramMessage('Введи корректную сумму (число больше 0):', chatId);
                    return;
                }
                pendingTx = { ...pendingTx, step: 'awaiting_title', amount };
                await sendTelegramMessage('Описание (например: Кофе в Старбакс):', chatId);
                return;
            }

            if (pendingTx.step === 'awaiting_title') {
                pendingTx = { ...pendingTx, step: 'awaiting_category', title: text };
                await sendTelegramMessage('Выбери категорию:', chatId, CATEGORY_KEYBOARD);
                return;
            }
        }

        // ── Команды ──────────────────────────────────────────────────────

        if (text === '/start') {
            await sendTelegramMessage(
                '👋 <b>Привет!</b> Записываю твои финансы.\n\n' +
                'Просто напиши что потратил или получил:\n' +
                '<i>Кофе 150</i> или <i>зарплата 50000</i>\n\n' +
                '<b>Команды:</b>\n' +
                '/add — добавить вручную (с кнопками)\n' +
                '/balance — сводка за всё время\n' +
                '/history — последние 10 транзакций\n' +
                '/stats — расходы по категориям за месяц',
                chatId
            );
            return;
        }

        if (text === '/add') {
            pendingTx = null;
            await sendTelegramMessage('Что добавляем?', chatId, {
                inline_keyboard: [[
                    { text: '📉 Расход', callback_data: 'type:expense' },
                    { text: '📈 Доход',  callback_data: 'type:income'  },
                ]],
            });
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
                `📊 <b>Сводка за всё время:</b>\n\n` +
                `💰 Баланс: ${Number(row.balance).toFixed(2)} руб.\n` +
                `📈 Доходы: +${Number(row.income).toFixed(2)} руб.\n` +
                `📉 Расходы: -${fmt(row.expenses)} руб.`,
                chatId
            );
            return;
        }

        if (text === '/history') {
            const txs = await sql`
                SELECT * FROM transactions WHERE user_id = ${userId}
                ORDER BY created_at DESC, id DESC LIMIT 10
            `;
            if (txs.length === 0) {
                await sendTelegramMessage('Транзакций пока нет.', chatId);
                return;
            }
            for (const tx of txs) {
                const isIncome = Number(tx.amount) > 0;
                const sign = isIncome ? '📈 +' : '📉 -';
                await sendTelegramMessage(
                    `${sign}${fmt(tx.amount)} руб.\n<b>${tx.title}</b>\n${catLabel(tx.category)} · ${fmtDate(tx.created_at)}`,
                    chatId,
                    { inline_keyboard: [[{ text: '🗑 Удалить', callback_data: `del:${tx.id}` }]] }
                );
            }
            return;
        }

        if (text === '/stats') {
            const rows = await sql`
                SELECT category, SUM(amount) AS total
                FROM transactions
                WHERE user_id = ${userId}
                  AND amount < 0
                  AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
                GROUP BY category
                ORDER BY total ASC
            `;
            if (rows.length === 0) {
                await sendTelegramMessage('Нет расходов за текущий месяц.', chatId);
                return;
            }
            const totalAbs = rows.reduce((s, r) => s + Math.abs(Number(r.total)), 0);
            const lines = rows.map(r => {
                const abs = Math.abs(Number(r.total));
                const pct = ((abs / totalAbs) * 100).toFixed(0);
                const bar = '█'.repeat(Math.round(abs / totalAbs * 10)).padEnd(10, '░');
                return `${catLabel(r.category)}\n${bar} ${pct}% · ${abs.toFixed(0)} руб.`;
            });
            await sendTelegramMessage(
                `📊 <b>Расходы за месяц:</b>\n\n${lines.join('\n\n')}\n\n💸 Итого: ${totalAbs.toFixed(0)} руб.`,
                chatId
            );
            return;
        }

        // ── Свободный текст → Gemini ──────────────────────────────────────
        if (!text.startsWith('/')) {
            const { title, amount, category, type } = await parseExpenseText(text);
            const normalizedAmount = type === 'income' ? Math.abs(amount) : -Math.abs(amount);

            await sql`
                INSERT INTO transactions(user_id, title, amount, category)
                VALUES (${userId}, ${title}, ${normalizedAmount}, ${category})
            `;

            const sign = type === 'income' ? '+' : '-';
            await sendTelegramMessage(
                `✅ <b>Записано!</b>\n\n📝 ${title}\n💰 ${sign}${fmt(normalizedAmount)} руб.\n📂 ${catLabel(category)}`,
                chatId
            );
        }

    } catch (err) {
        console.error('Bot handler error:', err);
    }
}
