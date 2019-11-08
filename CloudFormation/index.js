'use strict';

const Octokat = require('octokat');
const { processGoogleSheets } = require('./gsheet');


async function updateKonopasFiles() {
  const octo = new Octokat({ token: config.github.token });
  const repo = octo.repos(config.github.username, config.github.reponame);
  const subdir = config.repository.subdir.replace(/(.*[^/])[/]?$/, '$1/');
  const branch = config.repository.branch || 'heads/master';

  const getAppCache = async (repo, branch, subdir) => {
    const content = await repo.contents(`${subdir}konopas.appcache`).read({ branch });
    const now = (new Date()).toISOString().slice(0,19).replace('T', ' ');
    return content.replace(/[\n\r]+#.*/, `\n# ${now}`);
  }
  
  const files = [
    {
      path: `${subdir}konopas.appcache`,
      content: await getAppCache(repo, branch, subdir),
    },
    {
      path: `${subdir}data/people.js`,
      key: config.gdrive.people.key,
      gid: config.gdrive.people.gid,
      jsvar: 'people', // used by konopas
      content: '',
    },
    {
      path: `${subdir}data/program.js`,
      key: config.gdrive.program.key,
      gid: config.gdrive.program.gid,
      jsvar: 'program', // used by konopas
      content: '',
    },
  ];

  // Populate files structure with file contents from google sheets
  // TODO: rewrite this routine to use the Google APIs instead of using the CSV URL
  await processGoogleSheets(files);

  const main = await repo.git.refs(branch).fetch();
  const tree = await repo.git.trees.create({
    base_tree: main.object.sha,
    tree: files.map(entry => ({
      path: entry.path,
      content: entry.content,
      mode: '100644',
      type: 'blob',
    })),
  });

  const commit = await repo.git.commits.create({
    message: 'Scripted publish.',
    tree: tree.sha,
    parents: [main.object.sha],
  });

  await main.update({ sha: commit.sha });
  console.log('Done!');
}

// TODO: lambda + encrypted DynamoDB (where these configurations will live)
// TODO: need to get inputs from some kind of configuration service/cache:
// - google drive spreadsheet key + GIDs (per tab).
// - github personal token
// - github user + repository
// - (repository subdirectory) year
// - (optional) repository branch (TODO: why doesn't 'master' work?)
const config = {
  github: {
    token: '', // Note: Fill this in locally until this structure is migrated to MongoDB
    username: 'dpmott',
    reponame: 'StarbaseIndy',
  },
  repository: {
    branch: 'heads/master',
    subdir: '2019', // TODO: maybe this needs to be grouped with the gdrive data?
  },
  gdrive: {
    program: {
      key: '1Qe_AiFvB7wAiCXkb2jhXAN6kA8tBbY0_FTpJz2rXXhs',
      gid: '0',
    },
    people: {
      key: '1Qe_AiFvB7wAiCXkb2jhXAN6kA8tBbY0_FTpJz2rXXhs',
      gid: '958660582',
    },
  },
};
updateKonopasFiles(config);
