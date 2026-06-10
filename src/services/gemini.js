const GEMINI_URL = (key) =>
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;

async function callGemini(key, systemPrompt, contents, tools) {
    const body = { contents };
    if (systemPrompt) body.system_instruction = { parts: [{ text: systemPrompt }] };
    if (tools) body.tools = tools;

    const res = await fetch(GEMINI_URL(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Gemini error: ' + await res.text());
    return res.json();
}

// ── Bot Agent ─────────────────────────────────────────────────────────────────

const BOT_TOOLS = [{
    function_declarations: [
        {
            name: 'add_transaction',
            description: 'Добавить транзакцию (расход или доход) в счёт',
            parameters: {
                type: 'object',
                properties: {
                    title:      { type: 'string', description: 'Описание транзакции' },
                    amount:     { type: 'number', description: 'Сумма: отрицательная для расхода, положительная для дохода' },
                    category:   { type: 'string', enum: ['food','transport','shopping','health','entertainment','utilities','salary','freelance','investment','other'] },
                    account_id: { type: 'number', description: 'ID счёта (если не указан — использует активный)' },
                },
                required: ['title', 'amount', 'category'],
            },
        },
        {
            name: 'get_balance',
            description: 'Получить баланс и сводку по счёту',
            parameters: {
                type: 'object',
                properties: {
                    account_id: { type: 'number', description: 'ID счёта (если не указан — активный)' },
                },
            },
        },
        {
            name: 'list_transactions',
            description: 'Показать последние транзакции счёта',
            parameters: {
                type: 'object',
                properties: {
                    limit:      { type: 'number', description: 'Кол-во (по умолчанию 5, макс 50)' },
                    account_id: { type: 'number' },
                },
            },
        },
        {
            name: 'delete_transaction',
            description: 'Удалить транзакцию по ID',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'number', description: 'ID транзакции' },
                },
                required: ['id'],
            },
        },
        {
            name: 'add_note',
            description: 'Добавить текстовую заметку к счёту',
            parameters: {
                type: 'object',
                properties: {
                    content:    { type: 'string', description: 'Текст заметки' },
                    account_id: { type: 'number' },
                },
                required: ['content'],
            },
        },
    ],
}];

export async function runBotAgent({ text, audioBase64, accounts, activeAccountId, activeAccountName, userId, sql }) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY не задан');

    const accountsContext = accounts
        .map(a => `- "${a.name}" (id: ${a.id})${a.id === activeAccountId ? ' ← активный' : ''}`)
        .join('\n');

    const systemPrompt = `Ты — финансовый помощник в Telegram. Записываешь транзакции и заметки.

Активный счёт: "${activeAccountName}" (id: ${activeAccountId})
Все счета пользователя:
${accountsContext}

Правила:
- Расходы → отрицательная сумма, доходы → положительная
- Если упоминается конкретный счёт в сообщении — используй его id
- После выполнения действия отвечай коротко и чётко на русском
- Если что-то непонятно — задай один уточняющий вопрос

Правила удаления:
- Никогда не проси пользователя назвать ID транзакции
- Если пользователь хочет удалить по названию/описанию — сначала вызови list_transactions(limit: 50), найди нужную по названию и/или сумме, потом вызови delete_transaction с её id
- Если нашёл несколько похожих — удали самую последнюю
- Сообщи что именно удалил (название и сумму)`;

    // Функции-исполнители тулов
    async function executeTool(name, args) {
        const accId = args.account_id || activeAccountId;
        switch (name) {
            case 'add_transaction': {
                const [tx] = await sql`
                    INSERT INTO transactions(user_id, title, amount, category, account_id)
                    VALUES (${userId}, ${args.title}, ${args.amount}, ${args.category}, ${accId})
                    RETURNING id, title, amount, category`;
                return { success: true, transaction: tx };
            }
            case 'get_balance': {
                const [row] = await sql`
                    SELECT
                        COALESCE(SUM(amount), 0) AS balance,
                        COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS income,
                        COALESCE(SUM(amount) FILTER (WHERE amount < 0), 0) AS expenses
                    FROM transactions WHERE account_id = ${accId}`;
                return row;
            }
            case 'list_transactions': {
                const limit = Math.min(args.limit || 5, 50);
                const txs = await sql`
                    SELECT id, title, amount, category, created_at
                    FROM transactions WHERE account_id = ${accId}
                    ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
                return { transactions: txs };
            }
            case 'delete_transaction': {
                await sql`DELETE FROM transactions WHERE id = ${args.id}`;
                return { success: true };
            }
            case 'add_note': {
                const [note] = await sql`
                    INSERT INTO notes(user_id, account_id, content)
                    VALUES (${userId}, ${accId}, ${args.content})
                    RETURNING id`;
                return { success: true, note_id: note.id };
            }
            default:
                return { error: 'Unknown tool' };
        }
    }

    // Собираем parts для первого сообщения
    const userParts = audioBase64
        ? [
            { inlineData: { mimeType: 'audio/ogg', data: audioBase64 } },
            { text: 'Расшифруй голосовое и выполни запрос.' },
          ]
        : [{ text }];

    const contents = [{ role: 'user', parts: userParts }];

    // Агентный цикл (макс 5 итераций)
    for (let i = 0; i < 5; i++) {
        const data = await callGemini(key, systemPrompt, contents, BOT_TOOLS);
        const parts = data.candidates[0].content.parts;
        const functionCalls = parts.filter(p => p.functionCall);

        if (functionCalls.length === 0) {
            return parts.find(p => p.text)?.text?.trim() || 'Готово.';
        }

        contents.push({ role: 'model', parts });

        const toolResponses = await Promise.all(
            functionCalls.map(async part => ({
                functionResponse: {
                    name: part.functionCall.name,
                    response: await executeTool(part.functionCall.name, part.functionCall.args),
                },
            }))
        );

        contents.push({ role: 'user', parts: toolResponses });
    }

    return 'Готово.';
}

// ── Voice transcription (standalone) ─────────────────────────────────────────

export async function parseExpenseText(text) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY не задан');

    const prompt = `Ты — парсер финансовых операций. Пользователь написал: "${text}".
Определи тип (расход или доход) и извлечи данные.
Верни строго JSON: { "title": "строка", "amount": число, "category": "строка", "type": "expense" | "income" }.
amount всегда положительное число. Если валюта не указана — рубли.
Категории расходов: food, transport, shopping, health, entertainment, utilities, other.
Категории доходов: salary, freelance, investment, other.
Без лишнего текста и форматирования Markdown.`;

    const data = await callGemini(key, null, [{ parts: [{ text: prompt }] }]);
    const raw = data.candidates[0].content.parts[0].text;
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
}
