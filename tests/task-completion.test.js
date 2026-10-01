import assert from 'node:assert/strict';
import test from 'node:test';
import { isAssignmentCompleted, fetchPaginatedCanvasData, mapCanvasTasks } from '../electron/canvasTasks.js';
import { applyCompletion, loadCompletionOverrides } from '../src/utils/taskCompletion.js';

const online = { id: 10, submission_types: ['online_upload'], has_submitted_submissions: true };
const cases = [
  ['another student submitted', online, { workflow_state: 'unsubmitted' }, false],
  ['paper work still outstanding', { submission_types: ['on_paper'] }, null, false],
  ['no submission type still outstanding', { submission_types: ['none'] }, null, false],
  ['empty types', { submission_types: [] }, null, false],
  ['submitted upload', online, { workflow_state: 'submitted' }, true],
  ['awaiting review', online, { workflow_state: 'pending_review' }, true],
  ['group timestamp', online, { workflow_state: 'unsubmitted', submitted_at: '2026-10-01' }, true],
  ['excused', online, { excused: true, missing: true }, true],
  ['reassigned submitted work', online, { redo_request: true, submitted_at: '2026-10-01' }, false],
  ['automatic missing zero', online, { workflow_state: 'graded', score: 0, missing: true }, false],
  ['online grade without submission', online, { workflow_state: 'graded', score: 90 }, false],
  ['graded actual attempt without timestamp', online, { workflow_state: 'graded', attempt: 1, submission_type: 'online_upload', score: 0 }, true],
  ['actual submitted zero', online, { workflow_state: 'graded', score: 0, submitted_at: '2026-10-01' }, true],
  ['submitted despite stale missing flag', online, { workflow_state: 'submitted', missing: true }, true],
  ['external score without timestamp', { submission_types: ['external_tool'] }, { score: 95 }, true],
  ['external legitimate zero', { submission_types: ['external_tool'] }, { score: 0, missing: false }, true],
  ['external ambiguous zero', { submission_types: ['external_tool'] }, { score: 0 }, false],
  ['external missing with grade', { submission_types: ['external_tool'] }, { score: 95, late_policy_status: 'missing' }, false],
  ['paper grade', { submission_types: ['on_paper'] }, { score: 80 }, true],
  ['embedded group submission', { submission: { submitted_at: '2026-10-01' } }, undefined, true]
];
for (const [name, assignment, submission, expected] of cases) {
  test(name, () => assert.equal(isAssignmentCompleted(assignment, submission), expected));
}

function event(id, course = '101', assignment = online) {
  return { id: `assignment_${id}`, type: 'assignment', title: `Task ${id}`, context_code: `course_${course}`,
    context_name: 'Course', start_at: '2026-10-10T00:00:00Z', assignment: { ...assignment, id } };
}

test('batches current-user submissions, paginates, and separates courses', async () => {
  const events = Array.from({ length: 22 }, (_, i) => event(i + 1));
  events.push({ ...event(1, '102'), id: 'assignment_other_course' });
  const calls = [];
  const fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.cache, 'no-store');
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.has('student_ids[]'), false);
    const ids = parsed.searchParams.getAll('assignment_ids[]');
    assert.ok(ids.length <= 20);
    const course = parsed.pathname.includes('/102/');
    const data = ids.map(id => ({ assignment_id: id, workflow_state: course ? 'unsubmitted' : 'submitted' }));
    const firstPage = ids.length === 20 && !parsed.searchParams.has('page');
    return { ok: true, status: 200,
      headers: new Headers(firstPage ? { link: `<${url}&page=2>; rel="next"` } : {}),
      json: async () => firstPage ? data.slice(0, 10) : parsed.searchParams.has('page') ? data.slice(10) : data };
  };
  const tasks = await mapCanvasTasks(events, 'https://canvas.mock', {},
    (url, headers) => fetchPaginatedCanvasData(url, headers, fetch));
  assert.equal(calls.length, 4);
  assert.equal(tasks.filter(task => task.completed).length, 22);
  assert.equal(tasks.at(-1).completed, false);
});

test('missing batch rows fall back to single current-user submissions', async () => {
  const tasks = await mapCanvasTasks([event(10)], 'https://canvas.mock', {}, async url =>
    url.includes('/students/') ? [] : [{ workflow_state: 'submitted' }]);
  assert.equal(tasks[0].completed, true);
});

test('batch HTTP failures fall back to an embedded submission', async () => {
  const tasks = await mapCanvasTasks([event(10, '101', { ...online, submission: { submitted_at: '2026-10-01' } })],
    'https://canvas.mock', {}, async () => { throw new Error('Canvas request failed (403)'); });
  assert.equal(tasks[0].completed, true);
});

test('current batch state takes precedence over stale embedded state', async () => {
  const tasks = await mapCanvasTasks([event(10, '101', { ...online, submission: { workflow_state: 'submitted' } })],
    'https://canvas.mock', {}, async () => [{ assignment_id: 10, workflow_state: 'unsubmitted' }]);
  assert.equal(tasks[0].completed, false);
});

test('authentication errors propagate', async () => {
  await assert.rejects(mapCanvasTasks([event(10)], 'https://canvas.mock', {},
    async () => { throw new Error('unauthorized'); }), /unauthorized/);
});

test('HTTP failures do not become empty successful results', async () => {
  await assert.rejects(fetchPaginatedCanvasData('https://canvas.mock/api', {}, async () =>
    ({ ok: false, status: 500 })), /500/);
});

test('assignments disappearing from upcoming still update after submission', async () => {
  const fetchData = async () => [{ assignment_id: 10, workflow_state: 'submitted' }];
  const [cached] = await mapCanvasTasks([event(10)], 'https://canvas.mock', {}, async () =>
    [{ assignment_id: 10, workflow_state: 'unsubmitted' }]);
  const tasks = await mapCanvasTasks([], 'https://canvas.mock', {}, fetchData, [cached]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, cached.id);
  assert.equal(tasks[0].completed, true);
  assert.equal((await mapCanvasTasks([], 'https://different.mock', {}, fetchData, [cached])).length, 0);
});

test('failed submission fetch preserves last known state, without class-wide flags', async () => {
  const [item] = await mapCanvasTasks([event(10)], 'https://canvas.mock', {}, async () =>
    { throw new Error('offline'); });
  assert.equal(item.completionKnown, false);
  assert.equal(item.completed, false);
  assert.equal(applyCompletion(item, {}, { canvasCompleted: true }).completed, true);
});

test('local unchecked state persists on refresh and restart', () => {
  const overrides = { task: { completed: false, canvasCompleted: true } };
  const storage = { getItem: key => key === 'taskCompletionOverrides' ? JSON.stringify(overrides) : null };
  const restored = loadCompletionOverrides(storage, []);
  assert.equal(applyCompletion({ id: 'task', completed: true }, restored).completed, false);
});

test('new Canvas state supersedes an older manual choice', () => {
  const overrides = { task: { completed: true, canvasCompleted: false } };
  assert.equal(applyCompletion({ id: 'task', completed: false }, overrides).completed, true);
  applyCompletion({ id: 'task', completed: true }, overrides);
  assert.equal(applyCompletion({ id: 'task', completed: false }, overrides).completed, false);
});

test('legacy checked IDs migrate without making cached false positives into overrides', () => {
  const storage = { getItem: key => key === 'localCompletedIds' ? '["manual"]' : null };
  const restored = loadCompletionOverrides(storage, [{ id: 'bad-cache', completed: true }]);
  assert.equal(applyCompletion({ id: 'manual', completed: false }, restored).completed, true);
  assert.equal(applyCompletion({ id: 'bad-cache', completed: false }, restored).completed, false);
});
