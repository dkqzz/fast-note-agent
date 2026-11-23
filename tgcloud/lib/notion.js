import { fetch, FormData, InputFile } from 'sdk';
import { notionToken, pageId } from './config_local.js';

const pageChildren = `/blocks/${pageId}/children`;

export async function notion(path, method = 'GET', body) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${notionToken}`,
      'Notion-Version': '2026-03-11',
    },
    body: body instanceof FormData ? body : body && fetch.body.json(body),
  });
  if (!response.ok) throw new Error(`Notion ${method} failed (HTTP ${response.status})`);
  return response.json();
}

function blockText(block) {
  return block[block.type]?.rich_text?.map(run => run.plain_text).join('') ?? '';
}

async function findQuickNotes() {
  let heading;
  let cursor;
  do {
    const page = await notion(pageChildren + (cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : ''));
    for (const block of page.results) {
      if (heading) return block.type === 'divider' ? block.id : heading;
      if (/^heading_[123]$/.test(block.type) && blockText(block).trim() === 'Quick notes') {
        heading = block.id;
      }
    }
    cursor = page.next_cursor;
  } while (cursor);
  if (heading) return heading;
  throw new Error('Quick notes heading is missing');
}

export async function prepareCapture() {
  const anchor = await findQuickNotes();
  return async entry => {
    const result = await notion(pageChildren, 'PATCH', {
      position: { type: 'after_block', after_block: { id: anchor } },
      children: [entry],
    });
    return `https://www.notion.so/${pageId.replaceAll('-', '')}#${result.results[0].id.replaceAll('-', '')}`;
  };
}

export async function upload(bytes, filename, mime, type) {
  const { id } = await notion('/file_uploads', 'POST', { filename, content_type: mime });
  const form = new FormData();
  form.append('file', new InputFile(bytes, filename, { type: mime }));
  const result = await notion(`/file_uploads/${id}/send`, 'POST', form);
  if (result.status !== 'uploaded') throw new Error('Notion upload did not finish');
  return { type, [type]: { type: 'file_upload', file_upload: { id } } };
}
