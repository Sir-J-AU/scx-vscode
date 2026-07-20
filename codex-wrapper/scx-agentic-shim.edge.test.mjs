import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenTool, transformRequestBody, isPlanGateError, SERVER_TOOLS } from './scx-agentic-shim.mjs';

test('flattenTool edge cases: null/undefined/bare object', () => {
  assert.deepEqual(flattenTool(null, false), [null]);
  assert.deepEqual(flattenTool(undefined, false), [undefined]);
  assert.deepEqual(flattenTool({}, false), [{
    type: 'function',
    name: 'tool',
    description: 'Local undefined tool',
    parameters: { type: 'object', properties: { input: { type: 'string' } } }
  }]);
});

test('flattenTool preserves local_shell name as "shell"', () => {
  const tool = { type: 'local_shell', name: 'my_shell' };
  const result = flattenTool(tool, false);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'function');
  assert.equal(result[0].name, 'my_shell');
});

test('flattenTool custom/freeform tool uses input_schema fallback', () => {
  const tool = {
    type: 'custom',
    name: 'my_tool',
    input_schema: { type: 'object', properties: { custom_param: { type: 'string' } } }
  };
  const result = flattenTool(tool, false);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'function');
  assert.equal(result[0].name, 'my_tool');
  assert.deepEqual(result[0].parameters, tool.input_schema);
});

test('transformRequestBody returns unchanged when no tools array', () => {
  const body = { model: 'test', messages: [] };
  assert.deepEqual(transformRequestBody(body, false), body);
  assert.deepEqual(transformRequestBody(body, true), body);
});

test('isPlanGateError edge cases', () => {
  assert.equal(isPlanGateError(200, 'current plan not available'), false);
  assert.equal(isPlanGateError(400, 'invalid request format'), false);
  assert.equal(isPlanGateError(400, 'The current plan does not support this model'), true);
  assert.equal(isPlanGateError(400, 'model_not_in_plan'), true);
  assert.equal(isPlanGateError(400, 'not available on your subscription'), true);
});

test('SERVER_TOOLS contains web_search', () => {
  assert.ok(SERVER_TOOLS.has('web_search'));
});
