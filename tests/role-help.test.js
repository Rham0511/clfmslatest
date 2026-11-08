import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRoleHelpAnswer,
  formatRoleHelpAnswer,
  getRoleHelpSystemInstruction,
  normalizeHelpRole,
  RoleHelpAIError
} from '../utils/roleHelp.js';

test('normalizes supported ComLab roles', () => {
  assert.equal(normalizeHelpRole('super_admin'), 'admin');
  assert.equal(normalizeHelpRole('Administrator'), 'admin');
  assert.equal(normalizeHelpRole('Instructor'), 'faculty');
  assert.equal(normalizeHelpRole('TECHNICIAN'), 'technician');
  assert.equal(normalizeHelpRole('Student'), 'student');
  assert.equal(normalizeHelpRole('visitor'), null);
});

test('creates role-specific instructions for the AI', () => {
  const studentInstructions = getRoleHelpSystemInstruction('student');
  assert.match(studentInstructions, /My PC Station/);
  assert.match(studentInstructions, /Never give instructions for another role/);
  assert.doesNotMatch(studentInstructions, /User Management/);
  assert.match(studentInstructions, /Scan equipment QR/);
  assert.match(studentInstructions, /scanning alone does not borrow or release it/);
  assert.match(studentInstructions, /MR Faculty member must approve/);
  assert.match(studentInstructions, /match it to the relevant verified feature and workflow/);
  assert.doesNotMatch(getRoleHelpSystemInstruction('faculty'), /student.*attendance QR code to check in/i);
  assert.match(getRoleHelpSystemInstruction('faculty'), /student requests requiring your approval/);
  assert.match(getRoleHelpSystemInstruction('technician'), /record equipment release\/return/);
  assert.match(getRoleHelpSystemInstruction('admin'), /User Management/);
  assert.match(getRoleHelpSystemInstruction('admin'), /does not approve or create a student borrow request/);
  assert.equal(getRoleHelpSystemInstruction('visitor'), null);
});

test('sends role instructions and prior chat context to Groq', async () => {
  let requestUrl;
  let requestOptions;
  const answer = await generateRoleHelpAnswer(
    'student',
    [
      { sender: 'user', content: 'How do I use my PC station?' },
      { sender: 'assistant', content: 'Use My PC Station.' }
    ],
    'How do I end the session?',
    {
      apiKey: 'test-key',
      fetchImpl: async (url, options) => {
        requestUrl = url;
        requestOptions = options;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: 'Scan the station QR code again.' } }]
          })
        };
      }
    }
  );

  assert.equal(answer, 'Scan the station QR code again.');
  assert.match(requestUrl, /api\.groq\.com\/openai\/v1\/chat\/completions/);
  assert.equal(requestOptions.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(requestOptions.body);
  assert.equal(body.model, 'openai/gpt-oss-20b');
  assert.match(body.messages[0].content, /student/);
  assert.deepEqual(body.messages.map(({ role }) => role), ['system', 'user', 'assistant', 'user']);
});

test('reports an explicit configuration error when the API key is missing', async () => {
  await assert.rejects(
    generateRoleHelpAnswer('student', [], 'Help me', { apiKey: '' }),
    (error) => error instanceof RoleHelpAIError
      && error.status === 503
      && error.code === 'AI_NOT_CONFIGURED'
  );
});

test('reports Groq rate limits without falling back to canned answers', async () => {
  await assert.rejects(
    generateRoleHelpAnswer('student', [], 'Help me', {
      apiKey: 'test-key',
      fetchImpl: async () => ({ ok: false, status: 429 })
    }),
    (error) => error instanceof RoleHelpAIError
      && error.status === 503
      && error.code === 'AI_RATE_LIMITED'
  );
});

test('removes Markdown asterisks while preserving plain-text list content', () => {
  assert.equal(
    formatRoleHelpAnswer('**Important:** Scan again.\n* Open **My PC Station**\nUse `Profile`.'),
    'Important: Scan again.\n• Open My PC Station\nUse Profile.'
  );
});
