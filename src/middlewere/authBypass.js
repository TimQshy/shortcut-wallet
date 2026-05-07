const authBypass = (req, res, next) => {
    const BACKEND_SECRET = process.env.BACKEND_SECRET;
    const apiKey = req.headers['x-api-key'];

    if (apiKey && apiKey === BACKEND_SECRET) {
        // Если ключ совпал, помечаем запрос как "авторизованный бот"
        req.auth = { userId: process.env.MY_CLERK_USER_ID }; // Твой ID, чтобы транзакции падали тебе
        return next();
    }
    
    next();
};

export default authBypass;