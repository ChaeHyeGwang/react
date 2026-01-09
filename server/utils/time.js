const KST_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

function formatParts(partsArray) {
  return partsArray.reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
}

function getKSTDateTimeString(date = new Date()) {
  const parts = formatParts(KST_FORMATTER.formatToParts(date));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function getKSTDateString(date = new Date()) {
  const parts = formatParts(KST_FORMATTER.formatToParts(date));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

module.exports = {
  getKSTDateTimeString,
  getKSTDateString
};

