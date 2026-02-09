import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.MOLTBOOK_API_KEY;
const EMAIL = 'jwusch@gmail.com';
const BASE = 'https://www.moltbook.com/api/v1';

async function trySetup() {
  console.log(`Attempting to set up owner email: ${EMAIL}`);
  try {
    const res = await axios.post(`${BASE}/agents/me/setup-owner-email`, { email: EMAIL }, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    console.log('Success:', JSON.stringify(res.data, null, 2));
    return true;
  } catch (err: any) {
    const data = err.response?.data;
    console.log('Response:', JSON.stringify(data));
    if (data?.error?.includes('suspended')) {
      console.log(`Still suspended. ${data.hint || ''}`);
      return false;
    }
    // Some other error — don't retry
    console.error('Unexpected error:', err.message);
    return true; // stop retrying
  }
}

async function main() {
  const MAX_RETRIES = 12; // 12 x 15min = 3 hours
  for (let i = 0; i < MAX_RETRIES; i++) {
    const done = await trySetup();
    if (done) return;
    console.log(`Retrying in 15 minutes... (attempt ${i + 1}/${MAX_RETRIES})`);
    await new Promise(r => setTimeout(r, 15 * 60 * 1000));
  }
  console.log('Gave up after max retries.');
}

main().catch(console.error);
