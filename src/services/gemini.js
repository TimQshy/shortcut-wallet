export async function parseExpenseText(text) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error('GEMINI_API_KEY не задан');

    const prompt = `Ты — парсер финансовых операций. Пользователь написал: "${text}".
    Определи тип (расход или доход) и извлечи данные.
    Верни строго JSON: { "title": "строка", "amount": число, "category": "строка", "type": "expense" | "income" }.
    amount всегда положительное число. Если валюта не указана — рубли.
    Категории расходов: food, transport, shopping, health, entertainment, utilities, other.
    Категории доходов: salary, freelance, investment, other.
    Без лишнего текста и форматирования Markdown.`;

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
    );

    if (!res.ok) throw new Error('Ошибка Gemini: ' + await res.text());

    const data = await res.json();
    const raw = data.candidates[0].content.parts[0].text;
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
}
