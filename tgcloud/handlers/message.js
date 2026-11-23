import { api } from 'sdk';
import { ownerId } from '../lib/config_local.js';
import { buildCapture } from '../lib/capture.js';
import { prepareCapture } from '../lib/notion.js';

export default async function (message) {
  if (message.chat.type !== 'private' || String(message.from?.id) !== String(ownerId)) return;

  let warning;
  try {
    const append = await prepareCapture();
    const { entry, failed } = await buildCapture(message);
    const url = await append(entry);
    if (!failed) return;
    warning = `Saved with missing attachments.\n${url}`;
  } catch (error) {
    console.warn('Capture failed', { messageId: message.message_id, error: error.message });
    warning = 'Could not save to Notion. Your original is still here.';
  }

  await api.sendMessage({
    chat_id: message.chat.id,
    text: warning,
    reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
    link_preview_options: { is_disabled: true },
  });
}
