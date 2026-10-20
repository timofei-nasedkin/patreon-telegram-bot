import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { code, state: telegramId } = req.query;

  if (!code) {
    return res.status(400).send('Ошибка: Отсутствует код авторизации от Patreon.');
  }

  if (!telegramId) {
    return res.status(400).send('Ошибка: Не найден Telegram ID (state). Попробуйте запустить бота заново через /start.');
  }

  try {
    // 1. Обмениваем код авторизации на Access Token от Patreon
    const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.PATREON_CLIENT_ID,
        client_secret: process.env.PAT_CLIENT_SECRET,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: `https://${req.headers.host}/api/auth`,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      console.error('Patreon Token Error:', tokenData);
      return res.status(400).send(`Ошибка авторизации в Patreon: не удалось получить токен. Детали: ${JSON.stringify(tokenData)}`);
    }

    const patreonAccessToken = tokenData.access_token;

    // 2. Получаем данные профиля пользователя
    const patreonUrl = 'https://www.patreon.com/api/oauth2/v2/identity' + 
      '?include=memberships,memberships.campaign' +
      '&fields[member]=patron_status,is_follower,currently_entitled_amount_cents';

    const userResponse = await fetch(patreonUrl, {
      headers: { Authorization: `Bearer ${patreonAccessToken}` },
    });

    const userData = await userResponse.json();
    const patreonUserId = userData.data?.id;

    if (!patreonUserId) {
      return res.status(400).send('Не удалось определить ID пользователя Patreon.');
    }

    // 3. Проверяем наличие подписки или пробного периода
    const memberships = userData.included?.filter(item => item.type === 'member') || [];

    const hasActiveSubscription = memberships.some(m => {
      const patronStatus = m.attributes?.patron_status;
      return (
        patronStatus === 'active_patron' || 
        patronStatus === 'declined_patron' || 
        !!patronStatus
      );
    });

    if (!hasActiveSubscription && memberships.length === 0) {
      return res.status(403).send(
        '<h3>Активная подписка не найдена</h3><p>У вас нет подписки на наш Patreon. Пожалуйста, оформите её для получения доступа.</p>'
      );
    }

    // 4. Сохраняем связку в Supabase
    const { error: dbError } = await supabase
      .from('links')
      .upsert([{ telegram_id: parseInt(telegramId), patreon_id: patreonUserId }], {
        onConflict: 'telegram_id',
      });

    if (dbError) {
      console.error('Supabase Error:', dbError);
      return res.status(500).send('Ошибка сохранения данных в Supabase.');
    }

    // 5. Генерируем ссылку через Telegram API (на 7 дней)
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!chatId) {
      return res.status(500).send('Ошибка: Не задана переменная TELEGRAM_CHAT_ID в настройках Vercel.');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const expireDate = nowSec + 604800; // Ровно +7 дней

    const telegramInviteResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/createChatInviteLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          name: `User_${telegramId}`,
          expire_date: expireDate
        }),
      }
    );

    const inviteData = await telegramInviteResponse.json();

    if (!inviteData.ok) {
      console.error('Telegram Invite Error:', inviteData);
      return res.status(500).send(`
        <h3>Ошибка при создании ссылки в Telegram</h3>
        <pre>${JSON.stringify(inviteData, null, 2)}</pre>
      `);
    }

    const inviteLink = inviteData.result.invite_link;

    // 6. Отправляем ту же самую ссылку в личные сообщения
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text: `🎉 Подписка на Patreon успешно подтверждена!\n\nВаша персональная ссылка (действует 7 дней):\n${inviteLink}`,
      }),
    });

    // 7. Вывод ссылки на экран браузера
    return res.send(`
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: auto;">
        <h2 style="color: green;">Авторизация прошла успешно!</h2>
        <p>Ссылка также продублирована вам в личные сообщения Telegram.</p>
        <hr style="margin: 20px 0;">
        <h3>Ваша персональная ссылка:</h3>
        <p><a href="${inviteLink}" target="_blank" style="font-size: 16px; word-break: break-all;">${inviteLink}</a></p>
      </div>
    `);

  } catch (err) {
    console.error('Auth Handler Error:', err);
    return res.status(500).send(`Ошибка сервера: ${err.message}`);
  }
}
