import fs from 'fs';

// Mock Headers to simulate Fetch API
class MockHeaders {
  constructor(init = {}) {
    this.map = new Map(Object.entries(init));
  }
  get(name) {
    return this.map.get(name) || null;
  }
}

// Mock net.fetch
const net = {
  fetch: async (url, options) => {
    // console.log(`[Mock Fetch] ${url}`);
    
    if (url.includes('/upcoming_events')) {
      if (!url.includes('page=2')) {
        return {
          status: 200,
          ok: true,
          headers: new MockHeaders({
            link: '<https://canvas.mock/api/v1/users/self/upcoming_events?page=2&per_page=100>; rel="next"'
          }),
          json: async () => {
            let page1 = [
              {
                id: 1,
                title: "Online Upload Assignment",
                type: "assignment",
                context_code: "course_101",
                assignment: { id: 10, submission_types: ["online_upload"] } // Should be marked completed via submission state
              },
              {
                id: 2,
                title: "External Tool Assignment (Graded)",
                type: "assignment",
                context_code: "course_101",
                assignment: { id: 11, submission_types: ["external_tool"] } // Should be completed via score
              },
              {
                id: 3,
                title: "No Submission Assignment",
                type: "assignment",
                context_code: "course_101",
                assignment: { id: 12, submission_types: ["none"] } // Should be completed automatically
              },
              {
                id: 5,
                title: "Group Assignment",
                type: "assignment",
                context_code: "course_101",
                assignment: { id: 13, submission_types: ["online_upload"] }
              },
              {
                id: 6,
                title: "Excused Assignment",
                type: "assignment",
                context_code: "course_101",
                assignment: { id: 14, submission_types: ["online_upload"] }
              },
              {
                id: 7,
                title: "Third-party Quiz",
                type: "assignment",
                context_code: "course_101",
                assignment: { id: 15, submission_types: ["external_tool"] }
              }
            ];
            // Add 16 more to course_101 to push the total for course_101 to 22 (testing > 20 batching)
            for (let i = 16; i <= 31; i++) {
              page1.push({
                id: i * 10,
                title: `Batch Assignment ${i}`,
                type: "assignment",
                context_code: "course_101",
                assignment: { id: i, submission_types: ["online_upload"] }
              });
            }
            return page1;
          }
        };
      } else {
        return {
          status: 200,
          ok: true,
          headers: new MockHeaders(), // No next link
          json: async () => ([
            {
              id: 4,
              title: "External Tool (Not Graded)",
              type: "assignment",
              context_code: "course_102",
              assignment: { id: 40, submission_types: ["external_tool"] } // Should remain incomplete
            }
          ])
        };
      }
    }
    
    if (url.includes('/submissions')) {
      // Return mocked submissions for the requested assignment IDs
      const urlObj = new URL(url);
      const assignmentIds = urlObj.searchParams.getAll('assignment_ids[]');
      
      const submissions = assignmentIds.map(id => {
        if (id === '10') {
          return { assignment_id: 10, workflow_state: 'submitted' };
        } else if (id === '11') {
          return { assignment_id: 11, workflow_state: 'unsubmitted', score: 95 }; // Graded external tool
        } else if (id === '40') {
          return { assignment_id: 40, workflow_state: 'unsubmitted', score: null }; // Ungraded external tool
        } else if (id === '13') {
          return { assignment_id: 13, workflow_state: 'unsubmitted', submitted_at: '2026-07-21T00:00:00Z' }; // Group assignment
        } else if (id === '14') {
          return { assignment_id: 14, workflow_state: 'unsubmitted', excused: true }; // Excused
        } else if (id === '15') {
          return { assignment_id: 15, workflow_state: 'unsubmitted', score: 80 }; // Third-party Quiz
        } else {
          return { assignment_id: parseInt(id), workflow_state: 'unsubmitted' };
        }
      });
      
      return {
        status: 200,
        ok: true,
        headers: new MockHeaders(),
        json: async () => submissions
      };
    }
    
    return {
      status: 404,
      ok: false,
      headers: new MockHeaders(),
      json: async () => ({})
    };
  }
};

// ---------------------------------------------------------
// Copied functions from main.js for testing
// ---------------------------------------------------------

async function fetchPaginatedCanvasData(url, headers) {
  let results = [];
  let nextUrl = url;
  if (!nextUrl.includes('per_page=')) {
    nextUrl += nextUrl.includes('?') ? '&per_page=100' : '?per_page=100';
  }

  while (nextUrl) {
    const res = await net.fetch(nextUrl, { headers, credentials: 'include' });
    if (res.status === 401) {
      throw new Error('unauthorized');
    }
    if (!res.ok) break;
    
    const data = await res.json();
    if (Array.isArray(data)) {
      results = results.concat(data);
    } else {
      results.push(data);
      break;
    }

    const linkHeader = res.headers.get('link');
    let foundNext = false;
    if (linkHeader) {
      const links = linkHeader.split(',');
      const nextMatch = links.find(l => l.includes('rel="next"'));
      if (nextMatch) {
        const urlMatch = nextMatch.match(/<([^>]+)>/);
        if (urlMatch) {
          nextUrl = urlMatch[1];
          foundNext = true;
        }
      }
    }
    if (!foundNext) break;
  }
  return results;
}

async function testLogic() {
  const schoolUrl = 'https://canvas.mock';
  const headers = {};
  
  // 1. Fetch upcoming events using pagination
  let eventsData = await fetchPaginatedCanvasData(`${schoolUrl}/api/v1/users/self/upcoming_events`, headers);
  
  // Group assignment IDs by course for batch submission fetching
  const courseAssignments = {};
  eventsData.forEach(event => {
    if (event.assignment && event.context_code && event.context_code.startsWith('course_')) {
      const courseId = event.context_code.split('_')[1];
      if (!courseAssignments[courseId]) courseAssignments[courseId] = [];
      courseAssignments[courseId].push(event.assignment.id);
    }
  });

  const submissionsMap = {}; // mapping of assignment_id -> workflow_state
  const submissionsScoreMap = {}; // mapping of assignment_id -> submission object
  
  let fetchCallCount = 0;
  let batchSizes = [];

  // Overriding net.fetch briefly to spy on batch requests
  const originalFetch = net.fetch;
  net.fetch = async (url, opts) => {
    if (url.includes('/submissions')) {
      fetchCallCount++;
      const urlObj = new URL(url);
      batchSizes.push(urlObj.searchParams.getAll('assignment_ids[]').length);
    }
    return originalFetch(url, opts);
  };

  for (const [courseId, assignmentIds] of Object.entries(courseAssignments)) {
    // Chunk into 20 per request to prevent URI Too Long (414)
    for (let i = 0; i < assignmentIds.length; i += 20) {
      const chunk = assignmentIds.slice(i, i + 20);
      const query = chunk.map(id => `assignment_ids[]=${id}`).join('&');
      try {
        const subData = await fetchPaginatedCanvasData(`${schoolUrl}/api/v1/courses/${courseId}/students/submissions?student_ids[]=self&${query}`, headers);
        if (Array.isArray(subData)) {
          subData.forEach(sub => {
            submissionsMap[sub.assignment_id.toString()] = sub.workflow_state;
            submissionsScoreMap[sub.assignment_id.toString()] = sub;
          });
        }
      } catch (err) {
        console.error(`[fetch] Failed to fetch submissions for course ${courseId}:`, err);
      }
    }
  }
  
  net.fetch = originalFetch;

  // Map to widget schema
  const mappedEvents = eventsData.map(event => {
    let zoomLink = null;
    if (event.description) {
      const match = event.description.match(/https:\/\/(?:[a-zA-Z0-9-]+\.)?zoom\.us\/j\/\d+/);
      if (match) zoomLink = match[0];
    }

    let isCompleted = false;
    if (event.assignment) {
      const sub = submissionsScoreMap[event.assignment.id.toString()];

      // 1. Explicit Workflow States
      if (sub && (sub.workflow_state === 'submitted' || sub.workflow_state === 'graded' || sub.workflow_state === 'pending_review')) {
        isCompleted = true;
      }
      
      // 2. The Excused Flag
      if (!isCompleted && sub && sub.excused === true) {
        isCompleted = true;
      }

      // 3. The Submitted_At Timestamp (Catches Group Assignments)
      if (!isCompleted && sub && sub.submitted_at) {
        isCompleted = true;
      }

      // 4. The Graded Flag / Score Presence
      if (!isCompleted && sub && sub.score !== null && sub.score !== undefined) {
        isCompleted = true;
      }

      // 5. Assignment-Level Submission Flag
      if (!isCompleted && event.assignment.has_submitted_submissions === true) {
        isCompleted = true;
      }

      // 6. Fallback in case upcoming_events embedded it anyway
      if (!isCompleted && event.assignment.submission && event.assignment.submission.workflow_state) {
        const embeddedState = event.assignment.submission.workflow_state;
        if (embeddedState === 'submitted' || embeddedState === 'graded' || embeddedState === 'pending_review') {
          isCompleted = true;
        }
      }
      
      // 7. Edge Case: Assignments that do not require online submissions
      // Prevent "Missing" false positives for assignments the user literally cannot submit online
      if (!isCompleted && event.assignment.submission_types) {
        const sTypes = event.assignment.submission_types;
        const canSubmitOnline = sTypes.some(type => 
          !['none', 'not_graded', 'on_paper', 'external_tool'].includes(type)
        );
        if (!canSubmitOnline) {
          if (sTypes.includes('external_tool')) {
            const sub = submissionsScoreMap[event.assignment.id.toString()];
            const hasScore = sub && sub.score !== null && sub.score !== undefined;
            const hasSubmittedSubmissions = event.assignment.has_submitted_submissions === true;
            if (hasScore || hasSubmittedSubmissions) {
              isCompleted = true;
            }
          } else {
            // Since it can't be submitted online (and isn't an external tool), we mark it as completed to prevent false 'Missing' flags
            isCompleted = true;
          }
        }
      }
    }

    return {
      id: event.id.toString(),
      type: event.type === 'assignment' ? 'deadline' : 'event',
      title: event.title,
      course: event.context_name || 'Canvas Course',
      dueDate: event.start_at,
      zoomLink,
      completed: isCompleted
    };
  });

  // Verify Results
  console.log("=== Verification Results ===");
  console.log(`Total Events Parsed: ${mappedEvents.length}`);
  console.log(`Submission API calls: ${fetchCallCount}`);
  console.log(`Batch Sizes: ${batchSizes.join(', ')}`);

  const results = {};
  mappedEvents.forEach(e => {
    results[e.title] = e.completed;
  });

  const assert = (condition, msg) => {
    if (!condition) {
      console.error(`❌ FAIL: ${msg}`);
      process.exitCode = 1;
    } else {
      console.log(`✅ PASS: ${msg}`);
    }
  };

  // Pagination verification
  assert(mappedEvents.length === 23, `Pagination fetched all 23 items (got ${mappedEvents.length})`);
  
  // Batch verification
  assert(batchSizes.includes(20) && batchSizes.includes(2), "Batching successfully split >20 into chunks of 20 and 2");
  
  // Completion verification
  assert(results["Online Upload Assignment"] === true, "Online Upload marked complete via workflow_state='submitted'");
  assert(results["External Tool Assignment (Graded)"] === true, "External Tool marked complete via score check");
  assert(results["No Submission Assignment"] === true, "None submission type marked complete automatically");
  assert(results["External Tool (Not Graded)"] === false, "External Tool without score left incomplete");
  
  // 3 New edge case verifications
  assert(results["Group Assignment"] === true, "Group Assignment marked complete via submitted_at");
  assert(results["Excused Assignment"] === true, "Excused Assignment marked complete via excused flag");
  assert(results["Third-party Quiz"] === true, "Third-party Quiz marked complete via score !== null");

  if (process.exitCode !== 1) {
    console.log("\\nAll tests passed perfectly! The refactor works as expected.");
  }
}

testLogic();
