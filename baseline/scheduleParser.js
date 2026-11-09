/**
 * Parses raw Tab-Separated Values (TSV) schedule data copied from the university portal.
 * Returns an array of parsed course objects.
 */
export function parseScheduleTSV(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];

  const lines = rawText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length === 0) return [];

  const parsedCourses = [];

  // Parse header to map column indices to Days
  // e.g. "Time Slot \t Mon 08/06 \t Tue 09/06 ..."
  const headerCells = lines[0].split('\t').map(cell => cell.trim());
  
  // We expect days to start from index 1.
  // We'll normalize the day string to just the first 3 letters uppercase (e.g., 'MON', 'TUE').
  const dayMap = {};
  for (let i = 1; i < headerCells.length; i++) {
    const dayStr = headerCells[i].substring(0, 3).toUpperCase();
    if (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].includes(dayStr)) {
      dayMap[i] = dayStr;
    }
  }

  // Iterate over data rows
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    if (cells.length < 2) continue;

    const timeSlot = cells[0].trim(); // e.g. "7:30AM - 9:00AM"
    
    // Process each day's cell
    for (let colIndex = 1; colIndex < cells.length; colIndex++) {
      if (!dayMap[colIndex]) continue;
      
      const cellData = cells[colIndex].trim();
      if (!cellData) continue; // Empty slot
      
      // Parse the course details using Regex
      // Example format: "- CCINOV8 - INNOVATION AND TECHNOLOGY MANAGEMENT Offline Venue : Online Teacher : Melvin Gabriel Ignacio Room No :"
      // We make the ending "Room No :" optional just in case.
      const match = cellData.match(/-\s*(.*?)\s*-\s*(.*?)\s*(?:Offline\s*)?Venue\s*:\s*(.*?)\s*Teacher\s*:\s*(.*?)(?:\s*Room No\s*:|$)/i);
      
      if (match) {
        parsedCourses.push({
          id: Math.random().toString(36).substring(2, 10), // Unique ID for React keys
          day: dayMap[colIndex],
          timeSlot: timeSlot,
          courseCode: match[1].trim(),
          courseTitle: match[2].trim(),
          venue: match[3].trim(),
          teacher: match[4].trim(),
          isOnline: match[3].trim().toLowerCase() === 'online'
        });
      }
    }
  }

  return parsedCourses;
}
