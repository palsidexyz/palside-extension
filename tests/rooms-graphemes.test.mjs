import { decodeContract } from '../packages/shared/src/contracts/validation.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { graphemeLength, ContractDecodeError } from '../packages/shared/src/contracts/validation.ts';
import { roomMessage } from '../packages/shared/src/contracts/rooms.ts';
import { endpointsById } from '../packages/shared/src/contracts/endpoints.ts';
import { ROOM_TEXT_MAX } from '../packages/shared/src/contracts/limits.ts';
import { textLength } from '../packages/ui/src/internal/form-values.ts';

const key = `token:sol:${'a'.repeat(32)}`;
test('danmaku shared request and response schemas count the same graphemes as the input', () => {
  for (const glyph of ['中', '😀', '👨‍👩‍👧‍👦', '👩🏽‍💻', '🇨🇳', 'e\u0301']) {
    const text = glyph.repeat(ROOM_TEXT_MAX);
    assert.equal(graphemeLength(text), ROOM_TEXT_MAX); assert.equal(textLength(text), ROOM_TEXT_MAX);
    const row = { id: 'message', key, author: { id: 'author', nickname: 'Author', avatarId: null }, text, createdAt: 1, folded: false, reported: false };
    assert.equal(decodeContract(roomMessage, row).text, text);
    assert.throws(() => decodeContract(roomMessage, { ...row, text: text + glyph }), ContractDecodeError);
    const body = endpointsById['rooms.send'].body.schema;
    assert.equal(decodeContract(body, { key, text: ` ${text} ` }).text, text);
    assert.throws(() => decodeContract(body, { key, text: text + glyph }), ContractDecodeError);
  }
});
