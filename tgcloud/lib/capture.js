import { api } from 'sdk';
import { upload } from './notion.js';

const maxDownload = 20_000_000;
const media = {
  animation: ['animation.mp4', 'video/mp4', 'video'],
  audio: ['audio.mp3', 'audio/mpeg', 'audio'],
  document: ['document', 'application/octet-stream', 'file'],
  photo: ['photo.jpg', 'image/jpeg', 'image'],
  video: ['video.mp4', 'video/mp4', 'video'],
  video_note: ['video-note.mp4', 'video/mp4', 'video'],
  voice: ['voice.ogg', 'audio/ogg', 'audio'],
};
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const styles = { bold: 'bold', italic: 'italic', strikethrough: 'strikethrough',
  underline: 'underline', code: 'code', pre: 'code' };

function richText(value, annotations, url) {
  const chars = Array.from(value);
  const runs = [];
  for (let i = 0; i < chars.length; i += 1000) {
    const text = { content: chars.slice(i, i + 1000).join('') };
    if (url && url.length <= 2000) text.link = { url };
    runs.push({ type: 'text', text, annotations });
  }
  return runs;
}

function formattedText(value, entities = []) {
  const offsets = new Set([0, value.length]);
  for (const { offset, length } of entities) {
    offsets.add(offset);
    offsets.add(offset + length);
  }
  const boundaries = [...offsets].sort((a, b) => a - b);
  return boundaries.slice(0, -1).flatMap((start, i) => {
    const end = boundaries[i + 1];
    const annotations = {};
    let url;
    for (const entity of entities) {
      if (entity.offset > start || entity.offset + entity.length < end) continue;
      if (Object.hasOwn(styles, entity.type)) annotations[styles[entity.type]] = true;
      if (entity.type === 'url' || entity.type === 'text_link') {
        const candidate = entity.url ?? value.slice(entity.offset, entity.offset + entity.length);
        if (/^https?:\/\//i.test(candidate)) url = candidate;
      }
    }
    return richText(value.slice(start, end), annotations, url);
  });
}

function paragraph(value) {
  return { type: 'paragraph', paragraph: { rich_text: richText(value) } };
}

function name(account) {
  if (!account) return '';
  const label = account.title ?? [account.first_name, account.last_name].filter(Boolean).join(' ');
  return [account.username && `@${account.username}`, label].filter(Boolean).join(' ');
}

function timestamp(seconds) {
  // Moscow is UTC+3 for current Telegram messages.
  return new Date((seconds + 10800) * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' MSK';
}

function forwardBlock(origin) {
  const account = origin.sender_user ?? origin.sender_chat ?? origin.chat;
  const source = origin.sender_user_name ?? (name(account) || 'Unknown sender');
  const url = account?.username && origin.message_id
    ? `https://t.me/${account.username}/${origin.message_id}`
    : undefined;
  return {
    type: 'paragraph',
    paragraph: { rich_text: [
      ...richText('Forwarded from '),
      ...richText(source, undefined, url),
      ...richText(`${origin.author_signature ? ` · ${origin.author_signature}` : ''} · ${timestamp(origin.date)}`),
    ] },
  };
}

function attachments(message) {
  const files = [];
  for (const [kind, defaults] of Object.entries(media)) {
    if (kind === 'document' && message.animation) continue;
    const file = kind === 'photo' ? message.photo?.at(-1) : message[kind];
    if (file?.file_id) files.push({ file, defaults });
  }
  const sticker = message.sticker;
  if (sticker?.file_id) {
    const defaults = sticker.is_animated ? ['sticker.tgs', 'application/octet-stream', 'file']
      : sticker.is_video ? ['sticker.webm', 'video/webm', 'file']
        : ['sticker.webp', 'image/webp', 'image'];
    files.push({ file: sticker, defaults });
  }
  for (const item of message.paid_media?.paid_media ?? []) {
    const file = item.video ?? item.photo?.at(-1);
    if (file?.file_id) files.push({ file, defaults: media[item.type] });
  }
  return files;
}

async function attachmentBlock({ file, defaults }) {
  const [defaultName, defaultMime, defaultType] = defaults;
  const filename = Array.from((file.file_name || defaultName).replace(/[\x00-\x1f\x7f/\\]/g, '_')).slice(-150).join('');
  const mime = file.mime_type || defaultMime;
  const type = imageTypes.has(mime) ? 'image'
    : defaultType === 'video' && mime === 'video/mp4' ? 'video'
      : defaultType === 'audio' && mime === 'audio/mpeg' ? 'audio' : 'file';

  if (file.file_size > maxDownload) {
    return { block: paragraph(`Attachment skipped: ${filename} (over Telegram's 20 MB bot download limit)`), failed: true };
  }
  try {
    const bytes = await api.getFileContent(file.file_id);
    return { block: await upload(bytes, filename, mime, type), failed: false };
  } catch {
    return { block: paragraph(`Attachment unavailable: ${filename}. Original is in Telegram.`), failed: true };
  }
}

function extraContent(message) {
  const { message_id, date, chat, from, text, entities, caption, caption_entities,
    forward_origin, reply_to_message, external_reply, quote, media_group_id, sticker,
    animation, audio, document, photo, video, video_note, voice, ...other } = message;
  // Keep Telegram payload fields without a native Notion equivalent.
  if (sticker?.emoji) other.sticker_emoji = sticker.emoji;
  return other;
}

export async function buildCapture(message) {
  const children = [];
  const body = message.text ?? message.caption ?? '';
  const runs = formattedText(body, message.entities ?? message.caption_entities);
  const header = richText(timestamp(message.date), { bold: true });
  const inline = runs.length <= 90;
  if (inline && runs.length) header.push(...richText(' · '), ...runs);
  for (let i = 0; !inline && i < runs.length; i += 90) {
    children.push({ type: 'paragraph', paragraph: { rich_text: runs.slice(i, i + 90) } });
  }

  if (message.forward_origin) children.push(forwardBlock(message.forward_origin));
  if (message.media_group_id) children.push(paragraph(`Telegram album ${message.media_group_id}`));
  const reply = message.reply_to_message ?? message.external_reply;
  if (reply || message.quote) {
    const quoted = message.quote?.text ?? reply?.text ?? reply?.caption;
    const sender = name(reply?.from ?? reply?.sender_chat ?? reply?.chat);
    children.push(paragraph(`Reply${sender ? ` to ${sender}` : ''}${quoted ? `\n${quoted}` : ''}`));
    if (message.external_reply?.origin) children.push(forwardBlock(message.external_reply.origin));
  }

  let failed = false;
  for (const file of attachments(message)) {
    const result = await attachmentBlock(file);
    children.push(result.block);
    failed ||= result.failed;
  }
  const extra = extraContent(message);
  if (Object.keys(extra).length) {
    const data = richText(JSON.stringify(extra, null, 2));
    for (let i = 0; i < data.length; i += 90) {
      children.push({ type: 'code', code: { language: 'json', rich_text: data.slice(i, i + 90) } });
    }
  }
  if (!body && children.length === 0) children.push(paragraph('Telegram message with no exportable content.'));
  return { entry: { type: 'bulleted_list_item', bulleted_list_item: { rich_text: header, children } }, failed };
}
