import { renderMessage } from '../packages/i18n/src/core.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { insertPastedText, pastedImage } from '../apps/extension/src/features/palside/chat/clipboard.ts';

test('mixed paste replaces only the selected text and preserves Unicode content', () => {
  assert.deepEqual(insertPastedText('前文🙂旧文字后文', 4, 7, '图片说明\n'), { text: '前文🙂图片说明\n后文', caret: 9 });
  assert.deepEqual(insertPastedText('原稿', 2, 2, ''), { text: '原稿', caret: 2 });
});

test('multiple pasted files are rejected explicitly instead of silently choosing one', () => {
  const png = new File(['fixture'], 'one.png', { type: 'image/png' });
  assert.equal(pastedImage([png]).file, png);
  assert.deepEqual(pastedImage([]), {});
  const multiple = pastedImage([png, png]);
  assert.equal(multiple.file, undefined);
  assert.match(renderMessage('zh-CN', multiple.error), /逐张粘贴/);
});

test('unsupported pasted formats never become an image attachment', () => {
  for (const type of ['image/gif', 'image/svg+xml', 'application/pdf', '']) {
    const result = pastedImage([new File(['fixture'], 'unsupported', { type })]);
    assert.equal(result.file, undefined);
    assert.match(renderMessage('zh-CN', result.error), /PNG、JPEG 或 WebP/);
  }
});
