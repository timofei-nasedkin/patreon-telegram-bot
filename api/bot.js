import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Bot Webhook Active');
  }

  const { message } = req.body || {};
  if (!message || !message.text) {
    return res.status(200).send('OK');
  }

  const chatId = message.chat.id;
  const text = message.text.trim();
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

  // Функция отправки сообщений в Telegram
  const sendMessage = async (chatId, text, replyMarkup = null) => {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
      }),
    });
  };

  if (text === '/start') {
    // Проверяем, привязан ли уже Patreon к этому Telegram ID
    const { data: link } = await supabase
      .from('links')
      .select('patreon_id')
      .eq('telegram_id', String(chatId))
      .maybeSingle();

    if (link) {
      await sendMessage(chatId, '✅ Ваш аккаунт Patreon уже успешно привязан!');
    } else {
      const authUrl = `https://${req.headers.host}/api/auth?tg_id=${chatId}`;
      await sendMessage(
        chatId,
        'Привет! Нажми на кнопку ниже, чтобы авторизоваться через Patreon и получить доступ:',
        {
          inline_keyboard: [
            [{ text: '🔗 Авторизоваться через Patreon', url: authUrl }]
          ]
        }
      );
    }
  }

  return res.status(200).send('OK');
}
