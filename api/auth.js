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

    // 2. Получаем данные профиля пользователя из Patreon API
    const userResponse = await fetch('https://www.patreon.com/api/oauth2/v2/identity?include=memberships,memberships.campaign', {
      headers: { Authorization: `Bearer ${patreonAccessToken}` },
    });

    const userData = await userResponse.json();
    console.log('Patreon API Full Response:', JSON.stringify(userData));

    const patreonUserId = userData.data?.id;

    if (!patreonUserId) {
      return res.status(400).send(`Не удалось определить ID пользователя Patreon. Ответ от сервера: <pre>${JSON.stringify(userData, null, 2)}</pre>`);
    }

    // 3. Проверяем наличие активной подписки
    const memberships = userData.included?.filter(item => item.type === 'member') || [];
    const hasActiveSubscription = memberships.some(
      m => m.attributes?.status === 'active_patron' || m.attributes?.patron_status === 'active_patron'
    );

    // Примечание: если вы хотите тестировать без активной подписки, временно закомментируйте блок ниже
    if (!hasActiveSubscription) {
      return res.status(403).send(
        '<h3>Активная подписка не найдена</h3><p>У вас нет активной подписки на наш Patreon. Пожалуйста, оформите подписку, чтобы получить доступ в закрытую группу.</p>'
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
      return res.status(500).send('Ошибка сохранения данных в базу данных Supabase.');
    }

    // 5. Генерируем одноразовую инвайт-ссылку в закрытую группу через Telegram Bot API (на 24 часа)
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID; // ID закрытой группы (-100...)

    if (!chatId) {
      return res.status(500).send('Ошибка конфигурации: на сервере не задана переменная TELEGRAM_CHAT_ID.');
    }

    const expireDate = Math.floor(Date.now() / 1000) + 86400; // 24 часа в секундах

    const telegramInviteResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/createChatInviteLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          expire_date: expireDate,
          member_limit: 1,
        }),
      }
    );

    const inviteData = await telegramInviteResponse.json();

    if (!inviteData.ok) {
      console.error('Telegram Invite Error:', inviteData);
      return res.status(500).send('Подписка подтверждена, но не удалось сгенерировать ссылку в группу. Обратитесь к администратору.');
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
      '<h2>Авторизация и проверка успешна!</h2><p>Мы отправили персональную ссылку-приглашение в закрытую группу вам в личные сообщения Telegram. Можете закрыть это окно.</p>'
    );

  } catch (err) {
    console.error('Auth Handler Error:', err);
    return res.status(500).send(`Внутренняя ошибка сервера: ${err.message}`);
  }
}
