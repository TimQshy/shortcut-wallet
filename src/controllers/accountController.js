import sql from '../config/db.js';

export async function getAccounts(req, res) {
    try {
        const { userId } = req.params;
        const accounts = await sql`SELECT * FROM accounts WHERE user_id = ${userId} ORDER BY created_at DESC`;
        res.json(accounts);
    } catch (error) {
        console.error('Error getting accounts:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

export async function createAccount(req, res) {
    try {
        const { name, user_id } = req.body;
        if (!name || !user_id) return res.status(400).json({ message: 'name and user_id required' });
        const result = await sql`INSERT INTO accounts(user_id, name) VALUES(${user_id}, ${name}) RETURNING *`;
        res.status(201).json(result[0]);
    } catch (error) {
        console.error('Error creating account:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

export async function deleteAccount(req, res) {
    try {
        const { id } = req.params;
        await sql`DELETE FROM accounts WHERE id = ${id}`;
        res.json({ message: 'deleted' });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

export async function updateAccount(req, res) {
    try {
        const { id } = req.params;
        const { name } = req.body;
        const result = await sql`UPDATE accounts SET name = ${name} WHERE id = ${id} RETURNING *`;
        if (!result.length) return res.status(404).json({ message: 'not found' });
        res.json(result[0]);
    } catch (error) {
        console.error('Error updating account:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}
