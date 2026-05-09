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

const ADD_CATEGORY_KB = {
    inline_keyboard: [
        CATEGORIES.slice(0, 5).map(c => ({ text: c.label, callback_data: `cat:${c.id}` })),
        CATEGORIES.slice(5).map(c => ({ text: c.label, callback_data: `cat:${c.id}` })),
    ],
};

// Состояние мультишаговых флоу (один пользователь)
let state = null;
/*
  Возможные состояния:
  /add flow:
    { step: 'add_amount', type }
    { step: 'add_title', type, amount }
    { step: 'add_category', type, amount, title }

  /history custom range:
    { step: 'hist_from' }
    { step: 'hist_to', from: 'YYYY-MM-DD' }

  edit flow:
    { step: 'edit_value', txId, field: 'title' | 'amount' }
*/

// ── Утилиты ──────────────────────────────────────────────────────────────────

function catLabel(id) {
    return CATEGORIES.find(c => c.id === id)?.label ?? id;
}

function fmt(amount) {
    return Math.abs(Number(amount)).toFixed(2);
}

function fmtDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function parseInputDate(str) {
    // Принимает DD.MM.YYYY
    const parts = str.trim().split('.');
    if (parts.length !== 3) return null;
    const [d, m, y] = parts.map(Number);
    if (!d || !m || !y || y < 2000) return null;
    const date = new Date(y, m - 1, d);
    return isNaN(date.getTime()) ? null : `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function dateRange(preset) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (preset === 'today') return { from: today, to: today };

    if (preset === 'week') {
        const d = new Date(now);
        d.setDate(d.getDate() - 6);
        return { from: d.toISOString().split('T')[0], to: today };
    }

    if (preset === 'month') {
        const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}-01`;
        return { from, to: today };
    }

    // all
    return { from: '2000-01-01', to: today };
}

function editCategoryKb(txId) {
    const rows = [CATEGORIES.slice(0, 5), CATEGORIES.slice(5)];
    return {
        inline_keyboard: rows.map(row =>
            row.map(c => ({ text: c.label, callback_data: `editcat:${txId}:${c.id}` }))
        ),
    };
}

async function showTransactions(chatId, from, to) {
    const userId = process.env.MY_CLERK_USER_ID;
    const txs = await sql`
        SELECT * FROM transactions
        WHERE user_id = ${userId}
          AND created_at >= ${from}::date
          AND created_at <= ${to}::date
        ORDER BY created_at DESC, id DESC
        LIMIT 20
    `;

    if (txs.length === 0) {
        await sendTelegramMessage('Транзакций за этот период нет.', chatId);
        return;
    }

    const fromLabel = fmtDate(from);
    const toLabel   = fmtDate(to);
    const period    = from === to ? fromLabel : `${fromLabel} — ${toLabel}`;
    await sendTelegramMessage(`📋 <b>${period}</b> · ${txs.length} транзакций`, chatId);

    for (const tx of txs) {
        const isIncome = Number(tx.amount) > 0;
        const sign = isIncome ? '📈 +' : '📉 -';
        await sendTelegramMessage(
            `${sign}${fmt(tx.amount)} руб.\n<b>${tx.title}</b>\n${catLabel(tx.category)} · ${fmtDate(tx.created_at)}`,
            chatId,
            {
                inline_keyboard: [[
                    { text: '✏️ Изменить', callback_data: `edit:${tx.id}` },
                    { text: '🗑 Удалить',  callback_data: `del:${tx.id}`  },
                ]],
            }
        );
    }
}

// ── Главный обработчик ────────────────────────────────────────────────────────

export async function handleBotUpdate(req, res) {
    res.sendStatus(200);

    try {
        const { message, callback_query } = req.body;
        const userId = process.env.MY_CLERK_USER_ID;
        const ownChatId = process.env.TELEGRAM_CHAT_ID;

        // ── Callback-кнопки ───────────────────────────────────────────────
        if (callback_query) {
            const chatId = String(callback_query.message.chat.id);
            const msgId  = callback_query.message.message_id;
            const data   = callback_query.data;

            if (chatId !== ownChatId) { await answerCallback(callback_query.id); return; }
            await answerCallback(callback_query.id);

            // /add: выбор типа
            if (data.startsWith('type:')) {
                const type = data.split(':')[1];
                state = { step: 'add_amount', type };
                await editMessage(chatId, msgId,
                    `${type === 'expense' ? '📉 <b>Расход</b>' : '📈 <b>Доход</b>'}\n\nВведи сумму:`
                );
                return;
            }

            // /add: выбор категории
            if (data.startsWith('cat:') && state?.step === 'add_category') {
                const category = data.split(':')[1];
                const { type, amount, title } = state;
                const normalized = type === 'income' ? Math.abs(amount) : -Math.abs(amount);
                await sql`INSERT INTO transactions(user_id,title,amount,category) VALUES(${userId},${title},${normalized},${category})`;
                const sign = type === 'income' ? '+' : '-';
                await editMessage(chatId, msgId,
                    `✅ <b>Записано!</b>\n\n📝 ${title}\n💰 ${sign}${fmt(normalized)} руб.\n📂 ${catLabel(category)}`
                );
                state = null;
                return;
            }

            // /history: быстрый период
            if (data.startsWith('hist:')) {
                const preset = data.split(':')[1];
                if (preset === 'custom') {
                    state = { step: 'hist_from' };
                    await editMessage(chatId, msgId,
                        '📅 Введи дату <b>начала</b> периода в формате ДД.ММ.ГГГГ\n\nНапример: <code>01.04.2025</code>'
                    );
                } else {
                    const { from, to } = dateRange(preset);
                    await editMessage(chatId, msgId, '⏳ Загружаю...');
                    await showTransactions(chatId, from, to);
                }
                return;
            }

            // Удаление транзакции
            if (data.startsWith('del:')) {
                const txId = Number(data.split(':')[1]);
                await sql`DELETE FROM transactions WHERE id = ${txId}`;
                await editMessage(chatId, msgId, '🗑 Удалено.');
                return;
            }

            // Редактирование: выбор поля
            if (data.startsWith('edit:')) {
                const txId = Number(data.split(':')[1]);
                await editMessage(chatId, msgId,
                    'Что изменить?',
                    {
                        inline_keyboard: [[
                            { text: '📝 Название',  callback_data: `editfield:${txId}:title`    },
                            { text: '💰 Сумма',     callback_data: `editfield:${txId}:amount`   },
                            { text: '📂 Категория', callback_data: `editfield:${txId}:category` },
                        ]],
                    }
                );
                return;
            }

            // Редактирование: поле выбрано
            if (data.startsWith('editfield:')) {
                const [, txId, field] = data.split(':');
                if (field === 'category') {
                    state = null;
                    await editMessage(chatId, msgId, 'Выбери новую категорию:', editCategoryKb(txId));
                } else {
                    state = { step: 'edit_value', txId: Number(txId), field };
                    const prompt = field === 'title' ? 'Введи новое название:' : 'Введи новую сумму:';
                    await editMessage(chatId, msgId, prompt);
                }
                return;
            }

            // Редактирование: новая категория выбрана
            if (data.startsWith('editcat:')) {
                const [, txId, catId] = data.split(':');
                await sql`UPDATE transactions SET category = ${catId} WHERE id = ${Number(txId)}`;
                await editMessage(chatId, msgId, `✅ Категория изменена на ${catLabel(catId)}`);
                return;
            }

            return;
        }

        // ── Текстовые сообщения ───────────────────────────────────────────
        if (!message?.text) return;

        const chatId = String(message.chat.id);
        const text   = message.text.trim();

        if (chatId !== ownChatId) return;

        // Мультишаговые флоу
        if (state) {
            // /add: ввод суммы
            if (state.step === 'add_amount') {
                const amount = parseFloat(text.replace(',', '.'));
                if (isNaN(amount) || amount <= 0) {
                    await sendTelegramMessage('Введи корректную сумму (число больше 0):', chatId);
                    return;
                }
                state = { ...state, step: 'add_title', amount };
                await sendTelegramMessage('Описание (например: Кофе в Старбакс):', chatId);
                return;
            }

            // /add: ввод названия
            if (state.step === 'add_title') {
                state = { ...state, step: 'add_category', title: text };
                await sendTelegramMessage('Выбери категорию:', chatId, ADD_CATEGORY_KB);
                return;
            }

            // /history: ввод даты начала
            if (state.step === 'hist_from') {
                const from = parseInputDate(text);
                if (!from) {
                    await sendTelegramMessage('Неверный формат. Попробуй ещё раз (ДД.ММ.ГГГГ):', chatId);
                    return;
                }
                state = { step: 'hist_to', from };
                await sendTelegramMessage(
                    `Дата начала: <b>${text}</b>\n\nТеперь введи дату <b>конца</b> периода (ДД.ММ.ГГГГ):`,
                    chatId
                );
                return;
            }

            // /history: ввод даты конца
            if (state.step === 'hist_to') {
                const to = parseInputDate(text);
                if (!to) {
                    await sendTelegramMessage('Неверный формат. Попробуй ещё раз (ДД.ММ.ГГГГ):', chatId);
                    return;
                }
                const from = state.from;
                state = null;
                await showTransactions(chatId, from, to);
                return;
            }

            // edit: ввод нового значения
            if (state.step === 'edit_value') {
                const { txId, field } = state;

                if (field === 'amount') {
                    const amount = parseFloat(text.replace(',', '.'));
                    if (isNaN(amount) || amount <= 0) {
                        await sendTelegramMessage('Введи корректную сумму (число больше 0):', chatId);
                        return;
                    }
                    // Сохраняем знак из оригинала
                    const [orig] = await sql`SELECT amount FROM transactions WHERE id = ${txId}`;
                    const normalized = Number(orig.amount) < 0 ? -amount : amount;
                    await sql`UPDATE transactions SET amount = ${normalized} WHERE id = ${txId}`;
                    await sendTelegramMessage(`✅ Сумма изменена на ${fmt(normalized)} руб.`, chatId);
                } else {
                    await sql`UPDATE transactions SET title = ${text} WHERE id = ${txId}`;
                    await sendTelegramMessage(`✅ Название изменено на «${text}»`, chatId);
                }
                state = null;
                return;
            }
        }

        // ── Команды ───────────────────────────────────────────────────────

        if (text === '/start') {
            await sendTelegramMessage(
                '👋 <b>Привет!</b> Записываю твои финансы.\n\n' +
                'Просто напиши что потратил или получил:\n' +
                '<i>Кофе 150</i> или <i>зарплата 50000</i>\n\n' +
                '<b>Команды:</b>\n' +
                '/add — добавить вручную\n' +
                '/balance — сводка за всё время\n' +
                '/history — список с выбором периода\n' +
                '/stats — расходы по категориям за месяц',
                chatId
            );
            return;
        }

        if (text === '/add') {
            state = null;
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
            state = null;
            await sendTelegramMessage('Выбери период:', chatId, {
                inline_keyboard: [
                    [
                        { text: '📅 Сегодня', callback_data: 'hist:today' },
                        { text: '📅 Неделя',  callback_data: 'hist:week'  },
                    ],
                    [
                        { text: '📅 Месяц',     callback_data: 'hist:month' },
                        { text: '📅 Всё время', callback_data: 'hist:all'   },
                    ],
                    [
                        { text: '📅 Свой период', callback_data: 'hist:custom' },
                    ],
                ],
            });
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
            const normalized = type === 'income' ? Math.abs(amount) : -Math.abs(amount);
            await sql`INSERT INTO transactions(user_id,title,amount,category) VALUES(${userId},${title},${normalized},${category})`;
            const sign = type === 'income' ? '+' : '-';
            await sendTelegramMessage(
                `✅ <b>Записано!</b>\n\n📝 ${title}\n💰 ${sign}${fmt(normalized)} руб.\n📂 ${catLabel(category)}`,
                chatId
            );
        }

    } catch (err) {
        console.error('Bot handler error:', err);
    }
}
