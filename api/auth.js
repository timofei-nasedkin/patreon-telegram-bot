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

    // 2. Получаем данные профиля пользователя и запрашиваем поля member
    const patreonUrl = 'https://www.patreon.com/api/oauth2/v2/identity' + 
      '?include=memberships,memberships.campaign' +
      '&fields[member]=patron_status,is_follower,currently_entitled_amount_cents';

    const userResponse = await fetch(patreonUrl, {
      headers: { Authorization: `Bearer ${patreonAccessToken}` },
    });

    const userData = await userResponse.json();
    console.log('Patreon API Response with fields:', JSON.stringify(userData));

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

    // 5. Генерируем одноразовую инвайт-ссылку в закрытую группу (на 24 часа = 86400 сек)
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!chatId) {
      return res.status(500).send('Ошибка: Не задана переменная TELEGRAM_CHAT_ID в настройках Vercel.');
    }

    // Ровно +24 часа от текущего времени сервера в секундах (UNIX Timestamp)
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const expireDate = nowInSeconds + 86400; 

    const telegramInviteResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/createChatInviteLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          expire_date: expireDate,
          member_limit: 1, // Лимит 1 использование
        }),
      }
    );

    const inviteData = await telegramInviteResponse.json();

    if (!inviteData.ok) {
      console.error('Telegram Invite Error:', inviteData);
      return res.status(500).send(`
        <h3>Ошибка при создании ссылки в Telegram</h3>
        <p><b>Технический ответ от Telegram:</b></p>
        <pre>${JSON.stringify(inviteData, null, 2)}</pre>
      `);
    }

    const inviteLink = inviteData.result.invite_link;

    // 6. Отправляем инвайт-ссылку пользователю в личные сообщения Telegram
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text: `🎉 Подписка на Patreon успешно подтверждена!\n\nВот ваша персональная ссылка для входа в закрытую группу (действует 24 часа):\n${inviteLink}`,
      }),
    });

    // 7. Финальный ответ в окне браузера
    return res.send(
      '<h2>Авторизация прошла успешно!</h2><p>Персональная ссылка-приглашение отправлена вам в личные сообщения в Telegram. Можете закрыть это окно.</p>'
    );

  } catch (err) {
    console.error('Auth Handler Error:', err);
    return res.status(500).send(`Ошибка сервера: ${err.message}`);
  }
}
