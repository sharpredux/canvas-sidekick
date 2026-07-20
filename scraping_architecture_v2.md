# Canvas LMS Scraping Architecture V2

## 1. Overview and Fetching Strategy

The data fetching architecture for the Canvas Sidekick is centralized in the Electron Main process (`electron/main.js`). The core fetching logic resides within `fetchCanvasDataInternal(schoolUrl)`, which makes authenticated HTTP requests directly to the Canvas REST API using Electron's native `net.fetch` module.

The system uses a **cookie-based authentication strategy**:
- It reads an encrypted `canvas_cookie` from the user's `userData` directory.
- It decrypts and injects this cookie into the Electron `session.defaultSession` to authenticate requests.
- This ensures the widget acts on behalf of the authenticated user without requiring manual API tokens.

### Polling Mechanism
- The widget employs a **15-minute polling loop** (`startPolling`).
- To minimize renderer overhead, the main process caches the response and calculates a hash (`JSON.stringify(data)`).
- Data is only sent over IPC to the renderer (`canvas-data-update`) if the hash changes, effectively eliminating wasteful React re-renders for identical data.

## 2. API Endpoints Used

The architecture queries the following endpoints in sequence:
1. **Upcoming Events**: `GET /api/v1/users/self/upcoming_events`
2. **Assignment Submissions**: `GET /api/v1/courses/:course_id/students/submissions?student_ids[]=self&assignment_ids[]={id}...`
3. **Active Courses**: `GET /api/v1/courses?enrollment_state=active`
4. **Announcements**: `GET /api/v1/announcements?context_codes[]={id}...&start_date={iso_date}`
5. **Activity Stream (Feedback)**: `GET /api/v1/users/self/activity_stream`

## 3. Edge Cases & Task Tracking Accuracy: Resolving "Missing" False Positives

The prompt requires a system with **100% accuracy in task tracking**. Currently, some tasks still incorrectly show up as "Missing" even after being submitted (especially in group assignments, or for specific assignment types). 

### Findings on Group Assignments & Individual Edge Cases

1. **Group Assignments (`has_submitted_submissions` and `submitted_at`)**:
   When one student submits on behalf of a group, Canvas copies the submission data to all other group members. However, the `workflow_state` for the non-submitting members might sometimes lag, remain `unsubmitted`, or act unexpectedly. 
   **Key indicators that bypass `workflow_state`**:
   - The submission object will contain a `submitted_at` timestamp if *anyone* in the group submitted.
   - The assignment object itself often sets `has_submitted_submissions: true` if a submission was successfully registered for the user's group context.

2. **Excused Assignments (`excused: true`)**:
   If an instructor excuses a student from an assignment, it is excluded from their grade calculation. The `workflow_state` may remain `unsubmitted`, but the Submissions API returns `excused: true` on the individual submission object. These should be treated as "completed" to prevent nagging.

3. **Complex Submission Types (`discussion_topic`, `online_quiz`)**:
   Online quizzes and discussion topics sometimes don't trigger standard `workflow_state === 'submitted'` transitions immediately, especially if they are auto-graded (`workflow_state` jumps straight to `graded`) or rely on LTI external tools (New Quizzes).
   - If an assignment has a score (`sub.score !== null && sub.score !== undefined`), it must be considered complete regardless of `workflow_state`.

### Exact New Conditions for the Engineer to Add

To fix the remaining "Missing" false positives, the Engineer must update the `isCompleted` evaluation logic in `fetchCanvasDataInternal` (`electron/main.js`). 

The new condition block must explicitly check the following on the `sub` (submission) object and `event.assignment` object:

```javascript
const sub = submissionsScoreMap[event.assignment.id.toString()];

// 1. Explicit Workflow States (Already partially implemented)
if (sub && (sub.workflow_state === 'submitted' || sub.workflow_state === 'graded' || sub.workflow_state === 'pending_review')) {
  isCompleted = true;
}

// 2. The Excused Flag
if (sub && sub.excused === true) {
  isCompleted = true; // The instructor excused the student
}

// 3. The Submitted_At Timestamp (Catches Group Assignments)
if (sub && sub.submitted_at) {
  isCompleted = true; // A file/URL was submitted, even if workflow_state is unsubmitted
}

// 4. The Graded Flag / Score Presence (Catches auto-graded quizzes that bypass 'submitted')
if (sub && sub.score !== null && sub.score !== undefined) {
  isCompleted = true; 
}

// 5. Assignment-Level Submission Flag (Catches Group Assignments)
if (event.assignment.has_submitted_submissions === true) {
  isCompleted = true;
}
```

The Engineer must insert these checks before evaluating the `submission_types` array, ensuring that any of these definitive completion markers immediately mark `isCompleted = true`.
