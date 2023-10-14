/*
  Download latest extension index and fetch details for each
  Set GITHUB_TOKEN environment variable to increase rate limit
*/

const fs = require('fs');
const console = require('console');

let rateLimited = false;
const origin = 'https://raw.githubusercontent.com/AUTOMATIC1111/stable-diffusion-webui-extensions/master/index.json';
const originFile = '../input/a1111-extensions.json';
const outputFile = '../pages/extensions.json';
const listsFolder = '../lists';
const headers = {
  accept: 'application/vnd.github.v3+json',
  'content-type': 'application/json',
  'user-agent': 'nodejs/fetch',
};

const logger = new console.Console({
  stdout: process.stdout,
  stderr: process.stderr,
  ignoreErrors: true,
  inspectOptions: {
    showHidden: false,
    depth: 5,
    colors: true,
    showProxy: true,
    maxArrayLength: 1024,
    maxStringLength: 10240,
    breakLength: process.stdout.columns,
    compact: 64,
    sorted: false,
    getters: false,
  },
});

const log = (...args) => logger.log(...args);

const http = async (url) => {
  try {
    if (rateLimited) return {};
    const res = await fetch(url, { method: 'GET', headers });
    if (res.status !== 200) {
      const limit = parseInt(res.headers.get('x-ratelimit-remaining') || '0');
      if (limit === 0) {
        log(`ratelimit: ${url} used=${res.headers.get('x-ratelimit-used')} remaining=${res.headers.get('x-ratelimit-remaining')} reset=${res.headers.get('x-ratelimit-reset')}`, new Date(1000 * parseInt(res.headers.get('x-ratelimit-reset') || '0'))); // eslint-disable-line
        rateLimited = true;
      } else {
        log(`fetch error: ${res.status} ${res.statusText} ${url}`);
      }
      return {};
    }
    const text = await res.text();
    const obj = JSON.parse(text);
    const json = Array.isArray(obj) ? { array: obj } : obj;
    for (const h of res.headers) json[h[0]] = h[1];
    return json;
  } catch (e) {
    log(`fetch exception: ${e} ${url}`);
    return {};
  }
};

async function getDetails(extension) {
  if (!extension.url || rateLimited) return extension;
  return new Promise(async (resolve) => { // eslint-disable-line no-async-promise-executor
    let name = extension.url.replace('https://github.com/', '');
    if (name.endsWith('.git')) name = name.replace('.git', '');
    const ext = {
      name: extension.name,
      url: extension.url.replace('.git', ''),
      description: extension.description?.substring(0, 64) || '',
      tags: extension.tags || '',
      added: new Date(extension.added) || new Date(),
    };
    if (ext.tags.includes('localization')) {
      // log(`extension skip: ${name}`);
      resolve(ext); // don't fetch details for localization tags
    } else {
      let r = {};
      if (name.startsWith('http')) {
        log('extension not github:', { name });
        resolve(ext);
        return;
      }
      r = await http(`https://api.github.com/repos/${name}`);
      if (!r.full_name) {
        log('extension error:', { name });
        resolve(ext);
      } else {
        ext.created = new Date(r.created_at);
        ext.pushed = new Date(r.pushed_at); // timestamp of last any update
        ext.name = r.name;
        ext.long = r.full_name || r.name;
        ext.description = (r.description || extension.description).substring(0, 200);
        ext.size = r.size;
        ext.stars = r.stargazers_count;
        ext.issues = r.open_issues_count;
        ext.branch = r.default_branch;
        const h = await http(`https://api.github.com/repos/${r.full_name}/commits?per_page=1`);
        ext.updated = h.array?.[0]?.commit?.author?.date || ext.pushed; // timestamp of last commit
        const commits = 1 + parseInt(h.link?.match(/\d+/g).pop() || '0'); // extract total commit count from headers pagination data
        ext.commits = commits;
        ext.status = 0;
        ext.note = '';
        // log(`extension ok: ${name}`);
        resolve(ext);
      }
    }
  });
}

async function discover(data) {
  const search = await http('https://api.github.com/search/repositories?q=stable-diffusion-webui-plugin&per_page=100&sort=updated&order=desc');
  if (!search || !search.items || search.items.length === 0) return [];
  if (!data) data = JSON.parse(fs.readFileSync(outputFile));
  let discovered = 0;
  for (const r of search.items) {
    const ext = {
      name: r.name,
      url: r.clone_url.replace('.git', ''),
      description: r.description?.substring(0, 200) || '',
      tags: '',
      created: new Date(r.created_at),
      pushed: new Date(r.pushed_at),
      updated: new Date(r.updated_at),
      long: r.full_name,
      size: r.size,
      stars: r.stargazers_count,
      issues: r.open_issues_count,
      branch: r.default_branch,
      note: '',
      status: 6,
    };
    const existing = data.find((e) => e.url === ext.url);
    if (!existing) {
      discovered++;
      data.push(ext);
    }
  }
  log('discovered extensions:', { entries: discovered });
  return data;
}

async function curate(data) {
  const dir = fs.readdirSync(listsFolder);
  const curated = data;
  for (const f of dir.sort()) {
    if (!f.endsWith('.json')) {
      log('curation file not-json:', f);
      continue;
    }
    let list = [];
    let entries = 0;
    let appended = 0;
    let ammended = 0;
    let newData = {};
    try {
      list = JSON.parse(fs.readFileSync(`${listsFolder}/${f}`, 'utf8'));
      entries = list.length;
    } catch (e) {
      log('curation file error:', f, e);
      continue;
    }
    for (const ext of list) {
      if (!ext.url) continue;
      if (ext.url.endsWith('.git')) ext.url = ext.url.replace('.git', '');
      const i = curated.findIndex((e) => e.url === ext.url);
      if (ext.url !== curated[i]?.url) newData = await getDetails(ext);
      else newData = {};
      if (i > -1) {
        curated[i] = { ...curated[i], ...newData, ...ext };
        ammended += 1;
      } else {
        curated.push(ext);
        appended += 1;
      }
    }
    log('curation file:', f, { entries, appended, ammended });
  }
  for (const i in curated) {
    if (!curated[i].name || curated[i].name === '') {
      const arr = curated[i].url?.split('/') || ['unknown'];
      curated[i].name = arr[arr.length - 1];
    }
  }
  return curated;
}

async function main() {
  // const repos = await githubRepositories();
  log('action:', { repo: process.env.GITHUB_REPOSITORY, action: process.env.GITHUB_ACTION });
  log('github token:', { token: !!process.env.GITHUB_TOKEN });
  if (process.env.GITHUB_TOKEN) headers['authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  log('fetching extensions index:', { url: origin });
  const index = await http(origin);
  fs.writeFileSync(originFile, JSON.stringify(index, null, 2));

  const extensions = index?.extensions || [];
  log('analyzing extensions:', { entries: extensions.length });

  const promises = [];
  for (const e of extensions) {
    const ext = getDetails(e);
    promises.push(ext);
  }
  let details = await Promise.all(promises);

  const word = process.argv[2];
  if (word) {
    if (details[0][word]) {
      log('sorting by field:', word);
      details.sort((a, b) => b[word] - a[word]);
    } else if (Object.keys(index?.tags || {}).includes(word)) {
      log('filtering by tag:', word);
      details = details.filter((a) => a.tags.includes(word));
    } else {
      log('filtering by keyword:', word);
      details = details.filter((a) => (a.name.includes(word) || a.description.includes(word)));
    }
  }
  details.length = Math.min(parseInt(process.argv[3] || 100000), details.length);
  details = await discover(details);
  details = await curate(details);
  if (rateLimited) {
    log('skipping final write due to rate limit');
  } else {
    log('writing extensions:', { entries: details.length, file: outputFile });
    fs.writeFileSync(outputFile, JSON.stringify(details, null, 2));
  }
}

main();
