export const getPrimaryTimeLabel = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = date - now;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  
  if (diff < 0) return 'Past';
  if (hours < 24) return `${hours}h`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

export const getSecondaryTimeLabel = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = date - now;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  
  if (diff < 0) return '';
  if (hours < 24) return 'left';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const isDeadlineUrgent = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = date - now;
  // Urgent if due in less than 24 hours and not in the past
  return diff > 0 && diff < (1000 * 60 * 60 * 24);
};
