import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { tg_id, code } = req.query;

  const CLIENT_ID = process.env.PATREON_CLIENT_ID;
  const CLIENT_SECRET = process.env.PATREON_CLIENT_SECRET;
  
  const HOST = `https://${req.headers.host}`;
  const REDIRECT_URI = `${HOST}/api/auth`;

  if (!code) {
    if (!tg_id) {
      return res.status(400).send('Ошибка: Не указан Telegram ID.');
    }
    
    const patreonAuthUrl = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${tg_id}`;
    
    return res.redirect(patreonAuthUrl);
  }

  const telegram_id = req.query.state;

  try {
    const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) {
      throw new Error('Не удалось получить токен от Patreon: ' + JSON.stringify(tokenData));
    }

    const userResponse = await fetch('https://www.patreon.com/api/oauth2/v2/identity?fields[user]=social_connections', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    
    const userData = await userResponse.json();
    const patreon_id = userData.data.id;

    const { error } = await supabase
      .from('links')
      .upsert({ telegram_id: String(telegram_id), patreon_id: String(patreon_id) }, { onConflict: ['telegram_id'] });

    if (error) throw error;

    return res.status(200).send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
          <h2 style="color: green;">✅ Аккаунт Patreon успешно привязан!</h2>
          <p>Можете закрыть это окно и вернуться в Telegram-бот.</p>
        </body>
      </html>
    `);

  } catch (err) {
    console.error(err);
    return res.status(500).send('Произошла ошибка привязки аккаунта: ' + err.message);
  }
}
