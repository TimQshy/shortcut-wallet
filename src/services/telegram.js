const base = () => `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

async function tgPost(method, body) {
    await fetch(`${base()}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

export async function sendTelegramMessage(text, chatId, replyMarkup) {
    const targetChatId = chatId ?? process.env.TELEGRAM_CHAT_ID;
    if (!process.env.TELEGRAM_TOKEN || !targetChatId) return;
    const body = { chat_id: targetChatId, text, parse_mode: 'HTML' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await tgPost('sendMessage', body);
}

export async function editMessage(chatId, messageId, text, replyMarkup) {
    const body = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await tgPost('editMessageText', body);
}

export async function answerCallback(callbackQueryId, text = '') {
    await tgPost('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
}
