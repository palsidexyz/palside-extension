import Type from 'typebox';
import { strictObject } from '../validation.ts';
import { id } from '../common.ts';
import { endpoint, jsonResponse } from '../endpoint.ts';
import { operation } from '../operations.ts';
export const operationEndpoints = [endpoint({ id: 'operations.read', method: 'GET', path: '/operations', query: strictObject({ id: Type.Optional(id) }), response: jsonResponse(operation) })] as const;
