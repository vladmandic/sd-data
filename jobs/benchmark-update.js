// triggered by .github/workflows/update-benchmark-data-action.yaml

const fs = require('fs');
const https = require('https');
const process = require('process');
const core = require('@actions/core'); // eslint-disable-line node/no-extraneous-require

const url = 'https://papertrailapp.com/api/v1/events/search.json';
const jsonDataFolder = '../input';
const jsonDataFile = 'benchmark-raw';
const jsonParsedFile = '../pages/benchmark-data.json';
// const mdFile = '../pages/benchmark.md';
let data = { max_id: 0, events: [] };

const log = (...msg) => {
  // console.log('benchmark', ...msg); // eslint-disable-line no-console
  const s = Array.isArray(msg) ? msg.join(' ') : msg;
  core.info(`benchmark ${s}`);
};

const err = (...msg) => {
  // console.error('benchmark', ...msg); // eslint-disable-line no-console
  const s = Array.isArray(msg) ? msg.join(' ') : msg;
  // core.error(`benchmark ${s}`);
  core.setFailed(`benchmark ${s}`);
};

async function get(id) {
  // manual json fetch: `curl -v -H "X-Papertrail-Token: xxx" https://papertrailapp.com/api/v1/events/search.json`
  return new Promise((resolve) => {
    const token = process.env.PAPERTRAIL_TOKEN;
    if (!token) {
      err('missing token');
      resolve([]);
    }
    const headers = { 'x-papertrail-token': token };
    const current = `${url}?min_id=${id}`;

    https.get(current, { headers }, (res) => {
      log(`http response: url=${current} code=${res.statusCode} rate-limit: ${res.headers['x-rate-limit-remaining']}`);
      if (res.statusCode !== 200) {
        err('http request:', res.statusCode, res.statusMessage);
        resolve([]);
      }
      if (!/^application\/json/.test(res?.headers?.['content-type'])) {
        err(`http request invalid content-type: ${res?.headers?.['content-type']}`);
        resolve([]);
      }
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk) => { body += chunk; }); // download data in chunks as json response body may be large
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json);
        } catch (e) {
          err('http data', e.message);
          resolve([]);
        }
      });
    }).on('error', (e) => {
      err(`http get: ${e.message}`);
      resolve([]);
    });
  });
}

async function main() {
  // read existing data
  const today = new Date();
  log('action:', process.env.GITHUB_REPOSITORY, process.env.GITHUB_ACTION);
  log('today', today);

  data = { max_id: 0, events: [] };
  for (const f of fs.readdirSync(jsonDataFolder)) {
    if (f.startsWith(jsonDataFile)) {
      const fileName = jsonDataFolder + '/' + f;
      const fileData = fs.readFileSync(fileName);
      const fileJson = JSON.parse(fileData);
      data.events = data.events.concat(fileJson.events);
      if (fileJson.max_id > data.max_id) data.max_id = fileJson.max_id;
      log(`reading existing data: filename=${fileName} records=${fileJson?.events?.length || 0} total=${data.events.length} maxid=${data.max_id}`);
    }
  }

  // fetch new data
  log('fetching data');
  const res = await get(data?.max_id || 0);
  if ((res?.events?.length > 0) && (data?.max_id !== res?.max_id) || (process.argv.includes('--force'))) {
    data.max_id = res.max_id;
    const combined = data.events.concat(res.events).filter((evt) => evt?.message && evt?.id && (evt?.program === 'SDBENCHMARK')); // combine existing and new data
    combined.forEach((evt) => { // remove private and unnecessary data
      delete evt['source_ip'];
      delete evt['received_at'];
      delete evt['display_received_at'];
      delete evt['source_name'];
      delete evt['hostname'];
      delete evt['severity'];
      delete evt['facility'];
    });
    data.events = combined;
    // save updated data
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const y = String(today.getUTCFullYear());
    const newData = {
      max_id: res.max_id,
      events: data.events.filter((entry) => entry.generated_at.startsWith(`${y}-${m}`)),
    };
    const outputJsonDataFile = jsonDataFolder + '/' + jsonDataFile + `-${y}-${m}.json`;
    log('saving data:', outputJsonDataFile);
    fs.writeFileSync(outputJsonDataFile, JSON.stringify(newData, null, 2));
  } else {
    log('no new data');
    return;
  }

  if (data.events === 0) {
    log('no data');
    return;
  }

  // parse data
  log('parsing data entries:', data.events.length);
  const hashes = [];
  const entries = [];
  let id = 1;
  for (const d of data.events) {
    try {
      if (d.program !== 'SDBENCHMARK') continue;
      const items = d.message.split('|');
      const hash = items.pop().trim(); // remove entry hash
      if (hashes.includes(hash)) continue; // check for duplicates
      const perf = items[1].split('/').map((i) => i.trim());
      if (perf.len < 1 || isNaN(perf[0])) continue; // no valid performance data
      hashes.push(hash);
      items.pop(); // remove system hash
      let date = items[0].split(' ');
      date = date[date.length - 2] + ' ' + date[date.length - 1];
      items[0] = new Date(date).toISOString();
      items.unshift(id++);
      entries.push(items);
    } catch (e) {
      console.log('parsing record:', d); // eslint-disable-line no-console
      err('parsing error:', e.message);
    }
  }
  entries.reverse();
  log('parsed unique entries:', entries.length);

  // save parsed data
  fs.writeFileSync(jsonParsedFile, JSON.stringify(entries, null, 2));
  log('saved:', jsonParsedFile);

  /*
  // create markdown
  log('creating markdown');
  let md = `
  # Benchmark Data

  ## Updated: ${new Date().toISOString()}

  ### Submit data using WebUI extension: <https://github.com/vladmandic/sd-extension-system-info>

  <br>

  |ID|Date|Performance|Version|System|Libraries|GPU Info|Optimizations|Model|Username|Note|
  |---|---|---|---|---|---|---|---|---|---|---|
  `;
  for (const entry of entries) {
    const line = '|' + entry.join('|') + '|';
    md += line + '\n';
  }
  fs.writeFileSync(mdFile, md);
  */

  // done
  log('done');
}

main();
