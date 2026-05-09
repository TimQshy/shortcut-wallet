export async function parseExpenseText(text) {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error('GEMINI_API_KEY не задан');

    const prompt = `Ты — парсер расходов. Пользователь продиктовал следующее: "${text}".
    Извлеки данные и верни строго JSON: { "title": "строка", "amount": число, "category": "строка" }.
    Если валюта не указана, это рубли. Без лишнего текста и форматирования Markdown.`;

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
