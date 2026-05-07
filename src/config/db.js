import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sql = neon(process.env.POSTGRES_URL);



export default sql;