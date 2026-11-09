// Completion must describe the current student's work, not class-wide activity.
export function isAssignmentCompleted(assignment, submission = assignment?.submission) {
  if (!submission) return false;
  if (submission.excused === true) return true;
  if (submission.redo_request === true) return false;
  if (['submitted', 'pending_review'].includes(submission.workflow_state) || submission.submitted_at) {
    return true;
  }
  if (submission.missing === true || submission.late_policy_status === 'missing') return false;
  if (submission.workflow_state === 'graded' && submission.attempt > 0 &&
      ['online_upload', 'online_text_entry', 'online_url', 'online_quiz',
        'discussion_topic', 'media_recording', 'student_annotation'].includes(submission.submission_type)) {
    return true;
  }

  // Paper/LTI grades can arrive without a submission timestamp. Online grades
  // alone are insufficient: instructors can grade work that was never submitted.
  const types = assignment?.submission_types || [];
  const offline = types.length > 0 && types.every(type =>
    ['none', 'not_graded', 'on_paper', 'external_tool'].includes(type)
  );
  const hasScore = submission.score !== null && submission.score !== undefined;
  return offline && hasScore && (Number(submission.score) > 0 || submission.missing === false);
}

export async function fetchPaginatedCanvasData(url, headers, fetch) {
  const results = [];
  let nextUrl = url.includes('per_page=') ? url : `${url}${url.includes('?') ? '&' : '?'}per_page=100`;
  while (nextUrl) {
    const response = await fetch(nextUrl, { headers, credentials: 'include', cache: 'no-store' });
    if (response.status === 401) throw new Error('unauthorized');
    if (!response.ok) throw new Error(`Canvas request failed (${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data)) return [...results, data];
    results.push(...data);
    const nextLink = (response.headers.get('link') || '').split(',').find(link => link.includes('rel="next"'));
    nextUrl = nextLink?.match(/<([^>]+)>/)?.[1] || null;
  }
  return results;
}

export async function mapCanvasTasks(events, schoolUrl, headers, fetchData, trackedTasks = []) {
  const allEvents = new Map(events.map(event => [String(event.id), event]));
  // upcoming_events can stop returning an assignment immediately after it is
  // submitted. Keep checking tasks already shown so their cached state updates.
  for (const task of trackedTasks) {
    if (task.isManual || task.type !== 'deadline' || !task.assignmentId || !task.courseId ||
        task.schoolUrl !== schoolUrl || allEvents.has(String(task.id))) continue;
    allEvents.set(String(task.id), {
      id: task.id, type: 'assignment', title: task.title, start_at: task.dueDate,
      context_code: `course_${task.courseId}`, context_name: task.course,
      assignment: { id: task.assignmentId, submission_types: task.submissionTypes },
      cachedTask: task
    });
  }

  const courses = new Map();
  for (const event of allEvents.values()) {
    const courseId = event.assignment?.course_id || event.context_code?.match(/^course_(\d+)$/)?.[1];
    if (!courseId || !event.assignment?.id) continue;
    const key = String(courseId);
    if (!courses.has(key)) courses.set(key, new Set());
    courses.get(key).add(String(event.assignment.id));
  }

  const submissions = new Map();
  for (const [courseId, ids] of courses) {
    const assignmentIds = [...ids];
    for (let i = 0; i < assignmentIds.length; i += 20) {
      const chunk = assignmentIds.slice(i, i + 20);
      const query = chunk.map(id => `assignment_ids[]=${encodeURIComponent(id)}`).join('&');
      try {
        // Omitting student_ids requests the authenticated user's submissions.
        const data = await fetchData(`${schoolUrl}/api/v1/courses/${courseId}/students/submissions?${query}`, headers);
        for (const submission of data) {
          if (submission?.assignment_id != null) {
            submissions.set(`${courseId}:${submission.assignment_id}`, submission);
          }
        }
      } catch (error) {
        if (error.message === 'unauthorized') throw error;
        console.warn(`[fetch] Batch submissions unavailable for course ${courseId}: ${error.message}`);
      }
    }
  }

  const tasks = [];
  for (const event of allEvents.values()) {
    const assignment = event.assignment;
    const courseId = assignment?.course_id || event.context_code?.match(/^course_(\d+)$/)?.[1];
    const key = `${courseId}:${assignment?.id}`;
    let submission = submissions.get(key) || assignment?.submission;
    if (!submission && courseId && assignment?.id) {
      try {
        [submission] = await fetchData(`${schoolUrl}/api/v1/courses/${courseId}/assignments/${assignment.id}/submissions/self`, headers);
        if (submission) submissions.set(key, submission);
      } catch (error) {
        if (error.message === 'unauthorized') throw error;
        console.warn(`[fetch] Submission unavailable for assignment ${assignment.id}: ${error.message}`);
      }
    }
    const zoomLink = event.description?.match(/https:\/\/(?:[a-zA-Z0-9-]+\.)?zoom\.us\/j\/\d+/)?.[0] || event.cachedTask?.zoomLink || null;
    const completed = submission ? isAssignmentCompleted(assignment, submission) :
      (event.cachedTask?.canvasCompleted ?? false);
    tasks.push({
      id: String(event.id), type: event.type === 'assignment' ? 'deadline' : 'event',
      title: event.title, course: event.context_name || 'Canvas Course',
      dueDate: event.start_at, zoomLink, completed,
      ...(assignment ? {
        assignmentId: assignment.id, courseId, schoolUrl,
        submissionTypes: assignment.submission_types || [],
        completionKnown: Boolean(submission)
      } : {})
    });
  }
  return tasks;
}
