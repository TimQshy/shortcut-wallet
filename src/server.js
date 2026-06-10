import express from 'express';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import sql from './config/db.js';
import rateLimiter from './middlewere/rateLimiter.js';
import authBypass from './middlewere/authBypass.js';
const app = express();
import transactionRoute from './routes/transactionRoute.js';
import voiceRoute from './routes/voiceRoute.js';
import botRoute from './routes/botRoute.js';
import budgetRoute from './routes/budgetRoute.js';
import accountRoute from './routes/accountRoute.js';
import notesRoute from './routes/notesRoute.js';
import job, { nightlyJob } from './config/cron.js';

dotenv.config();
if(process.env.NODE_ENV === 'production') {
    job.start();
    nightlyJob.start();
}

//middleware
app.use(rateLimiter);
app.use(express.json());
app.use(authBypass);
//
//app.use((req,res, next) => {
//    console.log("Hey we hit a req, the method is ", req.method);
//    next()
//});


const PORT = process.env.PORT
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});


async function initDB() {
    try {
        await sql`CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(250) NOT NULL,
        title VARCHAR(250) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        category VARCHAR(250) NOT NULL,
        created_at DATE NOT NULL DEFAULT CURRENT_DATE)`;

        await sql`CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(250) NOT NULL,
        name VARCHAR(250) NOT NULL,
        created_at DATE NOT NULL DEFAULT CURRENT_DATE)`;

        await sql`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE`;

        await sql`CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(250) NOT NULL,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at DATE NOT NULL DEFAULT CURRENT_DATE)`;

        console.log('server initialized successfully');
    } catch (error) {
        console.error('Error initializing server:', error);
        process.exit(1); // status code 1 means error 0 means success
    }
}



app.use('/api/transactions', transactionRoute);
app.use('/api/voice', voiceRoute);
app.use('/api/telegram', botRoute);
app.use('/api/budget', budgetRoute);
app.use('/api/accounts', accountRoute);
app.use('/api/notes', notesRoute);
 
initDB().then(() => {
    app.listen(PORT, () => {
        console.log("Server is running on port: "+ PORT);
    });
});