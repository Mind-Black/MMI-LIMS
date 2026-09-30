import test from 'node:test';
import assert from 'node:assert';
import { JOB_TITLES } from '../src/utils/userConstants.js';

test('JOB_TITLES contains all 9 required job title options in order', () => {
    const expected = [
        'BSc Student',
        'MSc Student',
        'PhD Student',
        'Engineer',
        'Junior Researcher',
        'Researcher',
        'Senior Researcher',
        'Chief Researcher',
        'External'
    ];
    assert.strictEqual(JOB_TITLES.length, 9);
    assert.deepStrictEqual(JOB_TITLES, expected);
});
