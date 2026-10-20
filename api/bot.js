import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Bot Webhook Active');
  }

  const { message } = req.body;

  if (message && message.text === '/start') {
    const chatId = message.chat.id;
    const clientId = process.env.PATREON_CLIENT_ID;
    const redirectUri = `https://${req.headers.host}/api/auth`;

    // Передаем Telegram ID в параметре state, чтобы привязать аккаунт после авторизации
    const patreonAuthUrl = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${chatId}`;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: 'Привет! Нажмите кнопку ниже, чтобы авторизоваться через Patreon и получить доступ в закрытую группу:',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔗 Авторизоваться через Patreon',
                url: patreonAuthUrl,
              },
            ],
          ],
        },
      }),
    });
  }

  return res.status(200).json({ ok: true });
}
