export async function sendTelegramMessage(text, chatId) {
    const token = process.env.TELEGRAM_TOKEN;
    const targetChatId = chatId ?? process.env.TELEGRAM_CHAT_ID;
    if (!token || !targetChatId) return;

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: targetChatId, text, parse_mode: 'HTML' })
    });
}
