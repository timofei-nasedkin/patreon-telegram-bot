import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  const { code, state: telegramId } = req.query;

  // Вспомогательная функция для генерации красивой страницы ошибки с копируемым блоком
  const sendErrorResponse = (status, title, errorDetails) => {
    return res.status(status).send(`
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: auto; line-height: 1.5;">
        <h2 style="color: #d9534f;">${title}</h2>
        <p>При возникновении проблем, пожалуйста, свяжитесь с администратором в Telegram: <a href="https://t.me/MSOadmin2" target="_blank">@MSOadmin2</a> и передайте ему текст ошибки ниже:</p>
        <pre style="background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; font-size: 13px; user-select: all;"><code>${errorDetails}</code></pre>
      </div>
    `);
  };

  if (!code) {
    return sendErrorResponse(400, 'Ошибка авторизации', 'Ошибка: Отсутствует код авторизации от Patreon.');
  }

  if (!telegramId) {
    return sendErrorResponse(400, 'Ошибка авторизации', 'Ошибка: Не найден Telegram ID (state). Попробуйте запустить бота заново через /start.');
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
      return sendErrorResponse(400, 'Ошибка Patreon API', `Patreon Token Error: ${JSON.stringify(tokenData, null, 2)}`);
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
      return sendErrorResponse(400, 'Ошибка профиля Patreon', 'Не удалось определить ID пользователя Patreon из ответа API.');
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
      return res.status(403).send(`
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: auto; line-height: 1.5;">
          <h3 style="color: #d9534f;">Активная подписка не найдена</h3>
          <p>У вас нет подписки на наш Patreon. Пожалуйста, оформите её для получения доступа.</p>
          <p>Если это ошибка, обратитесь к администратору: <a href="https://t.me/MSOadmin2" target="_blank">@MSOadmin2</a></p>
        </div>
      `);
    }

    // 4. Сохраняем связку в Supabase
    const { error: dbError } = await supabase
      .from('links')
      .upsert([{ telegram_id: parseInt(telegramId), patreon_id: patreonUserId }], {
        onConflict: 'telegram_id',
      });

    if (dbError) {
      console.error('Supabase Error:', dbError);
      return sendErrorResponse(500, 'Ошибка базы данных', `Supabase Error: ${JSON.stringify(dbError, null, 2)}`);
    }

    // 5. Генерируем ссылку через Telegram API со сроком действия ровно 2 дня (48 часов = 172800 секунд)
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!chatId) {
      return sendErrorResponse(500, 'Ошибка конфигурации', 'Ошибка: Не задана переменная TELEGRAM_CHAT_ID в настройках Vercel.');
    }

    const nowMillis = Date.now();
    const nowSec = Math.floor(nowMillis / 1000);
    const expireSec = nowSec + 172800; // Ровно 2 дня в секундах

    const telegramInviteResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/createChatInviteLink`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          name: `User_${telegramId}_${nowMillis}`,
          expire_date: expireSec
        }),
      }
    );

    const inviteData = await telegramInviteResponse.json();

    if (!inviteData.ok) {
      console.error('Telegram Invite Error:', inviteData);
      return sendErrorResponse(500, 'Ошибка Telegram API', `Telegram Invite Error: ${JSON.stringify(inviteData, null, 2)}`);
    }

    const inviteLink = inviteData.result.invite_link;

    // 6. Форматируем время создания и окончания по Киеву
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Kyiv',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const createdAtKyiv = formatter.format(new Date(nowMillis));
    const expireAtKyiv = formatter.format(new Date(expireSec * 1000));

    const telegramMessage = `🎉 <b>Подписка на Patreon успешно подтверждена!</b>\n\n` +
      `📌 <b>Создано:</b> ${createdAtKyiv}\n` +
      `⏳ <b>Действует до:</b> ${expireAtKyiv} (по Киеву, 2 суток)\n\n` +
      `Ваша персональная ссылка:\n<a href="${inviteLink}">${inviteLink}</a>\n\n` +
      `💬 При возникновении вопросов обращайтесь к администратору: <a href="https://t.me/MSOadmin2">@MSOadmin2</a>`;

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text: telegramMessage,
        parse_mode: 'HTML'
      }),
    });

    // 7. Вывод в браузер
    return res.send(`
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: auto; line-height: 1.5;">
        <h2 style="color: green;">Авторизация прошла успешно!</h2>
        <p>Ссылка с ограничением в 2 суток отправлена вам в Telegram.</p>
        <hr style="margin: 20px 0;">
        <p><b>Создано:</b> ${createdAtKyiv}</p>
        <p><b>Действует до:</b> ${expireAtKyiv} (по Киеву)</p>
        <h3>Ссылка:</h3>
        <p><a href="${inviteLink}" target="_blank" style="font-size: 16px; word-break: break-all;">${inviteLink}</a></p>
        <hr style="margin: 20px 0;">
        <p>💬 Возникли вопросы? Обратитесь к администратору: <a href="https://t.me/MSOadmin2" target="_blank">@MSOadmin2</a></p>
      </div>
    `);

  } catch (err) {
    console.error('Auth Handler Error:', err);
    return sendErrorResponse(500, 'Внутренняя ошибка сервера', `Auth Handler Exception: ${err.message}\n${err.stack || ''}`);
  }
}
