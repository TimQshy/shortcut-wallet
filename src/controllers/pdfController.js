import sql from '../config/db.js';

const PDF_PROMPT = `Ты — парсер банковских выписок. Извлеки все транзакции из этой выписки.

Верни СТРОГО JSON массив без markdown, без лишнего текста:
[
  {
    "date": "YYYY-MM-DD",
    "title": "описание операции (коротко, макс 60 символов)",
    "amount": число (отрицательное = расход, положительное = поступление),
    "category": одно из: food|transport|shopping|health|entertainment|utilities|salary|freelance|investment|other
  }
]

Правила:
- Списания/расходы → отрицательная сумма
- Поступления/доходы → положительная сумма
- Игнорируй технические строки (остаток, итого, комиссия банка за ведение счёта)
- Дату бери из выписки в формате YYYY-MM-DD
- Если дата не распозналась — используй сегодняшнюю`;

async function parsePdfWithGemini(base64Pdf) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY не задан');

    const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];

    for (const model of models) {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
                            { text: PDF_PROMPT },
                        ],
                    }],
                }),
            }
        );

        if (res.ok) {
            const data = await res.json();
            const raw = data.candidates[0].content.parts[0].text;
            return JSON.parse(raw.replace(/```json|```/g, '').trim());
        }

        if (res.status === 503 || res.status === 429) {
            console.warn(`${model} unavailable, trying next...`);
            continue;
        }

        throw new Error('Gemini error: ' + await res.text());
    }

    throw new Error('Все модели Gemini недоступны, попробуй позже.');
}

// POST /api/pdf/parse
// Принимает: multipart/form-data { file: PDF, account_id, user_id }
export async function parsePdf(req, res) {
    try {
        if (!req.file) return res.status(400).json({ message: 'PDF файл не получен' });

        const { account_id, user_id } = req.body;
        if (!account_id || !user_id) {
            return res.status(400).json({ message: 'account_id и user_id обязательны' });
        }

        const base64Pdf = req.file.buffer.toString('base64');
        const parsed = await parsePdfWithGemini(base64Pdf);

        // Загружаем существующие транзакции для дедупликации
        const existing = await sql`
            SELECT date_trunc('day', created_at) AS day, amount
            FROM transactions
            WHERE account_id = ${account_id}
        `;

        const existingSet = new Set(
            existing.map(t => `${t.day.toISOString().split('T')[0]}_${Math.abs(Number(t.amount))}`)
        );

        const newTransactions = [];
        const skipped = [];

        for (const tx of parsed) {
            const key = `${tx.date}_${Math.abs(tx.amount)}`;
            if (existingSet.has(key)) {
                skipped.push(tx);
            } else {
                newTransactions.push(tx);
            }
        }

        res.json({
            new: newTransactions,
            skipped_count: skipped.length,
            total_parsed: parsed.length,
        });
    } catch (err) {
        console.error('PDF parse error:', err);
        res.status(500).json({ message: err.message });
    }
}

// POST /api/pdf/import
// Принимает: { transactions: [...], account_id, user_id }
export async function importTransactions(req, res) {
    try {
        const { transactions, account_id, user_id } = req.body;
        if (!transactions?.length || !account_id || !user_id) {
            return res.status(400).json({ message: 'transactions, account_id и user_id обязательны' });
        }

        const inserted = await Promise.all(
            transactions.map(tx =>
                sql`
                    INSERT INTO transactions(user_id, title, amount, category, account_id, created_at)
                    VALUES (${user_id}, ${tx.title}, ${tx.amount}, ${tx.category}, ${account_id}, ${tx.date}::date)
                    RETURNING id
                `
            )
        );

        res.json({ imported: inserted.length, message: `Импортировано ${inserted.length} транзакций` });
    } catch (err) {
        console.error('Import error:', err);
        res.status(500).json({ message: err.message });
    }
}
