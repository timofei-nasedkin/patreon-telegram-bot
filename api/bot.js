export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Bot Webhook Active');
  }

  const { message } = req.body;

  if (message && message.text === '/start') {
    const chatId = message.chat.id;
    const clientId = process.env.PATREON_CLIENT_ID;
    const redirectUri = `https://${req.headers.host}/api/auth`;

    const patreonAuthUrl = `https://www.patreon.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${chatId}`;
    const patreonCampaignUrl = 'https://www.patreon.com/cw/MonitoringSprosaOdessa';
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    const welcomeMessage = 
      `🤖 <b>Добро пожаловать в бот доступа к группе «Мониторинг Спроса Одесса»!</b>\n\n` +
      `⚠️ <b>ВАЖНО:</b> Сначала у вас должна быть оформлена подписка на нашем Patreon, и только после этого вы можете авторизоваться через этот бот для получения одноразовой ссылки на вступление.\n\n` +
      `📌 <b>Шаг 1.</b> Если подписка еще не оформлена, сделайте это здесь:\n` +
      `<a href="${patreonCampaignUrl}">${patreonCampaignUrl}</a>\n\n` +
      `📌 <b>Шаг 2.</b> Если подписка уже есть, нажмите кнопку ниже для авторизации и получения пригласительной ссылки:\n\n` +
      `💬 По вопросам обращайтесь к администратору: <a href="https://t.me/MSOadmin2">@MSOadmin2</a>`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: welcomeMessage,
        parse_mode: 'HTML',
        disable_web_page_preview: true, // Отключаем превью для ссылки на Patreon в чате, чтобы сообщение было аккуратным
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔗 Авторизоваться через Patreon',
                url: patreonAuthUrl,
              },
            ],
            [
              {
                text: '💳 Оформить подписку на Patreon',
                url: patreonCampaignUrl,
              },
            ],
          ],
        },
      }),
    });
  }

  return res.status(200).json({ ok: true });
}
