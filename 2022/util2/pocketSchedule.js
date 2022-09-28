const path = require('path');
const fs = require('fs');
const vm = require('vm');

// A programming item looks like this:
// { 
//   id: '94',
//   title: 'Kerbal Space Program',
//   status?: 'NEW',
//   date: '2021-11-28',
//   time: '12:00',
//   mins: '120',
//   desc: 'Full Description',
//   loc: [ 'Salon 8' ],
//   tags: [ 'Gaming' ],
//   people: [ { name: "Full Name", id:"3" } ]
// }
//
// Items need to span to their end time.  If nothing else starts at the end time, then a placeholder item must be added.
// It's okay for items to overlap - this can happen in an activity room where planned and general events take place.
// - For this reason, a location has two columns, and most entries will colspan=2, except for overlapping events.


const programFile = path.resolve(process.argv[2] || '../data/program.js');
const code = fs.readFileSync(programFile, 'utf8');
const data = vm.runInNewContext(code + '; program');
const program = data.filter(it => it.id != null && it.loc[0] != null && !(it.status || '').match(/Cancelled/i))

const locationsHash = program.reduce((acc, it) => { it.loc.forEach(loc => acc[loc] = true); return acc; }, {});
const allLocations = Object.keys(locationsHash).sort();

const getDisplayTime = (item) => {
  const [hour, minute] = item.time.split(':').map(it => +it);
  return (new Date( 0, 0, 1, hour, minute)).toLocaleTimeString().replace(':00 ', '').toLowerCase();
};

const getEndTime = (item) => {
  const [hour, minute] = item.time.split(':').map(it => +it);
  const timeOfDay = new Date(0, 0, 1, hour, minute + +item.mins);
  const midnightOffset = (timeOfDay.getDate() - 1) * 24;
  return [timeOfDay.getHours() + midnightOffset, timeOfDay.getMinutes()].map(it => it.toString().padStart(2, '0')).join(':');
};

const getWeekdayName = (date) => {
  const dateObj = new Date(...date.split('-').map((it, idx) => idx === 1 ? it-1 : it)); // construct in localtime, not UTC
  const weekday = (dateObj.toLocaleString('en-us', {  weekday: 'long' })); // get the weekday name
  return `${date} ${ weekday }`;
};

// Arrange data per: date => time => location
// { date: { location: {time: entry} } }
const nestedDateLocTimeData = program.reduce((acc, it) => {
  const { date, time } = it;
  const location = it.loc[0];
  acc[date] ||= {};
  acc[date][time] ||= {};

  // Also insert a placeholder event for the end date
  const endDate = getEndTime(it);
  acc[date][endDate] ||= {};
  acc[date][endDate][location] ||= {};

  const item = acc[date][time][location];
  if (item && item.title) {
    console.warn(`OVERLAP DETECTED: ${item.date} ${item.time} ${location}: ${item.title} ${item.status || ''} overlaps ${it.title} ${it.status || ''}`)

    // Sometimes overlap is okay.  Merge the two entries
    // DPM TODO
    it.mins = Math.max(+it.mins, +item.mins);
    it.title += '<br/>/<br/>' + item.title;
  }
  acc[date][time][location] = it;
  return acc;
}, {});

// Arrange data into a 2d array per day, with each axis sorted
// { date: Array.from(Array(#locations), () => new Array(#timeslots)) }
const dayGrids = {};
Object.entries(nestedDateLocTimeData).sort((a,b) => a[0].localeCompare(b[0])).forEach(([date, times]) => {
  const numTimeSlots = Object.keys(times).length;
  dayGrids[date] = Array.from(Array(numTimeSlots), () => new Array(allLocations.length));
  Object.entries(times).sort((a,b) => a[0].localeCompare(b[0])).forEach(([time, locations], timeIndex) => {
    allLocations.forEach((location, locIndex) => {
      const entry = locations[location];
      const defaults = { date, time, mins: 0, location, rowSpan: 0, skip: false };
      dayGrids[date][timeIndex][locIndex] = Object.assign({}, defaults, entry);
      if (entry?.time) {
        dayGrids[date][timeIndex + 1][locIndex] = { ...defaults, time: getEndTime(entry) };
      }
    });
  });
});

// Demark row span areas, and entries to skip 
Object.entries(dayGrids).forEach(([_date, grid]) => {
  grid.forEach((_row, timeIndex, rowAry) => {
    grid[timeIndex].forEach((item, locIndex) => {
      if (!item.title) return;
      itemEndTime = getEndTime(item);
      // See if this item spans any rows
      for (let idx = timeIndex + 1; idx < rowAry.length; idx++) {
        const nextEntry = grid[idx][locIndex];
        if (1 === itemEndTime.localeCompare(nextEntry.time)) {
          nextEntry.skip = true;
          item.rowSpan++;
          // Warn about overlaps
          if (nextEntry.title) {
            console.warn(`OVERLAP DETECTED: ${item.date} ${item.location}: ${item.title} ${item.time} overlaps ${nextEntry.title} ${nextEntry.time}`)
          }
        }
      }
    });
  });
});

// Generate the HTML
const tableStyle = 'style="border: 1px solid black; border-collapse: collapse; vertical-align: top"';
const makeTableElement = (elementName, content, attrs=[]) => `<${elementName} ${attrs.join(' ')}>${content}</${elementName}>`;
const getTR = (content) => makeTableElement('tr', content, [tableStyle]);
const getTD = (content, attr=[]) => makeTableElement('td', content, [tableStyle, ...attr]);
const getTH = (content) => makeTableElement('th', content, [tableStyle]);
const getTable = (content) => makeTableElement('table', content, [tableStyle]);
const html = {};
Object.entries(dayGrids).forEach(([date, grid]) => {
  const headers = ['', ...allLocations].map(it => getTH(it)).join('\n\t\t');
  const rows = ['', getTR(`\n\t\t${headers}\n\t`)];
  grid.forEach((_row, timeIndex) => {
    const columns = [''];
    grid[timeIndex].forEach((item, locIndex) => {
      const rowSpan = item.rowSpan ? `rowspan=${item.rowSpan + 1}` : '';
      const bgColor = item.title ? '' : 'bgcolor="LightGray"';
      if (locIndex === 0) columns.push(getTH(getDisplayTime(item)));
      if (!item.skip) columns.push(getTD(item.title || '', [rowSpan, bgColor]));
    });
    rows.push(getTR(columns.join('\n\t\t')));
  });
  html[date] = getTable(rows.join('\n\t'));
});

let output = '';
Object.entries(html).forEach(([date, table]) => {
  output += `<h2>${ getWeekdayName(date) }</h2>\n${table}`;
});

// Write to output file
fs.writeFileSync('../pocketSchedule.html', output);

