import sql from '../config/db.js';

export async function getNotesByAccount(req, res) {
    try {
        const { accountId } = req.params;
        const notes = await sql`SELECT * FROM notes WHERE account_id = ${accountId} ORDER BY created_at DESC`;
        res.json(notes);
    } catch (error) {
        console.error('Error getting notes:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

export async function createNote(req, res) {
    try {
        const { user_id, account_id, content } = req.body;
        if (!user_id || !account_id || !content) {
            return res.status(400).json({ message: 'user_id, account_id and content are required' });
        }
        const result = await sql`INSERT INTO notes(user_id, account_id, content) VALUES(${user_id}, ${account_id}, ${content}) RETURNING *`;
        res.status(201).json(result[0]);
    } catch (error) {
        console.error('Error creating note:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

export async function deleteNote(req, res) {
    try {
        const { id } = req.params;
        await sql`DELETE FROM notes WHERE id = ${id}`;
        res.json({ message: 'deleted' });
    } catch (error) {
        console.error('Error deleting note:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

export async function updateNote(req, res) {
    try {
        const { id } = req.params;
        const { content } = req.body;
        if (!content) return res.status(400).json({ message: 'content is required' });
        const result = await sql`UPDATE notes SET content = ${content} WHERE id = ${id} RETURNING *`;
        if (!result.length) return res.status(404).json({ message: 'not found' });
        res.json(result[0]);
    } catch (error) {
        console.error('Error updating note:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}
