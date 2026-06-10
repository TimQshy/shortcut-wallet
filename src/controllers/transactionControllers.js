import sql from '../config/db.js';
export async function getTransactions(req, res) {
    try {
        const { userId, accountId } = req.params;
        const transactions = await sql`SELECT * FROM transactions WHERE user_id = ${userId} AND account_id = ${accountId} ORDER BY created_at DESC`;
        res.status(200).json(transactions);
    } catch (error) {
        console.log("Error getting the transaction", error);
        res.status(500).json({ message: "Internal server error" });
    }
}
export async function createTransaction(req, res) {
    try {
    const { title, amount, category, account_id } = req.body;
    const user_id = req.body.user_id || req.auth?.userId;

    if (!title || !user_id || !category || amount === undefined) {
        return res.status(400).json({ message: "All fields are required" });
    }

    const transaction = await sql`
        INSERT INTO transactions(user_id, title, amount, category, account_id)
        VALUES (${user_id}, ${title}, ${amount}, ${category}, ${account_id ?? null})
        RETURNING *
    `;

    console.log(transaction);
    res.status(201).json(transaction[0]);
    } catch (error) {
  console.log("Error creating the transaction", error);
  res.status(500).json({ message: "Internal server error" });
}
}
export async function deleteTransaction(req, res) {
    try {
        const { id } = req.params

        if (isNaN(id)   ) {
            return res.status(400).json({ message: "Invalid transaction id" });
        }
       const result = await sql `DELETE FROM transactions WHERE id = ${id}`;
       if (result.rowCount === 0) {
        return res.status(404).json({ message: "Transaction not found" });
       }
       res.status(200).json({ message: "Transaction deleted successfully" });
    }catch (error) {
        console.log("Error deleting the transaction", error);
        res.status(500).json({ message: "Internal server error" });
    }   
}
export async function updateTransaction(req, res) {
    try {
        const { id } = req.params;
        if (isNaN(id)) return res.status(400).json({ message: "Invalid transaction id" });

        const { title, amount, category } = req.body;

        const result = await sql`
            UPDATE transactions
            SET
                title    = COALESCE(${title    ?? null}, title),
                amount   = COALESCE(${amount   ?? null}, amount),
                category = COALESCE(${category ?? null}, category)
            WHERE id = ${id}
            RETURNING *
        `;

        if (result.length === 0) return res.status(404).json({ message: "Transaction not found" });
        res.status(200).json(result[0]);
    } catch (error) {
        console.error("Error updating transaction:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

export async function getSummary(req, res) {
    try {
        const { userId, accountId } = req.params;
        const balanceResult  = await sql`SELECT COALESCE(SUM(amount), 0) AS balance FROM transactions WHERE user_id = ${userId} AND account_id = ${accountId}`;
        const incomeResult   = await sql`SELECT COALESCE(SUM(amount), 0) AS income FROM transactions WHERE user_id = ${userId} AND account_id = ${accountId} AND amount > 0`;
        const expensesResult = await sql`SELECT COALESCE(SUM(amount), 0) AS expenses FROM transactions WHERE user_id = ${userId} AND account_id = ${accountId} AND amount < 0`;

        res.status(200).json({
            balance: balanceResult[0].balance,
            income: incomeResult[0].income,
            expenses: expensesResult[0].expenses
        });
    } catch (error) {
        console.log("Error getting the summary", error);
        res.status(500).json({ message: "Internal server error" });
    }
}