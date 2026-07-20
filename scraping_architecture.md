# Canvas LMS Scraping Architecture

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
   - **Purpose**: Fetches the user's upcoming calendar events and assignment deadlines.
2. **Assignment Submissions**: `GET /api/v1/courses/:course_id/students/submissions?student_ids[]=self&assignment_ids[]={id}...`
   - **Purpose**: Batches submission status checks for all upcoming assignments found in the previous step, grouped by course.
3. **Active Courses**: `GET /api/v1/courses?enrollment_state=active`
   - **Purpose**: Builds a mapping of `course_id` to human-readable course names.
4. **Announcements**: `GET /api/v1/announcements?context_codes[]={id}...&start_date={iso_date}`
   - **Purpose**: Fetches course announcements from the last 14 days.
5. **Activity Stream (Feedback)**: `GET /api/v1/users/self/activity_stream`
   - **Purpose**: Filters for `Submission` type items to extract recent assignment feedback and comments.

## 3. Edge Cases & Task Tracking Accuracy

The prompt specifically requires a system with **100% accuracy in task tracking**, meaning zero false positives for "Missing" tasks (tasks that appear incomplete or overdue but actually cannot be completed online or have been submitted).

### Current Handling of Edge Cases
Currently, the codebase attempts to address the "unsubmittable" edge case:
- **No Online Submission Required**: If an assignment's `submission_types` exclusively contain `['none', 'not_graded', 'on_paper', 'external_tool']`, the logic marks `isCompleted = true`. This correctly prevents the UI from nagging the user about physical hand-ins or third-party (e.g., Gradescope) assignments that Canvas cannot track natively.
- **Workflow State Verification**: The logic correctly checks for `submitted`, `graded`, and `pending_review` workflow states to mark items as complete.

### Does the Codebase Ensure 100% Accuracy?
**No. The current implementation has several critical flaws that will cause false positives for "Missing" tasks.**

#### Required Improvements:

1. **Pagination Limits (Critical)**
   - The current code does not append `per_page` to any endpoints, nor does it handle the `Link` header for pagination. Canvas defaults to 10 items per page for many endpoints. If a user has more than 10 active courses, or if `activity_stream` pushes deadlines past the first page, tasks will be silently dropped or incorrectly evaluated.
   - **Solution**: Implement a robust pagination utility for all `net.fetch` calls.

2. **URI Too Long (414 Error) Vulnerability**
   - In the submission checking logic, the code groups assignments by course and appends `&assignment_ids[]=...` to the URL. If a course has a large number of assignments, this will exceed URL length limits, causing a failure. If the fetch fails, the assignments will default to incomplete.
   - **Solution**: Chunk the `assignment_ids` array into batches (e.g., 20 IDs per request) and aggregate the results.

3. **External Tools Over-Completion**
   - Currently, `external_tool` is treated as automatically completed. While this prevents "Missing" false positives, it creates "Completed" false positives. 
   - **Solution**: If an assignment is an `external_tool`, the architecture should check if `event.assignment.has_submitted_submissions` is true or if there is a `score`/`grade` attached in the submissions payload before hiding it, rather than blindly marking it completed.

4. **Quizzes and Discussions**
   - Quizzes (especially New Quizzes / LTI) and graded discussions often have anomalous workflow states or missing submission objects in `upcoming_events`. 
   - **Solution**: Ensure LTI quizzes are verified via grade presence, and discussion participation is checked explicitly via the submission API.
