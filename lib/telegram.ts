const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const API = `https://api.telegram.org/bot${TOKEN}`;

type InlineButton = { text: string; callback_data: string };

async function call(method: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; description?: string; result?: unknown };
  if (!json.ok) console.error(`Telegram ${method} failed:`, json.description);
  return json;
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  buttons?: InlineButton[][],
): Promise<any> {
  return call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export async function answerCallback(callbackId: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
}

/** Replace the buttons under a message (e.g. after the user taps Confirm). */
export async function editButtons(
  chatId: number | string,
  messageId: number,
  buttons: InlineButton[][],
): Promise<void> {
  await call("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: buttons },
  });
}

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
